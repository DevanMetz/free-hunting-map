# Public trails pipeline

Builds `trails.pmtiles` with the single vector layer `trails`, zooms 6–14, following `/workspace/trails-build/CONTRACT.md`. No commits, deployments of application code, credential-file reads, API-token creation, OSM, or direct state/county inventories are part of this pipeline.

## Run

Requires Python 3, GDAL Python bindings (`osgeo`), Shapely 2, GDAL 3.10+, tippecanoe/tile-join 2.53+, and the repository's existing Wrangler installation and authorized login. These dependencies were already installed on the build box. Tests use the standard-library unittest runner; the state geometry tests also require the build's GDAL/Shapely dependencies.

```bash
python3 -m unittest discover -s scripts/trails -p 'test_*.py'
python3 scripts/trails/build_trails.py all --region wi --work /workspace/trails-build/work
# National build: see the sequential state workflow below.
python3 scripts/trails/build_states.py run --work /workspace/trails-build/l48 --version v2
```

Each step is also available as `download`, `normalize`, `tiles`, or `upload`, with the same arguments. Download pages are checkpointed per source/view; rerunning reuses completed files. To refresh a source, remove its files under `<work>/<region>/raw/`. `all` removes raw/intermediate geometry after a successful upload. Rebuilding after cleanup requires downloading again. `tiles` requires the normalized file; `upload` only requires the final archive. An acquisition, normalization or tiling failure never publishes a new manifest. An upload failure can leave replaced part keys; rerun `upload` to finish the replacement.

`wi` is the bbox `[-97.25, 36.95, -82.1, 49.4]`, containing Wisconsin, Minnesota, Michigan, Iowa, and Illinois, plus neighboring territory inside that rectangle. `lower48` uses `[-124.85, 24.4, -66.85, 49.4]`; federal inventory features are clipped to the CONUS envelope, excluding Alaska, Hawaii, Puerto Rico and other territories. The original monolithic normalizer uses a bbox clip. The state build additionally clips emissions to the buffered Census ownership partition described below.

## Data sources

All sources below are federal public-domain products, subject to source metadata. The USGS subset also credits originating agencies **U.S. Fish and Wildlife Service** and **Tennessee Valley Authority** in feature provenance. Names, geometry, permitted uses and publication dates are agency assertions, not a current access guarantee or a land survey. Credit: **USDA Forest Service; Bureau of Land Management; National Park Service; U.S. Geological Survey**. No agency endorsement is implied.

