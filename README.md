# Free Hunting Map

Free, open-source, offline-first hunting and camping map. Runs as an installable web app (PWA); a native phone wrapper comes later.

Built because pins dropped on one phone in the woods never showed up on another phone without service. Everything here is local-first: your data lives on your device and moves between devices by file or QR code — no account, no server, no signal required.

## Features

- **Basemaps:** USGS Topo, USGS Imagery (satellite), OpenFreeMap streets (vector).
- **Labels overlay** (Topo and Satellite): place, road, trail, peak and water names from OpenFreeMap vector tiles; toggle under Layers.
- **Hillshade overlay:** USGS 3DEP lidar-derived terrain shading, available under Layers.
- **Public land overlays:** USGS PAD-US 4.1 toggles for USFS, BLM, NPS, FWS, state wildlife, state parks, state trust, DOD and other public land; tap land for its manager and designation.
- **Waypoints:** tap to drop; name, note and icon (pin, stand, blood, rub, camp, truck, trail cam). Drop at your GPS location.
- **Organize:** search offline by name, note, folder, type, camera model or date. Create colored categories for pins, trails and recordings; move one item in its editor or use Select for bulk moves, visibility and deletion. Category, item and type eyes control the map. Opening a hidden search result reveals its item, category and type.
- **Trail cams:** Drop pin → Trail cam. Edit bearing, angle and range with numeric controls or drag the center/edge handles on the map (mouse, touch or arrow keys). Camera model and set/check dates are under Details on phones. Save commits the draft. Field of view, category names and styles travel with GPX, GeoJSON and QR.
- **Tracks:** draw by tapping, or record from GPS (screen wake-lock while recording; points saved as you go).
- **Measure:** polyline distance in mi / ft / km.
- **GPS locate:** MapLibre GeolocateControl.
- **Conditions for the map center:** temperature, wind speed/direction arrow/gusts, next 8 hours (Open-Meteo); sunrise/sunset, civil twilight (approximation of legal shooting light — legal hours vary by state), moon phase, illumination, moonrise/set (computed on device with `suncalc`). Last forecast is cached and shown offline with its "as of" time.
- **Offline sharing:**
  - Export/import **GPX** and **GeoJSON** (uses the Web Share API when available, e.g. AirDrop / Quick Share, which work without internet).
  - **QR transfer:** selected pins/tracks are compressed into one or more numbered QR codes that cycle automatically; the other phone scans them with its camera. Re-scanning or re-importing is always safe (see merge rules).
- **Works offline:** app shell precached by a service worker; map tiles you've viewed are cached.

## Getting started

```bash
npm install
npm run dev       # dev server
npm run build     # type-check + production build to dist/
npm run preview   # serve dist/ (service worker active)
npm test          # unit tests (Vitest)
```

Geolocation and camera need a secure context: `localhost` works; on a phone, serve over HTTPS.

## Static pages and SEO

`npm run build` runs the plain Node generator in `scripts/build-pages.mjs` through
Vite, emits `.generated-pages/` into `dist/`, then lets Workbox precache the HTML,
styles and screenshots. Generated HTML is gitignored. The map remains at `/`;
content routes are excluded from the app navigation fallback. Workbox's clean-URL
and directory-index matching serves these pages offline after the map installs its
service worker. Cloudflare's SPA not-found handling remains unchanged.

Copy lives in `content/pages/`. The official resource inputs are
`content/states.json` (50 entries with `slug`, `name`, `agency`, `links`) and
`content/links.json` (resources with `group`, `title`, `url`, `description`).
State-specific editorial notes live in `content/pages/state-details.mjs`; a state's
own `notes` field takes precedence if provided. Missing links or state notes fail
the build. Feature sections in `content/pages/features.mjs` have explicit toggles
and source checks so stale feature claims fail visibly.

Canonicals use `https://freehuntingmap.com`: `/features`, `/about`, `/faq`, etc.
have no trailing slash; `/guides/` and `/public-land/` are directory indexes.
Privacy and terms keep their policy text in `public/` and share the content-site
navigation and stylesheet. The sitemap includes all 66 public HTML pages.

```bash
npm run build
node scripts/check-pages.mjs                         # internal links + JSON-LD
node scripts/check-pages.mjs --external --browser    # also check official sites
node scripts/verify-content.mjs                      # online/offline + review shots
node scripts/capture-screenshots.mjs                 # real app shots + social image
npm run build                                       # copy refreshed images to dist
```

Screenshot capture starts and stops Vite preview itself, imports synthetic GeoJSON
through Share, and centers near 44.51971, -90.81941 in Wisconsin. It captures
Organize categories, a trail-cam view cone, the redesigned Layers panel and
the 2025 USDA crops layer. The federal-trails view moves to Chequamegon-Nicolet
National Forest near Hayward; preview forwards real trail requests to the
production Worker because local preview has no R2 binding. It uses installed
Playwright Chromium and Python Pillow to make responsive WebP/AVIF assets. It
never uses personal data or fabricates map tiles or forecasts. Set
`FHM_CAPTURE_URL` to capture another running build, or `FHM_NOTES_DIR` to change
the default `/workspace/fhm-seo-notes` location for raw/review images and reports.

For Lighthouse, start `npm run preview -- --host 127.0.0.1 --port 4180`, then run
`CHROME_PATH=/usr/bin/google-chrome npx -y --package=lighthouse@12 -c 'node scripts/audit-pages.mjs'`.
The audit covers five content routes on mobile and desktop. Stop preview afterward.
Some official sites block automation or have certificate problems; link-check
failures are written to the notes directory for review, never silently ignored.

## Offline design

