"""Apply the measured Beverly reference area to the cached game map, offline.

NYS footprints retain their individual source dates. Facade colors are only
specified for photographs actually inspected; other colors remain provisional.
"""
from pathlib import Path
import json, math, hashlib

ROOT=Path(__file__).resolve().parents[1]
RESEARCH=ROOT/'docs'/'research-beverly'
LAT,LON=41.283879,-74.3662393
MX=111320*math.cos(math.radians(LAT))
BOUNDS={'minX':-334,'maxX':94,'minZ':-389,'maxZ':241}

def read(name): return json.loads((RESEARCH/name).read_text(encoding='utf-8'))
def local(p): return [(p[0]-LON)*MX,(LAT-p[1])*111320]
def rings(g): return [g['coordinates'][0]] if g['type']=='Polygon' else [p[0] for p in g['coordinates']]
def contains(p,poly):
    x,z=p; result=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]: result=not result
    return result
def in_bounds(p): return BOUNDS['minX']<=p[0]<=BOUNDS['maxX'] and BOUNDS['minZ']<=p[1]<=BOUNDS['maxZ']
def near_road(roads,x,z):
    best=None
    for road in roads:
        for a,b in zip(road['points'],road['points'][1:]):
            dx,dz=b[0]-a[0],b[2]-a[2]
            t=max(0,min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz or 1)))
            p=[a[0]+dx*t,a[2]+dz*t]; d=math.dist([x,z],p)
            if best is None or d<best[0]:best=(d,p,road)
    return best

FACADE={
 22:{'wallColor':0xa49e91,'trimColor':0xf0eee5,'shutterColor':0x30332f,'doorColor':0xd8d6cc,'roofColor':0x5a5650,'frontGable':'small','bayWindow':'left'},
 26:{'wallColor':0xd9dfe0,'trimColor':0xf4f2e9,'shutterColor':0x37332e,'doorColor':0xe7e9e2,'roofColor':0x6a6b67,'frontGable':'small'},
 29:{'wallColor':0xa59f95,'trimColor':0xdfdfd5,'doorColor':0xdcdcd2,'roofColor':0x494b49,'stoneLower':True,'bayWindow':'right'},
 34:{'wallColor':0xe3e0d3,'trimColor':0xf2eee4,'shutterColor':0x768276,'doorColor':0xe1dfd4,'roofColor':0x827765,'porch':True},
 35:{'wallColor':0xd8c9a9,'trimColor':0xeee8d8,'shutterColor':0x584435,'doorColor':0x3d9290,'roofColor':0x5d5448},
 41:{'wallColor':0xe7e2cf,'trimColor':0xf5f2e9,'shutterColor':0x263b32,'doorColor':0x713738,'roofColor':0x747570,'frontGable':'large'},
}

