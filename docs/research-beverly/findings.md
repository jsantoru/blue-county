# Beverly Drive source research

Retrieved 20 September 2026. This folder contains reference data and observations, not a replacement game map. The focus is the real Beverly Drive horseshoe and its short West Ridge Road closure, near the verified address point at latitude 41.283879, longitude -74.3662393.

## Exact area

`verified-loop-extent.json` follows OSM Beverly Drive way **20686958** and the connecting part of West Ridge Road way **20668865**, joining at their actual shared nodes **221872780** and **221872784**. Centerline length is **1,218.89 metres**. Local coordinates use x east, z south, in metres from the address point.

| Bounds | Minimum | Maximum |
|---|---:|---:|
| Loop x | -253.606 | 13.911 |
| Loop z | -308.913 | 160.412 |
| Reference image x | approximately -334 | approximately 94 |
| Reference image z | approximately -389 | approximately 241 |

The unbuffered loop WGS84 envelope is [-74.369271, 41.282438, -74.366073, 41.286654]. The exact exported image georeference is in `ortho2025-export-georeference.json` and its EPSG:3857 worldfile `beverly-2025-ortho.jgw`. Use that returned extent instead of assuming the requested extent was unchanged by ArcGIS aspect-ratio adjustment.

## Primary imagery and vector sources

- **Spring 2025 NYSDOP aerial:** [NYS 2025 service](https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer), downloaded as `beverly-2025-ortho.jpg`, 1800 × 2650 pixels, about 0.238 ground metres per exported pixel. The service describes approximately 12-inch display resolution. The [official Orange download page](https://gis.ny.gov/orange-county-orthoimagery-downloads) independently lists Warwick 2025; the Warwick archive identifies the source as 6-inch, four-band imagery. Exporting at a finer pixel spacing does not increase the service's native detail. The spring year is established; an exact individual flight day was not established.
- **NYS building polygons:** [official service](https://gisservices.its.ny.gov/arcgis/rest/services/BuildingFootprints/MapServer), `footprints-local.geojson`, 65 polygons in the buffered envelope. Orange county metadata says last update March 2025, based on 2021 imagery / 2022 LiDAR. **Per-feature dates differ:** 62 local polygons are marked 2013, two 2021–22, and one unspecified. Do not label all footprints as 2025. Source attributes remain in each feature.
- **Public tax parcels:** [NYS service](https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcels_Public/FeatureServer), 2025 parcel data published May 2026. `parcels-local.geojson` contains 54 intersecting parcels, including 38 Beverly addresses. Requested fields contain parcel identifiers, site addresses, footprint-relevant styles and dates, and parcel geometry. Owner names and mailing addresses were not requested. Parcel boundaries are reference geometry, not a survey.
- **Address association:** `footprints-address-join.json` associates a footprint mean vertex position with its enclosing parcel and supplies local x/z polygon coordinates. This geometric association can associate accessory structures with neighboring parcels where source boundaries differ; it is not a postal or ownership assertion.

The cached ArcGIS Latest Orthoimagery index returned 2021 at the home, while the live 2025-only service and current county download page provide 2025 coverage. The index is stale for this location; the images in this folder came explicitly from the 2025 service.

## Visible evidence and limits

The aerial clearly resolves roof outlines, detached buildings, lawn boundaries, driveway approaches, extensive deciduous woodland, evergreen screens, and the road's unmarked asphalt. It supports actual placements and plan shapes; it does not establish unseen facades, window layouts, precise heights, or current colors. The leaf-off aerial also contains shadows which should not be mistaken for tree crown boundaries.

`east-observations.json` contains 15 driveway traces, 47 approximate large crown observations, and four pavement cross-sections. Original full-image pixels, inspection crop pixels, local coordinates, confidence and occlusion notes are retained. The eastern pavement cross-sections measure **8.94–9.53 metres**, with approximate edge uncertainty of 0.8 metre. These measure apparent paved margins, not a legal carriageway width. No center stripe is visible in the inspected eastern segments.

**2 Beverly:** county parcel 1752052 identifies the structure as a raised ranch built in 1985. State main-building polygon 7159466 is roughly 10 × 15 metres, centered at local [1.97, 2.13]. Detached garage polygon 7206345 is southeast at [13.23, 20.86], and shed polygon 7206297 is farther east at [26.38, 13.56]. Direct visual comparison with the 2025 crop shows the three corresponding roofs in the expected positions and orientations. There is no gross missing-building or wrong-property alignment at Home. Roof overhang, image displacement and older outline capture can account for metre-scale edge differences; no global offset correction was derived.

The Home driveway is heavily hidden by evergreen crowns. Only its road-mouth stub is traced. Its unseen connection to the garage/apron must not be fabricated from this image. Nearby 4 and 6 Beverly have substantially clearer approaches.

## Rights and attribution

The [official NYS FAQ](https://gis.ny.gov/orthoimagery-faqs) provides imagery for no-cost viewing and downloading. [ShareGIS](https://gis.ny.gov/shareGIS/) expressly describes free public services, feature exports, and display in custom JavaScript/HTML applications. Official ortho and building-footprint ArcGIS item metadata supplies an **as-is / no-warranty** use notice; the notice is cached in `ortho-item.json` and `footprints-official-item.json` / its XML metadata. No named Creative Commons license, blanket public-domain declaration, or separate express derivative-redistribution license was found for this specific 2025 imagery. Do not relabel it CC0 or infer a license from a third-party ArcGIS mirror. The files here are retained as attributed research references.

Suggested source credit: **NYS ITS Geospatial Services / NYSDOP, Spring 2025; building footprints: NYS ITS Geospatial Services, Orange County GIS Division, NYSERDA and contributing sources; parcel reference: Orange County and NYS ITS Geospatial Services.** Source-specific attributes and date qualifications should remain in any generated dataset. OSM route topology remains © OpenStreetMap contributors under ODbL.

## Assessor exterior-photo lookup

The [official Orange County Parcel Information page](https://www.orangecountyny.gov/612/Parcel-Information) explicitly lists photographic property images among its public search features and links [Beacon](https://beacon.schneidercorp.com/Application.aspx?App=OrangeCountyNY&PageType=Search). The legacy [ImageMate portal](https://propertydata.orangecountygov.com/) now redirects its Public Access button to Beacon. Its homepage also notes that Warwick is an exception to weekly assessment updates.

Beacon's browser entry presents Agree/Disagree terms including an indemnification clause. No agreement was accepted, no account was created, and no property record was opened. Consequently the availability or date of exterior photographs specifically for 2, 4 or 6 Beverly was **not verified**. The browser's public-access UI was used; no hidden URL, authentication or terms bypass was attempted. Source reference photos are still an unresolved option if the user elects to accept the portal's agreement.

## Files and reproduction

- `fetch-references.py`: bounded public GIS export/query fetch, separate from game build scripts.
- `annotate-east.py`: converts the recorded manual crop coordinates through exact image extents into local coordinates and original-image pixels.
- `build-review.py`: creates `review-overlay.html`, a source-photo inspection page with toggles for footprints, parcels, driveway traces, canopies, and original OSM loop. Clicking gives source pixels and local metres. It changes no source image or game file.
- `home-east-south-2025.jpg` and `east-north-2025.jpg`: direct GIS exports for detailed inspection; their paired georeference JSON contains URLs and exact bounds.
- `fetched-reference-provenance.json`, `service-source-urls.json`, and cached service/item metadata retain request provenance. The optional 5.93GB municipal archive was **not** downloaded in full: bounded HTTP ranges retrieved its directory and small index metadata only.
