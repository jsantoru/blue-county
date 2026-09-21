# Stony Creek behind Home

The mapped watercourse behind 2 Beverly Drive is **Stony Creek**, GNIS **966557**. The selected USGS 3DHP channel is **EH86B**, corresponding to NHD permanent ID **61784457** and reach **02020007000878**. Its full 33-vertex horizontal centerline is preserved in [hydro-observations.json](hydro-observations.json). The game should clip that source line to the inspected area, then stop before West Ridge Road's pavement instead of carving an invented open crossing. [USGS 3DHP flowline service](https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/MapServer/50), [NHDPlus HR flowline service](https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3).

## Position and corroboration

Coordinates use the existing game origin, longitude `-74.3662393`, latitude `41.283879`, with X east and Z south in meters. The transform is `X=(lon-originLon)*111320*cos(originLat*pi/180)` and `Z=(originLat-lat)*111320`, where input latitude and longitude are degrees. ArcGIS queries requested WGS84 output (`outSR=4326`).

At Home's approximate north/south station (`Z=0`), the USGS line passes about **81 m east** of the origin. It bends southwest: `(82.96,-7.50)`, `(80.28,2.97)`, `(77.27,8.09)`, `(70.33,13.87)`, `(55.60,21.33)`, `(34.85,51.29)`. The nearest point on this full mapped flowline is approximately `(47.56,32.94)`, **57.85 m** from the address origin. These are centerline distances, not bank measurements.

The existing [OpenStreetMap way 1231197326](https://www.openstreetmap.org/way/1231197326) follows the same corridor, with finer small meanders and about X=78 m at Z=0. That particular OSM way is unnamed; the USGS named feature establishes the creek identity. The comparison is cached in [hydro-osm-comparison.json](hydro-osm-comparison.json). The separately inspected 2013 and 2025 NYS aerials place the wooded ravine around X=80 m at Z=0 and show the same southwest bend. See [woodland-review.svg](woodland-review.svg) for the aerial comparison.

The [NYS DEC classification layer](https://gisservices.dec.ny.gov/arcgis/rest/services/hvnrm/hvnrm_streams_and_watersheds_07302025/MapServer/9) returns feature **6860**, item **855.5-204**. Its line is approximately X=49 m at Z=0, roughly 30 m west of the USGS/OSM corridor and the visible ravine. It is useful regional corroboration but was **not selected as property-scale placement geometry**.

## Dates, precision and limits

- 3DHP feature date: **2023-09-14**; source work unit: **NHD**. Its geometry closely matches the legacy NHD feature dated **2012-03-08**. The 2023 date therefore must not be presented as a new field survey.
- NHD resolution code **2** means **High** in the source layer's coded-value domain. It is a cartographic flowline, not a surveyed bank, cadastral line or recent lidar-derived channel measurement.
- NHD feature code **46006** identifies its perennial stream/river class in the [USGS feature dictionary](https://www.usgs.gov/ngp-standards-and-specifications/national-hydrography-dataset-nhd-data-dictionary-feature-domains). That classification does not establish the water level or visible flow on the day represented by the game.
- Horizontal placement is corroborated by multiple map sources and the aerial ravine. Exact banks, channel width, bed depth, water surface, understory species and small meanders obscured by branches remain unmeasured. The renderer's width, carved section and vegetation composition should remain explicitly approximate.
- The [Orange County Hydrology service](https://gis.orangecountygov.com/arcgis/rest/services/Dynamic/Hydrology/MapServer) was located and lists a Streams and Rivers layer, but the local retrieval failed certificate-chain verification. No County geometry was used or claimed inspected. The indexed NYS Hydrography endpoint returned a service-not-started error; its error response is retained only as a retrieval record.

The query caches contain full source responses, requested bounds, URLs and retrieval timestamps. `fetch-hydro.py` refreshes the successful USGS/DEC requests and preserves their original query envelopes; it does not overwrite the reviewed canonical selection or gameplay files.
