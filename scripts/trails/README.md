# Public trails pipeline

Builds `trails.pmtiles` with the single vector layer `trails`, zooms 6–14, following `/workspace/trails-build/CONTRACT.md`. No commits, deployments of application code, credential-file reads, API-token creation, OSM, or direct state/county inventories are part of this pipeline.

## Run

Requires Python 3, GDAL Python bindings (`osgeo`), Shapely 2, GDAL 3.10+, tippecanoe/tile-join 2.53+, and the repository's existing Wrangler installation and authorized login. These dependencies were already installed on the build box. The normalizer's property tests use only the Python standard library.

```bash
python3 -m unittest discover -s scripts/trails -p 'test_*.py'
python3 scripts/trails/build_trails.py all --region wi --work /workspace/trails-build/work
# After checking the regional archive and upload:
python3 scripts/trails/build_trails.py all --region lower48 --work /workspace/trails-build/work
```

Each step is also available as `download`, `normalize`, `tiles`, or `upload`, with the same arguments. Download pages are checkpointed per source/view; rerunning reuses completed files. To refresh a source, remove its files under `<work>/<region>/raw/`. `all` removes raw/intermediate geometry after a successful upload. Rebuilding after cleanup requires downloading again. `tiles` requires the normalized file; `upload` only requires the final archive. An acquisition, normalization or tiling failure never publishes a new manifest. An upload failure can leave replaced part keys; rerun `upload` to finish the replacement.

`wi` is the bbox `[-97.25, 36.95, -82.1, 49.4]`, containing Wisconsin, Minnesota, Michigan, Iowa, and Illinois, plus neighboring territory inside that rectangle. `lower48` uses `[-124.85, 24.4, -66.85, 49.4]`; federal inventory features are clipped to the CONUS envelope, excluding Alaska, Hawaii, Puerto Rico and other territories. This is a bbox clip, not a land mask or state-boundary clip.

## Data sources

All sources below are federal public-domain products, subject to source metadata. Names, geometry, permitted uses and publication dates are agency assertions, not a current access guarantee or a land survey. Credit: **USDA Forest Service; Bureau of Land Management; National Park Service; U.S. Geological Survey**. No agency endorsement is implied.

