# Forest openings pilot

The October 2026 pilot explored a derived layer for small clearings within forest. No candidate was suitable for publication: the evaluated masks selected agricultural field edges and missed some visible clearings. Imagery and classifications may also represent different dates. A national export should wait for a better recipe evaluated in multiple forest regions.

## Wisconsin cost pilot

Earth Engine task `SPQN3SS7PZHLQBOA7FDEICMV` exported a Wisconsin mask from `USGS/NLCD_RELEASES/2021_REL/NLCD/2021` at 30 m. It took 1,447.430 EECU seconds (0.402 EECU-hours). Scaling by land area suggests roughly 23 EECU-hours for the contiguous US, but that is only a rough estimate, not a budget for a different recipe or export grid.

The mask classified NLCD 41, 42 and 43 as forest and 52, 71, 81 and 82 as potential openings. It retained potential opening pixels where the mean forest mask in a 21-by-21-pixel square was at least 0.5. The neighborhood mean used Earth Engine's `boxcar` optimization. This context rule alone included field-edge fragments.

## Other candidates

- Dynamic World 2025 summer mode with a surrounding-tree context on a roughly 350 km² Wisconsin sample used 89.864 EECU seconds; simple area scaling exceeded the 40 EECU-hour layer budget.
- ESA WorldCover 2021 at 10 m with a 61-by-61-pixel forest-context window also selected agricultural edges. A local 8-connected component filter (at most 1,000 pixels of shrub, grass, crop or bare land) removed many edge fragments but also missed visible clearings.

Before any national export, refine the classification, compare it with independent imagery at representative locations in several forest regions, and measure the final recipe at state scale. Record planned and measured Earth Engine use in the agent ledger, and check the R2 budget before upload. The source experiment used [NLCD 2021](https://developers.google.com/earth-engine/datasets/catalog/USGS_NLCD_RELEASES_2021_REL_NLCD) and [ESA WorldCover 2021](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200); neither experiment adds a production data source.
