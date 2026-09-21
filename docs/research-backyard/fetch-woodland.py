"""Bounded official aerial exports for the woods east of Home; research only."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import datetime, hashlib, json, math, urllib.parse, urllib.request

ROOT = Path(__file__).resolve().parent
LAT, LON = 41.283879, -74.3662393
SX = 111320 * math.cos(math.radians(LAT))

def merc(x, z):
    lon, lat = LON + x/SX, LAT-z/111320
    return lon*math.pi/180*6378137, math.log(math.tan(math.pi/4+lat*math.pi/360))*6378137

def fetch(year):
    south_west, north_east = merc(-12, 105), merc(178, -105)
    service = f'https://orthos.its.ny.gov/arcgis/rest/services/wms/{year}/MapServer'
    parameters = {'f':'json', 'bbox':','.join(map(str, [*south_west,*north_east])),
                  'bboxSR':3857, 'imageSR':3857, 'size':'1448,1600',
                  'format':'jpg','transparent':'false','dpi':96}
    url = service+'/export?'+urllib.parse.urlencode(parameters)
    response = json.load(urllib.request.urlopen(url, timeout=90))
    if 'error' in response: raise RuntimeError(response['error'])
    image = urllib.request.urlopen(response['href'].replace('http:','https:'), timeout=90).read()
    name = f'woodland-{year}'
    (ROOT / f'{name}.jpg').write_bytes(image)
    response.update(source=url, service=service, vintage=f'Spring {year}',
        requestedLocalBounds={'minX':-12,'maxX':178,'minZ':-105,'maxZ':105},
        retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        sha256=hashlib.sha256(image).hexdigest(), credit='NYS ITS Geospatial Services / NYSDOP',
        note='Returned EPSG:3857 extent is authoritative. Oversampling does not increase native detail. Research reference, not a game texture.')
    (ROOT / f'{name}-georeference.json').write_text(json.dumps(response, indent=2), encoding='utf-8')
    return {'year':year, 'bytes':len(image), 'image':f'{name}.jpg'}

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(fetch, [2025, 2013]): print(result)
