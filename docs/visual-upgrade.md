# Neighborhood visual upgrade

The visual branch replaces the original flat-color scenery while keeping the map geometry, terrain/road collision alignment, vehicle physics, controller bindings and left-hand-drive car export intact. The source Blender file and included snapshot retain SHA-256 `907219b6d86f22e749f8aa611bb11185fbb54dd890f655122664f6803c88c0fb`.

## Surfaces and lighting

Local 1024px scanned materials supply sRGB color, linear OpenGL normals and roughness at physical meter scales. They cover asphalt, lawn, bark, slate roofing, red brick, painted wood siding, concrete and gravel. World-space variation breaks up the large ground/road surfaces; low grazing-angle reflection keeps turf matte. Road strips and junctions retain their original terrain-facet clipping and colliders. Two narrow parallel centerlines and narrower gravel margins improve their appearance.

The pack contains 28 images, 24.28 MiB, including a 1K outdoor HDR reflection map. Poly Haven and ambientCG publish these assets under CC0. Every file, author, source URL, physical scale, color space and SHA-256 is recorded in `public/textures/manifest.json`; `LICENSE.txt` and `SOURCES.md` accompany it. `python scripts/fetch-textures.py --verify-only` checks local bytes, dimensions and hashes. Omitting `--verify-only` restores the pinned files. Gameplay uses no provider requests.

A procedural atmospheric sky, slowly moving cloud layer, warm directional sunlight, hemisphere fill and outdoor reflections replace the studio environment and flat background. High graphics adds multisampled rendering, subtle depth-based contact shading and peripheral falloff. Its depth comes from the actual color pass, so alpha-cutout foliage remains cut out in the contact shading. Tone mapping and display color conversion run once. Medium and Low render directly.

## Vegetation and architecture

Deterministic placement supplies 18,731 mature trees, 1,233 shrubs and 6,363 verge grass tufts. Broad deciduous crowns and conifers use branched trunks and original alpha-masked leaf/needle sprays, with varied scale, rotation and color. Volume-oriented foliage normals and restrained transmitted light avoid black card backs. Small vertex motion provides wind. Tree canopies remain outside widened roads and building envelopes.

Near and far tree templates share instanced material batches inside 240m spatial cells. Coarse distance culling combines with Three's native frustum bounds; detail switches by cell and shadows are limited to nearby trees. High/Medium/Low vegetation distances are 1120/820/580m. Grass fades at 65–100m and is disabled on Low. Fine leaf texture mipmaps, MSAA coverage and reduced distant geometry keep the fuller wooded backdrop affordable.

All 432 accepted house envelopes now have seeded generic architectural detail: siding or brick, foundations, gable/hip roofs, occasional dormers, eaves, gutters, windows with trim and sashes, shutters, doors, porches, steps and integrated garage panels. Yards include short paths, planting, fences and mailboxes. Spatial material batches retain UVs and vertex-color variation. The architecture is approximately 1.19 million triangles across the entire cached map; frustum culling excludes unseen cells. A separate 100-pole utility pass adds 85 sagging conductor spans, 11 rail-fence sections and six stone clusters.

These are plausible neighborhood details, not surveyed facade, tree, landscaping or utility locations. Real road centerlines and imported house/address placement remain the geographic evidence. The outdoor HDRI supplies lighting, not a claimed photograph of Warwick. Rivals and traffic now use three original generic sedan/wagon/pickup shapes, each approximately 11,000 triangles in seven material batches. Their sloped glazing, wheel arches, lamps, grilles, mirrors, trim and wheel details replace the old box models; chassis physics is unchanged. Destruction remains the impact/recovery system of the playable prototype.

## Validation

The build includes a new scenery browser check: `npm run test:visual` against the production preview. It captures Home, a house close-up and the ridge; visits three route locations; checks visible draw/triangle budgets and ground contact; exercises all graphics presets and resizing; reports shader, JavaScript and resource errors; and measures independent animation-frame intervals during real-time driving. Results are saved in `docs/visual-verification.json`.

The controller/browser suite still uses explicitly synthetic Gamepad snapshots and actual physics for the full three-lap race, result restart and return Home. Synthetic button edges now wait for rendered frames instead of assuming a fixed wall-clock delay. The initial loading screen stays up through texture loading, shader compilation and a render warmup.

The road regression suite still verifies terrain/collider alignment and now observes disposal of every InstancedMesh when an environment is removed. This catches per-instance GPU buffer leaks when switching between the neighborhood and handling grounds. PMREM render targets are also disposed when the fallback sky reflection is replaced by the HDRI.

Changing shadow enablement explicitly invalidates material programs. This is necessary in Three 0.186: otherwise Medium → Low can retain a PCF shadow sampler after its depth texture is removed. The browser quality check treats WebGL invalid-operation messages as failures and checks `gl.getError()` after preset changes and Low → High resizing.

The final production build passed all 42 unit tests, the scenery check and the full three-lap browser race (777 ordered gates, 6:35.62), including results restart and Return Home. The browser reports contain no JavaScript, WebGL or failed-resource errors. The graphics driver emitted only an HLSL constant-rounding warning, retained in the visual report.

Measured September 20, 2026 in Edge 153.0.4234.48 on Windows, AMD Ryzen 5 3600 and NVIDIA GeForce GTX 1660 SUPER using ANGLE Direct3D11. Each preset used 720 independent animation-frame intervals over 12 seconds of actual moving gameplay after warmup, with three rivals and three civilian cars.

| Preset | Render resolution | Median frame | 95th percentile | Mean frame | Last draws | Last triangles, including shadows |
|---|---|---:|---:|---:|---:|---:|
| High | 1920 × 1080 | 16.70 ms | 16.80 ms | 16.68 ms | 511 | 2,734,733 |
| Medium | 1920 × 1080 | 16.70 ms | 16.80 ms | 16.68 ms | 468 | 2,470,332 |
| Low | 1440 × 810 | 16.70 ms | 16.80 ms | 16.68 ms | 294 | 1,287,255 |

All presets used a 1920 × 1080 CSS viewport; Low renders at 75% resolution. The High Home inspection rendered 652 draws and 3,358,466 triangles. Preset switching and returning from Low to High at a resized 1280 × 720 viewport passed without WebGL errors.

These measurements describe the tested Windows browser, viewport and short driving samples: approximately 60 fps here, not a guarantee for every location, lower-end hardware or long thermal loads. Hardware controller feel, physical controller latency and rumble remain unverified.
