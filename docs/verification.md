# Verification — September 20, 2026

The local source builds successfully with TypeScript, Vite 8.3, Three.js 0.186 and Rapier 0.20. Dependency versions are locked in `package-lock.json`. After the left-hand-drive correction, **42 tests across six files pass**, and the full browser race/restart/Home flow was repeated successfully in Edge153.0.4234.48 with zero page errors. The earlier build was also checked in Chrome152.0.7977.83; its separate report remains `browser-verification-chrome.json`.

The corrected GLB was visually checked in the actual game: steering wheel, instrument cluster and pedals are on the driver's left. Seven export assertions check interior handedness, and wheel names are resolved from geometry rather than historical object labels. New actual-physics regressions check manual right/left steering and civilian right-lane tracking at four headings. Right-stick look direction, oncoming-lane credit and the Home shoulder were aligned with the corrected axis convention. The active source `.blend` and saved snapshot retain their original SHA-256. Screenshot: `left-hand-drive-game.png`.

## What was exercised

- Input unit tests: nonzero device selection, fresh snapshots/null entries, simultaneous proportional triggers, deadzone rescaling, menu edges/repeat, saved settings, unknown mappings, remapping, confirmation consumption, View hold, focus/disconnect latches, processed diagnostics and haptic scheduling/rejection.
- Actual Rapier scenarios: acceleration, partial/full throttle, braking to a stop without accidental reverse, ordinary turning and boosted wall collision at 30/60/120Hz rendered-frame schedules with fixed60 physics. Tolerances: 0.15m position, 0.2m/s speed, 0.1 boost units. No promise of deterministic results across hardware.
- Separate CCD tests initialize the chassis at the configured 70m/s boost ceiling and confirm it cannot tunnel through a thin fixed barrier or a stationary physical traffic car. The traffic car receives collision momentum. These are explicit high-speed initial conditions, not measured acceleration runs.
- Race rules: ordered directional gates, wrong-way rejection, out-of-order rejection, reset/teleport blocking, lap completion, reserve bounds/cooldowns and takedown deduplication.
- Map/surface tests: terrain diagonal agreement and road surface alignment. Offline importer asserts anchor distance, source-graph continuity, loop closure, map bounds and <=12m road samples. Rebuilding cached map data twice produced identical output.
- Full route with actual physics: all four racers completed all777 ordered gate crossings across3laps with3 physical civilian cars. No racer recovery/teleport was needed. Completion times in the controlled Node test:395.75s,556.32s,403.73s,396.23s. The slow rival was delayed by interactions; the simulation does not award artificial progress. See `vehicle-route-physics-traffic.json`.
- Browser race: real442 GLB loaded and rendered, countdown completed, actual physics driver completed3laps, results reported6:35.58. Synthetic pad then restarted from lap1/checkpoint1, and Return Home exited the event. See `browser-verification.json` and `browser-race-results.png`.
- Browser Home exit: actual physics drove from the roadside Home spawn, followed the eastern portion of Beverly Drive, crossed the verified junction, and reached West Ridge Road at local[128.540,10.786,40.715], four grounded wheels and0.005m centerline error. No teleport along the route.
- Boundary recovery: an explicit test placement beyond the eastern edge triggered safe recovery to a mapped road at local[1846.038,24.830,38.620], approximately0.009m from its centerline. Free Drive stayed outside race mode. Teleport injection was used only to set up this boundary test.
- Synthetic pad integration: standard-mapped index2 with null slots before it; partial LT/RT together; menus/settings slider; acceleration; disconnect while accelerating; reconnect selection followed by deliberate resume; blur/focus followed by deliberate resume; race/results/restart/Home. Injection is confined to the test script and `?test` debug hooks.
- Visual browser inspection: source car appearance, closed hood, separate steer/spin nodes, map road continuity, Home clearance, slopes, race result screen, and route preview. Shader compiled successfully for pooled smoke. The test-area drift sample reached20.95m/s with four grounded wheels and21.3° slip; this is functional evidence, not a physical feel judgment.

## Performance measurement

Measured in the actual Windows browser at1920×1080, pixel ratio1, **High** graphics, shadows on, using the production build and real442 with all six other cars active. Hardware: AMD Ryzen5 3600, NVIDIA GeForce GTX1660 SUPER, ANGLE Direct3D11. Browser: Edge153.0.4234.48. A scripted driver followed the first part of the race in real time, with fixed60 physics and interpolated rendering.

Independent raw `requestAnimationFrame` timestamps over a continuous20s sample, excluding the first10 warm-up intervals:

| Measure | Observed |
|---|---:|
| Measured intervals | 1,185 |
| Median | 16.70ms |
| 95th percentile | 16.80ms |
| 99th percentile | 16.80ms |
| Maximum | 16.90ms |
| Mean | 16.68ms (about60fps) |
| Last measured simulation step | 0.80ms |
| Last rendered draw calls | 171 |
| Last rendered triangles incl. shadow passes | 976,679 |

These measurements cover a short moving race sample, not every map location or a long thermal soak. They do not measure display latency or physical controller latency. High uses2048px shadows at native CSS resolution; Medium uses1024px shadows; Low uses75% render resolution and disables shadows. The renderer batches static scenery by material and pools effects.

## Hardware checks still pending

No actual Gamepad device was exposed in the browser during verification. Wired USB Xbox feel, button layout on your specific controller, end-to-end latency and felt rumble remain unverified. Complete the short checklist in `controller.md`. Haptic feature detection/rejection was tested synthetically, and vibration is optional.

The low-detail neighborhood uses real topology and public elevation but approximate building envelopes/materials/vegetation. It is not a precise reconstruction of your dad’s house. Road widths and racing presentation are explicit gameplay adjustments in the geographic manifest.

## Reproduce

Run `npm test`, then `npm run build`. Serve the production build with `npm run preview -- --port 5180 --strictPort`. In another PowerShell terminal set `$env:GAME_URL='http://127.0.0.1:5180'` and run `npm run test:browser`. Browser tests require an installed Edge or a Playwright browser selected through `BROWSER_CHANNEL`. The `?test` URL enables explicit developer hooks; normal play exposes no input-injection API.
