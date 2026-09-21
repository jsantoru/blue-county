# Woods behind Home: aerial review

Two bounded official exports were inspected for the woods east of **2 Beverly Drive**, centered near **41.283879, -74.3662393**: [spring 2025](woodland-2025.jpg) and [spring 2013](woodland-2013.jpg). They cover approximately local X **−12 to 178 m**, Z **−105 to 105 m**. Their returned EPSG:3857 extents, request URLs, retrieval timestamps and image hashes are recorded in the paired `woodland-*-georeference.json` files. The exact flight days were not established.

## Observed layout

The 2025 leaf-off image clearly shows a continuous predominantly deciduous wooded corridor behind the Beverly rear lawns. The 2013 image corroborates its broad extent. The maintained lawn behind Home remains open between the rear main-house wall and the irregular woodland edge. Near Home's Z≈0, that edge is approximately **X36 m**, about **27 m east of the rear wall**. Farther south it curves around the garage/shed-side yard; it is not a straight fence or property boundary.

[woodland-observations.json](woodland-observations.json) contains one 48-vertex woodland ground-cover polygon in the game's east/south meter coordinates, its original annotation pixels and a separately identified near-Home edge line. It follows the visible leaf-litter/lawn transition and stops north of West Ridge pavement, leaving the visible eastern and southern house lawns outside. The northern boundary is a research-box clip; woods continue beyond it. Estimated edge uncertainty is about **3 m**, with greater uncertainty under branches and shadows. Its area is approximately **17,799 m²**; the simple polygon has no self-intersections and contains no source-building vertices in the current map.

The compiled bounds for replacing generic woodland are X **12–178 m**, Z **−105–105 m**. These bounds also contain open lawns: tree generation must follow the actual polygon, not fill the rectangle. The suggested 8.5 m spacing is a rendering density, not a measured trunk interval. Trees, shrubs and fallen wood should additionally respect the separately mapped stream, roads and structures.

Individual mature crowns are evident, but the overlapping leaf-off branches and long shadows do not establish reliable separate crown centers. Accordingly `canopies` is empty. Trunk positions, heights, species and understory plants must remain representative unless additional on-site evidence is supplied.

## Watercourse cross-check

The aerial shows a sinuous shaded corridor within the woods that bends west toward the lower, southern portion of the image. The separately researched USGS/OSM stream locations around X≈75–83 m near Home's Z≈0 are consistent with this broad corridor. The substantially farther-west DEC classification geometry around X≈49 m is a poorer visual fit there. Branch cover prevents using this image to claim surveyed bed edges or the exact position of each small bend.

[woodland-review.svg](woodland-review.svg), also [rendered as PNG](woodland-review.png), overlays the woodland polygon, local 20 m coordinate grid and **selected** USGS/OSM vertices for inspection. Those simplified comparison lines are not a replacement for the complete hydrography source. Stream identity, full centerline selection, width and elevation belong to the separate hydrography findings.

## Representative plants

For a regional visual palette, the primary [New York Natural Heritage Program floodplain-forest guide](https://guides.nynhp.org/floodplain-forest/) lists sensitive and ostrich ferns, several sedges, spicebush, dogwoods and alder among New York riparian-forest plants, and identifies Orange County's Neversink River Preserve as an example location. Those forms support restrained fern clumps, sedge tufts, branched shrubs and young deciduous saplings in the game. This is **regional habitat reference**, not botanical identification at Home or a formal classification of this small creek corridor. Aerials do not resolve its actual understory species or seasonal cover.

## Reproduce and credit

```powershell
python docs/research-backyard/fetch-woodland.py
python docs/research-backyard/woodland-annotate.py
```

The fetch script requests only two bounded images from the official [2025 NYS imagery service](https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer) and [2013 service](https://orthos.its.ny.gov/arcgis/rest/services/wms/2013/MapServer). The annotation script performs an offline conversion through the returned image extents and writes JSON/SVG; it changes no game source or map file. Export oversampling does not increase native image detail.

**Credit: NYS ITS Geospatial Services / NYSDOP.** Existing [NYS source terms and limitations](../beverly-reconstruction.md#sources-and-resource-terms) apply. These images are attributed research references, not CC0 assets or runtime ground textures. Woodland interpretation does not assert property ownership, a legal boundary or an ecological field survey.