def apply_survey(data,manifest,point):
    if not (RESEARCH/'east-observations.json').exists():
        raise RuntimeError('Beverly reference cache missing. Restore docs/research-beverly.')
    east,west=read('east-observations.json'),read('west-observations.json')
    parcels=read('parcels-local.geojson')['features']
    footprints=read('footprints-local.geojson')['features']
    loop=read('verified-loop-extent.json')
    roads=data['roads']
    # Use observed pavement width locally. Road centerline/topology remain OSM.
    for road in roads:
        if road['name']=='Beverly Drive':
            road.update(width=9.2,markings='none',shoulderWidth=.25,surveyed=True)
    # Split West Ridge visually at cached sample boundaries to avoid claiming a
    # measurement for the road far outside the inspected neighborhood.
    split=[]
    for road in roads:
        if road['name']!='West Ridge Road': split.append(road);continue
        parts=[];current=[];previous=None
        for a,b in zip(road['points'],road['points'][1:]):
            inside=in_bounds([(a[0]+b[0])/2,(a[2]+b[2])/2])
            if previous is not None and inside!=previous:
                parts.append((previous,current));current=[]
            if not current:current=[a]
            current.append(b);previous=inside
        if current:parts.append((previous,current))
        for i,(inside,points) in enumerate(parts):
            piece={**road,'id':str(road['id'])+f'-reference-{i}','points':points}
            if inside:piece.update(width=9.2,markings='none',shoulderWidth=.35,surveyed=True)
            split.append(piece)
    data['roads']=roads=split

    buildings=[];observations=[]
    for f in footprints:
        geo=rings(f['geometry'])[0]
        center=[sum(p[i] for p in geo[:-1])/(len(geo)-1) for i in [0,1]]
        p=local(center)
        if not in_bounds(p):continue
        parcel=next((s for s in parcels if any(contains(center,r) for r in rings(s['geometry']))),None)
        props=parcel['properties'] if parcel else {}
        address=props.get('PARCEL_ADDR','Unmatched footprint')
        poly=list(map(local,geo)); area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:])))/2
        styleName=props.get('BLDG_STYLE_DESC','') or ''
        style={'Raised ranch':'raised-ranch','Split level':'raised-ranch','Colonial':'colonial','Cape cod':'cape','Ranch':'ranch'}.get(styleName,'ranch')
        utility=area<95
        h=2.65 if utility else {'raised-ranch':4.0,'colonial':5.4,'cape':3.4,'ranch':2.9}[style]
        reference={'style':'ranch' if utility else style,'stories':2 if style=='colonial' and not utility else 1,
          'roofType':'gable','roofRise':1.0 if utility else 2.5 if style=='cape' else 1.65,
          'porch':False,'dormers':False,'chimney':False,'suppressGenericYard':True,'garageDoors':0,
          'roofColor':0x696c69}
        number=int(address.split()[0]) if address.split()[0].isdigit() else None
        photographed='Beverly' in address and number in FACADE and not utility
        if photographed:reference.update(FACADE[number])
        else:reference['wallColor']=0xc9c7bc # Explicit neutral placeholder; not inferred paint.
        kind='garage' if utility and area>40 else 'shed' if utility else 'house'
        if utility:reference.update(garageDoors=2 if area>60 else 1,wallColor=0xc6c6bd)
        building={'id':'nys-'+str(f['id']),'points':[point(*q) for q in poly],
            'center':point(*p),'height':h/.72,'wallHeight':h,'kind':kind,
            'addressStreet':props.get('LOC_STREET',''),'address':address,'reference':reference,
            'approximate':False,'source':'NYS Building Footprints / Orange County GIS',
            'sourceDate':f['properties'].get('SOURCEDATE','unspecified'),
            'appearanceConfidence':'Photo-observed facade; geometry and heights approximate' if photographed else 'Footprint and parcel style supported; paint and facade details unverified',
            'footprintApproximate':False}
        buildings.append(building)
        nr=near_road(roads,*p)
        observations.append({'id':building['id'],'address':address,'center':building['center'],
            'areaMeters2':round(area,1),'style':styleName,'sourceDate':building['sourceDate'],
            'roadCenterDistanceMeters':round(nr[0],1),'photographedFacade':photographed,
            'appearanceConfidence':building['appearanceConfidence']})
    original=data['buildings']
    retained=[]
    for b in original:
        ps=b.get('points',[])
        if not ps:continue
        c=[sum(p[i] for p in ps)/len(ps) for i in [0,2]]
        if not in_bounds(c):retained.append(b)
    data['buildings']=retained+buildings
    driveways=east['driveways']+west['driveways']
    # Paved mouths start at the observed edge. Extend only the first span to
    # the unchanged OSM pavement edge if its alignment differs by <=6m.
    for driveway in driveways:
        driveway['surveyPoints']=driveway['points'][:]
        start=driveway['points'][0]; nr=near_road(roads,*start)
        if nr[0] < nr[2]['width']/2+6:
            driveway['points']=[nr[1]]+driveway['points']
    loopPoints=[]
    for a,b in zip(loop['pointsXZ'],loop['pointsXZ'][1:]):
        steps=max(1,math.ceil(math.dist(a,b)/8))
        loopPoints += [point(a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps) for i in range(steps)]
    loopPoints.append(loopPoints[0])
    survey={'schemaVersion':1,'name':'Beverly Drive reference area','bounds':BOUNDS,
        'sourceImageYear':2025,'retrievedDate':'2026-09-20',
        'driveways':driveways,'canopies':east['canopies']+west['canopies'],
        'woodlands':west['woodlands'],'landcover':west['landcover'],
        'loop':{'name':'Beverly neighborhood loop','points':loopPoints,
            'lengthMeters':round(loop['lengthMeters'],2),'sourceWays':loop['sourceWays']},
        'buildingObservations':observations,
        'sources':[
            {'name':'NYS 2025 orthoimagery','url':'https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer'},
            {'name':'NYS Building Footprints','url':'https://gisservices.its.ny.gov/arcgis/rest/services/BuildingFootprints/MapServer'},
            {'name':'NYS public tax parcels','url':'https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcels_Public/FeatureServer'},
            {'name':'Inspected exterior photographs','url':'../../docs/research-streetview/exterior-observations.md'}],
        'limits':['Ground photographs verified only for numbers22,26,29,34,35,41. Other paint colors remain provisional.',
          'Footprints have mixed source dates, chiefly2013; manually crosschecked against2025orthophoto.',
          'Driveway lines are visual estimates; number2 is only a visible mouth stub because its middle is tree-obscured.',
          'Canopy centers approximate trunks. Woodland stems and exact species/heights remain representative.',
          'OSM centerlines retained,9.2m pavement reflects observed local cross-sections; ground grade remains USGS30m DEM.']}
    data['beverlySurvey']=survey
    data['attribution']+=' Beverly reference: NYS Geospatial Services / Orange County GIS.'
    manifest['beverlySurvey']={k:v for k,v in survey.items() if k not in ['driveways','canopies','woodlands','landcover','buildingObservations']}
    manifest['beverlySurvey']['counts']={'footprints':len(buildings),'driveways':len(driveways),'canopies':len(survey['canopies']),'photoFacades':sum(b['photographedFacade'] for b in observations)}
    manifest['beverlySurvey']['cacheSha256']={name:hashlib.sha256((RESEARCH/name).read_bytes()).hexdigest() for name in ['footprints-local.geojson','parcels-local.geojson','east-observations.json','west-observations.json','verified-loop-extent.json']}
    manifest['adjustments'].append('Beverly reference area supersedes generic scenery: state footprints replace address envelopes, pavement9.2m with no invented centerline, observed driveway paths/canopy concentrations; unknown facades explicitly provisional.')
    (ROOT/'public/map/beverly-survey.json').write_text(json.dumps(survey,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Beverly:',manifest['beverlySurvey']['counts'])
