# Free Hunting Map

Free, open-source, offline-first hunting and camping map. Runs as an installable web app (PWA); a native phone wrapper comes later.

Built because pins dropped on one phone in the woods never showed up on another phone without service. Everything here is local-first: your data lives on your device and moves between devices by file or QR code — no account, no server, no signal required.

## Features

- **Basemaps:** USGS Topo, USGS Imagery (satellite), OpenFreeMap streets (vector).
- **Labels overlay** (Topo and Satellite): place, road, trail, peak and water names from OpenFreeMap vector tiles; toggle under Layers.
- **Hillshade overlay:** USGS 3DEP lidar-derived terrain shading, available under Layers.
- **Public land overlays:** USGS PAD-US 4.1 toggles for USFS, BLM, NPS, FWS, state wildlife, state parks, state trust, DOD and other public land; tap land for its manager and designation.
- **Waypoints:** tap to drop; name, note and icon (pin, stand, blood, rub, camp, truck). Drop at your GPS location.
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

## Offline design

| Concern | How |
|---|---|
| App loads offline | Workbox precaches all built assets (incl. the MapLibre worker). |
| Map tiles offline | Runtime `CacheFirst` per source with `maxEntries` caps (4000 topo, 4000 imagery, 3000 PAD-US, 3000 hillshade, 4000 OpenFreeMap, 4000 parcel queries, 3000 each NHD/NWI; deer units live only) and 90-day expiry. Only areas/zooms you have viewed are available. |
| Data | IndexedDB via `idb` (never localStorage). Stores: `items`, `outbox`, `imports`, `meta`. The app requests persistent storage. |
| Identity | Each device gets a random `deviceId` (stored in IndexedDB). Each item has a UUID `id`, `createdAt`, `updatedAt`, `deviceId` and a `deleted` tombstone. |
| Clock | `updatedAt` is a hybrid logical clock folded into epoch ms: strictly increasing per device and always ahead of anything imported, so a local edit after an import wins even with clock skew. |
| Merge | Pure per-item last-write-wins (`src/sync/merge.ts`): higher `updatedAt` wins; on a tie the tombstone wins; then higher `deviceId`; then canonical JSON (only for corrupt data). Idempotent, commutative and associative — property-tested. Every import (file or QR) goes through it. |
| Future sync | Every local write and every import that changes state is written to the `outbox` store (latest snapshot per item) in the same transaction. A sync server can drain it with `Repo.pending()` / `Repo.ack()`. |

