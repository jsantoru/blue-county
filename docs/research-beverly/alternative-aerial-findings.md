# Dated aerial comparisons for unresolved Beverly details

Inspected 2026-09-20. This bounded follow-up compares **12 new official GIS exports**: numbers **20, 28 and 43**, each in spring **2013, 2016, 2021 and 2025**. It also uses the five already inspected Home exports from 2010, 2013, 2016, 2021 and 2025. These are aerial orthophotographs, not ground-level Street View. The number 28 terrace and source-preserving rendering split were subsequently accepted for implementation. This research pass adds the terrace to reproducible west observations; it does not change any original source building polygon or rebuild game assets.

Each new image is named `alternative-<number>-<year>.jpg`, paired with `alternative-<number>-<year>-georeference.json`. Metadata records the original request URL, exact returned EPSG:3857 extent, dimensions, date and credit. The exports are enlarged for inspection; this does not improve their native resolution. `fetch-alternative-aerials.py` reproduces the bounded requests.

## 28 Beverly: a real open terrace beside an L-shaped roof

The [2016 image](alternative-28-2016.jpg) clearly separates a reddish/pale open terrace and outdoor objects from the L-shaped roof. The [2021](alternative-28-2021.jpg) and [2025 images](alternative-28-2025.jpg) retain the same arrangement; the lower-resolution [2013 image](alternative-28-2013.jpg) corroborates its earlier presence. The terrace is not a newly inferred covered addition. Its surface height, construction and exact edge under the roof remain uncertain.

NYS building `7159159` already has an L-shaped six-vertex footprint. The existing single rectangular rendering envelope fills its inward corner. The measured exposed terrace polygon is approximately **77.61m²**. It overlaps **none of the source L-shaped footprint**, but about **5.65m²** overlaps the old rectangular envelope. This corrects the earlier broad note that the envelope covered most of the terrace: the calculated overlap is about 7% of this newly traced exposed polygon.

[`alternative-28-subdivision.json`](alternative-28-subdivision.json) supplies the accepted source-preserving split and observed terrace polygon. `build-alternative-28-subdivision.py` reproduces these inputs and checks the areas. The two source-derived quadrilaterals partition the original **211.326602m²** footprint exactly, with **zero mutual overlap**. Their individual rectangular rendering envelopes total about **212.19m²**, compared with **262.54m²** for the old envelope. The small residual excess comes from independently enclosing slightly nonrectangular source edges; the original polygon remains authoritative. Neither new envelope intersects the exposed terrace. The local original source vertices agree with the retained official GeoJSON to within **0.000406m**, their existing rounding error; the split does not reposition them.

The split point is **G = [−182.310270, −268.160546]** in local X/Z meters. The north crossbar and south stem are:

```text
North: [-179.962, -274.689], [-194.527, -279.982],
       [-196.896, -273.435], G
South: G, [-192.123, -271.709], [-195.486, -262.395],
       [-185.674, -258.809]
```

This is a rendering subdivision, not a change to the footprint source. Both wings use the same facade appearance and floor height; the north crossbar suppresses an extra entrance. Roof junctions and elevations remain approximate. The dated images corroborate the north crossbar and east/south stem positions but do not remove source age, roof-overhang or image-displacement uncertainty. The terrace trace records original 2025 crop pixels and their equivalent coordinates in the full 1800 × 2650 reference image; it omits the shaded strip immediately against the roof. Approximate exposed-edge uncertainty is 0.75–1.5m. `annotate-property-west.py` includes this accepted trace and its separate image source on every regeneration. The shared envelope audit expands `building.renderParts` using the same plan-view rules as the renderer.

## 20 Beverly: driveway corroboration, rear projection still ambiguous

The [2016 image](alternative-20-2016.jpg) exposes substantially more of the east-side paved approach than the [2025 image](alternative-20-2025.jpg). It corroborates the driveway's bend from the road to the house-side apron where the newer evergreen crown screens its mouth and middle. The [2021](alternative-20-2021.jpg) and [2013](alternative-20-2013.jpg) views are consistent with this route. This strengthens the alignment evidence; it does **not** make the hidden 2025 pavement edges directly observed.

The small pale, bordered rectangular projection north of the house persists across all four dates. Different lighting exposes its surface and dark objects, but the overhead views do not confidently distinguish an open platform from a low flat-roofed extension. Keep that classification unresolved until a useful oblique/ground image appears. No new deck polygon is proposed from this comparison.

## 43 Beverly: an open rear platform becomes more plausible

The [2016 image](alternative-43-2016.jpg) shows a brown rear rectangle with separate round/dark and light furniture-like objects. The [2025 image](alternative-43-2025.jpg) again separates the brown surface and objects from the main sloping roof, with an adjacent bright rectangular area. These details **favor an open furnished platform over an uninterrupted flat roof**, at **medium confidence**. A clear ground photograph is still needed to establish its construction, railing, height and attachment. The [2021](alternative-43-2021.jpg) and [2013](alternative-43-2013.jpg) images corroborate a rear projection but add less detail.

The 2025 roof also clearly shows two rows of panel-like modules absent from the unobscured 2021 roof. This supports using the newer aerial for roof detail, without asserting an installation date or equipment specification. The 2025 driveway outline is already more exposed than the historical views; the older images should not replace that current pavement trace.

The apparent platform still conflicts with the retained simplified building envelope, so no displaced freestanding deck is proposed merely to avoid that envelope. No source trace was changed during this pass.

## 2 Beverly: earlier imagery resolves the access route, not today's hidden edges

The previously cached [2010](property-home-2010.jpg) and [2013](property-home-2013.jpg) views reveal the curved driveway from its southern road entry to parking between the house and detached garage. [2016](property-home-2016.jpg), [2021](property-home-2021.jpg) and [2025](property-home-2025.jpg) show increasingly screened portions but preserve the destination/apron relationship.

This already supported correcting the former short mouth stub by approximately 8m south and supplying the approximately 35.9m access route. Its 2025 canopy-obscured approach remains `inferred-occluded`, explicitly tied to the 2010 source and historical corroboration. The exposed apron is separately recorded from 2025. The alternative images do not justify claiming a newly surveyed current driveway edge or changing the existing uncertainty to “high.”

## Sources and resource terms

The [official Orange County download page](https://gis.ny.gov/orange-county-orthoimagery-downloads) lists the dated Warwick coverage. Direct image services used for the new comparisons are [2013](https://orthos.its.ny.gov/arcgis/rest/services/wms/2013/MapServer), [2016](https://orthos.its.ny.gov/arcgis/rest/services/wms/2016/MapServer), [2021](https://orthos.its.ny.gov/arcgis/rest/services/wms/2021/MapServer) and [2025](https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer). Home additionally uses the [2010 service](https://orthos.its.ny.gov/arcgis/rest/services/wms/2010/MapServer).

Credit: **NYS ITS Geospatial Services / NYSDOP**. These are attributed research references under the source's public-service access and as-is metadata, not CC0 textures. See [findings.md](findings.md#rights-and-attribution) for the recorded resource-term limits. The original aerials remain outside the game's texture assets. No source-owner or resident information was collected.
