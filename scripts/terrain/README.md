# Terrain & lidar tiles

Raster layers for spotting old logging roads, skid trails, and stand structure. They are built
from USGS 3DEP data, stored as WebP PMTiles in R2, and served by the
Worker at `/tiles/<name>/<version>/{z}/{x}/{y}.webp`.

| Layer | Archive | Source | Zooms |
| --- | --- | --- | --- |
| Local relief | `lidar-lrm` | 3DEP 1 m DEM | 8–16 |
| Openness | `lidar-openness` | 3DEP 1 m DEM | 8–16 |
| Lidar hillshade | `lidar-hillshade` | 3DEP 1 m DEM | 8–16 |
| Lidar slope | `lidar-slope` | 3DEP 1 m DEM | 8–16 |
| Canopy height | `lidar-chm` | 3DEP lidar point cloud (EPT) minus 1 m DEM | 8–15 |

Historic aerials are not tiled here. They come directly from the Wisconsin DNR public
`DW_Imagery/EN_Image_Basemap_<year>_Leaf_On` ImageServers.

## Sources and licenses

- **USGS 3DEP 1 m DEM**: TNM Access API `Digital Elevation Model (DEM) 1 meter`. US public domain.
  Overlapping projects are mosaicked newest first.
- **USGS 3DEP lidar point clouds**: Entwine Point Tiles in `s3://usgs-lidar-public`
  (AWS Open Data, public domain). Clark uses `WI_Clark_2018`. Its southwest corner, which that
  project does not cover, is filled from `WI_12County_9_B22`.
- **Historic aerials**: USDA NAIP 2005–2022 (public domain), served by Wisconsin DNR. Excluded: the DNR 1930s mosaic (covers only
  scattered patches of the state and none of the Wildcat Ln area), DNR 1990s leaf-off (internal DNR use only), county-produced 1997 and
  WROC 2010 imagery (license unclear).

## Pipeline

```sh
pip install rasterio numba scipy laspy[lazrs] rio-pmtiles
python mosaic.py                                  # dem/items.json -> dem/files.txt + dem/mosaic.vrt (newest wins)
python derive.py dem/mosaic.vrt out               # 2500 px blocks (40 px pad; BLOCK overrides) -> out/{lrm,openness,hillshade,slope}/*.tif
python chm.py https://s3-us-west-2.amazonaws.com/usgs-lidar-public/WI_Clark_2018 dem/mosaic.vrt chm/chm.tif
BBOX=minx,miny,maxx,maxy python chm.py <neighbouring EPT> dem/mosaic.vrt chm/fill.tif && python chm_fill.py chm/chm.tif chm/fill.tif
python chm_byte.py chm/chm.tif chm/chm_byte.tif   # 0–40 m -> 0–254
python tile.py lrm "out/lrm/*.tif" pm/lidar-lrm.pmtiles 16   # likewise for openness, hillshade, slope
python tile.py chm chm/chm_byte.tif pm/lidar-chm.pmtiles 15
python scripts/terrain/upload.py lidar-lrm v1 pm/lidar-lrm.pmtiles   # run from the repo root (uses wrangler)
```

Every derivative is a linear Byte index from 0 to 254, with 255 meaning nodata. That keeps
`average` resampling valid for warping and overviews. `palettes.py` colours the index at tiling time.

- **Local relief**: Gaussian σ 1.5 m DEM minus a 21 m focal mean, ±0.6 m, diverging blue/orange.
  Road beds, cut banks, and ditches stand out clearly.
- **Openness**: positive openness, 15 m radius, 8 directions, 78–93°, gray. Shows linear benches.
- **Hillshade**: multidirectional (225/270/315/360°, 45° sun, 4× exaggeration).
- **Slope**: 0–45°, cream to sepia, gamma 0.6.
- **Canopy height**: highest non-noise return per 4 m (EPSG:3857) cell from EPT depth ≤ 8,
  minus the average DEM, 0–40 m+.

