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
| Fast vegetation loss (1985–2024) | USDA Forest Service LCMS | [USDA public-domain policy](https://www.usda.gov/about-usda/policies-and-links) | IIPP LCMS_MostRecentYearFastLoss_CONUS ImageServer PNG32, value 55 (no loss) transparent; identify + raster attribute table. |

Verified 2026-10-24 using curl with `Origin: https://freehuntingmap.com`: these exports return `image/png`, allow the production origin, and contain transparent background and visible features over Clark County, Wisconsin. Service queries return survey/access attributes. Zoom ranges limit display, with source overzoom above z17.

Wisconsin DNR managed lands, county forests, State Natural Areas and MFL open lands were not added: the [GIS terms](https://dnr.wisconsin.gov/topic/forestmanagement/data) refer to the [acceptable-use policy](https://dnr.wisconsin.gov/legal/acceptableuse), which restricts material to noncommercial use and may require permission for redistribution. Other state hunting units were deferred because no clearly licensed official multi-state service was established.
