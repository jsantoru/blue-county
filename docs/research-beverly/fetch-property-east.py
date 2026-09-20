"""Fetch bounded official aerial comparisons for Home; never changes the game map."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import datetime, json, math, urllib.parse, urllib.request

ROOT=Path(__file__).resolve().parent
LAT,LON=41.283879,-74.3662393
SX=111320*math.cos(math.radians(LAT))
def merc(x,z):
    lo=LON+x/SX;la=LAT-z/111320
    return lo*math.pi/180*6378137,math.log(math.tan(math.pi/4+la*math.pi/360))*6378137
def fetch(year):
    a=merc(-38,48);b=merc(38,-24)
    service=f'https://orthos.its.ny.gov/arcgis/rest/services/wms/{year}/MapServer'
    params={'f':'json','bbox':','.join(map(str,[*a,*b])),'bboxSR':3857,'imageSR':3857,
            'size':'1100,1042','format':'jpg','transparent':'false','dpi':96}
    url=service+'/export?'+urllib.parse.urlencode(params)
    meta=json.load(urllib.request.urlopen(url,timeout=90))
    if 'error' in meta: return {'year':year,'error':meta['error']}
    image=urllib.request.urlopen(meta['href'].replace('http:','https:'),timeout=90).read()
    name=f'property-home-{year}'
    (ROOT/f'{name}.jpg').write_bytes(image)
    meta.update(source=url,service=service,vintage=f'Spring {year}',localBounds={'minX':-38,'maxX':38,'minZ':-24,'maxZ':48},
                inspectedDate='2026-09-20',retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                credit='NYS ITS Geospatial Services / NYSDOP',note='Export is oversampled for inspection; it does not increase native image detail.')
    (ROOT/f'{name}-georeference.json').write_text(json.dumps(meta,indent=2))
    return {'year':year,'bytes':len(image),'image':name+'.jpg'}

if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(fetch,[2025,2021,2016,2013,2010]):print(result)
