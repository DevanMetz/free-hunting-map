"""Run: python3 -m unittest discover -s scripts/terrain -p 'test_*.py'."""
import contextlib
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wi_blocks as wi
import upload


class BlockMath(unittest.TestCase):
    def test_round_trip(self):
        for x in range(61, 67):
            for y in range(89, 95):
                w, s, e, n = wi.tile_bounds(x, y)
                self.assertEqual(wi.tile_xy((w+e)/2, (s+n)/2), (x, y))
                a, b, c, d = wi.merc_bounds(x, y)
                self.assertAlmostEqual(c-a, 2*wi.WORLD/256, places=7)
                self.assertAlmostEqual(d-b, 2*wi.WORLD/256, places=7)
                self.assertAlmostEqual(a, math.radians(w)*wi.R, places=7)
                self.assertAlmostEqual(d, wi.R*math.asinh(math.tan(math.radians(n))), places=7)

    def test_zone_edge_and_clark(self):
        self.assertEqual(wi.tile_bounds(63, 92)[2], -90)
        self.assertEqual(wi.tile_bounds(64, 92)[0], -90)
        self.assertEqual(wi.tile_xy(-90.65, 44.75), (63, 92))
        x, y = wi.tile_xy(-90.65, 44.75, 14)
        self.assertEqual((x >> 6, y >> 6), (63, 92))

    def test_edges(self):
        self.assertEqual(wi.tile_xy(-180, 90), (0, 0))
        self.assertEqual(wi.tile_xy(180, -90), (255, 255))

    def test_wi_blocks(self):
        if not (wi.BASE/'cb_2024_us_state_500k.zip').exists():
            self.skipTest('Census state ZIP is not installed')
        state, buffered = wi.state_polygon()
        blocks = wi.make_blocks(state, buffered)
        self.assertEqual(blocks[0]['id'], 'b8-63-92')
        self.assertEqual(len(blocks), 23)
        self.assertEqual(len({b['id'] for b in blocks}), len(blocks))
        self.assertEqual([b['km2'] for b in blocks[1:]], sorted((b['km2'] for b in blocks[1:]), reverse=True))
        from shapely.geometry import shape
        from shapely.ops import unary_union
        union = unary_union([shape(b['geometry']) for b in blocks])
        self.assertLess(union.symmetric_difference(buffered).area, 1e-9)
        self.assertGreater(sum(b['km2'] for b in blocks), 140000)

    def test_partial_block_polygon(self):
        from shapely.geometry import box
        state = box(-90.1, 44.7, -89.9, 44.8)
        blocks = wi.make_blocks(state, state)
        self.assertEqual({b['id'] for b in blocks}, {'b8-63-92', 'b8-64-92'})


