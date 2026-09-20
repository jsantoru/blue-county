# Additional Beverly exterior references

Inspected **2026-09-20** for the driveway/deck follow-up. All property addresses below are Beverly Drive, Warwick, **New York 10990**. Two additional ordinary exterior photographs were actually viewed. A listing date is historical context, **not** a photograph capture date. No precise camera heading or image-capture timestamp was available. Left/right refer to the viewer.

## 12 Beverly Drive — new verified ordinary front view

[Zillow property source](https://www.zillow.com/homedetails/12-Beverly-Dr-Warwick-NY-10990/31868909_zpid/) · [inspected 960 × 720 photograph](https://photos.zillowstatic.com/fp/a4579b1a9f089a931a124100328d5445-cc_ft_960.jpg). Listing context **2023-10-23**, MLS H6274652. The same front photograph was also inspected at 800 × 533 through [Redfin](https://www.redfin.com/NY/Warwick/12-Beverly-Dr-10990/home/54939785) and its [GSMLS 3871104 image](https://ssl.cdn-redfin.com/photo/121/bigphoto/104/3871104_2.jpg). Redfin's rendered heading incorrectly says NJ while its URL and Zillow's matching image/address identify Warwick NY; no location inference rests on that typo.

**Visible:** pale gray/white horizontal siding, gray shutters, white trim, charcoal-gray shingle roof, and a pale cream door. A broad front-facing gable covers the projecting bay on the right; a lower sloping roof joins the central entry. Gray block/stone steps lead across a shallow planted bed. Dark paving appears at the left, adjoining a low block edge. The front lawn is open, with ornamental grasses/shrubs and a small circular planting bed.

**Confidence/limit:** high for the visible bay and facade arrangement, moderate for paint colors. The road mouth and rear deck are outside the frame. No new driveway polygon, deck position, or present-day paint claim follows from this photograph.

## 20 Beverly Drive — new verified ordinary front view

[Zillow property source](https://www.zillow.com/homedetails/20-Beverly-Dr-Warwick-NY-10990/31868887_zpid/) · [inspected 960 × 682 photograph](https://photos.zillowstatic.com/fp/53a82dd0e5dea713556aff938806acda-cc_ft_960.jpg). Listing context **2019-01-08**, MLS H4900885; capture date unknown. The [Compass archive](https://www.compass.com/homedetails/20-Beverly-Dr-Warwick-NY-10990/15QBM6_pid/) exposes one front photograph and repeats the historic listing's reference to a back deck. That text does not establish the deck's shape or current condition.

**Visible:** ivory horizontal siding on the right upper facade; a broad front gable on the left has pale yellow shake-like courses and angled white side trim. Red shutters flank the upper windows. The red-brown lower front is brick, with a red/burgundy central door and broad concrete steps. A narrow glimpse of dark paving lies to the right. Timber-edged planting beds, a bare ornamental shrub, and larger conifers frame the lawn.

**Confidence/limit:** high for the siding/brick arrangement and red shutters, moderate for colors. No back view was found to resolve the white-bordered rectangle seen in the aerial survey. It remains unclassified as a deck or flat roof.

## Bounded attempts that did not produce new visual evidence

- **Home / 2:** [Zillow](https://www.zillow.com/homedetails/2-Beverly-Dr-Warwick-NY-10990/31868904_zpid/) still exposes a Google Street View image link rather than ordinary listing photography. The linked request returned **403 Forbidden**. The image was **not viewed**; no imagery date, heading, paint color or driveway observation is claimed. The signed/API-key URL is not copied into this document.
- **4:** [Zillow](https://www.zillow.com/homedetails/4-Beverly-Dr-Warwick-NY-10990/31868905_zpid/) likewise exposes a Street View placeholder; no ordinary photograph was verified.
- **6:** Zillow's Street View request returned **403**. An alternative [Compass archive](https://www.compass.com/homedetails/6-Beverly-Dr-Warwick-NY-10990/15ZIXQ_pid/) lists four ordinary photos associated with MLS 359697 and a **2005** listing context, but all four linked original images returned **404**. Their contents were not viewed. Historic listing text mentions a pool/deck; that is corroborative text only and supplies no source geometry or present-day appearance.
- **10:** an alternative [Compass archive](https://www.compass.com/homedetails/10-Beverly-Dr-Warwick-NY-10990/15ROHB_pid/) lists 16 photos associated with MLS 550288 and **2013** listing context. The inspected image links returned **404**; no appearance is asserted. Earlier Homes.com image access was also unsuccessful, as recorded in exterior-observations.md.
- **43:** [Redfin](https://www.redfin.com/NY/Warwick/43-Beverly-Dr-10990/home/54930572) offers a Google Street View placeholder, not an independently verified rear photograph. Historical listing text does not resolve its rear platform. See the separate [alternative aerial findings](../research-beverly/alternative-aerial-findings.md).

The existing [Mapillary/KartaView coverage findings](coverage.md) remain the open street-imagery result; this pass did not establish new usable coverage. The browser connector reported that both Edge and the in-app browser were unavailable; no shared game-QA browser was touched. The two ordinary image URLs above were read directly for visual inspection without saving image files into this repository.

## Applied source overrides and remaining renderer limits

[facade-followup-overrides.json](facade-followup-overrides.json) supplies numeric approximate colors for 12/20, plus the verified viewer-right bay at 12. `scripts/beverly_build.py` merges those entries with the six existing photo-supported facades. Other addresses retain their previous evidence status, and the teal door at 35 remains unchanged.

No geometry generator was expanded. The existing large front-gable preset includes tall columns and a particular entry/right placement; it is not a faithful match for either new photo and is not enabled. Number 20's left gable, distinct yellow shake panel and brick lower facade remain unsupported. `stoneLower` remains disabled because irregular stone would misrepresent its brickwork. Number 12's gable/entry-roof arrangement likewise remains approximate. Colors are visual estimates rather than calibrated paint specifications.

These pages establish **no open image license**. Photographs remain with their rights holders; this repository adds links and limited factual observations only. None is a texture, background, distributed game asset, or licensed street-imagery dataset. No Google imagery was downloaded or incorporated. The retained measured NYS source geometry and its separate provenance continue to control world placement.
