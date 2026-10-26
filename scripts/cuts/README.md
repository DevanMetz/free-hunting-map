# Logging cuts

Lower-48 Hansen Global Forest Change v1.13 loss years **2001–2025**, masked to
`treecover2000 >= 25`. This is forest-loss detection, including fire, storms and
other disturbances; it does not establish that a site was logged. It is not an
access or ownership layer.

Source: [EE catalog](https://developers.google.com/earth-engine/datasets/catalog/UMD_hansen_global_forest_change_2025_v1_13).
Attribution: **Hansen/UMD/Google/USGS/NASA Global Forest Change, CC BY 4.0**.
Lower-48 clipping uses Census TIGER/2018 states (public domain), excluding AK,
HI and territories. The catalog and authenticated asset were checked before the
build. Source acquisition is server-side; browser tiles are same-origin and do
not depend on EE credentials or source CORS.

## Reproduce or resume

All scratch files belong in `/workspace/gee/cuts/`; `STATUS.md`, `export.json`,
`drive-files.json` and `tile-stats.json` record progress and measured resources.
The EE venv needs earthengine-api; system Python needs rasterio, numpy, Pillow,
mercantile and pmtiles. GDAL's `gdalbuildvrt` and the repo's Wrangler are required.

```sh
/workspace/gee/venv/bin/python scripts/cuts/export_ee.py --start
# Re-run without --start to update export.json; do not submit another export.
/workspace/gee/venv/bin/python scripts/cuts/export_ee.py
# Once COMPLETED, stream every shard and check Drive's MD5/size.
/workspace/gee/venv/bin/python scripts/cuts/pull_drive.py
python3 -m unittest discover -s scripts/cuts -p 'test_*.py'
GDAL_CACHEMAX=256 GDAL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 python3 scripts/cuts/tile.py /workspace/gee/cuts
TMPDIR=/workspace/gee/cuts python3 scripts/terrain/upload.py cuts v1 /workspace/gee/cuts/cuts.pmtiles
npm test -- --maxWorkers=2
npm run build
```

EE exports a single uint8 band on the native 0.00025° grid, zero nodata, in
32768-pixel COG shards. It uses one export task and the single Drive folder name
`FreeHuntingMap-gee-cuts-v1` (not a nested path). `pull_drive.py` reuses the EE
OAuth login with no quota-project header; it never prints credentials. It streams
1 MiB chunks, verifies checksums, and refuses downloads that would breach 10 GiB
free disk. Only tile after EE completion and all shards have been downloaded.

## Raster and year colors

Raster avoids polygonizing billions of categorical pixels. At z13 the 256px
Web Mercator grid is ~19 m per pixel at the equator. Nearest-neighbor reprojection
preserves categorical years. Each year has a distinct interpolated color between
2001 `#64869b`, 2007 `#80b6ac`, 2013 `#e8cf78`, 2019 `#ed923e`, 2025 `#ef4938`.
Zero is transparent. Lossless WebP preserves native tile colors; z5–12 overview
tiles average premultiplied RGBA, preserving proportional sparse coverage instead
of expanding any detected pixel into an opaque large cell. Overview colors can
blend adjacent years. The frontend uses a fixed palette and an existing opacity
control, without a custom recoloring protocol or year filter.

The builder reads 2048×2048 blocks, uses a 256 MiB GDAL cache and 128 MiB warp
buffer, and runs one thread. SQLite commits each block for resumption and stores
encoded tiles, never whole national arrays. Empty tiles are omitted. PMTiles
payloads spool to disk; the directory stays in memory. Preserve at least 10 GiB
free space. After verified upload, `tiles.sqlite` and `.vrt` can be deleted;
GeoTIFFs remain recoverable from Drive.

## Hosting and release

The existing immutable uploader writes 256 MiB parts into
`fhm-tiles/cuts/v1/part-NNN`, then writes and verifies `manifest.json`. It refuses
a previously published version. Rebuilds must use a new version and update
`CUTS_TILES`. Keep old prefixes for cached clients. Upload before pushing code.

Worker routes: `/tiles/cuts/v1.json`, `/tiles/cuts/v1.pmtiles` (Range), and
`/tiles/cuts/v1/{z}/{x}/{y}.webp`. Same-origin registry tiles use CacheFirst with
immutable URLs. The normal layer installer preserves the overlay across basemap
changes. Validate the live TileJSON, populated WebP and existing trails after
Workers Builds deploys, then capture desktop/mobile screenshots over Wisconsin
and another forested state using Chromium with `--disable-http2`.

## Measured v1 build (2026-10-26)

EE task `4BL5ZVMMAOTK46HFLUGGW75C` completed at **35,537.41015625 EECU seconds
(9.872 hours)**. Drive holds **22 GeoTIFF shards, 657,293,909 bytes**. The lossless
z5–13 archive is **2,593,805,828 bytes (2.42 GiB)**, SHA-256
`7f49a102ff027c7bbcd6ad0d8957d92f1e78e40266f624a6fed2c105bde71b6c`.
It contains 368,248 populated z13 tiles plus 149,459 overview tiles. This size
retains exact native colors and alpha; browsers fetch individual viewport tiles,
not the national archive. The upload uses ten 256 MiB-or-smaller parts.