class Resume(unittest.TestCase):
    def test_first_unfinished(self):
        block = {'stages': {}}
        self.assertEqual(wi.next_stage(block), 'dem')
        for stage in wi.STAGES:
            block['stages'][stage] = {'status': 'running'}
            self.assertEqual(wi.next_stage(block), stage)
            block['stages'][stage]['status'] = 'skipped' if stage == 'archive' else 'done'
        self.assertIsNone(wi.next_stage(block))

    def test_atomic_replace(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'manifest.json'
            wi.atomic_json(path, {'a': 1})
            wi.atomic_json(path, {'b': 2})
            self.assertEqual(json.loads(path.read_text()), {'b': 2})
            self.assertFalse(path.with_suffix('.json.tmp').exists())

    def test_lock(self):
        with tempfile.TemporaryDirectory() as d, wi.lock(Path(d)):
            with self.assertRaises(RuntimeError), wi.lock(Path(d)):
                pass

    def test_resume_skips_finished_stages(self):
        block = dict(id='b8-63-92', status='running', km2=10, attempts=0,
                     stages={s: {'status': 'done'} for s in wi.STAGES[:4]})
        calls = []
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': [block]})
            for stage in wi.STAGES:
                setattr(runner, stage, lambda s=stage: calls.append(s))
            with contextlib.redirect_stdout(io.StringIO()):
                runner.run()
            self.assertEqual(calls, ['upload', 'archive', 'cleanup'])
            self.assertEqual(block['status'], 'done')

    def test_three_failures_then_continue(self):
        blocks = [dict(id=f'b8-{x}-92', status='pending', km2=1, attempts=0, stages={}) for x in (63, 64)]
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': blocks})
            def dem():
                if runner.block['id'] == 'b8-63-92':
                    raise IOError('network failed')
            runner.dem = dem
            for stage in wi.STAGES[1:]:
                setattr(runner, stage, lambda: None)
            with patch('wi_blocks.time.sleep'), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                runner.run()
            self.assertEqual(blocks[0]['status'], 'failed')
            self.assertEqual(blocks[0]['attempts'], 3)
            self.assertEqual(blocks[1]['status'], 'done')

    def test_download_range_resume(self):
        class Response(io.BytesIO):
            status = 206
            headers = {'Content-Range': 'bytes 3-5/6', 'Content-Length': '3'}
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'a.tif'
            path.with_suffix('.tif.partial').write_bytes(b'abc')
            with patch('urllib.request.urlopen', return_value=Response(b'def')) as request:
                wi.download('https://example.test/a', path, 6)
                self.assertEqual(request.call_args.args[0].headers['Range'], 'bytes=3-')
            self.assertEqual(path.read_bytes(), b'abcdef')

    def test_download_ignored_range_restarts(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Length': '6'}
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'a.tif'
            path.with_suffix('.tif.partial').write_bytes(b'abc')
            with patch('urllib.request.urlopen', return_value=Response(b'abcdef')):
                wi.download('https://example.test/a', path, 6)
            self.assertEqual(path.read_bytes(), b'abcdef')

    def test_acquisition_not_las_packaging_year(self):
        self.assertEqual(wi.project_year('USGS_LPC_WI_OneidaCo_2013_LAS_2019'), 2013)
        self.assertEqual(wi.project_year('WI_12County_9_B22'), 2022)
        self.assertEqual(wi.project_year('MN_FullState'), 0)

    def test_interrupted_stage_counts_attempt(self):
        block = dict(id='b8-63-92', status='running', km2=1, attempts=0,
                     stages={'dem': {'status': 'running'}})
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': [block]})
            for stage in wi.STAGES:
                setattr(runner, stage, lambda: None)
            with contextlib.redirect_stdout(io.StringIO()):
                runner.run()
            self.assertEqual(block['attempts'], 1)
            self.assertEqual(block['status'], 'done')


class Prefix(unittest.TestCase):
    def test_prefix(self):
        self.assertEqual(wi.block_version('b8-63-92'), 'v2/b8-63-92')
        for version in ('v1', 'v2', 'v9999', 'v2/b8-63-92'):
            self.assertTrue(upload.valid_version(version))
        for version in ('v1/b8-63-92', 'v2/../v1', 'v2/b8-256-92', 'v0', 'v2/b8-1-2/part-001'):
            self.assertFalse(upload.valid_version(version))
        with self.assertRaises(ValueError):
            wi.block_version('../v1')


class RasterSemantics(unittest.TestCase):
    def test_newest_wins_gap_fill_replay(self):
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        from mosaic import merge_raster
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            profile = dict(driver='GTiff', width=16, height=16, count=1, dtype='float32',
                           nodata=-999999, crs='EPSG:26915', transform=from_origin(500000, 5000000, 1, 1))
            newest = np.full((16, 16), 20, dtype='float32')
            newest[:4, :4] = -999999
            older = np.full((16, 16), 10, dtype='float32')
            for name, data in [('new', newest), ('old', older)]:
                with rasterio.open(d/(name+'.tif'), 'w', **profile) as dst:
                    dst.write(data, 1)
            bounds = (500000, 4999984, 500016, 5000000)
            for name in ('new', 'new', 'old', 'old'):
                merge_raster(d/(name+'.tif'), d/'merged.tif', bounds, fill_only=True)
            with rasterio.open(d/'merged.tif') as src:
                a = src.read(1)[40:56, 40:56]
            expected = newest.copy()
            expected[:4, :4] = 10
            np.testing.assert_array_equal(a, expected)

    def test_half_pixel_sources_use_common_grid(self):
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        from rasterio.vrt import WarpedVRT
        from mosaic import merge_raster
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            prof = dict(driver='GTiff', width=32, height=32, count=1, dtype='float32', crs='EPSG:26915', nodata=-999999)
            with rasterio.open(d/'first.tif', 'w', transform=from_origin(500000, 5000000, 1, 1), **prof) as dst:
                dst.write(np.full((32, 32), -999999, dtype='float32'), 1)
            with rasterio.open(d/'shifted.tif', 'w', transform=from_origin(500000.5, 5000000.5, 1, 1), **prof) as dst:
                dst.write(np.arange(1024, dtype='float32').reshape(32, 32), 1)
            bounds = (500000, 4999968, 500032, 5000000)
            merge_raster(d/'first.tif', d/'merged.tif', bounds, halo=0, fill_only=True)
            merge_raster(d/'shifted.tif', d/'merged.tif', bounds, halo=0, fill_only=True)
            with rasterio.open(d/'merged.tif') as actual, rasterio.open(d/'shifted.tif') as src:
                with WarpedVRT(src, crs=actual.crs, transform=actual.transform, width=32, height=32,
                               nodata=-999999, resampling=rasterio.enums.Resampling.bilinear) as expected:
                    np.testing.assert_array_equal(actual.read(1), expected.read(1))
            # A newly allocated chunk must use the same origin, even when its first source is shifted.
            merge_raster(d/'shifted.tif', d/'new.tif', bounds, halo=0, fill_only=True)
            with rasterio.open(d/'new.tif') as src:
                self.assertEqual(src.transform.c, 500000)
                self.assertEqual(src.transform.f, 5000000)

    def test_native_chunk_retirement_and_resume_preserve_derivatives(self):
        import os
        import subprocess
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        from mosaic import merge_tiles, main as mosaic
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            group = d/'group'; group.mkdir()
            rows, cols = np.mgrid[:500, :300]
            with rasterio.open(d/'dem.tif', 'w', driver='GTiff', width=300, height=500, count=1,
                               dtype='float32', crs='EPSG:26915', nodata=-999999,
                               transform=from_origin(500000, 5000000, 1, 1)) as dst:
                dst.write((300+np.sin(rows/15)+np.cos(cols/11)).astype('float32'), 1)
            merge_tiles(d/'dem.tif', group, (500000, 4999500, 500300, 5000000), block=128)
            wi.atomic_json(group/'items.json', [dict(downloadURL=p.name, publicationDate='2020-01-01') for p in group.glob('dem_*.tif')])
            mosaic(str(group))
            env = {**os.environ, 'BLOCK': '128', 'WORKERS': '1', 'OPENBLAS_NUM_THREADS': '1', 'GDAL_CACHEMAX': '32'}
            command = [sys.executable, str(wi.SCRIPTS/'derive.py'), str(group/'mosaic.vrt')]
            subprocess.run([*command, str(d/'baseline')], env=env, check=True, stdout=subprocess.DEVNULL)
            env['DEM_CONSUME'] = str(group)
            subprocess.run([*command, str(d/'consume')], env=env, check=True, stdout=subprocess.DEVNULL)
            self.assertFalse(list(group.glob('dem_*_000.tif')))
            for path in (d/'baseline').glob('*/*.tif'):
                with rasterio.open(path) as expected, rasterio.open(d/'consume'/path.parent.name/path.name) as actual:
                    np.testing.assert_array_equal(expected.read(1), actual.read(1))
            # All retired inputs are still absent; completed output markers make restart safe.
            subprocess.run([*command, str(d/'consume')], env=env, check=True, stdout=subprocess.DEVNULL)

    def test_streamed_chm_filters_noise_and_clips_height(self):
        import os
        import numpy as np
        import rasterio
        import laspy
        import chm
        from rasterio.transform import from_origin
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            with rasterio.open(d/'dem.tif', 'w', driver='GTiff', width=4, height=4,
                               count=1, dtype='float32', crs='EPSG:3857',
                               transform=from_origin(0, 16, 4, 4), nodata=-9999) as dst:
                dst.write(np.full((4, 4), 100, dtype='float32'), 1)
            las = laspy.LasData(laspy.LasHeader(point_format=3, version='1.2'))
            las.x = [1, 1, 1, 5]
            las.y = [15, 15, 15, 15]
            las.z = [110, 150, 140, 160]
            las.classification = [1, 7, 1, 1]
            las.withheld = [0, 0, 1, 0]
            blob = io.BytesIO()
            las.write(blob, do_compress=True, laz_backend=laspy.LazBackend.Lazrs)
            payload = blob.getvalue()
            class Response(io.BytesIO):
                headers = {'Content-Length': str(len(payload))}
            meta = dict(bounds=[0, 0, 0, 128, 128, 128], boundsConforming=[0, 0, 0, 16, 16, 160],
                        srs={'horizontal': '3857'})
            def get(url):
                return json.dumps(meta if url.endswith('/ept.json') else {'0-0-0-0': 4}).encode()
            with patch.dict(os.environ, {'BBOX': '0,0,16,16'}), patch('chm.get', side_effect=get), \
                 patch('chm.urllib.request.urlopen', return_value=Response(payload)):
                chm.main('https://example.test/ept', str(d/'dem.tif'), str(d/'out.tif'))
            with rasterio.open(d/'out.tif') as src:
                a = src.read(1)
            self.assertEqual(a[0, 0], 10)
            self.assertEqual(a[0, 1], 45)
            self.assertTrue(np.isnan(a[1, 0]))
            self.assertFalse((d/'out_tmp').exists())

    def test_fill_clipped_window(self):
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        from chm_fill import main
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            profile = dict(driver='GTiff', width=16, height=16, count=1, dtype='float32', nodata=float('nan'),
                           crs='EPSG:3857', transform=from_origin(0, 64, 4, 4))
            with rasterio.open(d/'main.tif', 'w', **profile) as dst:
                a = np.full((16, 16), np.nan, dtype='float32'); a[0, 0] = 9
                dst.write(a, 1)
            profile['transform'] = from_origin(-8, 72, 4, 4)
            with rasterio.open(d/'fill.tif', 'w', **profile) as dst:
                dst.write(np.full((16, 16), 2, dtype='float32'), 1)
            main(d/'main.tif', d/'fill.tif')
            with rasterio.open(d/'main.tif') as src:
                a = src.read(1)
            self.assertEqual(a[0, 0], 9)
            self.assertEqual(a[13, 13], 2)
            self.assertTrue(np.isnan(a[15, 15]))


if __name__ == '__main__':
    unittest.main()