| Concern | How |
|---|---|
| App loads offline | Workbox precaches all built assets (incl. the MapLibre worker). |
| Map tiles offline | Runtime `CacheFirst` per source with `maxEntries` caps (4000 topo, 4000 imagery, 3000 PAD-US, 3000 hillshade, 4000 OpenFreeMap, 4000 parcel queries, 3000 each NHD/NWI; additional registry routes share 6000 entries) and 90-day expiry. Public trails have a 10,000-tile cap and one-year expiry. Only areas/zooms you have viewed are available. |
| Data | IndexedDB via `idb` (never localStorage). Stores: `items`, `outbox`, `imports`, `meta`. The app requests persistent storage. |
| Identity | Each device gets a random `deviceId` (stored in IndexedDB). Each item has a UUID `id`, `createdAt`, `updatedAt`, `deviceId` and a `deleted` tombstone. |
| Clock | `updatedAt` is a hybrid logical clock folded into epoch ms: strictly increasing per device and always ahead of anything imported, so a local edit after an import wins even with clock skew. |
| Merge | Pure per-item last-write-wins (`src/sync/merge.ts`): higher `updatedAt` wins; on a tie the tombstone wins; then higher `deviceId`; then canonical JSON (only for corrupt data). Idempotent, commutative and associative — property-tested. Every import (file or QR) goes through it. |
| Future sync | Every local write and every import that changes state is written to the `outbox` store (latest snapshot per item) in the same transaction. A sync server can drain it with `Repo.pending()` / `Repo.ack()`. |

