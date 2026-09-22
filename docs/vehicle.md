# 442 source and runtime contract

The game uses the supplied, modeled 1968 Oldsmobile 442, not a proxy. The adjacent source README was read and the saved Blender hierarchy inspected before export. The active `oldsmobile_442` folder was treated as read-only. The snapshot used by this project is `asset-source/1968_oldsmobile_442.snapshot.blend`; its SHA-256 is recorded in `public/assets/vehicle-manifest.json`.

Run from the game directory in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-car.ps1
# To use a different Blender installation:
powershell -ExecutionPolicy Bypass -File scripts/export-car.ps1 -Blender 'C:\path\to\blender.exe'
```

The script only opens the saved snapshot. It writes `public/assets/oldsmobile-442.glb`, `public/assets/vehicle-manifest.json`, and the compressed, editable derived `asset-source/oldsmobile-442.game.blend`. It never invokes the source rebuild scripts or saves the active source. The derived Blender file contains the same closed car, separate wheels and hinged doors exported to the game; it can be opened and posed directly in Blender. To incorporate a later source revision, explicitly copy its `.blend` to the snapshot path first, then run the export. Retain the earlier snapshot if it is needed for comparison.

The source is +X left, -Y forward, +Z up, with dimensions in meters. Standard glTF export converts to +X left, +Y up, +Z forward; physical right is -X. Load with GLTFLoader with no additional rotation or scale. The visual origin is at ground level, centered laterally and approximately between axles. A chassis center of mass .65m above the visual origin requires visual position `[0,-.65,0]` beneath its physics body. The suggested collider is independent of visual geometry.

The game export corrects the saved snapshot's interior to US left-hand drive. It inspects the steering wheel's actual location and reflects the interior only when necessary, moving the wheel, column, cluster and pedals together, with the glovebox on the passenger side. Text placement moves without mirroring glyphs, and reflected mesh winding is corrected. Export assertions verify all seven critical interior components. The steering-wheel center is `[+.398,1.038,.064]` in game coordinates, visibly left when looking forward from behind the car. The active source and saved snapshot remain untouched. Physical wheel names are resolved from tire geometry centers, not the snapshot's historically reversed LEFT/RIGHT labels.

| Wheel | Center in exported model (meters) | Steer pivot | Spin pivot |
|---|---|---|---|
| Front left | [.75, .345, 1.43] | WheelSteer_FL | WheelSpin_FL |
| Front right | [-.75, .345, 1.43] | WheelSteer_FR | WheelSpin_FR |
| Rear left | [.75, .345, -1.415] | WheelSteer_RL | WheelSpin_RL |
| Rear right | [-.75, .345, -1.415] | WheelSteer_RR | WheelSpin_RR |

Each wheel has a .345m radius. Animate front steering around local Y (negative angle turns right) and wheel spin around local +X; positive spin angle corresponds to +Z travel. Positive driver input means right; the physics controller performs the sign conversion. Suspension travel moves the steering pivot up/down relative to its manifest center. The nested pivots are intentional: steer the wrapper, then spin its child. Never rotate the combined body to create wheel motion. The root is `Oldsmobile442`, the static body mesh is `Body`.

The cabin wheel has its own identity-oriented `SteeringWheel` pivot and `SteeringWheelMesh`. Its 14 original rim, inset, hub, horn, spoke and slot pieces rotate around the manifest's normalized `[0, .638, -.77]` axis, pointing toward the driver. The column and indicator stalk remain fixed. Runtime applies the road-wheel angle × 1.7 to this axis: a right turn rotates clockwise from the seat. Both wrist targets follow the same tilted plane and rotation. Tests load the actual GLB, exercise both directions, verify fixed center/body and unchanged rim radius, and check the articulated wrists at both steering extremes.

Actual game close-ups: [steering right](controller-steering-right.png) and [steering left](controller-steering-left.png). Both were visually reviewed on the controller/camera fix build.

The door- and steering-enabled model has 310,089 triangles, 70 material primitives, 20 nodes, and 21 materials, occupying 5.96 MiB. The exporter evaluates 564,778 triangles before reduction. The hood is evaluated at authored frame 1 and its animation omitted. The modeled Rocket V8 is retained underneath. Studio floors, backdrop, cameras and lights are excluded.

## Real opening doors

The source's continuous sculpted sides are partitioned along its authored front, lower and rear door seams. The door section of each cabin shoulder and chrome belt molding is partitioned with them. This removes the original body skin from the doorway: opening a door reveals the floor, seat and footwell rather than a second blue wall. The original door card, armrest, window crank, release, exterior handle, key barrel, mirror and triangular vent window move as one rigid assembly. The windshield and A-pillars, rocker chrome, sill and rear-quarter upholstery stay fixed. Both physical sides are resolved from the evaluated geometry, after the existing US-left interior correction.

The original static interior cards extended beyond the rear door seam. Their longitudinal dimensions and attached details are fitted into the cut opening. Added folded painted edges, an inner metal pressing, latch, hinge plates, fixed jambs, rubber seals and sill scuff plates finish surfaces exposed by opening the door. These hidden construction details are an artistic interpretation of the existing model, not a new vehicle survey. The original paint profile, handles and upholstery detailing are retained.

| Physical door | Hinge node | Hinge in game coordinates | Fully open around local +Y |
| --- | --- | --- | --- |
| US driver / left (+X) | `DoorHinge_L` | `[0.866, 0.72, 0.59]` | −68° |
| Passenger / right (−X) | `DoorHinge_R` | `[-0.866, 0.72, 0.59]` | +68° |

Each hinge owns `DoorMesh_L` or `DoorMesh_R`. `VehicleDoors` in `src/vehicle-doors.ts` takes the cloned car model, preserves hinge rest transforms and provides `setOpen(side, progress)`, `closeAll()` and `getState()`. Side `1` is physical left; `-1` is right. Progress is clamped from zero (latched) to one (open); interaction code owns animation timing. `getState()` and hinge `userData.open_progress` expose normalized progress for QA. Do not add a second axis conversion at runtime. In Blender, the corresponding hinge axis is local +Z.

The clear opening is approximately local Z −0.72 to +0.59 m, above the 0.375 m sill. Character transfer can pass near local Z −0.2 m. The rigid-door animation changes visual nodes only; the existing chassis collision and wheel/suspension physics are unchanged.

Four focused tests load the actual exported GLB and check closed bounds, both hinge pivots, the US-left layout, wheel wrappers, outward travel, fixed-body preservation, progress sanitation and independent sides. Raycasts at three positions on each side verify that the closed surface blocks the passage and the open door leaves it clear. Run `npx vitest run tests/vehicle-doors.test.ts`.

`scripts/render-vehicle-doors.py` renders the editable derived car without resaving it. The closed view, both open sides, exposed doorway and interior-card view were inspected for panel/trim continuity and the fixed windshield. These are Blender asset renders; runtime integration is verified separately by the gameplay checks.

![Closed 442 with the original body profile](vehicle-doors-closed.png)

![US-left door open with the original handle, mirror and vent glass](vehicle-doors-left-open.png)

![The open driver doorway exposes the original cabin without a duplicate body wall](vehicle-doors-doorway.png)

![Original parchment door card and controls on the open door](vehicle-doors-inner-card.png)

[Passenger door open](vehicle-doors-right-open.png).

The final driving integration uses a visual offset of `[0,-.78,0]`, chassis collider half-extents `[.9,.31,2.3]` at `[0,.04,0]`, and four world-down wheel rays from local Y=.1, maximum length1.05m and spring rest ray distance1m. These final values are recorded in `runtimeIntegration` in the manifest and preserved by the export script; the earlier `.65m` values are exporter suggestions. Runtime reads wheel X/Z centers, radius and visual offset from the manifest before creating any vehicle. Car appearance and wheel geometry can therefore be revised without rewriting the input controller or tire-force code.

Optimization is applied only to the derived model: tessellation reduction, merging rigid meshes, reduced bevel/curve subdivisions, and small optical material changes. Dark sapphire base paint, parchment upholstery, chrome, redlines, Rally wheel details, and engine colors remain. Procedural subpixel paint noise is omitted. The windshield uses .20 alpha rather than expensive transmission; headlamps use reflective lenses. This is an artistic visual model, not a dimensionally certified reconstruction.

Browser inspection on September 20, 2026 loaded the actual GLB at 1280×720 in the Codex Chromium browser. Its closed hood, paint, interior, trim and redlines were visually checked. Separate steering/spin wrappers were exercised using the inspection page. There were no JavaScript errors; the isolated development preview emitted a Three.js duplicate-import warning and nonfatal GPU precision warnings. The game uses its own bundled Three.js instance. `docs/vehicle-browser.png` records the actual rendered export.

For development inspection, run the Vite development server and open `/assets/vehicle-preview.html`. This developer page imports installed `node_modules` and is intended for the development server, not the production build.

![Actual GLB browser render](vehicle-browser.png)
