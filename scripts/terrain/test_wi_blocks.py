"""Run: python3 -m unittest discover -s scripts/terrain -p 'test_*.py'."""
import contextlib
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wi_blocks as wi
import upload


class BlockMath(unittest.TestCase):
    def test_round_trip(self):
        for x in range(122, 134):
            for y in range(178, 190):
                w, s, e, n = wi.tile_bounds(x, y)
                self.assertEqual(wi.tile_xy((w+e)/2, (s+n)/2), (x, y))
                a, b, c, d = wi.merc_bounds(x, y)
                self.assertAlmostEqual(c-a, 2*wi.WORLD/512, places=7)
                self.assertAlmostEqual(d-b, 2*wi.WORLD/512, places=7)
                self.assertAlmostEqual(a, math.radians(w)*wi.R, places=7)
                self.assertAlmostEqual(d, wi.R*math.asinh(math.tan(math.radians(n))), places=7)

    def test_zone_edge_and_clark(self):
        self.assertEqual(wi.tile_bounds(127, 184)[2], -90)
        self.assertEqual(wi.tile_bounds(128, 184)[0], -90)
        self.assertEqual(wi.tile_xy(-90.65, 44.75), (127, 184))
        x, y = wi.tile_xy(-90.65, 44.75, 14)
        self.assertEqual((x >> 5, y >> 5), (127, 184))

    def test_edges(self):
        self.assertEqual(wi.tile_xy(-180, 90), (0, 0))
        self.assertEqual(wi.tile_xy(180, -90), (511, 511))

    def test_wi_blocks(self):
        if not (wi.BASE/'cb_2024_us_state_500k.zip').exists():
            self.skipTest('Census state ZIP is not installed')
        state, buffered = wi.state_polygon()
        blocks = wi.make_blocks(state, buffered)
        self.assertEqual(blocks[0]['id'], 'b9-127-184')
        self.assertEqual(len(blocks), 73)
        self.assertEqual([b['clark_km2'] for b in blocks], sorted((b['clark_km2'] for b in blocks), reverse=True))
        self.assertEqual(len({b['id'] for b in blocks}), len(blocks))
        self.assertEqual([b['km2'] for b in blocks if not b['clark_km2']], sorted((b['km2'] for b in blocks if not b['clark_km2']), reverse=True))
        from shapely.geometry import shape
        from shapely.ops import unary_union
        union = unary_union([shape(b['geometry']) for b in blocks])
        self.assertLess(union.symmetric_difference(buffered).area, 1e-9)
        self.assertGreater(sum(b['km2'] for b in blocks), 140000)

    def test_partial_block_polygon(self):
        from shapely.geometry import box
        state = box(-90.1, 44.7, -89.9, 44.8)
        blocks = wi.make_blocks(state, state)
        self.assertEqual({b['id'] for b in blocks}, {'b9-127-184', 'b9-128-184'})


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
        block = dict(id='b9-127-184', status='running', km2=10, attempts=0,
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
        blocks = [dict(id=f'b9-{x}-184', status='pending', km2=1, attempts=0, stages={}) for x in (127, 128)]
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': blocks})
            def dem():
                if runner.block['id'] == 'b9-127-184':
                    raise ValueError('invalid DEM CRS')
            runner.dem = dem
            for stage in wi.STAGES[1:]:
                setattr(runner, stage, lambda: None)
            with patch('wi_blocks.time.sleep'), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                runner.run()
            self.assertEqual(blocks[0]['status'], 'failed')
            self.assertEqual(blocks[0]['attempts'], 3)
            self.assertFalse(blocks[0]['scratch_removed'])
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

    def test_download_tnm_is_advisory_and_completed_size_is_http(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Length': '6'}
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'a.tif'
            with patch('urllib.request.urlopen', return_value=Response(b'abcdef')), patch('wi_blocks.log') as log:
                wi.download('https://example.test/a', path, 5)
                self.assertIn('TNM=5, HTTP=6', log.call_args.args[0])
            with patch('urllib.request.urlopen') as request:
                self.assertEqual(wi.download('https://example.test/a', path, 5), 0)
                request.assert_not_called()
            path.write_bytes(b'abcde')  # Matches TNM, but corrupt against recorded HTTP size.
            with patch('urllib.request.urlopen', return_value=Response(b'abcdef')) as request:
                wi.download('https://example.test/a', path, 5)
                request.assert_called_once()
            self.assertEqual(path.read_bytes(), b'abcdef')

    def test_truncated_tnm_sized_partial_is_not_promoted(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Length': '6'}
        with tempfile.TemporaryDirectory() as d, patch('wi_blocks.time.sleep'), patch('wi_blocks.log'):
            path = Path(d)/'a.tif'
            with patch('urllib.request.urlopen', side_effect=lambda *a, **k: Response(b'abcde')):
                with self.assertRaisesRegex(IOError, 'Truncated'):
                    wi.download('https://example.test/a', path, 5)
            self.assertFalse(path.exists())

    def test_invalid_ranges_are_never_appended(self):
        for headers in ({'Content-Range': 'bytes 2-5/6'}, {'Content-Range': 'bytes 3-6/6'},
                        {'Content-Range': 'bytes 3-5/6', 'Content-Length': '4'}):
            with self.subTest(headers=headers), tempfile.TemporaryDirectory() as d, patch('wi_blocks.time.sleep'):
                path = Path(d)/'a.tif'
                part = path.with_suffix('.tif.partial')
                part.write_bytes(b'abc')
                def response(*args, **kwargs):
                    result = io.BytesIO(b'def')
                    result.status, result.headers = 206, headers
                    return result
                with patch('urllib.request.urlopen', side_effect=response), self.assertRaises(IOError):
                    wi.download('https://example.test/a', path, 6)
                self.assertEqual(part.read_bytes(), b'abc')
                self.assertFalse(path.exists())

    def test_verified_partial_survives_interruption_before_rename(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'a.tif'
            path.with_suffix('.tif.partial').write_bytes(b'abcdef')
            wi.atomic_json(path.with_suffix('.tif.http.json'), dict(url='https://example.test/a', total=6, complete=True))
            with patch('urllib.request.urlopen') as request:
                wi.download('https://example.test/a', path, 5)
                request.assert_not_called()
            self.assertEqual(path.read_bytes(), b'abcdef')

    def test_unverified_full_partial_restarts_instead_of_looping_on_416(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'a.tif'
            path.with_suffix('.tif.partial').write_bytes(b'abcdef')
            wi.atomic_json(path.with_suffix('.tif.http.json'), dict(url='https://example.test/a', total=6, complete=False))
            response = io.BytesIO(b'abcdef')
            response.status, response.headers = 200, {'Content-Length': '6'}
            reserve = Mock()
            with patch('urllib.request.urlopen', return_value=response) as request:
                wi.download('https://example.test/a', path, reserve=reserve)
                self.assertNotIn('Range', request.call_args.args[0].headers)
            reserve.assert_called_once_with(6)
            self.assertEqual(path.read_bytes(), b'abcdef')

    def test_dem_preflight_and_source_reservation_precede_download(self):
        from shapely.geometry import box, mapping
        block = dict(id='b9-127-184', geometry=mapping(box(-90.5, 44.5, -90.4, 44.6)))
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': [block]})
            runner.block, runner.stage = block, {}
            dem = runner.paths()/'dem'
            dem.mkdir()
            wi.atomic_json(dem/'catalog.json', [dict(downloadURL='https://example.test/a.tif', sizeInBytes=10_000_000_000)])
            with patch.object(runner, 'wait_disk') as wait, patch.object(runner, 'guard'), \
                    patch('wi_blocks.disk_bytes', return_value=1_000_000_000), patch('wi_blocks.log'), \
                    patch('wi_blocks.download', side_effect=TimeoutError) as download:
                with self.assertRaises(TimeoutError):
                    runner.dem()
            self.assertEqual(wait.call_args_list[0].args, (4_500_000_000+wi.STAGE_HEADROOM,))
            self.assertEqual(wait.call_args_list[1].args, (20_000_000_000,))
            download.assert_called_once()

    def test_scratch_cap_waits_without_deleting_checkpoint(self):
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': []})
            checkpoint = runner.work/'checkpoint'
            checkpoint.write_text('keep')
            with patch('wi_blocks.disk_bytes', side_effect=[wi.MAX_SCRATCH, 1]), \
                    patch('wi_blocks.shutil.disk_usage', return_value=Mock(free=100*1024**3)), \
                    patch('wi_blocks.time.sleep') as sleep, patch('wi_blocks.log'):
                runner.wait_disk()
            sleep.assert_called_once_with(600)
            self.assertEqual(checkpoint.read_text(), 'keep')

    def test_transient_errors_retain_checkpoint_without_failure_budget(self):
        block = dict(id='b9-127-184', status='pending', km2=1, attempts=0, stages={})
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': [block]})
            checkpoint = runner.work/'checkpoint'
            checkpoint.write_text('merged DEM')
            failures = iter([OSError('network'), TimeoutError('timeout'),
                             __import__('subprocess').CalledProcessError(1, ['chm.py']), None])
            def dem():
                self.assertEqual(checkpoint.read_text(), 'merged DEM')
                error = next(failures)
                if error:
                    raise error
            runner.dem = dem
            for stage in wi.STAGES[1:]:
                setattr(runner, stage, lambda: None)
            with patch('wi_blocks.time.sleep'), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                runner.run()
            self.assertEqual(block['status'], 'done')
            self.assertEqual(block['attempts'], 0)

    def test_disk_wait_stops_only_owned_process_and_rechecks(self):
        import signal
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': []})
            runner.stage = {}
            process = Mock(pid=12345)
            process.poll.return_value = None
            usage = [Mock(free=wi.MIN_FREE+100), Mock(free=wi.MIN_FREE+2000)]
            with patch('wi_blocks.shutil.disk_usage', side_effect=usage), patch('wi_blocks.os.killpg') as kill, \
                    patch('wi_blocks.time.sleep') as sleep, patch('wi_blocks.log') as log:
                runner.wait_disk(1000, process=process)
            self.assertEqual([c.args for c in kill.call_args_list], [(12345, signal.SIGSTOP), (12345, signal.SIGCONT)])
            sleep.assert_called_once_with(600)
            self.assertIn('waiting for disk', log.call_args.args[0])
            self.assertNotIn('waiting', runner.stage)

    def test_status_reports_progress_disk_and_area_eta(self):
        blocks = [dict(id='done', status='done', km2=10, stages={'dem': {'seconds': 3600}}),
                  dict(id='b9-127-184', status='running', km2=20,
                       stages={'dem': dict(status='running', tiles_done=2, tiles_total=5)})]
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()) as out:
            wi.status({'blocks': blocks}, Path(d))
        for expected in ('1/2 done', 'GiB free', 'GiB scratch', 'ETA: 2.0 h', 'b9-127-184 dem: 2/5 sources'):
            self.assertIn(expected, out.getvalue())

    def test_acquisition_not_las_packaging_year(self):
        self.assertEqual(wi.project_year('USGS_LPC_WI_OneidaCo_2013_LAS_2019'), 2013)
        self.assertEqual(wi.project_year('WI_12County_9_B22'), 2022)
        self.assertEqual(wi.project_year('MN_FullState'), 0)

    def test_interrupted_stage_keeps_failure_budget(self):
        block = dict(id='b9-127-184', status='running', km2=1, attempts=0,
                     stages={'dem': {'status': 'running'}})
        with tempfile.TemporaryDirectory() as d:
            runner = wi.Runner(Path(d), {'blocks': [block]})
            for stage in wi.STAGES:
                setattr(runner, stage, lambda: None)
            with contextlib.redirect_stdout(io.StringIO()):
                runner.run()
            self.assertEqual(block['attempts'], 0)
            self.assertEqual(block['status'], 'done')


class Prefix(unittest.TestCase):
    def test_prefix(self):
        self.assertEqual(wi.block_version('b9-127-184'), 'v2/b9-127-184')
        for version in ('v1', 'v2', 'v9999', 'v2/b9-127-184'):
            self.assertTrue(upload.valid_version(version))
        for version in ('v1/b9-127-184', 'v2/../v1', 'v2/b9-512-184', 'v0', 'v2/b9-1-2/part-001'):
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
