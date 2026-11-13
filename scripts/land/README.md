# State land tiles

Builds `state-land.pmtiles` (source-layer `land`, zooms 5–15) and leaves it at `--work`. Upload with the terrain uploader after adding nothing else to a published prefix:

```bash
python3 scripts/land/build_land.py --work /tmp/state-land
python3 scripts/terrain/upload.py state-land v1 /tmp/state-land/state-land.pmtiles
```

Public land is non-private [USGS PAD-US 4.1](https://doi.org/10.5066/P96WBCHS) (public domain) for the 50 states and DC. Parcels are the [Hawaii Statewide GIS](https://planning.hawaii.gov/gis/download-gis-data-expanded/) TMK layer (public domain). Completed page downloads are reused. `pc` on every feature is `yes`, `partial`, or `no` and matches `src/map/stateLandCatalog.ts`.

Requires `tippecanoe` and `tile-join`. The script does not deploy the Worker.
