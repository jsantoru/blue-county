# Physical route validation

`npx vitest run tests/ai-route.test.ts` drives the actual Rapier vehicle, through the analog Driver controls, across the cached Warwick terrain and road colliders. It does not teleport the car between checkpoints or manipulate race progress. All 259 gates per lap must pass the production `RaceProgress` ordered, forward crossing checks. Terrain, clipped road surfaces and rounded joins are generated from the same runtime functions. Source building bounding boxes make this a conservative building clearance check; runtime houses use tighter rotated footprints.

The September 20, 2026 run completed all 777 gate crossings over three laps:

| Scenario | Finish time | Safe recoveries |
|---|---:|---:|
| Single car, 25m/s target | 395.22 simulated seconds | 0 |
| Player driven by scripted Driver, with six other cars | 395.75 seconds | 0 |
| Rival 1, 23.3m/s target | 556.32 seconds | 0 |
| Rival 2, 24.6m/s target | 403.73 seconds | 0 |
| Rival 3, 25.9m/s target | 396.23 seconds | 0 |

Three civilian cars were active in the multi-car test. Cars collided physically; traffic and contact can delay a rival. Recovery logic, if needed, uses the last earned gate and never awards a checkpoint. The single-car test requires zero recovery. The multi-car test allows fewer than five per racer to accommodate collision differences; this recorded run used none.

The original follower skipped gates at the two tight southern junctions because its lookahead began at the next waypoint and it advanced waypoints within a speed-dependent distance. The corrected follower measures lookahead from the projected car position, advances after crossing the gate, and converts pursuit curvature into the available steering angle. Actual terrain/road alignment was corrected separately in the road geometry code.

Recorded data: `vehicle-route-physics.json` contains each single-car gate crossing; `vehicle-route-physics-traffic.json` contains full-race outcomes. To regenerate:

```powershell
$env:AI_REPORT='docs/vehicle-route-physics.json'
npx vitest run tests/ai-route.test.ts
Remove-Item Env:AI_REPORT
```

This is automated physics evidence. Simulated race times do not measure browser frame rate, controller latency, physical Xbox feel, or haptic quality. Browser performance and physical controller checks are separate.
