"""State partition, streaming split, seam/dedup and checkpoint regressions."""
import contextlib
import gzip
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_states as states
import build_trails as build
from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import unary_union


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)

    def raw(self, folder, features):
        folder.mkdir(parents=True, exist_ok=True)
        for src in build.SOURCES:
            path = folder / (src + '-0.jsonl.gz')
            with gzip.open(path, 'wt') as f:
                for feature in features.get(src, []):
                    f.write(json.dumps(feature) + '\n')
            states.write_json(path.with_suffix('.done.json'), {'date': '2025-05-11', 'features': len(features.get(src, []))})

    @staticmethod
    def feature(coords, **props):
        return {'type': 'Feature', 'geometry': mapping(LineString(coords)), 'properties': props}

    def test_partition_covers_buffered_coasts_without_area_overlap(self):
        originals = {'AA': box(-72, 40, -71, 41), 'BB': box(-71, 40, -70, 41)}
        owners = states.ownership_polygons(originals, (-73, 39, -69, 42))
        a, b = owners['AA'][0], owners['BB'][0]
        expected = unary_union([g.buffer(.05) for g in originals.values()])
        self.assertLess(a.intersection(b).area, 1e-12)
        self.assertLess(a.union(b).symmetric_difference(expected).area, 1e-12)
        self.assertFalse(owners['BB'][1].is_empty)
        # An entire feature coincident with the shared edge belongs only to AA.
        edge = a.boundary.intersection(b.boundary)
        self.assertAlmostEqual(edge.difference(owners['BB'][1]).length, 0)

    def test_stream_split_routes_margin_and_preserves_rows_and_dates(self):
        folder = self.work / 'national'
        feature = self.feature([(-71.005, 40.5), (-71.001, 40.5)], trail_name='Ridge')
        feature['_date'] = '2024-04-02'
        self.raw(folder, {'usfs_trails': [feature]})
        path = folder / 'usfs_trails-0.jsonl.gz'
        owners = {'AA': (box(-72, 40, -71, 41), LineString()), 'BB': (box(-71, 40, -70, 41), LineString()), 'CC': (box(-69, 40, -68, 41), LineString())}
        dest = {code: self.work / code for code in owners}
        counts = states.split_file(path, dest, owners)
        self.assertEqual(counts, {'AA': 1, 'BB': 1})
        for code in ('AA', 'BB'):
            with gzip.open(dest[code] / path.name, 'rt') as f:
                self.assertEqual(json.loads(f.readline()), json.loads(json.dumps(feature)))
        marker = json.loads((dest['CC'] / path.name).with_suffix('.done.json').read_text())
        self.assertEqual(marker['features'], 0)
        self.assertEqual(marker['date'], '2025-05-11')

    def test_normalize_indexes_margin_before_ownership_clip(self):
        folder = self.work / 'AA'
        self.raw(folder / 'raw', {
            'nps_trails': [self.feature([(-70.012, 40.5), (-70.0001, 40.5)], TRLUSE='Hike')],
            'usgs_ndt': [self.feature([(-70.012, 40.5), (-69.9998, 40.5)], sourceoriginator='US Fish and Wildlife Service', hikerpedestrian='Y')],
        })
        with contextlib.redirect_stdout(io.StringIO()):
            build.normalize(SimpleNamespace(work=self.work, region='AA'), ownership=box(-70, 40, -69, 41))
        stats = json.loads((folder / 'stats.json').read_text())
        self.assertEqual(stats['excluded']['usgs_ndt:spatial_duplicate'], 1)
        self.assertEqual((folder / 'trails.geojsonl').read_text(), '')

    def test_state_output_seams_match_unpartitioned_geometry(self):
        owners = states.ownership_polygons({'AA': box(-72, 40, -71, 41), 'BB': box(-71, 40, -70, 41)}, (-73, 39, -69, 42))
        feature = self.feature([(-71.2, 40.5), (-70.8, 40.5)], trail_name='Crossing', hiker_pedestrian_managed='Y')
        geometries = []
        for code, (owned, excluded) in owners.items():
            folder = self.work / code
            self.raw(folder / 'raw', {'usfs_trails': [feature]})
            with contextlib.redirect_stdout(io.StringIO()):
                build.normalize(SimpleNamespace(work=self.work, region=code), ownership=owned, excluded_boundary=excluded)
            rows = [json.loads(row) for row in (folder / 'trails.geojsonl').read_text().splitlines()]
            self.assertTrue(rows)
            self.assertEqual(rows[0]['tippecanoe'], {'minzoom': 8, 'maxzoom': 14})
            geometries.extend(shape(row['geometry']) for row in rows)
        self.assertAlmostEqual(sum(g.length for g in geometries), .4, places=6)
        self.assertAlmostEqual(unary_union(geometries).length, .4, places=6)
        self.assertEqual(list(geometries[0].coords)[-1], list(geometries[1].coords)[0])

    def test_manifest_resume_and_failure_are_persistent(self):
        path = self.work / 'build-manifest.json'
        manifest = states.Manifest(path, ['DE', 'RI'], 'v2')
        states.stage(manifest, 'partition', lambda: None)
        again = states.Manifest(path, ['DE', 'RI'], 'v2')
        states.stage(again, 'partition', lambda: self.fail('completed stage reran'))
        with self.assertRaisesRegex(RuntimeError, 'broken'):
            states.stage(again, 'tiles', lambda: (_ for _ in ()).throw(RuntimeError('broken')), 'DE')
        entry = json.loads(path.read_text())['states']['DE']['tiles']
        self.assertEqual((entry['status'], entry['error']), ('failed', 'broken'))
        states.stage(again, 'tiles', lambda: None, 'DE')
        self.assertTrue(again.done('tiles', 'DE'))
        with self.assertRaises(RuntimeError):
            states.Manifest(path, ['RI'], 'v2')

    def test_cleanup_retains_archives_until_verified_upload(self):
        folder = self.work / 'lower48/states/DE'
        (folder / 'raw').mkdir(parents=True)
        for name in ('trails.geojsonl', 'index.sqlite', 'low.pmtiles', 'high.pmtiles', 'stats.json'):
            (folder / name).write_text('test')
        states.cleanup_state(self.work, 'DE')
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ['high.pmtiles', 'low.pmtiles', 'stats.json'])

    def test_missing_source_is_never_silently_accepted(self):
        with self.assertRaisesRegex(RuntimeError, 'Incomplete national download'):
            states.source_paths(self.work)

    def test_empty_state_skips_tippecanoe(self):
        folder = self.work / 'lower48/states/RI'
        states.write_json(folder / 'stats.json', {'sources': {}})
        with patch.object(build, 'tile_ranges') as tile_ranges:
            states.tile_state(self.work, 'RI')
        tile_ranges.assert_not_called()


