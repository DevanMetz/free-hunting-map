# Free Hunting Map — agent guidance

Guidance for humans and coding agents working in [Free Hunting Map](https://github.com/DevanMetz/free-hunting-map).

Production: https://freehuntingmap.com

Worker alias: https://open-hunt-map.metzdevan.workers.dev

Keep the Worker name `open-hunt-map` for the existing Workers Builds connection. Keep storage keys, cache names and interchange identifiers stable across branding changes. Browser storage is origin-scoped: export files from the alias and import them on the production domain to move existing data.

## Commands

```bash
npm install
npm run dev         # Vite dev server (do not leave running in automation)
npm run build       # tsc --noEmit + vite build (must pass)
npm test            # vitest run (must pass)
npm run typecheck   # tsc only
npm run icons       # regenerate public/icons/* and public/favicon.svg
```

## Stack

Vite + strict TypeScript (no framework) · MapLibre GL JS v6 · `idb` (IndexedDB) · `vite-plugin-pwa` (Workbox) · `fflate` · `qrcode` / `jsqr` (+ native `BarcodeDetector` when present) · `suncalc` · Vitest (`happy-dom` for GPX tests, `fake-indexeddb` for repo tests).

## Architecture

```
src/
  types.ts            Domain model: Waypoint | Track, ItemMeta (id, createdAt, updatedAt, deviceId, deleted)
  main.ts             Boot: open Repo, start App, register service worker
  sync/               Pure logic, no DOM
    merge.ts          LWW merge (compareVersions, mergeItem, mergeSets) — the conflict rules
    hlc.ts            Hybrid logical clock (monotonic epoch ms)
    validate.ts       sanitizeItem: untrusted input -> Item | null
    ids.ts            uuid(), contentId() for foreign imports
  storage/
    db.ts             IndexedDB schema (items, outbox, imports, meta)
    repo.ts           Repo: local writes (stamp + outbox), importItems (merge), pending/ack, meta
  share/              Pure encoders/decoders + thin browser helpers
    compact.ts        Compact array encoding for QR
    qr.ts             Chunked QR format + QrAssembler
    geojson.ts, gpx.ts  Export/import (round-trip exact for our own files)
    files.ts          Download / Web Share / file parsing
    scanner.ts        Camera QR scanning
  map/
    sources.ts        ALL external tile/style endpoints + attribution
    map.ts            HuntMap: MapLibre wrapper; re-installs overlays after basemap swaps
    labels.ts         Labels overlay (OpenFreeMap vector symbols) for raster basemaps
    cacheRoutes.ts    Service-worker runtime-cache URL patterns
    icons.ts          Waypoint icon SVGs
    geo.ts            Distance math/formatting, coordinate rounding
    recorder.ts       GPS track recorder + fix filter
  conditions/
    weather.ts        Open-Meteo client/parser
    astro.ts          Sun/moon via suncalc
    cache.ts          Network-first with IndexedDB fallback
  ui/
    app.ts            App controller: toolbar, modes/tools, map clicks, recording, settings
    sheet.ts          Bottom sheet / side panel
    *Panel.ts         One file per panel; receive an AppContext
    tools.ts          Waypoint / draw-track / measure tools
    dom.ts, icons.ts  h() element builder, icon buttons, toast
```

Data flow: UI -> `Repo` (IndexedDB) -> `change` event -> `App.reloadItems()` -> `HuntMap.setItems()`. Imports (file/QR) -> `sanitizeItem` -> `Repo.importItems` -> `mergeItem`.

## Rules

- **Local-first.** Never require network for core features. Persist with IndexedDB via `Repo`, never localStorage.
- **All writes go through `Repo`** so they get HLC timestamps, deviceId and an outbox entry. Never `put` items directly.
- **All incoming data goes through `sanitizeItem` and the merge.** Keep `merge.ts` pure and keep its property test passing.
- **Coordinates are `[lng, lat]`** and rounded to 6 decimals (`roundCoord`) so exports round-trip exactly.
- **Never invent endpoints.** New data sources must be verified (curl returns the expected content type, CORS ok) and documented in README "Data sources" with license.
- **UI design rule:** clean UI — no taglines, helper/explanatory text or secondary labels. Fix layout instead of adding text. Icon-only buttons need `aria-label` + `title` (use `iconButton`).
- Mobile-first: bottom toolbar + bottom sheet on phones; right rail + left side panel at >= 760px.
- Keep modules small; pure logic gets unit tests next to it (`*.test.ts`).

## Testing notes

- `src/sync/merge.test.ts` — LWW rules plus randomized commutativity/associativity/idempotence.
- `src/share/qr.test.ts` — chunking, assembler ordering/dupes/corruption, and a real `qrcode` -> `jsQR` round trip.
- `src/share/gpx.test.ts`, `geojson.test.ts` — exact round trips and foreign-file imports.
- `src/storage/repo.test.ts` — IndexedDB repo with `fake-indexeddb`.

## Optional cloud sync

- `worker/`: same-origin Google ID-token authentication, opaque cookie sessions, D1 sync API; `migrations/`: Wrangler D1 schema. Keep `open-hunt-map` and the existing DB binding identifiers.
- `src/sync/records.ts` extends sync to saved lidar candidates and portable settings without changing the map/share `Item` union. `src/sync/cloud.ts` drains Repo outbox, merges sanitized incoming records and stores cursors in Repo metadata. Never sync viewport/cache/device state.
- Local data binds to its first account; sign-out keeps it and must stop uploads immediately. Do not silently reassign it to another account. Explicit account deletion clears all D1 account data and releases local ownership/cursor while retaining local map data.
- The public OAuth client ID is committed as `vars.GOOGLE_CLIENT_ID` in `wrangler.jsonc`; `.dev.vars` and tests can override it. Never commit `DEV_AUTH` in vars. Vite uses strict port 5180: real Google login uses `http://localhost:5180`, while Wrangler port 8787 uses dev authentication. Local schema: `npx wrangler d1 migrations apply free-hunting-map --local`. Remote migrations/deploy require owner authorization.
- `npm run build` checks client and Worker. `npm test` includes real Miniflare D1 API tests; `npm run test:worker` isolates them. API routes must stay NetworkOnly and excluded from PWA navigation fallback. Standalone `/privacy` and `/terms` pages must also bypass that fallback. Dev authentication is localhost-only and requires an uncommitted `DEV_AUTH=1`.
