# Home photo observations

The user supplied three street-level reference photographs on 2026-09-20 and described the deck arrangement from personal knowledge. These observations supersede the earlier neutral Home facade and the partial aerial-only deck reconstruction. The supplied images are reference material; their bitmap contents are not copied into the game or this repository.

Reference attachment basenames:

- `codex-clipboard-4cbaa5d0-54fd-4f90-8baf-254774f303af.png`: nearly frontal view of the house and lawn.
- `codex-clipboard-8d66f726-aaf6-4392-9dd0-37a533740a51.png`: oblique view toward the driveway side.
- `codex-clipboard-334cf217-28cc-434f-82ba-36772f0dadd1.png`: driveway entrance and mailbox.

The photographs' capture date is not supplied. Their spring foliage state should not be mistaken for proof of a current tree inventory. The cached NYS 2013 and 2025 aerials help place the existing footprint and driveway, but do not resolve precise trunk locations or obscured wall openings.

## Coordinate frame

The main house is state footprint `nys-7159466`; retain its source polygon. From its four unique corners, its center in the game's east/south plane is approximately `(1.9675, 2.1288)`, facade width `14.946 m`, and depth `9.975 m`.

For a person looking at the house from Beverly Drive:

- Right along the front facade points south: unit vector `U = (-0.20644, +0.97846)`.
- Forward from the house toward the road points west: `F = (-0.97846, -0.20644)`.
- A local point `(u, f)` maps to `center + u*U + f*F`. The street-facing wall is at `f ≈ +4.99 m`; the driveway-side wall is at `u ≈ +7.47 m`.

This establishes handedness. The user's right-side deck belongs beside the driveway, not on the north/left wall. Heights and dimensions beyond the retained state footprint remain reconstruction estimates.

## Visible facade details

- Long, low raised-ranch form with a simple brown shingle gable roof, pale horizontal siding, white fascia/eaves and a visible thin metal flue toward the left half of the roof. No front dormer, front-facing gable, bay projection or covered front porch is visible.
- The upper facade has three distinct window groups. From viewer-left: a paired sash group; another paired group near the middle; and a wider picture-window group at the right, with narrow side panes. All have light frames and dark muted red/burgundy shutters at the outside edges. Their approximate normalized centers across the facade are `-0.37`, `-0.055`, `+0.345` of total width measured from its midpoint. These are visual proportions, not measured opening dimensions.
- The front door is offset to the viewer's right of center, approximately `u = +1.8 m`. It is muted dark red, with a dark glazed upper portion and light surrounding trim. A short stoop/steps reaches the door. The entry interrupts the otherwise continuous facade band; it is not a large columned porch.
- A small dark wall lamp and a dark spreading-wing decorative ornament appear above the entry. These small features should remain subordinate to the facade silhouette and opening positions.
- Lower-level windows are shorter than the upstairs windows. There is a larger left group, a small opening near the middle-left, and a right group below the wide upstairs window. Their red shutters, pale trim and the visible basement band contribute substantially to the recognizable raised-ranch appearance.
- The wall and lower story appear similarly pale overall. A large invented stone skirt or high plain concrete plinth would misrepresent the photos.

## Visible front yard and driveway details

- The front setback is mostly uninterrupted green lawn. Keep this broad open area readable instead of filling it with ornamental clusters or short conifer crowns.
- A dark brown planting bed hugs the front wall, with several individually spaced, fairly sparse shrubs. It contains a small pale pedestal/birdbath toward the left, a decorative wheel against the wall left of the entry, and a small outdoor bench to the right.
- A light paved walk reaches the front steps and continues along the front toward the driveway side. It is narrow domestic paving, not a broad parking apron across the lawn.
- Several mature deciduous trunk groups stand in the front lawn. Their thick pale gray, textured trunks are exposed for substantial height before the main crown. Branches and spring foliage cast fine shadows across the grass. The two frontal photos show the facade through the trunk spacing.
- Exact trunk positions cannot be triangulated from these three perspective photographs. Useful approximate layout anchors, to be visually checked against the aerial, are `(u,f)=(-10,16)`, `(4.5,16)`, and `(9.5,15)`, corresponding to world XZ about `(-11.62,-10.96)`, `(-14.62,3.23)`, and `(-14.67,8.33)`. These are reconstruction estimates, not survey points. Additional far-right trunks may be on the boundary or adjoining property; do not turn every visible crown into an asserted Home tree.
- The driveway curves in on the viewer-right/south side. It has a dark asphalt surface, a flared mouth, and a pale curb/road seam. A narrow timber-like edge is visible along part of its left entrance edge.
- The mailbox sits at the left side of the driveway mouth when viewed from the road. It has a dark gray rounded box, red flag, a pale weathered single wood post and the numeral `2`. The photograph also shows the back of a nearby road sign to the right; its sign face and message cannot be identified from this view.
- A tall evergreen screen belongs along the driveway and right boundary. Keep these trees away from the open center of the front lawn and preserve the driveway's usable width.

## User-confirmed side and rear details

These features are authoritative user descriptions, rather than facts established by the limited street-level photographs:

- The deck is on the viewer-right/driveway side of the house.
- A patio sits underneath that elevated deck.
- A red door opens from the house onto the lower patio.
- Sliding doors open onto the deck directly above the patio door.
- The deck wraps around the rear and includes a roofed screened-in area.

The exact screen-panel count, roof pitch, railing spacing, stairs, furniture and unseen rear openings remain approximate unless separately supported. Render the confirmed relationships clearly without presenting those secondary dimensions as measurements.

## Suggested game review views

Use terrain-relative camera heights through the existing inspection hook; each point below is XZ, not XYZ:

| View | Camera XZ | Target XZ | Suggested camera/target height above terrain |
| --- | --- | --- | --- |
| Street-facing facade and lawn | `(-31.30,-4.89)` | `(1.97,2.13)` | `2.3 m / 2.6 m` |
| Closer facade details | `(-18.58,-2.21)` | `(1.97,2.13)` | `2.3 m / 2.6 m` |
| Driveway-side deck and patio | `(-5,24)` | `(1,10)` | `3.5 m / 2.3 m` |
| Rear screened area | `(20,2)` | `(8,5)` | `5.8 m / 3 m` |

These are starting views. Adjust modestly for actual tree occlusion, but retain a road-height overview as evidence that the real front-lawn proportions and facade remain readable while driving.
