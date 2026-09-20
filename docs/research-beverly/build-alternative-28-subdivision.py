"""Reproduce the accepted source-preserving #28 rendering split and terrace.

This writes research inputs only; the property compiler applies the split.
"""
from pathlib import Path
import json, math, runpy

ROOT=Path(__file__).resolve().parent
audit=runpy.run_path(str(ROOT/'audit-property-east.py'))
mapdata=json.loads((ROOT.parents[1]/'public/map/warwick.json').read_text())
building={**next(b for b in mapdata['buildings'] if b.get('id')=='nys-7159159'),'renderParts':None}
joined=json.loads((ROOT/'footprints-address-join.json').read_text())
source=[p[:] for p in next(b for b in joined['buildings'] if b['buildingObjectId']==7159159)['points']]
if source[0]==source[-1]:source.pop()
compiled=[[p[0],p[2]] for p in building['points']]
if compiled[0]==compiled[-1]:compiled.pop()
assert source==compiled, 'Original NYS footprint must remain unchanged in compiled map'
raw=json.loads((ROOT/'footprints-local.geojson').read_text())
raw_points=next(f for f in raw['features'] if f['id']==7159159)['geometry']['coordinates'][0][:-1]
raw_local=[[(p[0]+74.3662393)*111320*math.cos(math.radians(41.283879)),(41.283879-p[1])*111320] for p in raw_points]
source_error=max(math.dist(a,b) for a,b in zip(source,raw_local))
assert len(source)==len(raw_local) and source_error<0.001, 'Source rounding must stay below one millimeter'
A,B,C,D,E,F=source
u=[A[i]-B[i] for i in [0,1]];v=[E[i]-D[i] for i in [0,1]];w=[D[i]-B[i] for i in [0,1]]
cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
t=cross(w,v)/cross(u,v)
G=[B[i]+t*u[i] for i in [0,1]]
parts=[[B,C,D,G],[G,E,F,A]]
meta=json.loads((ROOT/'alternative-28-2025-georeference.json').read_text());e=meta['extent']
full=json.loads((ROOT/'ortho2025-export-georeference.json').read_text());fe=full['extent']
SX=111320*math.cos(math.radians(41.283879))
def local(pixel):
    mx=e['xmin']+pixel[0]/meta['width']*(e['xmax']-e['xmin'])
    my=e['ymax']-pixel[1]/meta['height']*(e['ymax']-e['ymin'])
    lon=mx/6378137*180/math.pi;lat=(2*math.atan(math.exp(my/6378137))-math.pi/2)*180/math.pi
    return [(lon+74.3662393)*SX,(41.283879-lat)*111320]
def fullpixel(pixel):
    mx=e['xmin']+pixel[0]/meta['width']*(e['xmax']-e['xmin'])
    my=e['ymax']-pixel[1]/meta['height']*(e['ymax']-e['ymin'])
    return [(mx-fe['xmin'])/(fe['xmax']-fe['xmin'])*full['width'],(fe['ymax']-my)/(fe['ymax']-fe['ymin'])*full['height']]
pixels=[[290,390],[319,434],[354,448],[408,444],[447,425],[424,557],[403,585],[310,560]]
terrace=list(map(local,pixels))
area,triangles,intersection=audit['area'],audit['triangles'],audit['intersection']
overlap=lambda p,boxes:sum(area(intersection(t,b)) for t in triangles(p) for b in boxes)
old=next(b for b in audit['envelopes']({**mapdata,'buildings':[building]}) if b['id']=='nys-7159159')
temporary={**mapdata,'buildings':[{**building,'id':f'proposal-28-part-{i}','points':[[p[0],0,p[1]] for p in part+[part[0]]]} for i,part in enumerate(parts)]}
part_envelopes=audit['envelopes'](temporary)
result={'status':'Accepted implementation input: retain the original NYS footprint and render the two source-derived wings; terrace is included in reproducible west observations. No map or distribution rebuild is performed by this script.',
        'address':'28 Beverly Dr','sourceBuildingId':'nys-7159159','sourceDate':building.get('sourceDate'),
        'coordinateSystem':'local-meters-x-east-z-south','originalFootprint':source,
        'method':'Extend the short inward edge D→E to its intersection G with the opposite A↔B edge. Split across G–E. The two quadrilaterals exactly partition the original L-shaped source footprint; their tiny deviations from rectangles are retained, not snapped away.',
        'splitPoint':G,'parts':[{'id':f'28-{name}','points':part,'entrance':i==1} for i,(name,part) in enumerate(zip(['north-crossbar','south-stem'],parts))],
        'renderPartsMetadata':{'sourceFootprintPreserved':True,'pointConvention':'Unclosed local X/Z quadrilaterals; compiler closes each and samples terrain to produce runtime X/Y/Z points.',
          'sharedFloorHeight':True,'sharedAppearanceId':'nys-7159159','sourceValidatedAgainst':'footprints-local.geojson and footprints-address-join.json',
          'aerialPositionCheck':'The north crossbar and east/south stem match the L-shaped roof arrangement in 2013, 2016, 2021 and 2025 imagery. Source age, roof overhang and image displacement remain; positions are not snapped to the 2025 roof.',
          'status':'accepted'},
        'renderNotes':'Reuse the same facade style/material on both parts. Do not render a duplicate wall along shared G–E. Roof ridge/valley/height treatment remains approximate. OBB per part introduces only small source-rounding differences; original NYS polygon remains authoritative.',
        'terrace':{'id':'beverly-28-patio','address':'28 Beverly Dr','kind':'patio','geometryType':'polygon',
          'sourceId':'nysdop-2025-alternative-28','sourceImage':'alternative-28-2025.jpg','georeference':'alternative-28-2025-georeference.json',
          'sourcePixels':pixels,'fullImagePixels':list(map(fullpixel,pixels)),'points':terrace,
          'evidence':'observed','confidence':'high','heightMeters':0.04,'surface':'paving',
          'notes':'Exposed pale hardscape between the pool and the L-shaped roof recess. Furniture and perimeter are separately visible in 2016, 2021 and 2025. Approximate edge uncertainty 0.75–1.5m; platform/grade height is not measurable from nadir imagery. Only exposed surface is traced; shaded strip directly against the roof is omitted.',
          'supportingImages':['alternative-28-2013.jpg','alternative-28-2016.jpg','alternative-28-2021.jpg']},
        'audit':{'sourceRoundingMaxErrorMeters':source_error,'sourceAreaMeters2':area(source),'partsAreaMeters2':sum(area(p) for p in parts),
          'partsOverlapMeters2':overlap(parts[0],[parts[1]]),'oldEnvelopeAreaMeters2':area(old['points']),
          'newEnvelopeSumAreaMeters2':sum(area(p['points']) for p in part_envelopes),
          'terraceAreaMeters2':area(terrace),'terraceSourceOverlapMeters2':overlap(terrace,parts),
          'terraceOldEnvelopeOverlapMeters2':overlap(terrace,[old['points']]),
          'terraceNewEnvelopesOverlapMeters2':overlap(terrace,[p['points'] for p in part_envelopes])}}
assert abs(result['audit']['sourceAreaMeters2']-result['audit']['partsAreaMeters2'])<1e-6
assert result['audit']['partsOverlapMeters2']<1e-6
assert result['audit']['terraceNewEnvelopesOverlapMeters2']<1e-6
(ROOT/'alternative-28-subdivision.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result['audit'],indent=2))