Import accepts GPX, GeoJSON, and Google Takeout ZIP, CSV and JSON files. In [Google Takeout](https://takeout.google.com/), select **Saved** (one CSV per list), **Maps (your places)** (starred places in `Saved Places.json`), and optionally **Maps → My labeled places** (`Labeled places.json`). Import the whole ZIP or individual files from Share → Import file.

Takeout places become waypoint markers. Each list becomes a category (matched by name); notes/comments, tags and addresses remain in the note field; Google Maps source URLs are retained through exports, QR and sync. Coordinates come from Point geometry, Location Geo Coordinates, or coordinate-bearing URLs (`!3d/!4d`, `@`, `/maps/search/lat,lng`, `/maps/place/lat,lng`, `q`, `ll`, `query`). Actual place coordinates take precedence over a URL viewport. Rows without usable coordinates—including place-ID/cid-only links—are counted as skipped; importing uses no network or geocoding. Existing live waypoints and places within an import deduplicate by identical source URL, or case/whitespace-insensitive title within five meters. The result reports imported, duplicate and skipped counts.

Foreign GPX/GeoJSON files without our metadata get deterministic content-hash ids and `updatedAt = 0`, so re-importing the same file never duplicates and any local edit wins.

### QR format

`OHM1:<setId>:<index>:<total>:<data>` — `data` chunks concatenate to base64url(deflate(JSON)) of a compact array encoding (coordinates as integer micro-degrees, track points delta-encoded). `setId` is a hash of the payload and doubles as a checksum. Default chunk size is 600 characters (error correction L).

### Organize data and migration

IndexedDB v4 preserves every v3 store and reuses `records` for category snapshots and tombstones. Categories use the existing HLC, outbox, sanitizeRecord and pure LWW merge; Worker/D1 needs no migration. Items carry optional `categoryId`, `hidden`, color and pin icon override fields. Missing or deleted categories resolve to implicit Uncategorized. Type visibility is an allowlisted portable preference; search, selection, collapsed groups and camera previews stay local to the current panel.

At first Repo open, the idempotent Takeout migration recognizes Google Maps sources and legacy Takeout IDs (or standard/list names from CSV import logs), moves the final list-name note line into a category, and stamps each change through Repo. It retains coordinates, source URLs, metadata and all other note lines. File/QR sharing includes category names so imports find or create matching categories; hidden state is sync-only. Existing interchange identifiers and older payloads remain valid. Foreign GeoJSON also accepts `category` and `fov_bearing`/`fov_angle`/`fov_range` properties.

Organize browser checks: `TRAIL_URL=http://localhost:5180 FHM_SCREENSHOT_DIR=/workspace/fhm-notes/organize npx playwright test tests/organize.spec.ts --workers=1`. These cover 1440×900 and 390×844, stub external tiles locally, exercise mouse/touch handles, and capture screenshots. To run the same flow against a deployed PWA and verify an offline reload, add `FHM_ORGANIZE_LIVE=1` and set `TRAIL_URL=https://freehuntingmap.com`; it uses isolated browser data without Google sign-in.

## Data sources

External endpoints below were verified on 2026-10-22 to return tiles/images or parcel GeoJSON (`curl` → HTTP 200 `image/*`, with CORS headers). They are defined in `src/map/sources.ts`, `src/map/layers/` and `src/conditions/weather.ts`. Vegetation services were verified again on 2026-10-24 over Clark County, Wisconsin: HTTP 200 PNG imagery, nonempty pixels, and CORS allowing `https://freehuntingmap.com`. Viewed imagery and raster attribute tables are cached; identify requests stay live. Additional land/water/terrain registry sources were verified on 2026-10-24. Their hosts are allowed by the production Content Security Policy in `public/_headers`. Land/water/terrain image sources use 512-pixel tiles to reduce simultaneous service requests.

| Layer | Endpoint | License / terms |
|---|---|---|
| USGS Topo | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}` | USGS The National Map; public domain, attribution requested. |
| USGS Imagery | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | USGS The National Map orthoimagery (USDA NAIP); public domain, attribution requested. |
| Streets | `https://tiles.openfreemap.org/styles/liberty` | [OpenFreeMap](https://openfreemap.org) (free, no key). Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), © OpenMapTiles. Attribution comes from the TileJSON. |
| Labels | `https://tiles.openfreemap.org/planet` (TileJSON → vector tiles), glyphs `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` | [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, © OpenMapTiles), free, no key. Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Labels overlay on Topo/Satellite. |
| Trail finder | `https://s3-us-west-2.amazonaws.com/usgs-lidar-public/WI_Clark_2018/ept.json` and `WI_12County_9_B22/ept.json`; hierarchy JSON and LAZ nodes; 3DEP elevation `exportImage` with F32 TIFF, NAD83 UTM 15N | USGS public-domain 3DEP lidar/elevation. Verified 2026-10-24: JSON, LAZ and TIFF return 200; metadata and TIFF allow browser origins (`Access-Control-Allow-Origin: *`); browser LAZ decode verified. |
| Community trails | Same-origin `/tiles/community/12/{x}/{y}.geojson` | Anonymous model detections derived from USGS public-domain terrain; app-owned endpoint. Local Worker curl verified 200 with `application/geo+json`, five-minute cache headers; same-origin requests need no CORS permission. |
| Community hikes | Same-origin `/tiles/community-hikes/12/{x}/{y}.geojson` | Deliberately shared GPS recordings; app-owned community data, publicly viewable. Local D1 tests verify GeoJSON and five-minute caching; same-origin requests need no CORS permission. |
| Slope / Aspect | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage` with URL-encoded `Slope Map` / `Aspect Map` rendering rules | USGS 3DEP, public domain. Verified 2026-10-24: service `rasterFunctionInfos` lists both colored functions; exports return 200 `image/png` with CORS `*`. Legends sampled against paired degree exports; slope z10+, aspect z11+. |
| Hillshade | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage` with the Hillshade Gray raster function | USGS 3DEP elevation data, public domain. Lidar-derived terrain shading; resolution depends on available elevation coverage. |
| Public lands | `https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image` | USGS Gap Analysis Project, *Protected Areas Database of the United States (PAD-US) 4.1*, U.S. Geological Survey data release, https://doi.org/10.5066/P96WBCHS. USGS data are public domain. Layer 0 = PAD-US 4.1 Fee, filtered and colored by manager using dynamicLayers; `/MapServer/0/query` identifies enabled public land. |
| Parcels | Wisconsin Statewide Parcels DB FeatureServer/0/query (`services3.arcgis.com/n6uYoouQZW75n5WI`) | Wisconsin Statewide Parcels V12 (SCO), public domain. Visible at z13+; viewed tiles cached. Default off. |
| Lidar terrain & canopy height | Same-origin `/tiles/lidar-{lrm,openness,hillshade,slope,chm}/v1/{z}/{x}/{y}.webp`, PMTiles and TileJSON | USGS 3DEP lidar, federal public-domain data. Clark County pilot bounds [-90.93, 44.42, -90.31, 45.04], z8–16 with overzoom. Versioned R2 manifest/parts use `<name>/v1/`; absent tiles return 204. Off by default; viewed tiles cached offline. |
| Historic aerials | WI DNR `DW_Imagery/EN_Image_Basemap_{year}_Leaf_On/ImageServer/exportImage` (`dnrmaps.wi.gov/arcgis_image`) | USDA NAIP via Wisconsin DNR (2022, 2020, 2015, 2013, 2008, 2005); USDA 1937–41 aerials via UW–Madison SCO / Wisconsin DNR (`1930s`, patchy coverage). Public-domain USDA imagery; agency service terms apply. Default year 2005; layer off by default. All seven export endpoints verified 2026-10-24: HTTP 200 JPEG/PNG, CORS allows production origin. Viewed imagery cached offline. |
| Public trails | Same-origin `/tiles/trails/v1/{z}/{x}/{y}.mvt` (MVT layer `trails`, z6–14), `/tiles/trails/v1.pmtiles` (HTTP Range), TileJSON `/tiles/trails/v1.json` | USFS trails, Motor Vehicle Use Maps and roads; BLM Ground Transportation Linear Features; NPS trails; USGS National Digital Trails. Federal public-domain data. Attribution: USFS, BLM, NPS, USGS trails (public domain). R2 `fhm-tiles`: `trails/v1/manifest.json` and fixed-size `part-NNN` objects. Same-origin responses need no cross-origin CORS permission. Each data build has its own immutable `vN` prefix (see `scripts/trails/README.md`); live data is the Wisconsin + neighbors pilot (`v1`). Off by default; trails z9+, OHV/MVUM z8+, roads z11+. Viewed tiles cached offline (10,000 entries, one year); tap for available name, type, allowed uses, seasons, agency/unit and source/date. |
| Streams & lakes / Wetlands | USGS `USGSHydroCached/MapServer/tile` and USFWS `Wetlands/MapServer/export` (`fwspublicservices.wim.usgs.gov`) | USGS NHD / USFWS NWI, public domain federal data; attribution shown. NWI at z11+. Default off; cached. |
| Deer units | WI DNR `WM_CWD/WM_DMU_MSU_DMZ_Ext/MapServer/export` and `/2/query` (`dnrmaps.wi.gov`) | Wisconsin DNR service; agency terms apply. Viewed imagery cached; tap identification stays live. Default off, z6+. |
| Public access | `https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/export` (dynamic `Pub_Access` renderer), `/0/query` | [USGS public domain](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits); PAD-US 4.1. Open/restricted/closed/unknown; z5–19, transparent PNG32, viewed imagery cached; tap for unit and access. |
| PLSS townships / sections | `https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/export`, `/1/query`, `/2/query` | [BLM federal public-domain GIS data](https://www.blm.gov/services/geospatial/GISData). Outlines and service labels, townships z10–19 / sections z12–19; transparent PNG32 cached when viewed, tap for survey identifiers. |
| Springs & seeps / named water identification | `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export`, `/0/query`, `/6/query`, `/12/query` | [USGS NHD public domain](https://www.usgs.gov/national-hydrography). Springs filtered to FTYPE 458, z12–19; transparent PNG32 cached. Existing Streams & lakes imagery now identifies stream/lake names and feature type. |
| Watersheds / subwatersheds | `https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/export`, `/5/query`, `/6/query` | [USGS / USDA WBD public domain](https://www.usgs.gov/national-hydrography/watershed-boundary-dataset). HUC 10 z9–19 / HUC 12 z11–19; dynamic transparent outlines, viewed images cached; tap for name and HUC. |
| Riparian areas | `https://imagery.geoplatform.gov/iipp/rest/services/Ecosystems/USFS_EDW_Riparian_Areas/ImageServer/exportImage`, `/identify` | [USFS federal public-domain data](https://www.fs.usda.gov/rds/archive/catalog/RDS-2019-0030). Potential riparian areas, z10–19; Colormap rendering makes class 1 green with noData 0 transparent, 45% default opacity, viewed images cached. |
| Land cover (2025) | `https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms` — `Land-Cover-Native_conus_year_data`, `time=2025-01-01` | USGS Annual NLCD, [public domain](https://www.usgs.gov/data-management/data-licensing). PNG WMS GetMap + JSON GetFeatureInfo; newest verified MRLC vintage, 30 m, z8–18. |
| Vegetation type / height (2024) | `https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVT_CONUS/ImageServer` and `LF2024_EVH_CONUS/ImageServer` | USGS / USFS LANDFIRE, [public domain](https://www.usgs.gov/data-management/data-licensing); PNG32, nodata transparent, z8–18. Raw-pixel identify with full raster attribute tables (including all vegetation classes). |
| Forest type (2018) | `https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_FIA_BIGMAP_CONUS_ForestTypeGroup_2018/ImageServer` | USDA Forest Service FIA BIGMAP, [public domain](https://www.usda.gov/about-usda/policies-and-links); PNG32, nonforest transparent; identify by type group. z8–18. |
| Tree canopy (2025) | `https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer` — `time=1735689600000` | USDA Forest Service NLCD TCC, [public domain](https://www.usda.gov/about-usda/policies-and-links); PNG32, zero/background transparent, pixel identify in percent. z8–18. |
| Forest ownership | `https://imagery.geoplatform.gov/iipp/rest/services/Lands_Realty/USFS_EDW_ForestOwnership_CONUS/ImageServer` | USDA Forest Service FIA, [public domain](https://www.usda.gov/about-usda/policies-and-links); broad ownership classes, not access rights or parcel boundaries. Nonforest transparent, class identify, z8–18. |
| Fast vegetation loss | `https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_LCMS_MostRecentYearFastLoss_CONUS/ImageServer` | USDA Forest Service LCMS, [public domain](https://www.usda.gov/about-usda/policies-and-links); most recent fast vegetation loss year, 1985–2024. No-loss background transparent; year identify, z8–18. |
| Soils (SSURGO) | `https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms` (`mapunitpoly`, WMS 1.1.1) and `/Tabular/post.rest` | [USDA NRCS public-domain soil survey](https://efotg.sc.egov.usda.gov/references/Public/WI/Soil_Survey_Uses_Limitations_02252016_1222.pdf). Transparent map-unit boundaries, z12–19; viewed WMS images cached. Live SDA point intersection returns map-unit name, aggregate drainage, dominant-component hydric rating, and farmland class. |
| Ecoregions III / IV | `https://geodata.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer/export`, `/11/query`, `/7/query` | EPA federal public-domain ecoregions, service's December 2011 edition ([EPA](https://www.epa.gov/eco-research/ecoregions), [USDA public-domain catalog](https://agdatacommons.nal.usda.gov/articles/dataset/Ecoregions_of_North_America/24661866)). Level III z4–14, IV z6–15; 25% opacity for filled polygons, key Upper Midwest legend classes, live names; viewed imagery cached. |
| Contours | `https://carto.nationalmap.gov/arcgis/rest/services/contours/MapServer/export`, `/identify` | [USGS public domain](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits). Source chooses contour interval by scale; z11–19, transparent PNG32 cached when viewed. Tap returns elevation with source units. |
| Elevation tint | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`, `/identify` | [USGS 3DEP public domain](https://www.usgs.gov/3d-elevation-program). Fixed elevation bands in meters via server Remap/Colormap, z9–19, 35% default opacity; PNG32 with transparent nodata, viewed images cached; live elevation in meters and feet. |
| Crops (2025) | `https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer` — `mosaicRule={"where":"Year = 2025"}`, `time=1735689600000`, `croptypes` rendering | USDA NASS Cropland Data Layer, [public domain, free to redistribute](https://data.nass.usda.gov/Research_and_Science/Cropland/metadata/metadata_Cropland-Data-Layer-2024.htm). Latest catalog year verified 2026-10-24: `2025_10m_cdls`. PNG32 (background transparent), z9–18, crop + year identify at explicit 10 m pixel size from the full raster attribute table; viewed imagery/attribute table cached. |
| Wildfire hazard potential | `https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WildfireHazardPotentialClassified/ImageServer` | USDA Forest Service WHP 2023, [public domain](https://www.usda.gov/about-usda/policies-and-links). Five modeled potential classes (not current fire danger), PNG32; nonburnable/water transparent, default 50% opacity, z8–18; class identify. |
| Current wildfires | `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query` | NIFC / WFIGS federal public data; [source terms](https://www.arcgis.com/sharing/rest/content/items/d1c32af3212341869b3c810f1a215824?f=pjson). Viewport GeoJSON, wildfire incidents only (excludes prescribed burns), z6–18, outlines with light transparent fill; identify name/acres/containment/source update date. NetworkFirst viewed-response cache (one day maximum), refresh every five minutes while on. |
| Historic fire perimeters | `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query` | NIFC interagency federal public data; [source terms](https://www.arcgis.com/sharing/rest/content/items/e02b85c0ea784ce7bd8add7ae3d293d0?f=pjson). Viewport GeoJSON through 2025, z9–18, decade colors with transparent fill; identify name/year/acres; viewed responses cached. |
| Weather | `https://api.open-meteo.com/v1/forecast` | [Open-Meteo](https://open-meteo.com): free, no key, for non-commercial use; data CC BY 4.0 (attributed in the conditions panel). |
| Sun & moon | — | Computed locally with [`suncalc`](https://github.com/mourner/suncalc) (BSD-2-Clause). |

Also verified, but not wired in (fallback if PAD-US is unavailable): BLM Surface Management Agency cached tiles, `https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}` (BLM, public domain).

PAD-US is not a legal boundary or access determination. Always confirm land status and hunting regulations with the managing agency.

Icons (app and waypoint glyphs) are drawn in this repo (`scripts/gen-icons.mjs`, `src/map/icons.ts`, `src/ui/icons.ts`) and are MIT-licensed with the code.


Vegetation, Agriculture and Hazards verification (2026-10-24): PNG exports and
raster/WMS identification checked with curl and Chromium over Clark County, WI.
NIFC GeoJSON queries return CORS `*`; neither current nor historic perimeters are
present in that Clark County extent. Nonempty perimeter geometry was also checked
in Washington (current Little Giant fire) and northern California (historic fires).
Only viewport geometry is requested, with pagination and zoom-dependent simplification;
no national datasets are downloaded. Full raster class tables are fetched once and
cached when needed. Compact legends use source colors; LANDFIRE's legend highlights
Upper Midwest vegetation while identification covers the full class table.

Other candidates not selected: IIPP NLCD is older than MRLC Annual NLCD 2025;
stand size/stocking/age, crop-frequency and additional disturbance products were
left out to keep this set focused. LCMS supplies vegetation-loss years, so a second
GFW loss layer was not added. Timber activity polygons cover national forests only;
national vegetation/forest layers were prioritized. NIFC historic perimeters were
chosen over annual MTBS severity mosaics to supply fire names and years across the
full historic record. No additional license-restricted layers were added.


## Deployment

Production: https://freehuntingmap.com

Alias: https://open-hunt-map.metzdevan.workers.dev

Repository: https://github.com/DevanMetz/free-hunting-map

The Worker name stays `open-hunt-map` to preserve the Workers Builds connection. Storage/cache names and interchange identifiers remain stable. Browser storage is origin-scoped; export your files from the alias and import them on the new domain to move existing data.

The apex and `www` are configured as [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), with `workers_dev: true` retaining the alias. The [static assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/) needs no Worker script or assets binding for this site. The zone Redirect Rule for `www` → apex is managed separately.

The app is served as a static-assets-only [Cloudflare Worker](https://developers.cloudflare.com/workers/static-assets/) configured in `wrangler.jsonc` (SPA fallback to `index.html`; `public/_headers` keeps `sw.js` and the manifest uncached so PWA updates roll out). Every push to `main` is built and deployed automatically by Cloudflare Workers Builds (`npm run build` then `npx wrangler deploy`). Manual deploy: `npm run deploy`.

## Project layout

See [AGENTS.md](AGENTS.md) for architecture and conventions.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE) © 2026 Devan Metz

## Trail finder

Toolbar → Trail finder → Draw box → select two corners → Find trails. The selection
is capped at 2 square miles and 4 km per side. Results are ranked, marked Unverified,
and stored locally in IndexedDB independently of waypoints and tracks. Clear removes
only these derived results. Closing the panel cancels active work. Saved candidates
remain viewable offline; acquiring new lidar requires network access. Coverage is
limited to the two Wisconsin projects used by v4.

The fixed v4 `unet_r18_dem` dynamic-int8 ONNX model is lazy loaded from
`public/lidar/model.onnx` (12,588,880 bytes); its normalization and calibration are
alongside it. Runtime files are reproducibly copied/compressed from pinned npm
dependencies by `scripts/prepare-lidar.mjs` during dev/build, and cached on first use.
Inference and terrain processing run in a dedicated worker with WebGPU selection and
WASM fallback. Non-isolated pages use single-thread WASM SIMD. No inference server
or proxy is used. OSM road removal is omitted; line simplification uses Douglas–Peucker.
The restricted evaluation geometry is never shipped. See `THIRD_PARTY.md` for the
skeletonization lookup-table license.

## Optional Google cloud sync

The app works without an account. The toolbar contains Google sign-in when configured. Markers, drawn/GPS tracks, saved trail-finder candidates and map preferences merge across devices through a same-origin Worker API and D1. Viewport, weather caches, downloaded tiles and device state stay local. Signing out retains local data and queues logout if offline. “Delete account” removes all account data from D1, signs out, and releases the local account binding/cursor while retaining device data. Signing in again uploads that local data. Each browser database binds to its first account; use another browser profile for a different account to avoid uploading someone else's local map. Existing data on the Worker alias must still be exported/imported to move it to the production origin.

Setup (owner runs remote steps):

1. Create a Google OAuth **Web application** client. Add authorized JavaScript origins `https://freehuntingmap.com`, `https://www.freehuntingmap.com`, `https://open-hunt-map.metzdevan.workers.dev`; for development add `http://localhost:5180` and `http://localhost`. No redirect URI or client secret is used.
2. The public OAuth client ID is committed as `vars.GOOGLE_CLIENT_ID` in `wrangler.jsonc`, so Workers Builds deploys the intended value. Change that var when changing OAuth clients; no client secret is used. Ignored `.dev.vars` and test bindings can override the ID locally. Never commit `DEV_AUTH` in Worker vars.
3. Run `npx wrangler d1 migrations apply free-hunting-map --remote`, then deploy through the existing Workers Builds connection (`open-hunt-map`). **Do not deploy the API before applying migrations.**

Local development: `npm run build`, `npx wrangler d1 migrations apply free-hunting-map --local`, then `npx wrangler dev` (if the installed runtime rejects the configured date, add `--compatibility-date 2026-10-13` for local testing). Run `npm run dev` and open `http://localhost:5180` for real Google login; Vite uses strict port 5180 and proxies `/api` and `/tiles` to localhost:8787. The configured client also authorizes `http://localhost` (default port). Wrangler’s `http://localhost:8787` is not an authorized Google JavaScript origin; use `DEV_AUTH` there for local API testing. For API tests only, `.dev.vars` may set `DEV_AUTH=1`: credentials `dev:alice` work only on a localhost request URL, even if the flag is accidentally present in production. Never enable it for a publicly exposed development tunnel.

The signed-out toolbar uses a 44×44 native icon control with an undistorted, currentColor Google G. A nearly transparent GIS-rendered icon iframe is positioned over it and clipped to the control, so trusted pointer/keyboard activation still opens Google's popup and returns an ID token through the existing callback. No client secret, redirect registration, synthetic iframe clicks, or One Tap cooldown dependency is introduced. Chromium iframe focus needs an active-element fallback alongside CSS `:focus-within`. The mobile control lives in the top-level overlay, outside the bottom toolbar's compositor bounds. Preserve Google's iframe styles and dimensions; center and clip its wrapper instead. Repeated signed-out session notifications retain the live iframe.

Branding tradeoff: this requested monochrome treatment and obscured GIS button are not claimed to comply with [Google's branding guidelines](https://developers.google.com/identity/branding-guidelines), which currently prohibit monochrome G buttons. A fully compliant alternative is the visible Google-rendered button.

Browser verification (Vite + Wrangler running as above): `TRAIL_URL=http://localhost:5180 FHM_REAL_GIS=1 FHM_SCREENSHOT_DIR=/workspace/fhm-notes npx playwright test tests/*.spec.ts`. The real-network cases use full Chromium (rather than headless shell) and check iframe bounds/center hit, Tab focus ring, and an accounts.google.com popup at desktop/mobile widths; without `FHM_REAL_GIS`, deterministic iframe stubs cover the same path plus credential handling and account menus.

Security: Google RS256 ID tokens are verified against cached Google JWKS; the Worker issues 45-day opaque HttpOnly/Secure/SameSite=Lax host-only cookies and stores only SHA-256 hashes. POSTs require same-origin Origin and JSON. D1 enforces per-IP authentication and per-user sync rate limits across Worker instances without another service. Tombstones and shared last-write-wins rules resolve conflicts; account queries always include user identity. Sync rejects oversized records (1 MB), oversized requests (8 MB) and excessive batches/accounts. Large individual recordings remain local and show a sync error until reduced/exported. File and QR sharing continue to work offline.

Policy pages: `/privacy` and `/terms` are standalone static HTML, linked from Layers and excluded from the PWA navigation fallback.

Validation: `npm test` includes Worker token/handler tests and a two-device API sync test using real Miniflare D1 plus IndexedDB. `npm run test:worker` runs only Worker tests. A browser Google login still needs the owner's configured OAuth client and an interactive account.

Google Identity Services ([setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)) loads `https://accounts.google.com/gsi/client` on demand; the Worker retrieves keys from `https://www.googleapis.com/oauth2/v3/certs`. Authentication is optional and uses Google's service terms; it adds no map data source or map-data license.

### Registering data layers

`src/map/layerRegistry.ts` exports `registerLayer(def)`, `registerLayers(defs)` and
`layerRegistry`. Definitions appear in category order, then registration order;
empty categories are omitted. Stable IDs are the persistence and interchange keys.
Register definitions in `src/map/builtinLayers.ts`, or import a registration module
there so both the client and `vite.config.ts` see it. That registration graph must
have no DOM or MapLibre runtime dependencies (type imports are fine).

```ts
registerLayer({
  id: 'slope', category: 'terrain', name: 'Slope', defaultOpacity: 0.65,
  minzoom: 10, attribution: HILLSHADE_ATTR,
  source: { kind: 'raster', tiles: [SLOPE_EXPORT], tileSize: 256, maxzoom: 17 },
  cacheRoute: CACHE_ROUTES.hillshade,
  legend: [{ color: '#ffff00', label: '10°' }],
});
```

New registry layers and their verified endpoints belong in category modules under `src/map/layers/` and the Data sources table; shared basemap endpoints remain in `src/map/sources.ts`.
A declarative raster is installed on first activation and restored on style swaps.
For custom sources use `install(map, ctx)`, `setVisible(map, on, ctx)` and
`setOpacity(map, opacity, ctx)`; declare `layerIds` in drawing order. `ctx.beforeId`
keeps data below labels and user items. Hooks must tolerate repeated calls. The
optional `identify(lng, lat, signal, map, point)` returns `{ title?, rows }` (each row
is `[label, value]`) or `null`. Fetches must honor the abort signal. Registry changes
also update an open Layers panel without replacing existing controls.

A definition's `cacheRoute` is a URL regex consumed at build time by Workbox.
Live feeds declare `cacheStrategy: 'NetworkFirst'` and use the separate
`live-data-layers` cache (200 viewed responses, one day maximum); all existing
cache routes keep their default CacheFirst behavior.
Existing cache names stay stable; additional registered routes share
`tiles-data-layers` (6000 entries, 90 days). Downloads remain view-based; there is
no offline-area tile downloader. `layers`, `collapsed` and `remembered` preferences
persist in Repo and cloud sync, including unknown IDs for modules registered later.
Basemap thumbnails are bundled tiny crops of USGS tiles and OpenFreeMap Liberty;
source attributions and licenses are the same as their basemaps.

## Community trails

Trail finder shares completed detections anonymously by default, including when signed out. “Share scan results” is a single switch beside Usage analytics in Layers preferences. It is device-local, stored in IndexedDB metadata as `community.share`; turning it off discards pending uploads, and scans completed while off are never queued. Contributions already delivered are public and independent of account deletion. The separate `communityQueue` store retries on app start, reconnect and once a minute.

The Trails category includes **Community trails**, enabled by default at zoom 12 and above. Cyan lines grow stronger with confirmation count; tapping one shows scans, model, last-confirmed day, two vote buttons and an optional trail type. Tap the selected vote again to clear it. Viewed areas use the layer registry’s NetworkFirst offline cache. This is community model output, not an access or right-of-way designation.

`POST /api/community/scans` accepts JSON `{v:1, model:"v4", threshold:0.1, sources:["WI_Clark_2018","USGS_3DEP_DEM"], day:"YYYY-MM-DD", area:[west,south,east,north], lines:[{c:0.8,d:[lng0,lat0,deltaLng1,deltaLat1,...]}]}`. Coordinates are integers in millionths of a degree; the first pair is absolute and later pairs are deltas. Raw detections are simplified by at most 0.5 m before encoding; only the Worker simplifies display lines to 2.5 m. The area rounds outward to 0.01°. Empty scans are retained too. Limits: 4 MB JSON, 1,000 lines, 20,000 vertices per line, 150,000 vertices total, 50 km total length and 600 tile indexes. Metadata and the deduplication hash live in D1 `community_scans`; full raw geometry and per-line confidence live permanently in private R2 `TILES` (`fhm-tiles`) at `training/scans/<scanHash>.json`. Project IDs come from the EPT projects actually fetched, with `USGS_3DEP_DEM` for the fallback elevation raster. Older version-1 uploads may lack threshold/source metadata. Scans contain no account, device, IP or session identity; uploads omit cookies.

Limits: 600,000 request bytes, 200 lines, 2–2,000 vertices per line, 20,000 total vertices, 50 km total length and 600 tile-index entries. Coordinates must fall in US bounding boxes, inside/near a coarse scan bbox spanning at most 0.15° each way and 0.0025 square degrees. Dates must be within the past 366 days and not in the future. A line confirms an existing line when at least 60% of its length is within 8 m; a line’s count increases once per distinct scan. Canonical duplicate scans return 409, treated as delivered. Distinct uncovered lines are inserted; partial extensions of a matched line are currently not added.

`GET /tiles/community/12/{x}/{y}.geojson` returns merged GeoJSON with `scan_count`, `model`, `confidence`, `first_seen` and `last_confirmed`. This same-origin, app-owned data endpoint is covered by real local D1 integration tests. Edge responses cache for five minutes and affected tiles are purged on upload/moderation; `/api/*` remains NetworkOnly. No external data service or credentials are needed for this layer; underlying lidar/elevation is USGS public-domain data.

Moderation uses `POST /api/community/delete` with either `{id:"line-id"}` or `{bbox:[west,south,east,north]}` and `Authorization: Bearer <COMMUNITY_ADMIN_TOKEN>`. The token is a Worker secret already managed in production, never a committed variable. Bbox deletion removes intersecting lines. Scan metadata, raw training objects and vote history remain permanently; hashes prevent replay of deleted scans. Apply migration `0003_community_trails.sql` before deployment; it adds anonymous scans, merged lines, tile indexes and a merge revision guard. Uploads and deletions use atomic D1 batches, with optimistic retries for concurrent scans.


Voting uses `POST /api/community/vote` with `{id, token, vote:"real"|"not"|null, type:null|"logging road / two-track"|"foot / game trail"|"ATV"|"skid trail"|"fire break"|"ditch / other non-trail"}`. Clearing a vote requires `type:null`. The random 256-bit token is stored only in IndexedDB `meta['community.voteToken']`, never synced or linked to an account. The Worker stores its SHA-256 hash, one current vote per line/hash in `community_votes`, plus every accepted vote/label change in append-only `community_vote_log` with UTC timestamp. One-minute rate limits are 30 per device hash and 60 per salted IP hash; stale rate counters expire independently of training data. Local votes and pending sends live in `meta['community.votes']`; retries run on startup, reconnect and once a minute, independent of scan-sharing preference. A local negative vote filters the line immediately, including offline.

The hiding rule is defined by `HIDE_MARGIN` in `src/community/vote.ts`: hide when `not_votes - real_votes >= 2`. Hidden lines are retained for training. Admin `POST /api/community/override` accepts `{id,override:"show"|"hide"|null}` with the same Bearer secret as deletion. Overrides win over the public vote rule. Affected edge tile keys are purged after votes and overrides; already viewed offline tiles refresh when online. Your own negative vote remains a local filter.

Admin `GET /api/community/export` uses `Authorization: Bearer <COMMUNITY_ADMIN_TOKEN>` and needs no Origin header. It streams NDJSON GeoJSON Features, with `properties.dataset` selecting `scan_lines`, `labeled_lines`, `votes`, or `hikes`. Empty scans export a null-geometry feature with `empty_scan:true`. Raw scan features include scan ID, coarse area, day, model, threshold, sources and per-line confidence. Merged features include positive/negative counts, each type's count, all tied majority types, hidden and override status. Vote features have null geometry and include line ID, device hash, vote, type, timestamp and sequence. Deleted display lines are absent from merged export, while raw scans and vote history remain. Export reads D1 in pages and R2 one scan at a time; it is a live export, not a transactional snapshot across concurrent writes.

Run `FHM_ADMIN_TOKEN=… node scripts/community-export.mjs --out ./community-export`, or pass `--token-file /path/to/secret`. Optional `--url http://localhost:8787` targets local development. The script writes `scan_lines.geojson`, `labeled_lines.geojson`, `votes.geojson`, and `hikes.geojson` incrementally with restricted file permissions. Keep the token outside source control. No remote migration or deployment is performed by this script.

## Community hikes

Open a **recorded track’s existing editor** and choose **Share to community**. Choose an optional public name (blank by default) and type, leave **Trim ends** on at 200 m per end (adjustable 100–500 m), or turn it off to share the full track, and review the violet line plus distance/month before sharing. Drawn tracks have no share action. Sharing works signed out and offline; “Unshare from community” queues a withdrawal. Deleting the recording also queues withdrawal. This is separate from “Share scan results.” The Trails category’s **Community hikes** layer is on by default at zoom 12, with violet dashed lines; tap for distance, month, optional name/type and Report. These lines do not grant access permission.

When “Trim ends” is on, the client interpolates cuts by along-track distance. When off, the full line includes its original endpoints. Both modes lightly simplify to 2.5 m and drop all elevation and point timestamps. The payload contains only month (`YYYY-MM`), selected geometry and optional public text/type; the server computes the public distance. Names have a 60-character cap and strip control/bidirectional formatting characters; private track names are never prefilled. Choose public text with care. Trimming does not guarantee anonymity, especially for loops or routes passing near their starting point again.

`POST /api/community/hikes/share` accepts `{id,secret,hike:{v:1,month:"YYYY-MM",name:"",type:null,d:[lng0,lat0,deltaLng1,deltaLat1,...]}}`. ID and secret are independent random 256-bit lowercase hex values. Coordinates use the same integer microdegree deltas as scans. Type is null or `hike`, `scouting`, `deer drag`, `ATV`, `horse`, `other`. The server accepts full or trimmed geometry without assuming client trimming, derives distance, simplifies geometry, rejects unknown public fields and hashes canonical geometry for duplicates (409 = delivered). Limits: 250 KB JSON, 10,000 points, >200 m and <=100 km shared length, supported US bounds, <=1° extent per axis, <=0.1 square degree bbox and <=400 tile indexes; month must be valid, no earlier than 2000-01 and not in the future. Public tables contain no account, track ID, email, device ID, session or IP. Anonymous requests omit cookies. D1 stores only SHA-256 of the withdrawal secret; the public ID cannot authorize withdrawal.

`POST /api/community/hikes/unshare` accepts `{id,secret}`. Withdrawals are idempotent, erase geometry/public metadata and tile indexes, and leave an ID tombstone to prevent delayed uploads. Unsharing removes the hike from **future training exports too**; exports already downloaded cannot be recalled. Separate synced ownership records keep credentials with your account’s private data; GPX/GeoJSON/QR item exports contain no credentials. Each share generation persists independently, including pending withdrawals. Delivery acknowledgments and report state stay device-local in IndexedDB; retries run on startup, record changes, reconnect and every minute. Clearing browser storage without retaining account sync credentials can lose the ability to withdraw. Account deletion itself does not remove anonymous hikes; unshare first.

`GET /tiles/community-hikes/12/{x}/{y}.geojson` returns FeatureCollections with public `id`, `distance` (meters), `month`, `name` and `type`. This app-owned same-origin endpoint uses D1 geometry and indexes, five-minute edge caching and registry NetworkFirst offline caching; no external service, CORS permission or extra R2 training copy is needed. Integration tests verify GeoJSON content type and tile output. Writes purge affected keys on the request’s own origin, best effort; cached/offline copies may remain until refreshed.

`POST /api/community/hikes/report` accepts `{id,token}` using the same device-local anonymous random token as trail voting. Only its SHA-256 hash is stored. A device can report each hike once; accepted reports are logged. At `HIKE_REPORT_THRESHOLD` (3), hide from public tiles while retaining geometry for moderation/training; exports include hidden/report/override status. All anonymous hike operations have a 60/minute salted IP-hash limit; reports also have a 30/minute device-hash limit. Counters expire separately from community data.

Admin `POST /api/community/hikes/delete` accepts `{id}` or `{bbox:[west,south,east,north]}`. `POST /api/community/hikes/override` accepts `{id,override:"show"|"hide"|null}`. Both require the existing `Authorization: Bearer <COMMUNITY_ADMIN_TOKEN>` secret. Override wins over report hiding; neither override nor delayed uploads revive withdrawn/deleted hikes. Display deletion retains geometry and report history for moderation, excludes it from training export, and keeps duplicate protection. The existing admin NDJSON export now includes `dataset:'hikes',source:'gps_track',label:'positive'` with the selected simplified geometry and public metadata; `scripts/community-export.mjs` additionally writes `hikes.geojson`. No ownership secret or secret hash is exported. Apply **0004_community_hikes.sql** before deployment; 0003 is unchanged. Remote migration and deployment require owner action.
