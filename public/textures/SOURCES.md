# Offline material sources

Retrieved September 20, 2026 from the original Poly Haven and ambientCG download hosts. All assets are CC0: [Poly Haven license](https://polyhaven.com/license), [ambientCG license](https://docs.ambientcg.com/license/). SHA-256 and available original provider MD5 checksums are pinned in `manifest.json`; `python scripts/fetch-textures.py --verify-only` validates every file and its actual dimensions. The ambientCG set also pins its source ZIP checksum and member names for repeatable restoration.

| Runtime key | Source | Artist | Original tile width |
|---|---|---|---:|
| grass | [Leafy Grass](https://polyhaven.com/a/leafy_grass) | Charlotte Baglioni | 2m |
| lawn | [Grass 004](https://ambientcg.com/view?id=Grass004) | ambientCG / Lennart Demes | 1.4m |
| asphalt | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Rob Tuytel | 3m |
| bark | [Bark Brown 02](https://polyhaven.com/a/bark_brown_02) | Rob Tuytel | 1m |
| roof | [Roof Slates 02](https://polyhaven.com/a/roof_slates_02) | Rob Tuytel | 3m |
| brick | [Red Brick 03](https://polyhaven.com/a/red_brick_03) | Rob Tuytel | 1m |
| siding | [White Planks Clean](https://polyhaven.com/a/white_planks_clean) | Rob Tuytel | 1.8m |
| concrete | [Concrete Floor](https://polyhaven.com/a/concrete_floor) | eye-candy.xyz | 2.08m |
| gravel | [Gravel Floor](https://polyhaven.com/a/gravel_floor) | Jenelle van Heerden; Matterfield | 2.25m |
| outdoor reflection | [Greenwich Park HDRI](https://polyhaven.com/a/greenwich_park) | Andreas Mischok | Equirectangular |

Nine material sets contain 1024×1024 JPEG albedo, OpenGL normal and roughness maps. The HDR environment is 1024×512 Radiance RGBE. No preview render or reference photograph is included. Total images: 24.28 MiB. The greener lawn set adds 4.94 MiB of original provider files; the original leafy ground remains available for woodland margins.

Set albedo maps to sRGB; normal and roughness maps contain linear data. Geometry UVs in meters can use texture repeat `1 / tileMeters`. The siding source planks run vertically in the image: swap the surface U/V coordinates for horizontal courses. Slate roofing is a generic visual approximation rather than a statement about any individual house. Avoid displacement in the runtime so visual texture changes cannot alter verified road collision geometry.