Import accepts GPX, GeoJSON, and Google Takeout ZIP, CSV and JSON files. In [Google Takeout](https://takeout.google.com/), select **Saved** (one CSV per list), **Maps (your places)** (starred places in `Saved Places.json`), and optionally **Maps → My labeled places** (`Labeled places.json`). Import the whole ZIP or individual files from Share → Import file.

Takeout places become waypoint markers. List names, notes/comments, tags and addresses go into the existing note field; Google Maps source URLs are retained through exports, QR and sync. Coordinates come from Point geometry, Location Geo Coordinates, or coordinate-bearing URLs (`!3d/!4d`, `@`, `/maps/search/lat,lng`, `/maps/place/lat,lng`, `q`, `ll`, `query`). Actual place coordinates take precedence over a URL viewport. Rows without usable coordinates—including place-ID/cid-only links—are counted as skipped; importing uses no network or geocoding. Existing live waypoints and places within an import deduplicate by identical source URL, or case/whitespace-insensitive title within five meters. The result reports imported, duplicate and skipped counts.

Foreign GPX/GeoJSON files without our metadata get deterministic content-hash ids and `updatedAt = 0`, so re-importing the same file never duplicates and any local edit wins.

### QR format

`OHM1:<setId>:<index>:<total>:<data>` — `data` chunks concatenate to base64url(deflate(JSON)) of a compact array encoding (coordinates as integer micro-degrees, track points delta-encoded). `setId` is a hash of the payload and doubles as a checksum. Default chunk size is 600 characters (error correction L).

## Data sources

All endpoints below were verified on 2026-10-22 to return tiles/images or parcel GeoJSON (`curl` → HTTP 200 `image/*`, with CORS headers). They are defined in `src/map/sources.ts` and `src/conditions/weather.ts`.

| Layer | Endpoint | License / terms |
|---|---|---|
| USGS Topo | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}` | USGS The National Map; public domain, attribution requested. |
| USGS Imagery | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | USGS The National Map orthoimagery (USDA NAIP); public domain, attribution requested. |
| Streets | `https://tiles.openfreemap.org/styles/liberty` | [OpenFreeMap](https://openfreemap.org) (free, no key). Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), © OpenMapTiles. Attribution comes from the TileJSON. |
| Labels | `https://tiles.openfreemap.org/planet` (TileJSON → vector tiles), glyphs `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` | [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, © OpenMapTiles), free, no key. Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Labels overlay on Topo/Satellite. |
| Trail finder | `https://s3-us-west-2.amazonaws.com/usgs-lidar-public/WI_Clark_2018/ept.json` and `WI_12County_9_B22/ept.json`; hierarchy JSON and LAZ nodes; 3DEP elevation `exportImage` with F32 TIFF, NAD83 UTM 15N | USGS public-domain 3DEP lidar/elevation. Verified 2026-10-24: JSON, LAZ and TIFF return 200; metadata and TIFF allow browser origins (`Access-Control-Allow-Origin: *`); browser LAZ decode verified. |
| Hillshade | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage` with the Hillshade Gray raster function | USGS 3DEP elevation data, public domain. Lidar-derived terrain shading; resolution depends on available elevation coverage. |
| Public lands | `https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image` | USGS Gap Analysis Project, *Protected Areas Database of the United States (PAD-US) 4.1*, U.S. Geological Survey data release, https://doi.org/10.5066/P96WBCHS. USGS data are public domain. Layer 0 = PAD-US 4.1 Fee, filtered and colored by manager using dynamicLayers; `/MapServer/0/query` identifies enabled public land. |
| Parcels | Wisconsin Statewide Parcels DB FeatureServer/0/query (`services3.arcgis.com/n6uYoouQZW75n5WI`) | Wisconsin Statewide Parcels V12 (SCO), public domain. Visible at z13+; viewed tiles cached. Default off. |
| Water | USGS `USGSHydroCached/MapServer/tile` and USFWS `Wetlands/MapServer/export` (`fwspublicservices.wim.usgs.gov`) | USGS NHD / USFWS NWI, public domain federal data; attribution shown. NWI at z11+. Default off; cached. |
| Deer units | WI DNR `WM_CWD/WM_DMU_MSU_DMZ_Ext/MapServer/export` and `/2/query` (`dnrmaps.wi.gov`) | Wisconsin DNR service; agency terms apply. Live only, never cached; default off, z6+. |
| Weather | `https://api.open-meteo.com/v1/forecast` | [Open-Meteo](https://open-meteo.com): free, no key, for non-commercial use; data CC BY 4.0 (attributed in the conditions panel). |
| Sun & moon | — | Computed locally with [`suncalc`](https://github.com/mourner/suncalc) (BSD-2-Clause). |

Also verified, but not wired in (fallback if PAD-US is unavailable): BLM Surface Management Agency cached tiles, `https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}` (BLM, public domain).

PAD-US is not a legal boundary or access determination. Always confirm land status and hunting regulations with the managing agency.

Icons (app and waypoint glyphs) are drawn in this repo (`scripts/gen-icons.mjs`, `src/map/icons.ts`, `src/ui/icons.ts`) and are MIT-licensed with the code.

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

Local development: `npm run build`, `npx wrangler d1 migrations apply free-hunting-map --local`, then `npx wrangler dev` (if the installed runtime rejects the configured date, add `--compatibility-date 2026-10-13` for local testing). Run `npm run dev` and open `http://localhost:5180` for real Google login; Vite uses strict port 5180 and proxies `/api` to localhost:8787. The configured client also authorizes `http://localhost` (default port). Wrangler’s `http://localhost:8787` is not an authorized Google JavaScript origin; use `DEV_AUTH` there for local API testing. For API tests only, `.dev.vars` may set `DEV_AUTH=1`: credentials `dev:alice` work only on a localhost request URL, even if the flag is accidentally present in production. Never enable it for a publicly exposed development tunnel.

The signed-out toolbar uses a 44×44 native icon control with an undistorted, currentColor Google G. A nearly transparent GIS-rendered icon iframe is positioned over it and clipped to the control, so trusted pointer/keyboard activation still opens Google's popup and returns an ID token through the existing callback. No client secret, redirect registration, synthetic iframe clicks, or One Tap cooldown dependency is introduced. Chromium iframe focus needs an active-element fallback alongside CSS `:focus-within`. The mobile control lives in the top-level overlay, outside the bottom toolbar's compositor bounds. Preserve Google's iframe styles and dimensions; center and clip its wrapper instead. Repeated signed-out session notifications retain the live iframe.

Branding tradeoff: this requested monochrome treatment and obscured GIS button are not claimed to comply with [Google's branding guidelines](https://developers.google.com/identity/branding-guidelines), which currently prohibit monochrome G buttons. A fully compliant alternative is the visible Google-rendered button.

Browser verification (Vite + Wrangler running as above): `TRAIL_URL=http://localhost:5180 FHM_REAL_GIS=1 FHM_SCREENSHOT_DIR=/workspace/fhm-notes npx playwright test tests/*.spec.ts`. The real-network cases use full Chromium (rather than headless shell) and check iframe bounds/center hit, Tab focus ring, and an accounts.google.com popup at desktop/mobile widths; without `FHM_REAL_GIS`, deterministic iframe stubs cover the same path plus credential handling and account menus.

Security: Google RS256 ID tokens are verified against cached Google JWKS; the Worker issues 45-day opaque HttpOnly/Secure/SameSite=Lax host-only cookies and stores only SHA-256 hashes. POSTs require same-origin Origin and JSON. D1 enforces per-IP authentication and per-user sync rate limits across Worker instances without another service. Tombstones and shared last-write-wins rules resolve conflicts; account queries always include user identity. Sync rejects oversized records (1 MB), oversized requests (8 MB) and excessive batches/accounts. Large individual recordings remain local and show a sync error until reduced/exported. File and QR sharing continue to work offline.

Policy pages: `/privacy` and `/terms` are standalone static HTML, linked from Layers and excluded from the PWA navigation fallback.

Validation: `npm test` includes Worker token/handler tests and a two-device API sync test using real Miniflare D1 plus IndexedDB. `npm run test:worker` runs only Worker tests. A browser Google login still needs the owner's configured OAuth client and an interactive account.

Google Identity Services ([setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)) loads `https://accounts.google.com/gsi/client` on demand; the Worker retrieves keys from `https://www.googleapis.com/oauth2/v3/certs`. Authentication is optional and uses Google's service terms; it adds no map data source or map-data license.
