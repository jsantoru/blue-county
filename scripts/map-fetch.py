"""Explicitly refresh cached open map sources. Never runs during gameplay.

Requires Python 3.10+ and Pillow: python -m pip install Pillow
Run: python scripts/map-fetch.py && python scripts/map-build.py
The build command alone is offline and needs only Python's standard library.
"""
import datetime
import json
import math
import pathlib
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

try:
    from PIL import Image
except ImportError:
    raise SystemExit('Source refresh needs Pillow to decode USGS Float32 GeoTIFF: python -m pip install Pillow. Cached builds do not need Pillow.')

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'map' / 'source'
OUT.mkdir(parents=True, exist_ok=True)
HEADERS = {'User-Agent': 'Warwick442-LocalGame-MapPreparation/1.0 (offline personal game; explicit single extract)'}
LAT, LON = 41.283879, -74.3662393
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat()


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90) as response:
        return response.read()


def save(name, value):
    (OUT / name).write_text(json.dumps(value, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')


geocoder = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({
    'q': '2 Beverly Dr, Warwick, NY 10990', 'format': 'jsonv2', 'addressdetails': 1})
matches = json.loads(get(geocoder))
match = next((m for m in matches if m.get('address', {}).get('house_number') == '2'
              and m.get('address', {}).get('road') == 'Beverly Drive'
              and m.get('address', {}).get('postcode') == '10990'), None)
if not match:
    raise SystemExit('House-level address match disappeared; review the source instead of using a street centroid.')
offset = math.hypot((float(match['lat']) - LAT) * 111320,
                    (float(match['lon']) - LON) * 111320 * math.cos(math.radians(LAT)))
if offset > 25:
    raise SystemExit(f'House-level address moved {offset:.1f}m; review anchor before updating.')
save('nominatim-anchor.json', matches)

osm_url = 'https://api.openstreetmap.org/api/0.6/map?bbox=-74.389,41.266,-74.343,41.3018'
xml = get(osm_url)
tree = ET.fromstring(xml)
elements = []
for element in tree:
    if element.tag not in {'node', 'way'}:
        continue
    item = {'type': element.tag, 'id': int(element.attrib['id']),
            'tags': {tag.attrib['k']: tag.attrib['v'] for tag in element.findall('tag')}}
    if element.tag == 'node':
        item.update(lat=float(element.attrib['lat']), lon=float(element.attrib['lon']))
    else:
        item['nodes'] = [int(n.attrib['ref']) for n in element.findall('nd')]
    elements.append(item)
anchor = next((n for n in elements if n['type'] == 'node' and n['id'] == 8788896022), None)
if not anchor or anchor['tags'].get('addr:housenumber') != '2':
    raise SystemExit('The expected OSM house address node is absent or changed; inspect before rebuilding.')
(OUT / 'osm-api.xml').write_bytes(xml)
save('osm-neighborhood.json', {'elements': elements})

service = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'
save('usgs-service.json', json.loads(get(service + '?f=json')))
factor = 111320 * math.cos(math.radians(LAT))
bbox = [LON - 2100 / factor, LAT - 2100 / 111320, LON + 2100 / factor, LAT + 2100 / 111320]
export_url = service + '/exportImage?' + urllib.parse.urlencode({
    'bbox': ','.join(map(str, bbox)), 'bboxSR': 4326, 'imageSR': 4326,
    'size': '257,341', 'format': 'tiff', 'pixelType': 'F32',
    'interpolation': 'RSP_BilinearInterpolation', 'noData': -9999, 'f': 'json'})
export = json.loads(get(export_url))
save('elevation-export.json', {'request': export_url, 'response': export})
(OUT / 'elevation.tiff').write_bytes(get(export['href']))
image = Image.open(OUT / 'elevation.tiff')
heights = list(image.get_flattened_data()) if hasattr(image, 'get_flattened_data') else list(image.getdata())
if not all(math.isfinite(v) and -100 < v < 1000 for v in heights):
    raise SystemExit('USGS export includes invalid heights; do not rebuild until the elevation source is inspected.')
save('elevation-grid.json', {'cols': image.width, 'rows': image.height, 'heights': heights})
save('retrieval.json', {'retrievedAt': NOW, 'sourceUrl': osm_url, 'method': 'OSM map API bounding-box extract',
                      'bounds': [-74.389, 41.266, -74.343, 41.3018], 'nominatim': geocoder,
                      'usgs': service, 'elevationExport': export_url})
print(f'Cached {len(elements)} OSM elements and {image.width}×{image.height} USGS heights. Run python scripts/map-build.py.')