| Source key | Official source | Acquisition and license |
|---|---|---|
| `usfs_trails` | [NFS Trails ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.TrailNFS_Publish.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0) | USFS federal public data. National bulk ZIP; bbox-paged REST for the regional build. |
| `usfs_mvum_trails` | [MVUM Trails ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.Trail_MVUM.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/2) | USFS federal public data; legal motor designations and vehicle-specific seasonal fields. |
| `usfs_mvum_roads` | [MVUM Roads ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.Road_MVUM.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/1) | USFS federal public data. |
| `usfs_roads` | [NFS Roads ZIP](https://data.fs.usda.gov/geodata/edw/edw_resources/shp/S_USA.RoadCore_FS.zip), [REST](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer) | USFS federal public data. REST layers 0 and 1 include open and closed roads. Current decommissioned routes are removed; a future decommissioning objective alone does not remove an existing level-1 road. |
| `blm_gtlf` | [BLM GTLF Public Display](https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_GTLF_Public_Display/MapServer), [metadata and public-domain notice](https://www.arcgis.com/sharing/rest/content/items/f94999eb674d4085be0c86729fe4a151/info/metadata/metadata.xml?format=default&output=html) | Public domain. BLM requests credit, description of modifications, and no implication of endorsement. Modifications here: clipping, attribute normalization, segment deduplication, simplification and tiling. |
| `nps_trails` | [NPS Public Trails](https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/MapServer/0) | Federal public data. Non-extant, explicitly non-public, restricted, sidewalk and nonfederal-origin records are excluded when attributes identify them. |
| `usgs_ndt` | [USGS National Digital Trails, layer 37](https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37), [licensing/provenance Q&A](https://www.usgs.gov/national-digital-trails/qas-about-usgs-trail-data) | USGS aggregates public-domain authoritative data, including nonfederal contributions. This pipeline admits only positively recognized federal **originators**, excludes USFS/NPS/BLM origins or maintainers and water trails, then removes remaining agency duplicates. State, county, private and unknown origins are excluded even if a federal agency maintains the trail. The known published spelling `Tenneessee Valley Authority` is explicitly recognized as TVA; this is not a fuzzy government-name match. |

Ownership partitions also use the public-domain [Census 2024 cartographic state boundaries (1:500,000)](https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip), with the equivalent 2023 file as a fallback. This is a clipping/ownership source, not an additional trail inventory. The ZIP was verified as HTTP 200, `application/zip`; it is acquired server-side and exposes no browser CORS header.

The regional REST endpoints were checked with real ID and GeoJSON queries. Acquisition happens server-side; source-host CORS policies do not affect the app, which consumes its same-origin Worker tiles. USFS ZIPs return `application/zip` and restrict cross-origin browser access to the Forest Service website. Do not point browser code directly at the ZIPs.

The pipeline checks BLM's documented legacy [bulk ZIP](https://gis.blm.gov/EGISDownload/LayerPackages/BLM_National_GTLF_Public_Display.zip) and [Hub shapefile export](https://gbp-blm-egis.hub.arcgis.com/api/download/v1/items/f94999eb674d4085be0c86729fe4a151/shapefile?layers=3) before querying. The complete legacy ZIP returned HTTP 403/404 during this build. The Hub catalog's stale `layers=0` export returned 404; its current hosted layer 3 export is a verified ZIP (HTTP 206 Range response, ZIP signature). That item covers only the public motorized-road view. The pipeline uses the consistent MapServer views for the complete inventory instead of mixing that one hosted export with other snapshots. REST views **0, 1, 7** cover the roads and all designated trails; view 7 includes the overlapping trail views 2–6. Route/feature identity plus spatial overlap prevents duplicate segments. BLM [announces an endpoint migration before February 1, 2027](https://www.blm.gov/services/geospatial/GISData); reverify the endpoint when refreshing.

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
fhm-tiles/trails/vN/part-000
fhm-tiles/trails/vN/part-001  # only when needed
...
fhm-tiles/trails/vN/manifest.json
```

The manifest is exactly `{size, partSize, parts, sha256, built, bounds}`, with `partSize=268435456`. All parts are uploaded before the manifest, which is downloaded again and compared to the local manifest. Extra old parts are deleted after verification. Wrangler's existing authentication is used; no credential files are opened by this script and no R2 tokens are created. Application code and Worker deployment are outside this script.

Every build gets its own immutable prefix (`--version vN`, default `v2`; live lower-48 data is `v2`, and the historical WI pilot remains at `v1`). Never re-upload into a published prefix: the Worker edge cache and the app's offline tile cache key tiles by URL (`/tiles/trails/vN/{z}/{x}/{y}.mvt`) for a year. To publish: upload to a new `vN`, then bump `TRAILS_TILES` in `src/map/sources.ts` and deploy, retain earlier prefixes until a separately authorized cleanup. This build never modifies `trails/v1/`. The Worker serves any `vN` prefix whose manifest exists (Range requests on `/tiles/trails/vN.pmtiles`, TileJSON at `/tiles/trails/vN.json`).

`<work>/<region>/sources.json` records acquisition URLs, dates and source counts. `stats.json` records output counts by source/type, kilometres, exclusions, final archive size and SHA-256. The disk guard defaults to 7.5 GiB for the original commands and 25 GiB for the state build (`--disk-budget-gib` or `TRAILS_DISK_GIB`), always retaining at least 1 GiB free. Tippecanoe uses two threads. Four national USFS ZIPs total **966.8 MiB compressed**, below the 2 GiB retention cap. Raw downloads, normalization SQLite and GeoJSON, and intermediate low/high archives are scratch files.

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

The full acquisition contains **788,643 source features** before clipping/filtering/splitting/deduplication. National USFS ZIPs are the **2025-05-11** snapshot; the pilot used live REST geometry with that ZIP date as its fallback. Regional and national counts therefore include different USFS publication snapshots. 

## State-by-state lower-48 build

`build_states.py` imports the pilot pipeline and runs the 48 contiguous states plus DC sequentially. Each normalization and tiling stage runs in a fresh process; `TIPPECANOE_MAX_THREADS=2`, SQLite's 16 MiB cache, and streaming gzip keep memory bounded. Do not run another heavy build alongside it. On this box every detached process must enter the 3 GiB `fhm` cgroup through `/workspace/fhm-cg.sh`.

```bash
python3 -m unittest discover -s scripts/trails -p 'test_*.py'
setsid nohup /workspace/fhm-cg.sh nice -n 10 python3 scripts/trails/build_states.py run \
  --work /workspace/trails-build/l48 --version v2 \
  > /workspace/trails-build/l48/states.log 2>&1 < /dev/null &
```

The same command resumes interrupted work. It waits for an existing national `build_trails.py download` using that work directory and, if acquisition stopped, resumes completed source checkpoints. HTTP 403 is retried, including the known shared-proxy USGS failures; a failed source stops publication. Source selection, properties, dedup tolerances, feature minzooms and tile settings are the WI pilot's. No app/Worker deployment is part of this command.

Ownership uses the verified public-domain [Census 2024 cartographic state boundaries, 1:500,000](https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip), with the equivalent 2023 ZIP as an acquisition fallback. The 2024 URL returned HTTP 200 and `application/zip`; it does not advertise browser CORS, and is used only by the server-side build. Alphabetically ordered state polygons are buffered 0.05 degrees, subtract all earlier ownership, then intersect the lower-48 bbox. The buffered land union has no internal gaps or overlapping areas; it is not a claim to cover the offshore/beyond-US remainder of the bbox. `lower48/ownership.geojson` persists the partition and boundary provenance once. A line exactly on a shared boundary belongs to the earlier state.

Each national raw source is streamed once into per-state gzip JSONL, using an STRtree against ownership buffered by 0.02 degrees. Original rows and acquisition dates survive unchanged; empty state/source files receive completion markers too. Deduplication indexes the state plus margin before emitted geometry is clipped to exclusive ownership. Each state's `stats.json` records its counts, kilometres and exclusions. Margin exclusions can appear in multiple states; only emitted segments and kilometres are summed as national output.

The state build retains `states/XX/low.pmtiles` (z6–11, density dropping) and `high.pmtiles` (z12–14, no feature/tile limits). Immediately after both finish it removes that state's split raw, GeoJSONL and SQLite. `tile-join --no-tile-size-limit --no-tile-stats` combines the archives, then the existing z6 header correction and layer/name/attribution checks run. National raw stays available for recovery. Per-state archives are removed only after the published R2 manifest has been downloaded and compared successfully. The final archive remains at `<work>/lower48/trails.pmtiles`.

`<work>/lower48/build-manifest.json` records stages, per-source splits and per-state normalization/tiling/cleanup, pending/done/failed status, errors and failure history, attempts, UTC timestamps and bytes. Completed work is skipped. Each failed state is retried once; any unresolved state prevents join/upload. Fix the error and rerun the identical command. A file lock prevents simultaneous runs in one work directory. The manifest also samples peak scratch bytes, the summed RSS of this build's process tree, and the cgroup memory high-water mark (the latter includes unrelated jobs and filesystem cache).

To test a subset without publishing, use a separate work directory with completed raw acquisition and run `--states RI DE --no-upload`. A subset cannot upload. The 2026-10-25 RI/DE smoke test used the same federal REST sources over their combined envelope while national ZIP acquisition continued: **154 segments / 44.25 km**, **52,233 bytes**, SHA-256 `b0311aca6e32c36a80ab53d683afed1321918bcced3097c390d3ad33690d41ca`. Its resume run skipped completed stages. Unit tests cover coastal ownership, coincident boundaries, split margins and empty checkpoints, date/row preservation, margin-based USGS deduplication, clipped seams, failed-stage resume, cleanup ordering, and exact upload part reassembly before manifest publication.

## Lower-48 results

Built and remotely verified on **2026-10-25 (UTC)**. **Live data: `fhm-tiles/trails/v2/`**. All 48 contiguous states plus DC completed on their first attempt, with no state failures, retries, missing sources or OOM events. `trails/v1/` was not modified. Application deployment is coordinated separately.

| Source | Lower-48 segments | Lower-48 km |
|---|---:|---:|
| `usfs_trails` | 149,761 | 212,272.02 |
| `usfs_mvum_trails` | 4,662 | 1,671.67 |
| `usfs_mvum_roads` | 164,272 | 309,065.27 |
| `usfs_roads` | 1,343,786 | 273,355.50 |
| `blm_gtlf` | 157,250 | 107,126.73 |
| `nps_trails` | 31,641 | 24,571.53 |
| `usgs_ndt` | 9,096 | 5,166.40 |

Total: **1,860,468 segments / 933,229.12 km** from **788,643 acquired source features**. Counts describe normalized/split segments, not distinct trails; Oregon alone contributes 1,179,906 segments under the unchanged overlap-splitting rules.

- Archive: **453,692,373 bytes (432.67 MiB)**; **2 R2 parts** of 268,435,456 and 185,256,917 bytes.
- SHA-256: `50da395a20633efdb29ed08385b2965709b077b79017c9571e5fc0df5817b1a0`.
- Peak scratch under `--work`: **3,670,507,027 bytes (3.42 GiB)**, including retained national downloads/raw and the pilot.
- Sampled peak summed build-process RSS: **788,910,080 bytes (752.36 MiB)**, below the 1.5 GiB target. Shared cgroup high-water mark at completion: **1,850,658,816 bytes (1.72 GiB)** against a 3 GiB limit; this includes unrelated processes and filesystem cache.
- Final archive: `/workspace/trails-build/l48/lower48/trails.pmtiles`.
- Per-state counts and source/type breakdowns: `lower48/stats.json` and `lower48/states/XX/stats.json`.
- Resume/audit record: `/workspace/trails-build/l48/lower48/build-manifest.json`; every build stage is `done`. Per-state archives were removed only after remote manifest verification.

Validation passed: 22 Python unittest cases, `npm run build`, and all 322 application/Worker tests (`npm test -- --maxWorkers=1 --no-file-parallelism`). A completed national resume skipped all stages successfully after per-state archive cleanup.

The upload used `npx --no-install wrangler` from the repository root with its existing authentication. The live [v2 TileJSON](https://freehuntingmap.com/tiles/trails/v2.json) also returned HTTP 200 with the `trails` layer, zooms 6–14 and the lower-48 bounds. A populated z14 MVT returned HTTP 200, `application/vnd.mapbox-vector-tile`, and an ETag containing the archive SHA-256. Verification output:

```text
Verified R2 fhm-tiles/trails/v2/manifest.json {"size":453692373,"partSize":268435456,"parts":2,"sha256":"50da395a20633efdb29ed08385b2965709b077b79017c9571e5fc0df5817b1a0","built":"2026-10-25","bounds":[-124.85,24.4,-66.85,49.4]}
```
