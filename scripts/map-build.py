"""Build the offline Warwick scene from redistributable cached OSM + USGS data.

    python scripts/map-build.py

No dependencies or network are needed for the normal build. Refresh source data
with map-fetch.py (Pillow is required only to decode newly fetched GeoTIFFs).
"""
from __future__ import annotations
import collections
import hashlib
import html
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'map'
SOURCE = OUT / 'source'
LAT, LON = 41.283879, -74.3662393
M_LAT = 111320.0
M_LON = M_LAT * math.cos(math.radians(LAT))
BOUNDS = {'minX': -1900, 'maxX': 1900, 'minZ': -1950, 'maxZ': 1950}


def read(name):
    return json.loads((SOURCE / name).read_text(encoding='utf-8'))


def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def xy(lat, lon):
    return (lon - LON) * M_LON, (LAT - lat) * M_LAT


def inside(x, z, margin=0):
    return BOUNDS['minX'] + margin <= x <= BOUNDS['maxX'] - margin and BOUNDS['minZ'] + margin <= z <= BOUNDS['maxZ'] - margin


elevation = read('elevation-grid.json')
extent = read('elevation-export.json')['response']['extent']


def absolute_height(x, z):
    lon, lat = LON + x / M_LON, LAT - z / M_LAT
    # ArcGIS export extent describes outer pixel edges; samples are pixel centers.
    gx = (lon - extent['xmin']) / (extent['xmax'] - extent['xmin']) * elevation['cols'] - .5
    gz = (extent['ymax'] - lat) / (extent['ymax'] - extent['ymin']) * elevation['rows'] - .5
    gx = max(0, min(elevation['cols'] - 1.000001, gx))
    gz = max(0, min(elevation['rows'] - 1.000001, gz))
    ix, iz = int(gx), int(gz)
    fx, fz = gx - ix, gz - iz
    vals = elevation['heights']
    a, b = vals[iz * elevation['cols'] + ix:iz * elevation['cols'] + ix + 2]
    c, d = vals[(iz + 1) * elevation['cols'] + ix:(iz + 1) * elevation['cols'] + ix + 2]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz


HOME_ELEVATION = absolute_height(0, 0)
TERRAIN_COLS, TERRAIN_ROWS = 129, 133
terrain_heights = [round(absolute_height(BOUNDS['minX'] + col / (TERRAIN_COLS - 1) * 3800,
    BOUNDS['minZ'] + row / (TERRAIN_ROWS - 1) * 3900) - HOME_ELEVATION, 3)
    for row in range(TERRAIN_ROWS) for col in range(TERRAIN_COLS)]


def height(x, z):
    """Same bilinear surface as delivered terrain, keeping roads aligned."""
    gx = max(0, min(TERRAIN_COLS - 1.000001, (x - BOUNDS['minX']) / 3800 * (TERRAIN_COLS - 1)))
    gz = max(0, min(TERRAIN_ROWS - 1.000001, (z - BOUNDS['minZ']) / 3900 * (TERRAIN_ROWS - 1)))
    ix, iz = int(gx), int(gz)
    fx, fz = gx - ix, gz - iz
    a, b = terrain_heights[iz * TERRAIN_COLS + ix:iz * TERRAIN_COLS + ix + 2]
    c, d = terrain_heights[(iz + 1) * TERRAIN_COLS + ix:(iz + 1) * TERRAIN_COLS + ix + 2]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz


def point(x, z):
    return [round(x, 3), round(height(x, z), 3), round(z, 3)]


