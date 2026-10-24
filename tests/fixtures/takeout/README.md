Synthetic Takeout fixtures; no personal data. Regenerate the committed ZIP with `node tests/fixtures/takeout/generate.mjs`.

Research checked October 24, 2026:
- https://github.com/purarue/google_takeout_parser/issues/20 — actual Saved CSV and Maps (your places) FeatureCollection samples, including Location and Geo Coordinates.
- https://github.com/schackartk/google_mapper — verifies `Takeout/Maps/My labeled places/Labeled places.json`.
- https://developers.google.com/data-portability/schema-reference/maps — Google's aliased/pinned place Point geometry and name/address properties.
- https://exportgooglemaps.com/ — current product selections: Saved, Maps (your places), Maps → My labeled places.
- https://www.nickgracilla.com/posts/export-google-maps-saved-places/ — February 2025 update on per-list CSV exports.

The ZIP includes the three product paths and deliberately invalid unrelated files to verify filtering. CSV covers actual-place versus viewport precedence, search/place coordinate paths, q/ll/query, encoded URLs, identifier-only links, BOM, CRLF, multiline notes, escaped quotes, Comment and Tags. JSON covers geometry, Location coordinate strings, zero-geometry fallback, missing coordinates and labels. Published/Updated are included but imports use local Repo clock stamps.
