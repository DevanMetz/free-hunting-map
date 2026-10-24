# Terrain & lidar tiles

Raster layers for spotting old logging roads, skid trails, and stand structure. They are built
once from USGS 3DEP data on a Colab CPU VM, stored as WebP PMTiles in R2, and served by the
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
python derive.py dem/mosaic.vrt out               # 5000 px blocks (40 px pad) -> out/{lrm,openness,hillshade,slope}/*.tif
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

## Wider coverage plan

v1 covers the Clark County 3DEP 1 m DEM tiles, a 62 × 82 km box (about 5,100 km²) at
-90.99…-90.20 °E, 44.40…45.14 °N. Canopy height covers the `WI_Clark_2018` footprint plus the fill.
v1 measurements:

| | Clark (v1) | Wisconsin (×33) |
| --- | --- | --- |
| DEM download | 87 tiles, 15 GB | ~500 GB, streamed per region |
| Archives | LRM 364 MB, openness 307 MB, hillshade 220 MB, slope 254 MB, CHM 69 MB (≈1.2 GB) | ~40 GB in R2 |
| Colab High-RAM CPU | ~1.5 h, ≈0.3 CU | ~10 CU, or run it on any 8+ core box |

1. Work in regions of about 1° × 1°, roughly 2 to 4 counties each. Group them by UTM zone
   (zone 15 is west of 90° W, zone 16 is east) so derivatives are computed in native metres.
   For each region: query TNM for 1 m DEM tiles, run `mosaic.py` and `derive.py`, warp each layer
   to the EPSG:3857 z16 grid (the first step of `tile.py`), keep only the Byte mercator rasters,
   and delete the DEM. Keep ~60 GB of scratch per region.
2. For canopy height, run `chm.py` once per EPT project that meets the region, with `BBOX` set
   to the region. Then run `chm_fill.py` to merge it into a regional grid. Newest projects go
   first, and older ones only fill gaps.
3. When every region is in, `gdalbuildvrt` the regional mercator rasters per layer. Then run the
   RGBA, overview and `rio pmtiles` steps of `tile.py` once to make one statewide archive per
   layer (about 10 GB, about 40 parts).
4. Publish the archives as `v2` with `upload.py`. Set `LIDAR_VERSION = 'v2'` and the statewide
   `LIDAR_BOUNDS` in `src/map/sources.ts`, then ship. `v1` stays readable until cached
   clients age out.
5. Optionally, ship sooner region by region: publish growing `v2`, `v3`, … archives as regions
   finish, since each version is immutable.
