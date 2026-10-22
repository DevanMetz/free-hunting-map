# Open Hunt Map

Free, open-source, offline-first hunting and camping map. Runs as an installable web app (PWA); a native phone wrapper comes later.

Built because pins dropped on one phone in the woods never showed up on another phone without service. Everything here is local-first: your data lives on your device and moves between devices by file or QR code — no account, no server, no signal required.

## Features

- **Basemaps:** USGS Topo, USGS Imagery (satellite), OpenFreeMap streets (vector).
- **Labels overlay** (Topo and Satellite): place, road, trail, peak and water names from OpenFreeMap vector tiles; toggle under Layers.
- **Hillshade overlay:** USGS 3DEP lidar-derived terrain shading, available under Layers.
- **Public lands overlay:** USGS PAD-US 4.1 (federal, state, local and NGO fee lands, colored by manager).
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
| Map tiles offline | Runtime `CacheFirst` per source with `maxEntries` caps (4000 topo, 4000 imagery, 3000 PAD-US, 3000 hillshade, 4000 OpenFreeMap) and 90-day expiry. Only areas/zooms you have viewed are available. |
| Data | IndexedDB via `idb` (never localStorage). Stores: `items`, `outbox`, `imports`, `meta`. The app requests persistent storage. |
| Identity | Each device gets a random `deviceId` (stored in IndexedDB). Each item has a UUID `id`, `createdAt`, `updatedAt`, `deviceId` and a `deleted` tombstone. |
| Clock | `updatedAt` is a hybrid logical clock folded into epoch ms: strictly increasing per device and always ahead of anything imported, so a local edit after an import wins even with clock skew. |
| Merge | Pure per-item last-write-wins (`src/sync/merge.ts`): higher `updatedAt` wins; on a tie the tombstone wins; then higher `deviceId`; then canonical JSON (only for corrupt data). Idempotent, commutative and associative — property-tested. Every import (file or QR) goes through it. |
| Future sync | Every local write and every import that changes state is written to the `outbox` store (latest snapshot per item) in the same transaction. A sync server can drain it with `Repo.pending()` / `Repo.ack()`. |

Foreign GPX/GeoJSON files without our metadata get deterministic content-hash ids and `updatedAt = 0`, so re-importing the same file never duplicates and any local edit wins.

### QR format

`OHM1:<setId>:<index>:<total>:<data>` — `data` chunks concatenate to base64url(deflate(JSON)) of a compact array encoding (coordinates as integer micro-degrees, track points delta-encoded). `setId` is a hash of the payload and doubles as a checksum. Default chunk size is 600 characters (error correction L).

## Data sources

All endpoints below were verified on 2026-10-22 to return tiles/images (`curl` → HTTP 200 `image/*`, with CORS headers). They are defined in `src/map/sources.ts` and `src/conditions/weather.ts`.

| Layer | Endpoint | License / terms |
|---|---|---|
| USGS Topo | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}` | USGS The National Map; public domain, attribution requested. |
| USGS Imagery | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | USGS The National Map orthoimagery (USDA NAIP); public domain, attribution requested. |
| Streets | `https://tiles.openfreemap.org/styles/liberty` | [OpenFreeMap](https://openfreemap.org) (free, no key). Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), © OpenMapTiles. Attribution comes from the TileJSON. |
| Labels | `https://tiles.openfreemap.org/planet` (TileJSON → vector tiles), glyphs `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` | [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, © OpenMapTiles), free, no key. Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Labels overlay on Topo/Satellite. |
| Hillshade | `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage` with the Hillshade Gray raster function | USGS 3DEP elevation data, public domain. Lidar-derived terrain shading; resolution depends on available elevation coverage. |
| Public lands | `https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image` | USGS Gap Analysis Project, *Protected Areas Database of the United States (PAD-US) 4.1*, U.S. Geological Survey data release, https://doi.org/10.5066/P96WBCHS. USGS data are public domain. Layer 0 = PAD-US 4.1 Fee, rendered by manager name. |
| Weather | `https://api.open-meteo.com/v1/forecast` | [Open-Meteo](https://open-meteo.com): free, no key, for non-commercial use; data CC BY 4.0 (attributed in the conditions panel). |
| Sun & moon | — | Computed locally with [`suncalc`](https://github.com/mourner/suncalc) (BSD-2-Clause). |

Also verified, but not wired in (fallback if PAD-US is unavailable): BLM Surface Management Agency cached tiles, `https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}` (BLM, public domain).

PAD-US is not a legal boundary or access determination. Always confirm land status and hunting regulations with the managing agency.

Icons (app and waypoint glyphs) are drawn in this repo (`scripts/gen-icons.mjs`, `src/map/icons.ts`, `src/ui/icons.ts`) and are MIT-licensed with the code.

## Deployment

Live: https://open-hunt-map.metzdevan.workers.dev

The app is served as a static-assets-only [Cloudflare Worker](https://developers.cloudflare.com/workers/static-assets/) configured in `wrangler.jsonc` (SPA fallback to `index.html`; `public/_headers` keeps `sw.js` and the manifest uncached so PWA updates roll out). Every push to `main` is built and deployed automatically by Cloudflare Workers Builds (`npm run build` then `npx wrangler deploy`). Manual deploy: `npm run deploy`.

## Project layout

See [AGENTS.md](AGENTS.md) for architecture and conventions.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE) © 2026 Devan Metz
