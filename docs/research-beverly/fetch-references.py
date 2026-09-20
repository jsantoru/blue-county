"""Fetch a bounded, reproducible reference set; does not modify game data."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import datetime, json, math, urllib.parse, urllib.request

ROOT = Path(__file__).resolve().parent
LAT, LON = 41.283879, -74.3662393
SX = 111320 * math.cos(math.radians(LAT))
def lonlat(x, z): return LON+x/SX, LAT-z/111320
west, north = lonlat(-334, -389)
east, south = lonlat(94, 241)
bbox = [west, south, east, north]
requests = {}
def fetch(name, base, params=None):
    url = base + ('?' + urllib.parse.urlencode(params) if params else '')
    data = urllib.request.urlopen(url, timeout=90).read()
    (ROOT/name).write_bytes(data)
    requests[name] = url
    if name.endswith('.json') or name.endswith('.geojson'):
        obj=json.loads(data)
        return {'name':name, 'bytes':len(data), 'features':len(obj.get('features', [])), 'error':obj.get('error')}
    return {'name':name, 'bytes':len(data)}

def query_params(fields='*'):
    return {'f':'geojson','geometry':','.join(map(str,bbox)), 'geometryType':'esriGeometryEnvelope','inSR':4326,'outSR':4326,'spatialRel':'esriSpatialRelIntersects','outFields':fields,'returnGeometry':'true'}

if __name__ == '__main__':
    tasks = [
      ('footprints-local.geojson','https://gisservices.its.ny.gov/arcgis/rest/services/BuildingFootprints/FeatureServer/2/query',query_params()),
      ('footprints-orange-metadata.json','https://gisservices.its.ny.gov/arcgis/rest/services/BuildingFootprints/FeatureServer/1/query',{'f':'json','where':"NAME = 'Orange'",'outFields':'*','returnGeometry':'false'}),
      ('parcels-local.geojson','https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query',query_params('OBJECTID,PARCEL_ADDR,LOC_ST_NBR,LOC_STREET,LOC_ZIP,PRINT_KEY,SBL,YR_BLT,BLDG_STYLE_DESC,FRONT,DEPTH,ACRES')),
      ('ortho2025-boundary-layer.json','https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer/0',{'f':'pjson'}),
      ('ortho2025-boundary-at-home.json','https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer/0/query',{'f':'json','geometry':f'{LON},{LAT}','geometryType':'esriGeometryPoint','inSR':4326,'outFields':'*','returnGeometry':'false'}),
    ]
    with ThreadPoolExecutor(max_workers=5) as pool:
        for result in pool.map(lambda a:fetch(*a), tasks): print(result)
    def merc(lon,lat): return lon*20037508.342789244/180,math.log(math.tan((90+lat)*math.pi/360))*6378137
    mx0,my0=merc(west,south); mx1,my1=merc(east,north)
    w,h=1800,round(1800*(my1-my0)/(mx1-mx0))
    export={'f':'image','bbox':f'{mx0},{my0},{mx1},{my1}','bboxSR':3857,'imageSR':3857,'size':f'{w},{h}','format':'jpg','transparent':'false','dpi':96}
    print(fetch('beverly-2025-ortho.jpg','https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer/export',export))
    (ROOT/'fetched-reference-provenance.json').write_text(json.dumps({'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bboxWgs84':bbox,'localBounds':{'minX':-334,'maxX':94,'minZ':-389,'maxZ':241},'orthoImagePixels':[w,h],'imageGroundMetersPerPixel':428/w,'urls':requests},indent=2))