class UploadContractTests(unittest.TestCase):
    def test_parts_precede_verified_manifest_and_reassemble_exactly(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            folder = work / 'lower48'
            folder.mkdir()
            content = b'complete archive bytes crossing part boundaries'
            (folder / 'trails.pmtiles').write_bytes(content)
            remote, events = {}, []

            def wrangler(*args, **kwargs):
                if args[:3] == ('r2', 'bucket', 'list'):
                    return SimpleNamespace(stdout='name: fhm-tiles\n', returncode=0)
                action, key = args[2:4]
                events.append((action, key))
                file = Path(args[args.index('--file') + 1])
                if action == 'put':
                    remote[key] = file.read_bytes()
                elif key not in remote:
                    return SimpleNamespace(stdout='404 not found', returncode=1)
                else:
                    file.write_bytes(remote[key])
                return SimpleNamespace(stdout='', returncode=0)

            with patch.object(build, 'PART_SIZE', 13), patch.object(build, 'wrangler', wrangler), contextlib.redirect_stdout(io.StringIO()):
                build.upload(SimpleNamespace(work=work, region='lower48', version='v2'))
            manifest = json.loads(remote['fhm-tiles/trails/v2/manifest.json'])
            self.assertEqual(set(manifest), {'size', 'partSize', 'parts', 'sha256', 'built', 'bounds'})
            parts = [remote[f'fhm-tiles/trails/v2/part-{i:03}'] for i in range(manifest['parts'])]
            self.assertEqual(b''.join(parts), content)
            self.assertTrue(all(len(part) == 13 for part in parts[:-1]))
            self.assertEqual(events[-2:], [('put', 'fhm-tiles/trails/v2/manifest.json'), ('get', 'fhm-tiles/trails/v2/manifest.json')])
            self.assertEqual(json.loads((folder / 'verified-manifest.json').read_text()), manifest)
            self.assertFalse((folder / 'upload-part').exists())


if __name__ == '__main__':
    unittest.main()
