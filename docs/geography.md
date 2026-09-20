# Warwick map provenance and review

The anchor is the **house-level address point** for 2 Beverly Dr, Warwick, NY 10990: **41.2838790, -74.3662393**. It is [OSM node 8788896022](https://www.openstreetmap.org/node/8788896022), carrying NYS address-point ID `ORAN057146`. On 2026-09-20, Nominatim returned house number 2, Beverly Drive, Warwick, 10990. A separate current ArcGIS World Geocoder returned a `PointAddress` match, score 100, at 41.28388794, -74.36624112, approximately 1 meter away. Confidence is high for a house address point, not a surveyed structure/driveway location. Census's current address-range geocoder returned a point about 115 meters away; that interpolation was rejected as the house anchor.

The source cache and precise metadata are in `public/map/source/` and `public/map/manifest.json`. No paid service or live map request is needed by the game. ArcGIS World Geocoder was used only as an independent location check. Road geometry and address-point locations come from the reusable OSM extract. A separate NYS reference pass supplies building footprints and observed scenery around the starting Beverly loop; its source cache is in `docs/research-beverly/`. See [Beverly reconstruction](beverly-reconstruction.md) for scope, evidence and limitations.

## What is verified

- Beverly Drive is an approximately horseshoe-shaped street. Both ends connect to **West Ridge Road**, at shared OSM nodes `221872780` and `221872784`. It is not treated as a dead end, and its real bend geometry is retained.
- Beverly Drive plus the short connecting West Ridge segment forms a real **1,218.89-meter neighborhood loop**, from OSM ways `20686958` and `20668865`. The detailed scenery pass covers this starting area; it does not replace the separate Ridge & Hollow race.
- The three-lap **Ridge & Hollow** circuit is **2,644.7 meters per lap**, clockwise, about one kilometer east of Home. It follows **Old Ridge Road → High Hill Avenue → Claire Ann Drive → Seward Highway → mapped Old Ridge/Seward connector → Old Ridge Road**. The short connector is OSM way `20655828`, not an invented closing segment.
- Every route edge is an edge from the original shared-node OSM graph. A polyline crossing alone never becomes a junction. The route is closed at the same original OSM node.
- Home starts on the exposed parking apron at 2 Beverly, about **19.6 meters** from the house address point, facing the curved driveway exit. Official 2010/2013 aerials reveal the approach hidden by trees in 2025 and correct its entrance roughly 8m south of the earlier stub. The current exposed apron is visible; present-day edges under the canopy remain approximate. See the [property pass](property-pass.md).
- The map includes the connected local road component within a **3.8 × 3.9 km** rectangle, centered on Home. Roads end at the playable boundary rather than connecting to fabricated streets. The compact extract includes portions of West Ridge, Sleepy Valley, Old Ridge, Pine Island Turnpike, Locust, Maple, and other local roads.

See [the top-down route preview](../public/map/route-preview.svg), also supplied as a PNG. North is up, the route is amber, and Home is teal. The small northern/eastern/boundary road stubs are intentional clips of the source network.

## Elevation and units

Geometry uses **one meter per game unit**, local **X east, Y up, Z south**. Latitude/longitude are projected with a local equirectangular approximation about the house point. Heading is `atan2(dx, dz)` in radians; zero faces south (+Z). Stored Home road position is `[-23.874, 2.501, -5.052]`; its initial heading is `-0.208545` radians.

The [USGS 3DEP Bare Earth DEM service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) supplied real Float32 elevation samples. The service described its source coverage as current through **2026-08-24**. The unmodified GeoTIFF, returned geographic extent, parsed source grid, and service metadata are cached. Pixels are sampled at their centers, accounting for the server's adjusted export extent. Home's sampled absolute ground elevation is about **211.6 meters**. All game heights are relative to this datum.

The terrain is resampled to a **129 × 133** grid, approximately 30-meter cells. Stored road centerline samples occur at intervals no greater than 12 meters, with Y computed by bilinear interpolation from that grid; this softens small bumps while retaining the broader local elevation. At runtime, `src/roads.ts` uses the **exact terrain triangle interpolation**, with the same cell diagonal as the terrain mesh. Road strips and joins are clipped against those terrain facets, and the asphalt surface is lifted **0.065m** above the terrain. This keeps visible surfaces and colliders aligned through grades and junctions. The runtime terrain sampler is authoritative for spawn placement, including Home; small differences from the stored bilinear point Y values are expected. Raster sampling is not a road-surface engineering survey. Mapped bridge/layer tags are retained; no road-over-road bridge is part of the selected race.

## Deliberate approximations

Beverly Drive and the inspected West Ridge segment use **9.2m pavement width**, informed by four aerial cross-sections of 8.94–9.53m with approximately 0.8m edge uncertainty. This is an approximate apparent paved width, not a legal carriageway measurement. No center stripe is visible in the inspected local imagery, so the local roads have no painted centerline. Elsewhere, residential roads retain **10.5m** game widths and primary/secondary roads **13m**. Original geographic centerline bends, junction positions, and relative distances are preserved; centerline vertices are not moved to simplify the race.

Within the **428 × 630m Beverly reference area**, 64 NYS footprints replace the earlier approximate address-point buildings, including garages and sheds. Most footprint source dates are 2013, compared with spring 2025 reference imagery; the newer county dataset publication date does not make every outline current. Source polygons are retained, while rendered envelopes, roof forms and heights remain approximate. Public parcel geometry supports address/style association, not ownership or a surveyed setback. Six ordinary ground-level listing photographs support limited facade observations for numbers 22, 26, 29, 34, 35 and 41; other facade colors and unseen details remain provisional. Full Street View coverage was not obtained.

The compiled neighborhood has **37 driveway approaches** and **122 observed crown positions**. Occluded segments retain confidence notes, and Home has only its visible mouth stub. These are crowns, not measured trunks: obstructed trunk candidates are omitted rather than moved onto a road or building. Woods and ground-cover shapes guide procedural scenery; aerial photographs are not game textures. Outside the reference area, OSM footprints and flagged address-point envelopes retain the broader generic interpretation. Mode-specific race arrows and barriers are game objects.

Runtime buildings are simplified **rotated oriented envelopes**. Where an envelope encroaches on a road, its collider is conservatively reduced or omitted to preserve driving clearance. The source OSM and NYS footprint shapes remain unchanged in the map file; collider adjustments are not claims that a real house has moved. Driveway mouths may extend to the retained OSM road centerline to avoid visual gaps where the observed pavement edge and source alignment differ. Original annotation points are retained separately as `surveyPoints`.

## Repeatable commands

From `driving-game`, rebuild deterministically from the cached sources using Python 3.10 or newer:

```powershell
python scripts/map-build.py
```

That command needs only the Python standard library and makes no network requests. It applies `scripts/beverly_build.py` to the cached neighborhood references and regenerates `warwick.json`, `manifest.json`, `beverly-survey.json`, and `route-preview.svg`, then checks source-edge continuity, loop closure, route spacing, map bounds, Home proximity, and road/terrain alignment. The SVG is the authoritative generated route preview; the supplied PNG is a convenience render. The [source inspection overlay](research-beverly/review-overlay.html) shows both east and corrected west observations over the original aerial.

An explicit source refresh is optional and requires internet and Pillow:

```powershell
python -m pip install Pillow
python scripts/map-fetch.py
python scripts/map-build.py
```

The refresh rejects an absent house-level match or a materially moved address point. The builder rejects a source change that removes the verified circuit. This refresh covers OSM and USGS sources; the separate NYS research fetch is described in [Beverly reconstruction](beverly-reconstruction.md). Review the preview, source overlay and manifest before adopting a new snapshot.

## Attribution and data license

**Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).** The cached OSM extract and this project's derived geographic database are distributed under ODbL 1.0. The code is separate from this data license. Keep the attribution and license links when sharing the game or its geographic database. The source extract and repeatable transformation are included. This database notice does not relabel independent NYS source resources or listing photographs as ODbL.

**Elevation: U.S. Geological Survey, 3D Elevation Program (3DEP).** USGS-produced data are in the public domain under [USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits).

**Beverly references: NYS ITS Geospatial Services / NYSDOP, Spring 2025; building footprints: NYS ITS Geospatial Services, Orange County GIS Division, NYSERDA and contributing sources; parcel reference: Orange County and NYS ITS Geospatial Services.** The state offers no-cost public GIS services and exports with as-is/no-warranty metadata; no named CC0 or blanket public-domain license was established for these resources. Source-specific terms and dates remain documented in [Beverly reconstruction](beverly-reconstruction.md#sources-and-resource-terms) and the cached item metadata. Original aerial imagery remains a research reference; ordinary listing photographs are linked and described, not bundled. Neither is a game texture. No Google imagery is included in the game.
