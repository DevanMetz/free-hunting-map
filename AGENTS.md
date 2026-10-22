# AGENTS.md

Guidance for humans and coding agents working in this repo.

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
