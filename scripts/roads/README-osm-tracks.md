# OSM tracks

```bash
python3 scripts/roads/osm_tracks.py --region both --work /workspace/roads-build/osm
```

Requires `osmium`, `tippecanoe`, `tile-join`, and Python `shapely`, `pyproj`, `pmtiles`, `mapbox-vector-tile`. Regions: `midwest`, `lower48`, `both`. The script has no upload step. Scratch stays under `--work`; guards enforce an 18 GB work budget and at least 25 GB free on the filesystem. Completed statistics checkpoints reuse finished regions; remove a region's `*-stats.json` to rebuild. Normalized checkpoints reuse geometry after interrupted tiling when its scratch input still exists.

## Data sources

[Geofabrik](https://download.geofabrik.de/) public OSM extracts:

- `https://download.geofabrik.de/north-america/us/{wisconsin,minnesota,michigan,iowa,illinois}-latest.osm.pbf`
- `https://download.geofabrik.de/north-america/us-latest.osm.pbf`

All six URLs were checked by real HTTP/1.1 HEAD and GET requests on 2026-10-24: redirects to dated PBFs, `application/octet-stream`, successful lengths and valid osmium PBF headers. The national download also validates each HTTP 206 Content-Range before accepting it. These are server-side acquisitions; the app consumes the built archive through its own tile service rather than fetching Geofabrik from a browser.

License evidence: [Geofabrik's download page](https://download.geofabrik.de/) explicitly links [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); [OSM's copyright page](https://www.openstreetmap.org/copyright) states its licensing and attribution requirements. Display [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The exported derived databases remain ODbL, including applicable share-alike and source-availability requirements. Keep this attribution and license with training data.

The build report in `--work/REPORT.md` records coverage, source timestamps, feature/grade counts, kilometres, sizes, hashes and Wildcat Ln tile checks. Source response evidence is in `*-sources.json`.

Only `highway=track` ways are included, deduplicated by OSM way ID. National geometry is clipped to the lower-48 envelope; state extracts preserve cross-border ways. The export is gzipped EPSG:4326 newline-delimited GeoJSON, rounded to six decimals. `g` is tracktype grade 1–5 or 0; `id` is OSM way ID; optional `s`, `a`, `n` are surface, access, name. No inference of public access is made.

PMTiles has one source-layer, `osm`, header zooms 8–14, features from z10. z8–11 allow density dropping; the independent z12–14 build and tile join disable feature/tile-size limits. Header minzoom is patched to 8 following the trails pipeline. Only raw downloads and scratch files are deleted automatically. Upload, R2 multipart packaging, version selection and deployment belong to the parent agent.