`upload.py` splits each archive into 256 MiB R2 objects under `<name>/<version>/part-NNN` and writes
`manifest.json` last. Versions are immutable, so a rebuild needs a new version, a new
`LIDAR_VERSION` in `src/map/sources.ts`, and an entry in the Worker allowlist.

## Wider coverage: Wisconsin v2 blocks

v1 remains unchanged. Each v2 archive covers exactly one XYZ z9 tile, with zooms 9–16
(CHM 9–15). R2 keys are `<layer>/v2/b9-<x>-<y>/part-NNN` plus `manifest.json`, written last.
The manifest retains the v1 format; bounds describe valid data clipped to buffered Wisconsin.
The existing Worker selects `(x >> (z-9), y >> (z-9))` and falls back to v1 for unpublished blocks.
The Worker advertises minzoom 9 for v2 and returns 204 below z9; v1 stays unchanged.
Deploy the z9 routing before publishing these archives.

`wi_blocks.py` uses STATEFP 55 from `cb_2024_us_state_500k.zip`, buffered 500 m in EPSG:5070.
There are **73 blocks**, covering **145,330.5 km²** of the Census state geometry. Blocks
intersecting Clark bounds `[-90.93, 44.42, -90.31, 45.04]` go first, largest overlap first
(starting with `b9-127-184`, **3,080.1 km²**); the others follow descending unbuffered state area.
State geometry area includes inland water; it is not a land-only survey measurement.

```sh
python3 -m pip install --user rasterio numba scipy 'laspy[lazrs]' rio-pmtiles fiona shapely pyproj
python3 scripts/terrain/wi_blocks.py plan
python3 scripts/terrain/wi_blocks.py status
# Default: every unfinished block. Optional: --blocks b9-127-184 b9-126-184
nohup setsid /workspace/fhm-cg.sh nice -n 10 ionice -c3 python3 scripts/terrain/wi_blocks.py run \
  >> /workspace/terrain-build/wi-v2/run.log 2>&1 < /dev/null &
python3 -m unittest discover -s scripts/terrain -p 'test_*.py'
```

The base directory is `/workspace/terrain-build/wi-v2` (`--base` overrides it). `manifest.json`
is atomic and records per-stage attempts, errors, seconds, downloads, archive sizes, coverage,
and observed cgroup memory. Scratch is in `work/`; `run.lock` excludes simultaneous runs.
Interrupted stages resume at the first unfinished checkpoint without spending the failure budget.
Network, OS and unclassified subprocess errors retry after ten minutes and retain checkpoints.
Three explicit deterministic input/invariant failures mark a block failed and save diagnostics
in `failed/`. Its merged DEM and other checkpoints stay on disk unless deletion is needed to
restore the 10 GiB free-space floor. Failed blocks are
terminal until an operator explicitly resets their manifest entry and stages after resolving the cause.
Published prefixes are immutable; upload resume verifies size, SHA-256 and bounds before accepting them.

Stages: `dem → derive → chm → tile → upload → archive → cleanup`.

- DEM: paginate TNM, filter footprints against block ∩ buffered WI, stream HTTP/1.1 downloads
  with Range resume, contiguous Content-Range validation and persisted HTTP totals.
  TNM `sizeInBytes` is advisory: a mismatch logs a warning, while a completed file must match
  its recorded HTTP total. Unverified legacy downloads are fetched again. `mosaic.py` incrementally fills native 1 m CRS mosaics newest
  first; older valid cells only fill gaps. Delete each raw download after its durable merge checkpoint.
  This avoids retaining overlapping projects. Each CRS uses native chunks aligned to `BLOCK`.
  Half-pixel source offsets use bounded bilinear resampling onto the common native grid.
  Derive checkpoints each output chunk and releases DEM rows only after their 40 m halos are no
  longer needed. A 4 m ground grid is saved first. Keep `BLOCK` unchanged when resuming.
