"""Bounded official-vintage comparisons; research only, no trace or game edits."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import datetime, json, math, urllib.parse, urllib.request

ROOT=Path(__file__).resolve().parent
LAT,LON=41.283879,-74.3662393
SX=111320*math.cos(math.radians(LAT))
AREAS={20:(-65,0,-372,-300),28:(-227,-154,-301,-240),43:(-199,-139,-8,49)}
def merc(x,z):
    lo=LON+x/SX;la=LAT-z/111320
    return lo*math.pi/180*6378137,math.log(math.tan(math.pi/4+la*math.pi/360))*6378137
def fetch(task):
    number,year=task;minx,maxx,minz,maxz=AREAS[number]
    a=merc(minx,maxz);b=merc(maxx,minz);width=1100;height=round(width*(maxz-minz)/(maxx-minx))
    service=f'https://orthos.its.ny.gov/arcgis/rest/services/wms/{year}/MapServer'
    params={'f':'json','bbox':','.join(map(str,[*a,*b])),'bboxSR':3857,'imageSR':3857,
            'size':f'{width},{height}','format':'jpg','transparent':'false','dpi':96}
    url=service+'/export?'+urllib.parse.urlencode(params)
    meta=json.load(urllib.request.urlopen(url,timeout=90))
    if 'error' in meta:return {'address':number,'year':year,'error':meta['error']}
    image=urllib.request.urlopen(meta['href'].replace('http:','https:'),timeout=90).read()
    name=f'alternative-{number}-{year}'
    (ROOT/f'{name}.jpg').write_bytes(image)
    meta.update(source=url,service=service,vintage=f'Spring {year}',address=f'{number} Beverly Dr',
                localBounds={'minX':minx,'maxX':maxx,'minZ':minz,'maxZ':maxz},
                retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                credit='NYS ITS Geospatial Services / NYSDOP',
                note='Native original GIS export; requested pixel spacing is oversampled for inspection and does not increase image detail. Exact flight day not established.')
    (ROOT/f'{name}-georeference.json').write_text(json.dumps(meta,indent=2))
    return {'address':number,'year':year,'bytes':len(image),'image':name+'.jpg'}

if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(fetch,[(n,y) for n in AREAS for y in [2025,2021,2016,2013]]):print(result)
