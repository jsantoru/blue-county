# Blue County — Warwick / 442

A locally playable arcade driving and exploration game starring your actual dark blue 1968 Oldsmobile 442 convertible. Drive the Warwick roads, race the Ridge & Hollow circuit, or park, step out and explore Beverly Drive's yards, woods and Stony Creek on foot. The visible driver sits behind the wheel on the US driver's left.

**The Blender asset update is on `codex/home-driver-coppola`.** Dad now has an editable Blender character with a charcoal Italian coppola, white mustache, tinted glasses and blue checked shirt. The 442's actual doors open during entry and exit, and four Blender-built props add detail to Home's yard. See [the assets, source files and modeling limits](docs/hero-assets.md).

![Dad standing beside the parked 442 at Home](docs/hero-dad-standing.png)

Stop in Free Drive and press **F / Xbox Y** to get out. Move with **WASD / left stick**, run with **Shift / A**, jump with **Space / X**, and look with the mouse or right stick. Approach either door and press **F / Y** to get back in. See [full controls](#first-drive) or [launch instructions](#launch-on-windows).

## Recent screenshots — September 21, 2026

Actual screenshots from the local production build with the Blender character and opening doors. The character is a stylized interpretation of one supplied photograph.

| Behind the wheel | Opening the driver's door |
| --- | --- |
| ![Dad seated behind the 442's left-hand steering wheel](docs/hero-dad-driving.png) | ![Dad stepping through the open driver's doorway](docs/hero-dad-exiting.png) |
| Dad in the US-left seat, with his hands at the wheel. | Original body panels, mirror and interior card move with the door. |

![Exploring the mapped Stony Creek channel and woodland plants on foot](docs/exploration-second-creek-exploration.png)

Walking through the shallow Stony Creek channel. [More gameplay views and verification notes](docs/exploration-pass.md).

## The starting neighborhood

Free Drive starts on the visible parking apron at 2 Beverly Drive, facing its curved driveway exit. Official 2010/2013 aerials resolve the approach hidden by trees in the 2025 reference; current edges beneath those trees remain approximate.

Home has its own house and yard reconstruction from the three supplied street photographs: the offset red entrance, burgundy shutters, distinct window groups, front garden ornaments and open lawn. The owner's description places the upper deck on the driveway/right side, with a patio and red door below, sliders above, and a roofed screened area around the back. See the [front facade and yard view](docs/home-front-details.png) or read [the Home detail notes](docs/home-detail-pass.md) for reference observations, game views and remaining approximations.

Behind Home, **Stony Creek** follows its mapped course through woods traced from official 2013/2025 aerials, with an open rear lawn, mature trees and layered woodland ground cover. The approximately 212m creek reach uses an explicitly inferred channel and bank profile; it is not a new elevation survey. See [the backyard notes and game views](docs/backyard-pass.md).

The property pass adds individually traced driveway outlines, parking courts, observed decks and pools, and junction signs. [Inspect the aerial overlay](docs/research-beverly/property-review.html) or read [the property notes](docs/property-pass.md). The earlier visual pass added tree crowns, recessed windows, siding, roof detail and revised lighting; its [before/after comparison](docs/detail-comparison.html) remains available.

## Launch on Windows

Double-click **Launch Blue County.cmd**, then choose **Drive from Home**. The launcher serves the built game at **http://127.0.0.1:5180/** and opens your default browser. Use Chrome or Edge. Node.js 22+ is required; dependencies and the production build are already present in this workspace.

From PowerShell, the equivalent commands are:

```powershell
cd C:\Users\Joe\Documents\ChatGPT\blender\driving-game
npm ci                 # only needed on a fresh checkout
npm run build
npm run preview -- --port 5180 --strictPort
```

Development: `npm run dev -- --port 5174 --strictPort`. The game loads all map, model, and sound resources locally. No paid services, keys, live maps, or CDN requests are needed during play.

## First drive

Click once to focus/unlock audio, connect the wired Xbox controller, and press a button to select it. Release that first press, then use the pad for all menus. RT is proportional throttle; LT is proportional brake. To reverse, come to a stop, release LT, then press it again. Hold A to boost, X for handbrake, B to look back, R3 to switch camera, right stick to look around, Menu to pause, and View for 0.7s to recover. Y exits the parked car in Free Drive. Return Home is in Pause and exits an active race.

Keyboard: WASD/arrows drive, Shift boost, Space handbrake, B look back, C camera, R hold reset, Escape pause, Enter confirm. Menu arrows/WASD navigate; left/right adjusts settings. F3 shows telemetry.

**Explore on foot:** stop and press **F / Y** to get out. WASD/arrows or the left stick move relative to the camera; Shift / A runs; Space / X jumps. Look with the right stick, right mouse drag, or click the game to capture the mouse (Escape releases and pauses). C / R3 recenters the walking camera. Approach either door and press F / Y to re-enter the 442. The map marks the parked car in blue. Walking follows terrain, steps over curbs and collides with houses, tree trunks, decks and rails. Dad uses Blender-authored idle, walk, run, airborne and seated animations; see [asset notes](docs/hero-assets.md) and [exploration controls](docs/exploration-pass.md).

Start with **Balanced** handling, 0.12 stick deadzone, 1.35 response curve, and sensitivity 1.0. Increase deadzone only for stick drift. Try **Planted** if high-speed steering feels too lively. Physics tuning lives together in `src/vehicle.ts`: `steerLow`, `steerFalloff`, `grip`, `driftGrip`, `engineForce`, and `stability` are the useful first adjustments. Settings and the chosen handling preset persist locally. Diagnostics shows selected device, raw and processed analog inputs, mapping, buttons, and haptic availability; every binding can be remapped.

## Included slice

- Free Drive across approximately 3.8 × 3.9km of mapped roads, with Home and safe recovery.
- A rigged Blender driver in the US-left seat, opening vehicle doors and third-person exterior exploration, with walking/running/jumping, collision-aware orbit camera, parked-car return prompts and footsteps.
- **Ridge & Hollow**: a verified connected 2.645km clockwise circuit, three laps, countdown, three physical AI rivals, three civilian cars, ordered directional progress, position, results, restart.
- Real route: Old Ridge Road → High Hill Avenue → Claire Ann Drive → Seward Highway → existing mapped connector → Old Ridge Road. Beverly Drive retains both real connections to West Ridge Road.
- Separate handling grounds: straight, slalom, constant-radius loop, ramp and collision barriers.
- Dynamic Rapier chassis, four spring/damper wheel rays, contact-limited tire forces, speed-sensitive steering, brake/handbrake drift, boost, CCD, collision feedback, recent-contact takedown credit, and temporary vehicle-to-vehicle protection after recovery.
- Detailed actual 442 with closed hood, parchment interior, redlines, chrome, separate steering/spinning wheels, and the modeled engine retained under the hood. Rivals and traffic use original sedan, wagon and pickup models with shaped bodywork, glazing, lamps, grilles, trim and detailed wheels.
- Stable horizon chase/close cameras, minimap, synthesized engine/shift/tire/wind/boost/impact audio, pooled skid marks, smoke and sparks. Graphics, camera motion, input and rumble settings.
- A targeted Beverly Drive reference pass: 64 state building footprints, including garages and sheds; 37 observed driveway approaches; 122 aerial crown observations before blocked-trunk omissions and Home-specific tree replacement; and nine facades informed by exterior photographs, including the supplied Home views. The real Beverly/West Ridge neighborhood loop is 1.21889km. See [the reconstruction notes](docs/beverly-reconstruction.md), [Home detail notes](docs/home-detail-pass.md) and [interactive source overlay](docs/research-beverly/review-overlay.html).
- Scanned PBR road, lawn, bark, roof, brick, siding and gravel surfaces; procedural trees with branching trunks, leaf/needle sprays, wind and distant detail levels; grass and shrubs; detailed houses; poles, wires, mailboxes, porches and fences. Afternoon sky/clouds, outdoor HDR reflections, and contact shading on High. Scenery beyond the Beverly reference area remains a generic geographic interpretation. See `docs/visual-upgrade.md` for the rendering design, licenses and limits.

## Rebuild the data and Blender assets

```powershell
npm run map            # offline, Python 3 stdlib; uses cached sources
npm run export-car     # Blender background export from the saved snapshot
npm run export-driver  # character, rig, clips, editable .blend and GLB
npm run export-home-props # bench, wagon wheel, birdbath and mailbox
python scripts/fetch-textures.py --verify-only  # local checksums/dimensions
```

The offline map build also applies the cached Beverly research through `scripts/beverly_build.py` and writes `public/map/beverly-survey.json`. Optional geographic refresh: `python scripts/map-fetch.py` (requires Pillow). This refresh uses OSM and USGS endpoints, preserves cached provenance, and rejects a mismatched house anchor; it does not refresh the separate NYS reference cache. See [geography and attribution](docs/geography.md) and [Beverly reproduction details](docs/beverly-reconstruction.md). Source data and the ODbL notice are in `public/map/source` and `public/map/LICENSE.txt`; the map manifest records bounds, origin, meter convention, road graph, Home, checkpoints, sources, dates and adjustments.

The active source folder `../oldsmobile_442` was **not modified**. The car exporter reads `asset-source/1968_oldsmobile_442.snapshot.blend` and writes the separate, editable `asset-source/oldsmobile-442.game.blend` with hinged doors. Dad and the Home kit also have tracked editable sources. See [the asset guide](docs/hero-assets.md) for rebuild commands, export contracts and source ownership. Generators recreate their derived assets; preserve manual Blender edits before regenerating them.

## Checks and evidence

The September 21 Blender asset update passed **127 tests across 20 files** and the production build. Tests load the delivered character and car assets to check skinning, animations, seated hand placement, pause behavior, fabric export and real doorway clearance. The [hero review](docs/hero-verification.json) captures the character seated, standing, running and stepping through an open door. The [verification record](docs/verification.md) records the repeated exploration checks and separates them from the preceding build's full three-lap race, restart and Return Home. Controller automation uses synthetic Gamepad API input; physical controller feel and rumble remain unverified.

```powershell
npm test               # input, rules, surfaces, physics and complete AI route tests
npm run build           # TypeScript + production bundle
# With the production server running on 5180:
$env:GAME_URL='http://127.0.0.1:5180'
npm run test:browser     # system Edge; synthetic pad, actual game/race physics
npm run test:visual      # real rendered scenery, quality presets, independent RAF metrics
npm run test:beverly     # surveyed neighborhood loop, reference views and moving frame sample
npm run test:detail      # latest detail pass, all presets, resize and environment rebuild checks
npm run test:property    # Home driveway departure, property details, loop and graphics checks
npm run test:home        # photo-specific facade, yard, deck/patio relationships and reference views
npm run test:backyard    # woodland/creek views, stream clearances, presets and environment rebuild
npm run test:exploration # actual keyboard/mouse exit, walking, collisions and return
npm run test:exploration:second # separate synthetic-controller and lifecycle review
npm run test:hero        # actual Blender character, opening doors and inspection captures
```

Tests compare acceleration, proportional throttle, braking, turning and boosted wall collision at simulated 30/60/120 fps rendering with fixed 60Hz physics. Tolerances are 0.15m position and 0.2m/s speed, not a cross-machine determinism promise. Ordered gates reject reverse travel, out-of-order crossings, teleport progress and duplicate rewards. Full mapped-route physics tests complete all 777 crossings over three laps, including all four racers with traffic and no racer recoveries. See `docs/verification.md`, the JSON reports and browser screenshots for measured environment and results.

## Geographic and visual limits

The anchor is **41.283879, -74.3662393**, an OSM house-address point agreeing with an independent PointAddress match within approximately 1m. This is high-confidence address placement, not a survey. Around the starting Beverly loop, NYS building footprints replace the earlier address-point houses, and dated aerial evidence guides driveway approaches, crowns and ground-cover patterns. Most source footprints date to 2013. Nine facades have exterior-photo observations: 2, 12, 20, 22, 26, 29, 34, 35 and 41 Beverly. The supplied Home photographs resolve its visible front; the owner describes its deck, patio and screened rear area. Heights, exact construction dimensions, tree coordinates, hidden details and unverified paint colors remain approximate. Home's curved driveway uses the visible 2010/2013 approach and 2025 apron; current hidden edges are inferred. This is a partial reconstruction rather than complete Street View coverage.

Beverly and the inspected West Ridge segment use an approximately **9.2m paved width without an invented center stripe**. Outside that area, game road widths remain widened to 10.5–13m. Geographic centerlines, bends and junctions are retained; the broader **Ridge & Hollow** race is unchanged. Building envelopes, heights, roofs and landscaping remain approximations. Coarse USGS terrain softens small bumps; roads and their colliders follow the same triangulated terrain. A mapped Jessup stream bridge retains its grade/tags; water and structural bridge detail are not reconstructed. The race has no road-over-road crossing.

Civilian cars follow the verified race loop in its right-hand lane; they do not simulate every neighborhood journey. AI is competent path-following with physical contacts, not human race tactics. Damage is impact/wreck feedback with quick recovery, not deformable destruction. The cabin/close camera is a closer chase view, not a fully modeled first-person driving interface. Campaign, multiplayer and destruction simulation remain outside this slice.

**Physical wired-controller feel, end-to-end latency and felt rumble were not verified.** The automated pad tests inject API snapshots and are labeled accordingly. Use the short hardware checklist in `docs/controller.md`: menus/sliders, partial triggers, drift/recovery, boosted bend, scrape/hard impact, unplug/reconnect, tab away/back, rumble off/on, and controller-only race restart.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Elevation: [USGS 3DEP](https://www.usgs.gov/3d-elevation-program), public domain. Scanned materials and outdoor HDRI are CC0 from [Poly Haven](https://polyhaven.com/license) and [ambientCG](https://docs.ambientcg.com/license/); exact authors, source URLs, scales and checksums are in `public/textures/manifest.json`. Game UI, generated audio, leaf masks and scenery implementation are original. No Burnout names, artwork, sounds or code are included.

Beverly references: **NYS ITS Geospatial Services / NYSDOP, Orange County GIS Division, NYSERDA and contributing sources**. NYS public-service access and as-is resource terms are documented in [the reconstruction notes](docs/beverly-reconstruction.md#sources-and-resource-terms); these sources are not labeled CC0. Aerial and listing photographs are research references, not game textures. Listing photographs are linked and described only; they are not included as assets. The user-supplied Home street screenshots are also reference-only: their pixels are not copied into this repository or projected onto game geometry.
