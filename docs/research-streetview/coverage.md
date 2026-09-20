# Beverly Drive street-imagery research

Research date: **2026-09-20**. Requested center: **41.283879, -74.3662393**, identified by the task as 2 Beverly Drive, Warwick, NY 10990. This report concerns publicly accessible street-imagery coverage and source suitability. It contains no downloaded street photographs and no runtime changes.

## Result

**No usable, openly licensed street-level photograph was obtained for Beverly Drive.** Mapillary displayed the local road map but no imagery tracks at either inspected zoom. KartaView's documented nearby-photo API returned empty results at three sampled locations. These are observations of the services on the research date, not proof that no photograph exists elsewhere or will be added later.

Consequently this search establishes **no observed house paint colors, roof shapes, story counts, individual tree positions, driveway surfaces, or driveway entrances** on the loop. Do not substitute regional assumptions for street observations.

A subsequent, separate inspection of ordinary listing photographs established limited exterior observations for numbers **22, 26, 29, 34, 35 and 41**. See [exterior-observations.md](exterior-observations.md) for those directly inspected references, dates, confidence, and limits. Those photographs are not openly licensed street-imagery coverage and are not distributed with the game.

## Coverage checks

| Provider / location | Source and method | Observed result | Confidence and limits |
|---|---|---|---|
| Mapillary, requested center | [Public app at 41.283879, -74.3662393, zoom 17](https://www.mapillary.com/app/?lat=41.283879&lng=-74.3662393&z=17), fresh isolated Edge browser | The basemap loaded and showed Beverly Drive and its West Ridge Road junctions; no green photo/sequence tracks were visible in the viewport. No image was selected. | High confidence in the displayed state. Does not establish an exhaustive global absence. |
| Mapillary, whole-loop area | [Public app at 41.2855, -74.369, zoom 15](https://www.mapillary.com/app/?lat=41.2855&lng=-74.369&z=15), separate fresh browser | Wider map showed the horseshoe and surrounding West Ridge / Old Ridge / Distillery roads, with no visible imagery tracks. Six imagery vector-tile requests completed with HTTP 200. Their payloads were each 38 bytes and contained a single `water` layer feature, with no image or sequence layers. | High confidence that imagery was not available through these displayed tiles. Tile metadata is recorded in `coverage.json`; the placeholder layer is not street evidence. |
| KartaView, requested center | [Nearby-photo query](https://api.openstreetcam.org/2.0/photo/?lat=41.283879&lng=-74.3662393&zoomLevel=15&join=sequence&orderBy=id&orderDirection=desc) | HTTP 200; API code 601; `The request has an empty response`; result null. | High confidence in response. Provider documentation does not state the exact geographic search radius associated with zoom 15. |
| KartaView, north/central loop sample | [Nearby-photo query](https://api.openstreetcam.org/2.0/photo/?lat=41.2868&lng=-74.3678&zoomLevel=15&join=sequence&orderBy=id&orderDirection=desc) | Same empty response. | Same limitation; not an exact parcel observation. |
| KartaView, western junction sample | [Nearby-photo query](https://api.openstreetcam.org/2.0/photo/?lat=41.2830&lng=-74.3700&zoomLevel=15&join=sequence&orderBy=id&orderDirection=desc) | Same empty response. | Same limitation; not an exact parcel observation. |

The KartaView requests followed the provider's [nearby-photo API documentation](https://kartaview.org/doc/photos). No access credentials were obtained or stored. Browser checks used their own short-lived processes and did not operate the game's QA browser.

## Listing leads handed to the main researcher

These are leads, not image-based observations from this street-imagery search:

| Address | Source | Verified source facts / caveat |
|---|---|---|
| 2 Beverly Drive | [Zillow property page](https://www.zillow.com/homedetails/2-Beverly-Dr-Warwick-NY-10990/31868904_zpid/) | The first/only image link resolved to **Google Street View**, rather than an independent listing photograph. It was not obtained or used as a visual reference. Do not treat the Zillow wrapper as a different image license. |
| 29 Beverly Drive | [Coldwell Banker listing, MLS 902190](https://www.coldwellbankerhomes.com/ny/warwick/29-beverly-dr/pid_67046593/) | The page identifies a raised ranch with stone and vinyl siding, and reports roof and siding updates in 2023. Listing date shown: 2025-08-21. The exterior image link is hosted by `m1.cbhomes.com`; image capture date and reuse permission are not established. The page's Street View section says unavailable. |
| 34 Beverly Drive | [Zillow property page](https://www.zillow.com/homedetails/34-Beverly-Dr-Warwick-NY-10990/31868880_zpid/) | Lists 33 photographs and describes a colonial. Exterior-photo inspection and image rights remain separate tasks; this report does not infer colors or materials from the listing category. |

## License and reference-use limits

- Mapillary's [official imagery-license guidance](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data) identifies imagery as CC BY-SA and calls for image, contributor, and license attribution. The [CC BY-SA 4.0 deed](https://creativecommons.org/licenses/by-sa/4.0/) describes attribution, marking changes, and ShareAlike obligations for adaptations. If an image is later found, capture its image ID, contributor, capture date, exact license, and link before including it or an adaptation.
- KartaView's [official terms, section 4](https://kartaview.org/terms) identify street images and spatial data as CC BY-SA 4.0 and require the credit **“© Grab and KartaView Contributors.”** No KartaView image was found or copied in this search.
- Public visibility of a real-estate listing does not establish an open license for its photographs. This report distributes only links and factual source notes; it grants no right to redistribute photographs or turn them into game textures. Obtain permission or a suitable license before distributing listing imagery.
- Google Street View images were excluded from visual analysis and are not distributed. No Google image was used to derive game geography or building detail.

Do not mark the current generic neighborhood architecture as surveyed from these sources. House-specific visual records need an actual inspected, usable exterior reference with its capture-date uncertainty retained.