- CHM: discover projects through the [USGS EPT boundary index](https://github.com/hobu/usgs-lidar/blob/master/boundaries/resources.geojson)
  and validate `ept.json`. Acquisition year, excluding LAS packaging dates, orders projects newest
  first. Undated statewide composites are last-resort fills, recorded with unknown dates.
  Stream one LAZ node at a time, accumulate 8,192-point chunks into a disk-backed grid, then
  merge gaps with `chm_fill.py`. Noise classes, 4 m grid, depth 8, scaling and palettes match v1.
- Tile: warp CRS groups separately onto the exact z9 extent and z16 grid, clip to WI, apply
  existing palettes, and encode WebP quality 82 with `rio pmtiles -j 2`. Delete intermediates per layer.
- Upload: publish only v2 block prefixes. Verify each remote manifest and a nonempty z14 tile
  using `curl --http1.1`; response bytes must match the local archive, excluding a false success
  from v1 fallback. Each Clark-intersecting block also saves five v1/v2 comparisons at a point inside its
  Clark overlap in `clark-comparison/<block>/`.
- Archive: only `colab ls -s v5gpu` and `colab upload -s v5gpu`, as flat 64 MiB parts under
  `content/drive/MyDrive/FreeHuntingMap-lidar/layers/v2-<block>-lidar-<layer>.pmtiles.part-NNN`.
  Skip on failure or after one hour.
  No Colab execution/session control. Cleanup removes remaining block rasters and archives.

### Resource settings and measurements

One block and one heavy stage at a time, nice 10, idle I/O priority. Execution refuses to run
outside the `fhm` cgroup. Defaults: `BLOCK=2500`, `WORKERS=2` (maximum 3), GDAL cache 64 MiB,
warp buffers 128–256 MiB, RGBA strips 256 rows, one GDAL/BLAS/Numba thread per worker.
Finished file cache is released with `posix_fadvise`; no global cache or cgroup settings are changed.
Scratch limit: **20 GB allocated**, with at least **10 GiB free** on the volume. Before each
source, require 10 GiB + twice its size (rechecked against the HTTP total). Block preflight
reserves `0.55 × sum(TNM sizeInBytes)` for DEM scratch plus **4 GiB** derive/tile headroom;
already retained DEM bytes are deducted on resume. The factor comes from the failed z8
Clark build: **28.1 GB peak scratch / 53.0 GB downloaded**. z9 quarters block area, targeting
roughly 8 GB or less of native DEM scratch.

Every later command also reserves 4 GiB headroom and is monitored while running. The live
guard starts waiting at 11 GiB free, leaving 1 GiB for writes between checks. Disk pressure
logs `waiting for disk`, sleeps ten minutes and rechecks without deleting checkpoints or
spending retries. Owned subprocess groups are suspended with SIGSTOP while waiting and
continued with SIGCONT once space is available; other processes are never signaled. Scratch
above the cap also waits for operator intervention. Temporary files stay under `work/`.
Derive retires consumed DEM rows, CHM deletes each consumed LAZ/fill, and tiling deletes
byte rasters and completed layer inputs as it goes.

Measured 2026-10-25 on this box: a synthetic 5,000 × 2,500 DEM, two 2,500-pixel derivative workers,
completed in **5.21 s**, with shared cgroup peak observed **1.49 GiB**. This is a memory smoke test,
not a whole-block throughput estimate. Real Clark DEM/EPT patches produced all five layers;
side-by-side v1 comparisons matched terrain/vegetation features and palettes. Review artifacts
are retained under `validation/`. Full-block timings and archive sizes populate the manifest as stages finish.
`status` reports done/total blocks, current block/stage/progress, free disk and allocated scratch.
ETA is completed-block seconds per WI km² multiplied by remaining WI km². It reports no
numeric ETA until one full block completes.

Historical v1 Clark reference: 87 DEM tiles / 15 GB downloads, about 5,100 km² DEM bounding box;
archives LRM 364 MB, openness 307 MB, hillshade 220 MB, slope 254 MB, CHM 69 MB.