| Source key | Official source | Acquisition and license |
|---|---|---|
| `usfs_trails` | [NFS Trails ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.TrailNFS_Publish.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0) | USFS federal public data. National bulk ZIP; bbox-paged REST for the regional build. |
| `usfs_mvum_trails` | [MVUM Trails ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.Trail_MVUM.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/2) | USFS federal public data; legal motor designations and vehicle-specific seasonal fields. |
| `usfs_mvum_roads` | [MVUM Roads ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.Road_MVUM.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/1) | USFS federal public data. |
| `usfs_roads` | [NFS Roads ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.RoadCore_FS.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer) | USFS federal public data. REST layers 0 and 1 include open and closed roads. Current decommissioned routes are removed; a future decommissioning objective alone does not remove an existing level-1 road. |
| `blm_gtlf` | [BLM GTLF Public Display](https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_GTLF_Public_Display/MapServer), [metadata and public-domain notice](https://www.arcgis.com/sharing/rest/content/items/f94999eb674d4085be0c86729fe4a151/info/metadata/metadata.xml?format=default&output=html) | Public domain. BLM requests credit, description of modifications, and no implication of endorsement. Modifications here: clipping, attribute normalization, segment deduplication, simplification and tiling. |
| `nps_trails` | [NPS Public Trails](https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/MapServer/0) | Federal public data. Non-extant, explicitly non-public, restricted, sidewalk and nonfederal-origin records are excluded when attributes identify them. |
| `usgs_ndt` | [USGS National Digital Trails, layer 37](https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37), [licensing/provenance Q&A](https://www.usgs.gov/national-digital-trails/qas-about-usgs-trail-data) | USGS aggregates public-domain authoritative data, including nonfederal contributions. This pipeline admits only positively recognized federal **originators**, excludes USFS/NPS/BLM origins or maintainers and water trails, then removes remaining agency duplicates. State, county, private and unknown origins are excluded even if a federal agency maintains the trail. |

The regional REST endpoints were checked with real ID and GeoJSON queries. Acquisition happens server-side; source-host CORS policies do not affect the app, which consumes its same-origin Worker tiles. USFS ZIPs return `application/zip` and restrict cross-origin browser access to the Forest Service website. Do not point browser code directly at the ZIPs.

The pipeline checks BLM's documented legacy [bulk ZIP](https://gis.blm.gov/EGISDownload/LayerPackages/BLM_National_GTLF_Public_Display.zip) and [Hub shapefile export](https://gbp-blm-egis.hub.arcgis.com/api/download/v1/items/f94999eb674d4085be0c86729fe4a151/shapefile?layers=0) before querying. They returned HTTP 403/404 during this build. The Hub item covers only one view, not the entire inventory. REST views **0, 1, 7** cover the roads and all designated trails; view 7 includes the overlapping trail views 2–6. Route/feature identity plus spatial overlap prevents duplicate segments. BLM [announces an endpoint migration before February 1, 2027](https://www.blm.gov/services/geospatial/GISData); reverify the endpoint when refreshing.

## Normalization and deduplication

Output properties are exactly the contract's `name`, `type`, `mvum`, `uses`, `seasons`, `surface`, `agency`, `unit`, `src`, `date`; empty optional strings are omitted. Names are capped at 100 characters, units 80, surfaces 40, seasons 600. `mvum=1` is reserved for actual USFS MVUM geometry or matching portions of NFS trails. An MVUM trail with missing vehicle-class fields remains `ohv`, with `uses` omitted rather than invented. No motor-use permission is inferred for closed NFS roads.

Snow-only uses produce `snow`; designated motor uses produce `ohv`; remaining trails use `foot` when hiking is allowed, then `bike`, then `horse`. Unknown terrestrial use defaults to the `foot` styling class while leaving `uses` absent. Every road remains `road` regardless of permitted vehicle classes. Coordinate order is `[longitude, latitude]`, rounded to six decimals.

MVUM motor permissions and vehicle-specific `*_DATESOPEN` strings are applied only to NFS trail portions within 20 m of a matching route CN or forest-scoped route number. Unmatched NFS and MVUM portions remain. NFS roads have overlapping same-route MVUM portions subtracted, retaining the unmatched remainder with `mvum=0`. BLM overlaps are subtracted only for the same feature/route identity. Remaining USGS lines are dropped when more than 70% of their length lies within 20 m of already included agency lines.

When multiple MVUM designations overlap, their permissions and seasons are combined on that portion of the NFS line. A disk-backed SQLite R-tree indexes bounding boxes; Shapely operations run in EPSG:5070 metres. EPSG:5070 introduces a small spatial tolerance distortion across CONUS; the 20 m threshold is approximate. Reported kilometres use haversine distances on the resulting geographic geometry. Counts describe output segments after splitting/deduplication, not the number of original named routes.

`date` uses record source/edit dates when available, service edit metadata otherwise. USFS services omit edit metadata, so their ZIP's HTTP `Last-Modified` date is the fallback. BLM's MapServer omits edit metadata; the equivalent official hosted public-road view's edit date (or its item modification date) is used as the GTLF publication date. Dates do not represent field verification or prove current access.

National ZIPs are read through GDAL `/vsizip` without extracting national shapefiles. DBF long names are restored from the official USFS XML schema after validating the complete field count, ordinal order and truncated prefixes against the [published USFS XML schema](https://data.fs.usda.gov/geodata/edw/edw_resources/meta/S_USA.TrailNFS_Publish.xml). GDAL SQL applies the aliases while streaming GeoJSONSeq into gzip, without expanding shapefiles or buffering national GeoJSON. Any schema mismatch falls back to REST to avoid silently losing uses or seasons. REST uses complete ID lists and recursive page splitting; missing or truncated pages fail the build rather than producing a silently incomplete archive.

## Tiles and hosting

Per-feature minimum zoom is 10 for roads, 7 for motorized/MVUM trails, 8 for other trails. Archive metadata spans zooms 6–14. Tippecanoe performs zoom-dependent line simplification. After joining, the fixed-size PMTiles minimum-zoom header is set to 6 because `tile-join` otherwise reports the first populated zoom; tiles below each feature's minimum zoom stay empty. Zooms 6–11 may drop dense features to fit tile limits; zooms 12–14 are built separately with **no feature limit and no tile-size limit**. `tile-join` combines these disjoint ranges into one `trails` layer. No density filter can propagate into z12+.

The upload command creates `fhm-tiles` if missing, streams the archive into one temporary 256 MiB part at a time, and writes:

```text
fhm-tiles/trails/v1/part-000
fhm-tiles/trails/v1/part-001  # only when needed
...
fhm-tiles/trails/v1/manifest.json
```

The manifest is exactly `{size, partSize, parts, sha256, built, bounds}`, with `partSize=268435456`. All parts are uploaded before the manifest, which is downloaded again and compared to the local manifest. Extra old parts are deleted after verification. Wrangler's existing authentication is used; no credential files are opened by this script and no R2 tokens are created. Application code and Worker deployment are outside this script.

Stable `v1` part names make replacement non-atomic while parts are uploading; a cached old manifest can briefly refer to newly replaced bytes. Perform refreshes in a coordinated window. A future incompatible release should use a new version prefix. The app's Worker serves Range requests and extracted MVTs according to the shared contract.

`<work>/<region>/sources.json` records acquisition URLs, dates and source counts. `stats.json` records output counts by source/type, kilometres, exclusions, final archive size and SHA-256. The disk guard stops near 7.5 GiB under `--work` or below 1 GiB free; tippecanoe uses four threads. Four national USFS ZIPs total **966.8 MiB compressed**, below the 2 GiB retention cap. Raw downloads, normalization SQLite and GeoJSON, and intermediate low/high archives are scratch files.

## Measured builds

Built and remotely verified on **2026-10-24**. The `wi` pilot was uploaded first: **29,493,164 bytes (28.13 MiB)**, one R2 part; SHA-256 `ac71d25be01c8dbf048bd223316b8edc4b1751228e9eb78f8ec577c8b3649c15`.

| Source | WI segments | WI km |
|---|---:|---:|
| `usfs_trails` | 17,015 | 18,310.84 |
| `usfs_mvum_trails` | 1,867 | 521.42 |
| `usfs_mvum_roads` | 16,671 | 19,911.87 |
| `usfs_roads` | 22,351 | 19,178.03 |
| `blm_gtlf` | 0 | 0.00 |
| `nps_trails` | 3,405 | 1,590.20 |
| `usgs_ndt` | 858 | 453.31 |

Total: **62,167 segments / 59,965.67 km**. BLM has no features in the regional bbox.

The full acquisition contains **788,643 source features** before clipping/filtering/splitting/deduplication. National USFS ZIPs are the **2025-05-11** snapshot; the pilot used live REST geometry with that ZIP date as its fallback. Regional and national counts therefore include different USFS publication snapshots. The lower-48 archive result is recorded below when complete.
