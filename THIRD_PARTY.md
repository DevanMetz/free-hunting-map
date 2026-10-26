The Zhang–Suen lookup table in src/lidar/skeletonLut.ts is derived from
scikit-image v0.25.2, skimage/morphology/_skeletonize_various_cy.pyx.
https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/morphology/_skeletonize_various_cy.pyx

Copyright (c) 2009-2022 the scikit-image team. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
THE POSSIBILITY OF SUCH DAMAGE.

Other dependencies retain their npm package licenses. ONNX Runtime is MIT;
laz-perf is Apache-2.0; copc is MIT; proj4 is MIT; geotiff is MIT.

## Map data layers

| Layer | Provider | License / terms URL | How served |
|---|---|---|---|
| Public access (`padus-access`) | USGS PAD-US 4.1 | Public domain; [USGS copyrights](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits), [data release](https://doi.org/10.5066/P96WBCHS) | Source ArcGIS MapServer PNG32 exports with dynamic access renderer; live point query; viewed tiles cached. |
| PLSS townships / sections (`plss-townships`, `plss-sections`) | Bureau of Land Management | Federal public domain; [BLM GIS data](https://www.blm.gov/services/geospatial/GISData) | Source CadNSDI MapServer layers 1/2; transparent PNG32 exports and live point queries; viewed tiles cached. |
| Springs & seeps / Streams & lakes identification (`water-springs`, `water-nhd`) | USGS NHD | Federal public domain; [National Hydrography](https://www.usgs.gov/national-hydrography), [USGS copyright policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) | Source NHD MapServer PNG32 point exports filtered to FTYPE 458; live point/line/polygon queries; viewed images cached. |
| Watersheds / subwatersheds (`water-huc10`, `water-huc12`) | USGS / USDA NRCS WBD | Federal public domain; [Watershed Boundary Dataset](https://www.usgs.gov/national-hydrography/watershed-boundary-dataset) | Source MapServer line layer 0 filtered by HUDigit, transparent outline renderer; polygon layers 5/6 for identify and live point query; viewed images cached. |
| Riparian areas (`water-riparian`) | USDA Forest Service / GeoPlatform IIPP | Federal public domain; [USFS data release RDS-2019-0030](https://www.fs.usda.gov/rds/archive/catalog/RDS-2019-0030), [service provenance](https://imagery.geoplatform.gov/iipp/rest/services/Ecosystems/USFS_EDW_Riparian_Areas/ImageServer) | Source ImageServer PNG32 export with class-1 green Colormap and transparent noData 0; live pixel identify; viewed images cached. |
| Land cover (Annual NLCD 2025) | USGS EROS / MRLC | [Public domain](https://www.usgs.gov/data-management/data-licensing) | MRLC `dmsdata.cr.usgs.gov` Annual NLCD WMS GetMap, explicit 2025 time; GetFeatureInfo. |
| Vegetation type (2024) | USGS / USDA Forest Service LANDFIRE | [Public domain federal data](https://www.usgs.gov/data-management/data-licensing) | `lfps.usgs.gov` LF2024_EVT_CONUS ImageServer PNG32; identify + raster attribute table. |
| Vegetation height (2024) | USGS / USDA Forest Service LANDFIRE | [Public domain federal data](https://www.usgs.gov/data-management/data-licensing) | `lfps.usgs.gov` LF2024_EVH_CONUS ImageServer PNG32; identify + raster attribute table. |
| Forest type (2018) | USDA Forest Service FIA BIGMAP | [USDA public-domain policy](https://www.usda.gov/about-usda/policies-and-links) | IIPP ForestTypeGroup_2018 ImageServer PNG32, nonforest transparent; identify + raster attribute table. |
| Tree canopy (2025) | USDA Forest Service NLCD TCC | [USDA public-domain policy](https://www.usda.gov/about-usda/policies-and-links) | IIPP NLCD_TCC_CONUS ImageServer, explicit 2025 time, zero/background transparent; pixel identify. |
| Forest ownership | USDA Forest Service FIA | [USDA public-domain policy](https://www.usda.gov/about-usda/policies-and-links) | IIPP ForestOwnership_CONUS ImageServer PNG32, nonforest transparent; identify + raster attribute table. |
| Logging cuts (2001–2025) | [Hansen/UMD/Google/USGS/NASA Global Forest Change v1.13](https://developers.google.com/earth-engine/datasets/catalog/UMD_hansen_global_forest_change_2025_v1_13) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Lower-48 clipping; treecover2000 ≥25%; lossyear colored by year, reprojected and tiled to lossless WebP. Loss includes disturbances other than logging. State clipping uses public-domain Census TIGER/2018 boundaries. |
| Fast vegetation loss (1985–2024) | USDA Forest Service LCMS | [USDA public-domain policy](https://www.usda.gov/about-usda/policies-and-links) | IIPP LCMS_MostRecentYearFastLoss_CONUS ImageServer PNG32, value 55 (no loss) transparent; identify + raster attribute table. |
| Soils (`soils-ssurgo`) | USDA NRCS SSURGO / Soil Data Access | Federal public domain; [NRCS soil survey uses and limitations](https://efotg.sc.egov.usda.gov/references/Public/WI/Soil_Survey_Uses_Limitations_02252016_1222.pdf), [SDA](https://sdmdataaccess.sc.egov.usda.gov/) | Source WMS transparent mapunitpoly PNG tiles; live SDA point-intersection SQL via POST for map-unit name, drainage, dominant hydric rating and farmland class. Only imagery is cached. |
| Ecoregions III / IV (`terrain-ecoregions-iii`, `terrain-ecoregions-iv`) | US EPA ORD | Federal public domain; [EPA dataset](https://www.epa.gov/eco-research/ecoregions), [USDA public-domain catalog](https://agdatacommons.nal.usda.gov/articles/dataset/Ecoregions_of_North_America/24661866) | Source MapServer layers 11/7 (December 2011), PNG32 exports at 25% opacity; live point queries; viewed imagery cached. Legend colors from source renderer, key Upper Midwest classes. |
| Contours (`terrain-contours`) | USGS The National Map | Federal public domain; [USGS copyright policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) | Source contours MapServer transparent PNG32 exports with scale-dependent intervals, live identify with source elevation units; viewed imagery cached. |
| Elevation tint (`terrain-elevation`) | USGS 3DEP | Federal public domain; [3DEP](https://www.usgs.gov/3d-elevation-program), [USGS copyright policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) | Source elevation ImageServer PNG32 export using fixed meter bands in Remap/Colormap; transparent nodata, default 35% opacity; raw elevation identify; viewed imagery cached. |
| Crops (2025) | USDA NASS | [Public domain, free to redistribute](https://data.nass.usda.gov/Research_and_Science/Cropland/metadata/metadata_Cropland-Data-Layer-2024.htm) | Source `pdi.scinet.usda.gov` CDL_WM ImageServer PNG32, 2025 mosaic + time, croptypes renderer; identify + full crop attribute table; viewed imagery cached. |
| Wildfire hazard potential | USDA Forest Service RMRS | [USDA public-domain policy](https://www.usda.gov/about-usda/policies-and-links) | IIPP WildfireHazardPotentialClassified ImageServer PNG32, 2023 model, water/nonburnable transparent; pixel identify + raster attribute table. |
| Current wildfires | NIFC / WFIGS interagency federal public data | [Source terms and provenance](https://www.arcgis.com/sharing/rest/content/items/d1c32af3212341869b3c810f1a215824?f=pjson) | Public FeatureServer viewport GeoJSON, wildfire incidents only, transparent polygons; NetworkFirst (one day maximum), five-minute refresh; local feature identify including source update date. |
| Historic fire perimeters | NIFC interagency federal public data | [Source terms and provenance](https://www.arcgis.com/sharing/rest/content/items/e02b85c0ea784ce7bd8add7ae3d293d0?f=pjson) | All_Years_View FeatureServer viewport GeoJSON through 2025; decade-colored transparent polygons, viewed geometry cached; local name/year/acres identify. |

Verified 2026-10-24 using curl with `Origin: https://freehuntingmap.com`: these exports return `image/png`, allow the production origin, and contain visible features over Clark County, Wisconsin at their supported scales (springs additionally checked at Veazie Springs, Wisconsin). Boundary/WMS/riparian images have transparent backgrounds; ecoregion/elevation fills use reduced default opacity. Service queries return survey/access, hydrology, soils, ecological-region and elevation attributes. Zoom ranges limit display; source tiles overzoom at high zoom levels.

Wisconsin DNR managed lands, county forests, State Natural Areas and MFL open lands were not added: the [GIS terms](https://dnr.wisconsin.gov/topic/forestmanagement/data) refer to the [acceptable-use policy](https://dnr.wisconsin.gov/legal/acceptableuse), which restricts material to noncommercial use and may require permission for redistribution. Other state hunting units were deferred because no clearly licensed official multi-state service was established.

Optional thematic soils (`USFS_Drainage_Class`) were skipped: `exportImage` returns “This operation is not supported on a non-catalog data source,” and the tile endpoint returns Not Found (no cached tile schema). No datasets were downloaded.


Hazards were verified with the production Origin header on 2026-10-24:
WHP returns nonempty PNG32 with transparent background over Clark County, WI;
NIFC current/history queries return GeoJSON with CORS `*` (empty in that WI extent,
nonempty in Washington/northern California). NIFC source terms disclaim accuracy
and legal-boundary use; historic data are for strategic use. Neither service's
published terms restrict use to noncommercial applications or prohibit redistribution.

Public trails tiles contain U.S. federal public-domain data from USFS (trails,
Motor Vehicle Use Maps and roads), BLM (Ground Transportation Linear Features),
NPS (trails), and USGS (National Digital Trails).
Attribution: USFS, BLM, NPS, USGS trails (public domain).
Source agency, unit, source dataset and source date are retained in tile properties
where available. The tiles are served from the same-origin /tiles/trails/v2/ route.

The in-repo PMTiles v3 reader implements the published format specification:
https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
