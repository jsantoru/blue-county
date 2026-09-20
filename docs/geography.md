# Warwick map provenance and review

The anchor is the **house-level address point** for 2 Beverly Dr, Warwick, NY 10990: **41.2838790, -74.3662393**. It is [OSM node 8788896022](https://www.openstreetmap.org/node/8788896022), carrying NYS address-point ID `ORAN057146`. On 2026-09-20, Nominatim returned house number 2, Beverly Drive, Warwick, 10990. A separate current ArcGIS World Geocoder returned a `PointAddress` match, score 100, at 41.28388794, -74.36624112, approximately 1 meter away. Confidence is high for a house address point, not a surveyed structure/driveway location. Census's current address-range geocoder returned a point about 115 meters away; that interpolation was rejected as the house anchor.

The source cache and precise metadata are in `public/map/source/` and `public/map/manifest.json`. No paid service or live map request is needed by the game. ArcGIS was used only as an independent location check; all road geometry and address-point asset locations are from the reusable OSM extract.

## What is verified

- Beverly Drive is an approximately horseshoe-shaped street. Both ends connect to **West Ridge Road**, at shared OSM nodes `221872780` and `221872784`. It is not treated as a dead end, and its real bend geometry is retained.
- The three-lap **Ridge & Hollow** circuit is **2,644.7 meters per lap**, clockwise, about one kilometer east of Home. It follows **Old Ridge Road → High Hill Avenue → Claire Ann Drive → Seward Highway → mapped Old Ridge/Seward connector → Old Ridge Road**. The short connector is OSM way `20655828`, not an invented closing segment.
- Every route edge is an edge from the original shared-node OSM graph. A polyline crossing alone never becomes a junction. The route is closed at the same original OSM node.
- Home is a right-hand roadside spawn on the eastern limb of Beverly Drive, about **20.2 meters** from the house address point, facing the nearby West Ridge Road exit. No exact driveway was verified, so no driveway connection is claimed.
- The map includes the connected local road component within a **3.8 × 3.9 km** rectangle, centered on Home. Roads end at the playable boundary rather than connecting to fabricated streets. The compact extract includes portions of West Ridge, Sleepy Valley, Old Ridge, Pine Island Turnpike, Locust, Maple, and other local roads.

See [the top-down route preview](../public/map/route-preview.svg), also supplied as a PNG. North is up, the route is amber, and Home is teal. The small northern/eastern/boundary road stubs are intentional clips of the source network.

## Elevation and units

Geometry uses **one meter per game unit**, local **X east, Y up, Z south**. Latitude/longitude are projected with a local equirectangular approximation about the house point. Heading is `atan2(dx, dz)` in radians; zero faces south (+Z). Home road position is `[-19.765, 2.071, -4.183]`; its initial heading is `-0.208545` radians.

The [USGS 3DEP Bare Earth DEM service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) supplied real Float32 elevation samples. The service described its source coverage as current through **2026-08-24**. The unmodified GeoTIFF, returned geographic extent, parsed source grid, and service metadata are cached. Pixels are sampled at their centers, accounting for the server's adjusted export extent. Home's sampled absolute ground elevation is about **211.6 meters**. All game heights are relative to this datum.

The terrain is resampled to a **129 × 133** grid, approximately 30-meter cells. Stored road centerline samples occur at intervals no greater than 12 meters, with Y computed by bilinear interpolation from that grid; this softens small bumps while retaining the broader local elevation. At runtime, `src/roads.ts` uses the **exact terrain triangle interpolation**, with the same cell diagonal as the terrain mesh. Road strips and joins are clipped against those terrain facets, and the asphalt surface is lifted **0.065m** above the terrain. This keeps visible surfaces and colliders aligned through grades and junctions. The runtime terrain sampler is authoritative for spawn placement, including Home; small differences from the stored bilinear point Y values are expected. Raster sampling is not a road-surface engineering survey. Mapped bridge/layer tags are retained; no road-over-road bridge is part of the selected race.

## Deliberate approximations

Residential road widths are widened to **10.5m**, and primary/secondary roads to **13m**. These are documented game widths, not measured street widths. Original centerline bends, junction positions, and relative distances are preserved; centerline vertices are not moved to simplify the race.

Mapped building footprints are retained where present. Building heights without source metadata default to 6m. Appearance, roofs, materials, yards, signs, and tree placement are simplified approximations. Nearby verified house address points may supply approximate house locations where OSM has no footprint; those generated envelopes are explicitly flagged and are not claims of accurate footprint geometry. A precise reconstruction of the house or its driveway has not been made. Mode-specific race arrows and barriers are game objects.

Runtime buildings are simplified **rotated oriented envelopes**. Where an envelope encroaches on a widened road, its collider is conservatively reduced or omitted to preserve driving clearance. The actual OSM footprint data remain unchanged in the map file. A clearance audit found that all 104 approximate address-point house envelopes already clear the widened asphalt edges by more than four meters; adjustments concern source-building envelopes and game road widening, not a relocation of real houses.

## Repeatable commands

From `driving-game`, rebuild deterministically from the cached sources using Python 3.10 or newer:

```powershell
python scripts/map-build.py
```

That command needs only the Python standard library and makes no network requests. It regenerates `warwick.json`, `manifest.json`, and `route-preview.svg`, then checks source-edge continuity, loop closure, route spacing, map bounds, Home proximity, and road/terrain alignment. The SVG is the authoritative generated preview; the supplied PNG is a convenience render.

An explicit source refresh is optional and requires internet and Pillow:

```powershell
python -m pip install Pillow
python scripts/map-fetch.py
python scripts/map-build.py
```

The refresh rejects an absent house-level match or a materially moved address point. The builder rejects a source change that removes the verified circuit. Review the preview and manifest before adopting a new snapshot.

## Attribution and data license

**Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).** The cached OSM extract and derived geographic database (`warwick.json`, including road graph, address-derived positions and footprints) are distributed under ODbL 1.0. The code is separate from this data license. Keep the attribution and license links when sharing the game or its geographic database. The redistributable source extract and repeatable transformation are included.

**Elevation: U.S. Geological Survey, 3D Elevation Program (3DEP).** USGS-produced data are in the public domain under [USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits). No third-party imagery, map screenshots, commercial textures, or Google data were used as game assets.