data = read('osm-neighborhood.json')
nodes = {e['id']: e for e in data['elements'] if e['type'] == 'node'}
ways = {e['id']: e for e in data['elements'] if e['type'] == 'way'}
coords = {i: xy(n['lat'], n['lon']) for i, n in nodes.items()}
allowed = {'residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'living_street'}
roadways = [w for w in ways.values() if w.get('tags', {}).get('highway') in allowed
            and w['tags'].get('access') not in {'private', 'no'}]
valid_nodes = {i for i, p in coords.items() if inside(*p, margin=30)}
graph = collections.defaultdict(list)
edges = {}
for way in roadways:
    for a, b in zip(way['nodes'], way['nodes'][1:]):
        if a in valid_nodes and b in valid_nodes and a != b:
            length = math.dist(coords[a], coords[b])
            graph[a].append((b, length, way['id']))
            graph[b].append((a, length, way['id']))
            edges[a, b] = edges[b, a] = way

# A junction exists only when ways share the same original OSM node. Geometric
# crossings are never converted to graph junctions.
beverly = ways[20686958]
start_node = min(beverly['nodes'], key=lambda n: math.hypot(*coords[n]))
connected, queue = {start_node}, [start_node]
while queue:
    for other, _, _ in graph[queue.pop()]:
        if other not in connected:
            connected.add(other)
            queue.append(other)


def densify(points, spacing=12.0):
    result = []
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        count = max(1, math.ceil(length / spacing))
        for i in range(count):
            t = i / count
            result.append(point(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    result.append(point(*points[-1]))
    return result


roads = []
for way in roadways:
    chunks, chunk = [], []
    for n in way['nodes']:
        if n in connected:
            chunk.append(n)
        else:
            if len(chunk) > 1:
                chunks.append(chunk)
            chunk = []
    if len(chunk) > 1:
        chunks.append(chunk)
    tags = way['tags']
    for j, chunk in enumerate(chunks):
        road = {'id': str(way['id']) + (f'-{j}' if len(chunks) > 1 else ''), 'osmWayId': way['id'],
                'name': tags.get('name', 'Mapped connector'), 'highway': tags['highway'],
                'points': densify([coords[n] for n in chunk]), 'nodeIds': chunk,
                'width': 13 if tags['highway'] in {'primary', 'secondary'} else 10.5,
                'oneway': tags.get('oneway', 'no'), 'layer': int(tags.get('layer', 0)),
                'bridge': tags.get('bridge', 'no') != 'no', 'surface': tags.get('surface', 'unspecified')}
        roads.append(road)

# Select a compact real circuit away from Home. This uses only shared-node
# adjacency, including the mapped Old Ridge/Seward connecting slip road.
sys.setrecursionlimit(10000)
parents, visited, cycles = {}, set(), []


def visit(a, parent=None):
    visited.add(a)
    for b, _, _ in graph[a]:
        if b == parent:
            continue
        if b not in visited:
            parents[b] = a
            visit(b, a)
        else:
            cycle, current = [a], a
            while current in parents and current != b:
                current = parents[current]
                cycle.append(current)
            if current == b and len(cycle) > 3:
                pairs = list(zip(cycle, cycle[1:] + cycle[:1]))
                names = {edges[x, y]['tags'].get('name') for x, y in pairs}
                if {'Old Ridge Road', 'High Hill Avenue', 'Claire Ann Drive', 'Seward Highway'} <= names:
                    cycles.append((sum(math.dist(coords[x], coords[y]) for x, y in pairs), cycle))


visit(start_node)
if not cycles:
    raise RuntimeError('The cached network has no expected verified circuit; review source changes before choosing a new route.')
_, circuit = min(cycles, key=lambda c: c[0])
area = sum(coords[a][0] * coords[b][1] - coords[b][0] * coords[a][1]
           for a, b in zip(circuit, circuit[1:] + circuit[:1]))
if area < 0:
    circuit.reverse()
# Start on Old Ridge Road, near its West Ridge connection, beyond junctions.
safe = [i for i, n in enumerate(circuit) if len(graph[n]) == 2
        and edges[n, circuit[(i + 1) % len(circuit)]]['tags'].get('name') == 'Old Ridge Road']
offset = min(safe, key=lambda i: math.hypot(*coords[circuit[i]]))
circuit = circuit[offset:] + circuit[:offset]
circuit.append(circuit[0])
route_points = densify([coords[n] for n in circuit])
route_names = list(dict.fromkeys(edges[a, b]['tags'].get('name', 'Mapped Old Ridge/Seward connector')
                               for a, b in zip(circuit, circuit[1:])))
cumulative = [0.0]
for a, b in zip(route_points, route_points[1:]):
    cumulative.append(cumulative[-1] + math.hypot(b[0] - a[0], b[2] - a[2]))
checkpoints, last = [], -200.0
for i in range(len(route_points) - 1):
    if cumulative[i] - last >= 120:
        a, b = route_points[i], route_points[i + 1]
        checkpoints.append({'index': len(checkpoints), 'sampleIndex': i, 'position': a,
                            'heading': round(math.atan2(b[0] - a[0], b[2] - a[2]), 6),
                            'distance': round(cumulative[i], 2), 'radius': 18})
        last = cumulative[i]

# Place Home on the verified road shoulder near the exact address point, facing
# south toward the eastern West Ridge junction. No unsupported driveway is drawn.
nearest = None
for a, b in zip(beverly['nodes'], beverly['nodes'][1:]):
    ax, az = coords[a]
    bx, bz = coords[b]
    dx, dz = bx - ax, bz - az
    t = max(0, min(1, -(ax * dx + az * dz) / (dx * dx + dz * dz)))
    px, pz = ax + dx * t, az + dz * t
    if nearest is None or px * px + pz * pz < nearest[0]:
        nearest = (px * px + pz * pz, px, pz, dx, dz)
_, hx, hz, dx, dz = nearest
norm = math.hypot(dx, dz)
# For forward (dx,dz) with world +Y up, physical right is (-dz,dx).
hx, hz = hx - dz / norm * 2.1, hz + dx / norm * 2.1
home = {'label': 'Home', 'position': point(hx, hz), 'heading': round(math.atan2(dx, dz), 6),
        'kind': 'roadside', 'road': 'Beverly Drive', 'distanceToAddressMeters': round(math.hypot(hx, hz), 1),
        'note': 'Right-hand roadside position on mapped Beverly Drive; driveway connection was not verified.'}

buildings = []
for way in ways.values():
    if 'building' not in way.get('tags', {}) or len(way['nodes']) < 4:
        continue
    footprint = [coords[n] for n in way['nodes'] if n in coords]
    if not footprint or not all(inside(*p, margin=10) for p in footprint):
        continue
    cx = sum(p[0] for p in footprint[:-1]) / (len(footprint) - 1)
    cz = sum(p[1] for p in footprint[:-1]) / (len(footprint) - 1)
    tags = way['tags']
    try:
        h = float(tags.get('height', float(tags.get('building:levels', 2)) * 3.0))
    except (ValueError, TypeError):
        h = 6
    buildings.append({'id': str(way['id']), 'points': [point(*p) for p in footprint],
                      'center': point(cx, cz), 'height': h,
                      'footprintApproximate': False, 'source': 'OSM building footprint',
                      'heightApproximate': 'height' not in tags and 'building:levels' not in tags,
                      'kind': tags['building']})

# Beverly has reusable NYS-imported address points but no OSM house footprints.
# Mark these simple envelopes as approximate instead of silently presenting
# invented building shapes as source geometry. Avoid overlap with known shapes.
house_streets = {'Beverly Drive', 'West Ridge Road', 'Old Ridge Road', 'High Hill Avenue',
                 'Claire Ann Drive', 'State Route 94 North'}
approximate_houses = 0
for node in nodes.values():
    tags = node.get('tags', {})
    if not tags.get('addr:housenumber') or tags.get('addr:street') not in house_streets:
        continue
    x, z = coords[node['id']]
    if not inside(x, z, margin=25):
        continue
    if any(math.hypot(b['center'][0] - x, b['center'][2] - z) < 25 for b in buildings):
        continue
    near = None
    for road in roads:
        for a, b in zip(road['points'], road['points'][1:]):
            dx, dz = b[0] - a[0], b[2] - a[2]
            sq = dx * dx + dz * dz
            if sq < .01:
                continue
            t = max(0, min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / sq))
            distance = math.hypot(x - a[0] - t * dx, z - a[2] - t * dz)
            if near is None or distance < near[0]:
                near = distance, dx / math.sqrt(sq), dz / math.sqrt(sq)
    if near is None or near[0] < 17 or near[0] > 160:
        continue
    _, tx, tz = near
    footprint = [point(x + tx * along + tz * across, z + tz * along - tx * across)
                 for along, across in [(-6,-5),(6,-5),(6,5),(-6,5),(-6,-5)]]
    buildings.append({'id': 'address-' + str(node['id']), 'points': footprint,
                      'center': point(x, z), 'height': 5.5, 'heightApproximate': True,
                      'footprintApproximate': True, 'source': 'OSM house address point; generic 12m x 10m envelope',
                      'addressStreet': tags['addr:street'], 'kind': 'house'})
    approximate_houses += 1

land = []
for way in ways.values():
    tags = way.get('tags', {})
    kind = tags.get('landuse') or tags.get('natural')
    if kind not in {'forest', 'wood', 'water', 'meadow', 'grass', 'farmland', 'orchard'}:
        continue
    polygon = [coords[n] for n in way['nodes'] if n in coords]
    if len(polygon) > 3 and all(inside(*p) for p in polygon):
        land.append({'id': str(way['id']), 'kind': kind, 'points': [point(*p) for p in polygon]})

geo_edges = [{'from': a, 'to': b, 'wayId': w['id'], 'length': round(math.dist(coords[a], coords[b]), 3),
              'layer': int(w['tags'].get('layer', 0)), 'bridge': w['tags'].get('bridge', 'no') != 'no'}
             for (a, b), w in edges.items() if a < b and a in connected and b in connected]
retrieval = read('retrieval.json')
attribution = 'Map data © OpenStreetMap contributors, ODbL 1.0. Elevation: USGS 3DEP (public domain).'
terrain = {**BOUNDS, 'cols': TERRAIN_COLS, 'rows': TERRAIN_ROWS, 'heights': terrain_heights,
           'heightReferenceMeters': round(HOME_ELEVATION, 3), 'order': 'row-major, increasing z / north to south'}
route = {'type': 'circuit', 'name': 'Ridge & Hollow', 'points': route_points, 'streets': route_names,
         'laps': 3, 'direction': 'clockwise', 'lengthMeters': round(cumulative[-1], 2),
         'nodeIds': circuit, 'checkpoints': checkpoints, 'cumulativeDistances': [round(d, 3) for d in cumulative],
         'heading': checkpoints[0]['heading']}
result = {'schemaVersion': 1, 'name': 'Warwick — Beverly & the Ridge', 'origin': {'lat': LAT, 'lon': LON},
          'bounds': BOUNDS, 'terrain': terrain, 'roads': roads, 'buildings': buildings, 'landuse': land,
          'home': home, 'route': route, 'attribution': attribution, 'attributionUrl': 'https://www.openstreetmap.org/copyright',
          'graph': {'nodes': {str(n): point(*coords[n]) for n in sorted(connected)}, 'edges': geo_edges}}

manifest = {'schemaVersion': 1, 'name': result['name'], 'retrievedAt': retrieval['retrievedAt'],
    'anchor': {'address': '2 Beverly Dr, Warwick, NY 10990, United States', 'lat': LAT, 'lon': LON,
        'osmNodeId': 8788896022, 'nysAddressPointId': 'ORAN057146', 'type': 'house-address point',
        'confidence': 'High: current OSM house point agrees within ~1m with independent ArcGIS PointAddress score 100. Not surveyed.',
        'source': 'https://www.openstreetmap.org/node/8788896022',
        'verification': {'Nominatim': 'source/nominatim-anchor.json',
            'ArcGIS': {'retrievedDate': retrieval['retrievedAt'][:10], 'lat': 41.283887941988, 'lon': -74.366241122767,
                       'matchType': 'PointAddress', 'score': 100, 'use': 'verification only; no proprietary map geometry used'},
            'Census': 'source/census-anchor.json — interpolated street range differs ~115m; rejected as house anchor'}},
    'projection': {'type': 'local equirectangular tangent approximation', 'origin': {'lat': LAT, 'lon': LON},
        'metersPerUnit': 1, 'x': 'east', 'y': 'up relative to sampled home ground', 'z': 'south',
        'formula': 'x=(lon-origin.lon)*111320*cos(origin.lat); z=(origin.lat-lat)*111320',
        'heading': 'atan2(dx,dz), radians; zero points south (+Z)'},
    'bounds': BOUNDS, 'elevation': {'source': 'USGS 3DEP Bare Earth DEM', 'license': 'Public domain US Government work',
        'service': 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',
        'dataPublicationDate': '2026-08-24', 'datum': 'Meters as served by USGS; vertical datum inherited from source DEM',
        'sourceGrid': [elevation['cols'], elevation['rows']], 'gameGrid': [TERRAIN_COLS, TERRAIN_ROWS],
        'absoluteHomeElevationMeters': round(HOME_ELEVATION, 3), 'relativeHeightRange': [min(terrain_heights), max(terrain_heights)],
        'method': 'Bilinear DEM resampling onto ~30m grid; stored point y samples use bilinear interpolation. Runtime geometry, collider and spawn heights use exact interpolation on the terrain triangle diagonal. Small-scale bumps removed by resampling.',
        'runtimeSurface': 'Road strips and joins are clipped against terrain facets; asphalt is lifted 0.065m above the exact triangular terrain surface. Runtime heightAt, rather than stored point y, is authoritative for placement.'},
    'home': home, 'route': {k: v for k, v in route.items() if k not in {'points', 'cumulativeDistances'}},
    'roadGraph': {'nodes': len(connected), 'edges': len(geo_edges), 'roadPolylines': len(roads),
        'junctionRule': 'Shared OSM node IDs only; geometric crossings never create connections.',
        'beverlyWayId': 20686958, 'beverlyJunctions': [221872780, 221872784],
        'beverlyConnectsTo': 'West Ridge Road at both ends', 'bridges': [r['id'] for r in roads if r['bridge']]},
    'sources': [{'name': 'OpenStreetMap current API extract', 'url': retrieval.get('sourceUrl', retrieval.get('overpass')),
        'license': 'ODbL 1.0', 'copyright': '© OpenStreetMap contributors', 'licenseUrl': 'https://www.openstreetmap.org/copyright'},
        {'name': 'Nominatim house-level address verification', 'url': 'https://nominatim.openstreetmap.org/search?q=2+Beverly+Dr%2C+Warwick%2C+NY+10990&format=jsonv2&addressdetails=1'},
        {'name': 'USGS 3DEP current elevation export', 'url': read('elevation-export.json')['request'], 'license': 'Public domain'}],
    'adjustments': ['Residential roads rendered 10.5m wide and primary/secondary roads 13m wide for arcade driving; OSM centerlines unchanged.',
        'Road samples densified to <=12m spacing without moving original vertices or junctions.',
        'Terrain resampled to ~30m grid to soften small bumps; road heights use same surface.',
        'Stored point heights are bilinear source samples. Runtime road strips and joins are clipped against terrain facets and use exact triangle interpolation with a 0.065m asphalt lift. Runtime terrain sampling is authoritative for spawn placement; minor differences from stored point y are expected.',
        'Map clipped by retaining connected source segments inside bounds with a 30m terrain margin; roads deliberately end at map edge.',
        'Home is a roadside spawn ~20m from the address point; exact driveway connection is not established.',
        f'Initial OSM import included {approximate_houses} explicitly flagged generic house envelopes at address points; the Beverly pass replaces those inside its reference bounds. Missing OSM heights default to 6m; roof, material, yards and vegetation appearance remain approximations except for documented reference overrides.',
        'Runtime buildings use rotated oriented envelopes. Colliders are conservatively shrunk or omitted where envelopes encroach on widened roads; real source footprints remain unchanged in this geographic database.',
        'No road-over-road overpass occurs on the race; mapped stream bridges keep explicit bridge/layer tags and shared-node topology.',
        'Race direction and width are gameplay choices, not a claim that public roads support racing.'],
    'attribution': attribution, 'rebuild': 'python scripts/map-build.py',
    'cacheSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SOURCE.glob('*')) if p.is_file()}}
from beverly_build import apply_survey
apply_survey(result, manifest, point)
from backyard_build import apply_backyard
apply_backyard(result, manifest)
roads, buildings, home = result['roads'], result['buildings'], result['home']
write('warwick.json', result)
write('manifest.json', manifest)

# Offline SVG route review, with genuine coordinates and named intersections.
W, H = 1120, 1220
scale = 950 / max(3800, 3900)
sx = lambda x: 560 + x * scale
sy = lambda z: 640 + z * scale
fmt_points = lambda ps: ' '.join(f'{sx(p[0]):.1f},{sy(p[2]):.1f}' for p in ps)
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
       '<rect width="100%" height="100%" fill="#0c1822"/>',
       '<style>text{font-family:Segoe UI,Arial,sans-serif;fill:#e8f1f3}.label{font-size:12px;paint-order:stroke;stroke:#0c1822;stroke-width:4px;stroke-linejoin:round}.small{font-size:15px;fill:#a8bcc4}</style>',
       '<text x="42" y="48" font-size="30" font-weight="700">WARWICK / RIDGE &amp; HOLLOW</text>',
       f'<text class="small" x="42" y="80">Verified connected circuit · {route["lengthMeters"]/1000:.2f} km × 3 laps · clockwise</text>',
       '<text class="small" x="42" y="106">Home on Beverly Drive. OSM centerlines + USGS 3DEP terrain. North is up.</text>',
       '<path d="M1040 122l-8 22h16z" fill="#dfe9df"/><text x="1034" y="114" font-size="14">N</text>']
for building in buildings:
    svg.append(f'<polygon points="{fmt_points(building["points"])}" fill="#253b40"/>')
for road in roads:
    svg.append(f'<polyline points="{fmt_points(road["points"])}" fill="none" stroke="#637477" stroke-width="{3 if road["highway"]=="primary" else 2}" stroke-linecap="round" stroke-linejoin="round"/>')
svg.append(f'<polyline points="{fmt_points(route_points)}" fill="none" stroke="#ffbe58" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
label_names = {'Beverly Drive', 'West Ridge Road', 'Old Ridge Road', 'High Hill Avenue', 'Claire Ann Drive', 'Seward Highway', 'Sleepy Valley Road', 'Pine Island Turnpike', 'Locust Street', 'Maple Avenue', 'Ridgeway Loop'}
seen_names = set()
for road in roads:
    if road['name'] in label_names and road['name'] not in seen_names:
        p = road['points'][len(road['points']) // 2]
        svg.append(f'<text class="label" x="{sx(p[0])+6:.1f}" y="{sy(p[2])-7:.1f}">{html.escape(road["name"])}</text>')
        seen_names.add(road['name'])
for i in range(18, len(route_points)-2, 40):
    a, b = route_points[i], route_points[i+1]
    angle = math.degrees(math.atan2(b[2]-a[2], b[0]-a[0]))
    svg.append(f'<path d="M-6 -5L3 0L-6 5" transform="translate({sx(a[0]):.1f} {sy(a[2]):.1f}) rotate({angle:.1f})" fill="none" stroke="#152029" stroke-width="2"/>')
hp, rp = home['position'], route_points[0]
svg.extend([f'<circle cx="{sx(hp[0]):.1f}" cy="{sy(hp[2]):.1f}" r="7" fill="#75e1cf" stroke="#fff" stroke-width="2"/>',
    f'<text class="label" x="{sx(hp[0])+10:.1f}" y="{sy(hp[2])+18:.1f}">HOME</text>',
    f'<rect x="{sx(rp[0])-6:.1f}" y="{sy(rp[2])-6:.1f}" width="12" height="12" fill="#fff" stroke="#0c1822" stroke-width="2"/>',
    f'<text class="label" x="{sx(rp[0])+10:.1f}" y="{sy(rp[2])+18:.1f}">START / FINISH</text>',
    '<text class="small" x="42" y="1153">Route: Old Ridge Rd · High Hill Ave · Claire Ann Dr · Seward Hwy · mapped connector</text>',
    '<text class="small" x="42" y="1185">Map data © OpenStreetMap contributors · openstreetmap.org/copyright · ODbL 1.0</text>',
    '<text class="small" x="42" y="1207">Elevation: USGS 3DEP, public domain. Retrieved '+html.escape(retrieval['retrievedAt'][:10])+'. Scenery is approximate.</text></svg>'])
(OUT / 'route-preview.svg').write_text('\n'.join(svg), encoding='utf-8')

# Meaningful geographic invariants: every race edge really belongs to the graph;
# laps close by shared source node, and Home remains close to its source street.
assert circuit[0] == circuit[-1]
assert all((a, b) in edges for a, b in zip(circuit, circuit[1:]))
assert all(inside(p[0], p[2]) for p in route_points)
assert home['distanceToAddressMeters'] < 40
assert all(abs(p[1] - height(p[0], p[2])) < .01 for r in roads for p in r['points'])
assert max(math.hypot(b[0]-a[0], b[2]-a[2]) for a,b in zip(route_points,route_points[1:])) <= 12.01
print(f'Built {len(roads)} connected roads, {len(buildings)} buildings ({sum(bool(b.get("footprintApproximate")) for b in buildings)} approximate address-point envelopes), {len(connected)} graph nodes.')
print(f'Route: {route["lengthMeters"]:.0f}m clockwise, {len(route_points)} samples, {len(checkpoints)} checkpoints, 3 laps.')
print(f'Home: {home}. Ground datum: {HOME_ELEVATION:.1f}m. All geographic invariants passed.')
