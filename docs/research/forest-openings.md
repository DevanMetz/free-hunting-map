# Forest openings pilot

The October 2026 pilot explored a derived layer for small clearings within forest. No candidate was suitable for publication: the evaluated masks selected agricultural field edges and missed some visible clearings. Imagery and classifications may also represent different dates. A national export should wait for a better recipe evaluated in multiple forest regions.

## Wisconsin cost pilot

Earth Engine task `SPQN3SS7PZHLQBOA7FDEICMV` exported a Wisconsin mask from `USGS/NLCD_RELEASES/2021_REL/NLCD/2021` at 30 m. It took 1,447.430 EECU seconds (0.402 EECU-hours). Scaling by land area suggests roughly 23 EECU-hours for the contiguous US, but that is only a rough estimate, not a budget for a different recipe or export grid.

The mask classified NLCD 41, 42 and 43 as forest and 52, 71, 81 and 82 as potential openings. It retained potential opening pixels where the mean forest mask in a 21-by-21-pixel square was at least 0.5. The neighborhood mean used Earth Engine's `boxcar` optimization. This context rule alone included field-edge fragments.

## Other candidates

- Dynamic World 2025 summer mode with a surrounding-tree context on a roughly 350 km² Wisconsin sample used 89.864 EECU seconds; simple area scaling exceeded the 40 EECU-hour layer budget.
- ESA WorldCover 2021 at 10 m with a 61-by-61-pixel forest-context window also selected agricultural edges. A local 8-connected component filter (at most 1,000 pixels of shrub, grass, crop or bare land) removed many edge fragments but also missed visible clearings.

Before any national export, refine the classification, compare it with independent imagery at representative locations in several forest regions, and measure the final recipe at state scale. Record planned and measured Earth Engine use in the agent ledger, and check the R2 budget before upload. The source experiment used [NLCD 2021](https://developers.google.com/earth-engine/datasets/catalog/USGS_NLCD_RELEASES_2021_REL_NLCD) and [ESA WorldCover 2021](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200); neither experiment adds a production data source.

## Date-matched reference comparison

A follow-up compared the WorldCover connected-component mask with cloud-masked Sentinel-2 surface-reflectance summer 2021 median RGB composites at 10 m in small Wisconsin, Pennsylvania and Oregon samples. The Pennsylvania mask includes road corridors and developed clearings; the Wisconsin sample misses an apparent larger clearing. The Oregon sample contains many patches in a landscape with extensive forestry disturbance. These are visual observations, not measured accuracy. Sentinel-2's resolution is too coarse to judge small openings reliably, and WorldCover itself uses Sentinel imagery, so this is not an independent validation source. Matching the year reduces, but does not eliminate, date mismatch as an explanation.

The three small reference exports used 58.881 EECU seconds in total. Their costs are not estimates for a national classification. Before refining a national recipe, assemble independent, higher-resolution, date-matched reference samples with representative positive and negative examples across regions; distinguish desired openings from roads, buildings, field edges and recent timber harvest. Measure both missed openings and false positives, then revisit cost at state scale. No production source was added.

## Independent aerial reference seeds

The original Wisconsin, Pennsylvania and Oregon sample points have no 2021 NAIP imagery in the Earth Engine collection. Three additional 0.01° squares in Minnesota, Virginia and Maine have 2021 NAIP imagery and matching WorldCover 2021 classifications. The reproducible export is in `scripts/openings/reference_samples.py`: it exports aerial RGB at 1 m and WorldCover at 10 m. These are exploratory seeds, not a representative or labeled accuracy sample. The Minnesota image includes forest and field edges; the Virginia image includes a large field, roads and buildings alongside forest. More positive examples of small forest openings and independent holdout areas are needed, as is sufficient surrounding classification context for the neighborhood and connected-component rules. The current squares alone cannot establish accuracy or justify a national export.

The six exports used about 0.00634 EECU-hours combined; that is not an estimate for a national layer. [USDA NAIP](https://developers.google.com/earth-engine/datasets/catalog/USDA_NAIP_DOQQ) imagery is public domain with attribution requested to USDA Farm Production and Conservation - Business Center, Geospatial Enterprise Operations. It is a research reference, not a new production data source. Availability and sample dates were checked on 2026-10-26.
