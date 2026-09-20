"""Reproduce manually traced east-side property surfaces, without changing game data.

Pixel coordinates refer to original GIS exports, not resized screenshots. The
Home connector explicitly distinguishes historical visibility from 2025 canopy
occlusion. Roof/footprint ages and trace uncertainty remain in the output.
"""
from pathlib import Path
import json, math

ROOT=Path(__file__).resolve().parent
LAT,LON=41.283879,-74.3662393
SX=111320*math.cos(math.radians(LAT))
full=json.loads((ROOT/'ortho2025-export-georeference.json').read_text())
source_files={
    'east-south-2025':('home-east-south-2025.jpg','home-east-south-georeference.json',2025),
    'east-north-2025':('east-north-2025.jpg','east-north-georeference.json',2025),
    **{f'home-{year}':(f'property-home-{year}.jpg',f'property-home-{year}-georeference.json',year) for year in [2025,2021,2016,2013,2010]},
}
meta={k:json.loads((ROOT/v[1]).read_text()) for k,v in source_files.items()}
def transform(source,pixel):
    m=meta[source];e=m['extent']
    mx=e['xmin']+pixel[0]/m['width']*(e['xmax']-e['xmin'])
    my=e['ymax']-pixel[1]/m['height']*(e['ymax']-e['ymin'])
    lon=mx/6378137*180/math.pi
    lat=(2*math.atan(math.exp(my/6378137))-math.pi/2)*180/math.pi
    f=full['extent']
    return [round((lon-LON)*SX,3),round((LAT-lat)*111320,3)], [round((mx-f['xmin'])/(f['xmax']-f['xmin'])*full['width'],2),round((f['ymax']-my)/(f['ymax']-f['ymin'])*full['height'],2)]

out={'schemaVersion':1,'coordinateSystem':'local-meters-x-east-z-south','origin':{'lat':LAT,'lon':LON},
     'inspectedDate':'2026-09-20','method':'Manual source-image polygons and access lines. Approximate edges, typically 1–2m uncertainty; greater under shadow or canopy. No facade or property ownership inference.',
     'sources':[],'features':[],'excludedObservations':[],
     'limits':['Ground-cover outlines are not a survey. Historical visibility does not prove unchanged pavement today.',
               'Pool/deck presence and plan shape are observed; deck height, rails and pool wall height are approximate rendering choices, not aerial measurements.',
               'Pixel coordinates use each sourceId original image grid; fullImagePixels maps the same coordinates onto the existing 1800×2650 2025 overlay.',
               'Building polygons are older than the imagery. Rendering should preserve source footprints and avoid rendering surface polygons through house envelopes.']}
for id,(image,georef,year) in source_files.items():
    m=meta[id]
    out['sources'].append({'id':id,'url':m.get('source',f'https://orthos.its.ny.gov/arcgis/rest/services/wms/{year}/MapServer'),
        'imagePath':image,'georeferencePath':georef,'vintage':f'Spring {year}','width':m['width'],'height':m['height'],
        'pixelSizeMeters':round((m['extent']['xmax']-m['extent']['xmin'])/m['width']*math.cos(math.radians(LAT)),4),
        'credit':'NYS ITS Geospatial Services / NYSDOP','terms':'Public no-cost GIS access; as-is/no-warranty resource metadata. No CC0 claim; see findings.md. Reference image only, not a game texture.'})

def add(id,address,kind,source,pixels,confidence='high',evidence='observed',notes='',**extra):
    pairs=[transform(source,p) for p in pixels]
    feature={'id':id,'address':f'{address} Beverly Dr','kind':kind,'geometryType':'polygon','sourceId':source,
             'sourcePixels':pixels,'fullImagePixels':[p[1] for p in pairs],'points':[p[0] for p in pairs],
             'evidence':evidence,'confidence':confidence,'notes':notes,**extra}
    out['features'].append(feature)
    return feature

def driveway(address,source,pixels,centerline,width,confidence='high',notes='Visible paved approach and widened parking apron; edges are approximate under tree shadows.'):
    feature=add(f'east-driveway-{address}',address,'driveway',source,pixels,confidence,notes=notes,
        surface='asphalt',widthMeters=width,replacesDrivewayIds=[f'{address} Beverly Dr'])
    feature['centerlineSourcePixels']=centerline
    feature['centerlinePoints']=[transform(source,p)[0] for p in centerline]
    return feature

def ellipse(cx,cy,rx,ry,n=16):
    return [[round(cx+rx*math.cos(i*2*math.pi/n),2),round(cy+ry*math.sin(i*2*math.pi/n),2)] for i in range(n)]

# Home: 2010 is the clearest historical view of the curved driveway. The 2025
# evergreens hide it; do not call this contemporary visible pavement.
home_line=[[158,830],[247,815],[342,794],[431,769],[493,735],[540,684],[553,631],[551,586]]
home_connector=add('east-home-driveway-hidden',2,'driveway','home-2010',
    [[171,794],[249,783],[328,765],[410,742],[468,713],[508,673],[522,633],[565,637],
     [565,694],[527,753],[453,799],[355,828],[257,850],[151,862]],
    'medium','inferred-occluded',
    'Curved approach is visible in 2010 and corroborated in 2013. In 2025 the evergreen crowns obscure its mouth and middle. This preserves a historically supported usable connection, with uncertain present-day edges; estimated width 4.4m. The former 2025-only short stub was about 8m too far north.',
    surface='asphalt',widthMeters=4.4,replacesDrivewayIds=['2 Beverly Dr'],
    supportingSourceIds=['home-2013','home-2016','home-2021','home-2025'],currentVisibility='canopy-obscured',historicalEvidence='observed in 2010/2013')
home_connector['centerlineSourcePixels']=home_line[:7]
home_connector['centerlinePoints']=[transform('home-2010',p)[0] for p in home_line[:7]]
home_apron=add('east-home-driveway-apron',2,'driveway','home-2025',
    [[518,551],[587,570],[608,627],[646,673],[618,712],[573,679],[546,648],[520,621]],
    'medium',notes='Exposed paved parking/apron between the main house and detached garage. Western and southern margins partly disappear beneath evergreen crowns. The north edge stops beyond the apparent roof edge and well clear of the older state footprint.',
    surface='asphalt',widthMeters=5.2,replacesDrivewayIds=['2 Beverly Dr'])
home_apron['centerlineSourcePixels']=[[540,684],[553,631],[551,586]]
home_apron['centerlinePoints']=[transform('home-2025',p)[0] for p in home_apron['centerlineSourcePixels']]
out['home']={'connectionFeatureIds':[home_connector['id'],home_apron['id']],
    'drivewayCenterline':[transform('home-2010',p)[0] for p in home_line],
    'drivewayCenterlineSourceId':'home-2010','drivewayCenterlineSourcePixels':home_line,
    'status':'Historically observed connection; 2025 entry and middle obscured by evergreen crowns. Current exposed apron corroborates the destination.',
    'spawnRecommendation':{'positionXZ':transform('home-2025',[553,631])[0],'headingRadians':round(math.atan2(540-553,684-631),6),
        'confidence':'medium','kind':'driveway-apron','notes':'Optional spawn on exposed apron facing south-southwest toward the historical driveway exit. Root should validate 442 full chassis clearance and nearby retained tree stems before adopting. Existing roadside Home remains safe until that review.'}}

# Eastern limb: polygons include the visible turning/parking pads, not just constant-width centerlines.
driveway(4,'east-south-2025',[[450,1049],[492,1036],[534,1004],[576,963],[604,916],[620,880],[677,894],[731,900],[716,953],[706,989],[639,993],[600,1022],[548,1065],[513,1084],[458,1097]],[[451,1064],[507,1048],[563,1000],[607,952],[655,941]],4.3)
driveway(6,'east-south-2025',[[472,632],[576,628],[608,625],[642,612],[672,605],[714,606],[719,663],[687,679],[651,666],[600,667],[475,665]],[[475,647],[556,647],[622,645],[681,641]],4.4)
driveway(8,'east-south-2025',[[538,299],[614,296],[660,289],[691,279],[754,282],[785,298],[787,334],[750,335],[719,327],[652,327],[607,334],[540,335]],[[540,318],[617,314],[688,309],[756,310]],4.2)
driveway(9,'east-south-2025',[[404,369],[354,379],[304,383],[254,379],[210,366],[177,366],[168,406],[202,423],[273,419],[343,412],[400,412]],[[405,395],[331,397],[266,401],[204,396]],4.5)
driveway(7,'east-south-2025',[[399,671],[345,677],[299,671],[263,656],[256,644],[215,649],[216,688],[248,704],[310,702],[399,712]],[[399,686],[329,689],[275,681],[238,666]],3.7,'medium','Approach and apron visible, with parked vehicles and tree shadows obscuring small portions of the edges.')
driveway(5,'east-south-2025',[[380,906],[308,910],[236,919],[178,926],[134,924],[125,914],[82,916],[76,954],[95,974],[142,964],[189,950],[267,940],[380,928]],[[380,917],[283,927],[184,939],[110,943]],3.8)
driveway(10,'east-north-2025',[[583,1138],[644,1151],[701,1163],[723,1151],[723,1133],[781,1144],[807,1153],[810,1201],[756,1202],[682,1193],[622,1182],[575,1170]],[[582,1151],[662,1170],[734,1177],[783,1175]],3.7)
driveway(12,'east-north-2025',[[669,754],[736,764],[776,768],[802,756],[814,751],[853,758],[860,791],[851,800],[821,800],[788,795],[744,795],[663,789]],[[668,771],[739,781],[794,782],[836,784]],4.4)
driveway(14,'east-north-2025',[[704,496],[757,486],[804,470],[850,460],[883,460],[893,476],[892,517],[887,517],[886,498],[830,502],[792,514],[748,529],[703,537]],[[704,516],[767,500],[831,482],[881,483]],5.0,'medium','Broad apron along north of main house to detached garage; southern boundary next to main roof and eastern garage edge are shadowed.')
driveway(16,'east-north-2025',[[685,432],[744,418],[796,402],[843,395],[864,374],[901,369],[910,399],[930,415],[906,433],[864,435],[827,427],[780,433],[732,449],[690,457]],[[686,446],[753,430],[812,414],[871,416],[901,406]],3.6,'medium','Tree canopy hides part of the road-end approach; visible continuation and apron support its alignment. Widened southeast parking pad is included.')
driveway(17,'east-north-2025',[[477,324],[458,344],[439,361],[409,374],[413,394],[433,405],[456,381],[477,361],[502,344]],[[491,335],[468,356],[439,383]],4.0,'medium','Road-end and parking corners are partly shaded; polygon follows visible gray paving, avoiding the house roof.')
driveway(15,'east-north-2025',[[641,644],[602,648],[578,656],[563,649],[536,660],[527,681],[542,694],[561,682],[586,670],[611,666],[641,666]],[[643,656],[597,658],[563,672],[543,681]],3.2,'medium','Pale access strip and small pad are partly shadowed; surface could include gravel, and the eastern side-yard endpoint remains uncertain.')
driveway(13,'east-north-2025',[[602,844],[563,844],[538,853],[495,856],[459,855],[433,868],[416,883],[433,881],[453,887],[473,879],[508,878],[542,874],[597,879]],[[601,860],[552,861],[504,867],[467,869],[441,882]],3.7)
driveway(11,'east-north-2025',[[548,1065],[510,1064],[474,1058],[437,1048],[403,1045],[396,1054],[389,1084],[421,1092],[442,1085],[478,1087],[508,1093],[542,1099]],[[546,1080],[491,1076],[445,1071],[408,1075]],4.2)

# Pools are distinguished from small ambiguous circular backyard objects.
add('east-pool-6',6,'pool','east-south-2025',[[791,580],[810,582],[828,598],[842,606],[831,641],[813,672],[794,676],[773,663],[777,638],[782,609]],
    form='in-ground',surface='water',notes='Clearly visible irregular teal in-ground pool with surrounding pale paving. Outline follows the water, not the outer patio.',heightMeters=0.05)
add('east-patio-6',6,'patio','east-south-2025',[[752,555],[782,539],[815,546],[839,570],[858,612],[851,648],[829,680],[803,699],[775,696],[749,679],[731,654],[738,611]],
    confidence='medium',surface='paving',heightMeters=0.04,holesFeatureIds=['east-pool-6'],notes='Observed pool-surround hardscape. Exclude the pool polygon as a hole; paving pattern and height are approximate.')
add('east-pool-13',13,'pool','east-north-2025',ellipse(251,941,23,24),confidence='high',form='above-ground',surface='covered',heightMeters=1.15,
    notes='Dark covered circular pool with visible pale raised rim. Wall height is a plausible rendering value, not a measured height.')
add('east-pool-14',14,'pool','east-north-2025',ellipse(958,645,31,18),confidence='medium',form='above-ground',surface='water',heightMeters=1.15,
    notes='Visible blue oval pool and pale raised perimeter. Blue interior could include a cover; water treatment is provisional. Pool presence/outline is clearer than surface state.')
add('east-pool-16',16,'pool','east-north-2025',ellipse(915,150,26,27),form='above-ground',surface='water',heightMeters=1.15,
    notes='Round turquoise pool with prominent pale raised rim and adjacent small access deck. Wall height is approximate.')

add('east-deck-2',2,'deck','home-2025',[[666,331],[685,336],[696,390],[657,389]],confidence='medium',
    heightMeters=1.1,railEdges=[0,1,2],supportingSourceIds=['home-2016'],
    notes='Small rear/east platform is clearer in 2016 and partly visible in 2025 beside the recessed roof edge. Height and rail treatment are approximate; no unseen wraparound deck is added.')
add('east-deck-4',4,'deck','east-south-2025',[[724,830],[761,839],[758,873],[716,868]],confidence='medium',
    heightMeters=1.2,railEdges=[0,1,2],stairs={'edgeIndex':1,'widthMeters':1.1,'runMeters':2.2},
    notes='Visible rectangular rear platform and narrow east-running access/steps. Height is approximate; outline avoids the main house source polygon.')
add('east-deck-13-pool',13,'deck','east-north-2025',[[213,923],[229,926],[227,951],[211,948]],confidence='medium',
    heightMeters=1.1,railEdges=[0,2,3],notes='Small pale platform abutting west side of the covered round pool. Height/rails are approximate.')
add('east-deck-14-pool',14,'deck','east-north-2025',[[953,612],[975,613],[977,630],[953,629]],confidence='medium',
    heightMeters=1.1,railEdges=[0,1,3],notes='Small tan access platform at the north side of the oval pool. No connecting raised deck to the house is inferred.')
add('east-deck-16-pool',16,'deck','east-north-2025',[[944,132],[965,127],[972,157],[948,165]],
    heightMeters=1.1,railEdges=[0,1,2],notes='Visible tan access platform on east side of the round pool; height/rails are approximate.')

out['excludedObservations']=[
    {'address':'2 Beverly Dr','notes':'Circular pale backyard feature is not classified as a pool. No pool added at Home.'},
    {'address':'8 Beverly Dr','notes':'Small dark circular backyard object might be a hot tub or trampoline; not sufficiently resolved to create a pool.'},
    {'address':'16 Beverly Dr','notes':'Small dark circular object immediately beside the house is distinct from the clearly visible large round pool; excluded.'},
    {'address':'16 Beverly Dr','notes':'Narrow rear platform beside the house is partly visible, but its trace overlaps the older state footprint. Omitted rather than inventing a displaced deck; the distinct pool access deck is included.'},
    {'kind':'sign','notes':'No readable sign faces or verified sign-post coordinates were established from these aerials. Do not invent posted text or traffic controls from this file.'}]

if __name__=='__main__':
    (ROOT/'property-east-observations.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    # Code-native review overlay keeps the source photograph untouched.
    colors={'driveway':'#ffcc66','pool':'#51d4ff','deck':'#ff8eca','patio':'#bfe37b'}
    svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="2650" viewBox="0 0 1800 2650">',
         '<image href="beverly-2025-ortho.jpg" width="1800" height="2650"/>',
         '<g fill-opacity="0.13" stroke-width="2.4" font-family="sans-serif" font-size="14">']
    for f in out['features']:
        points=' '.join(','.join(map(str,p)) for p in f['fullImagePixels'])
        color=colors[f['kind']];dash=' stroke-dasharray="9 6"' if f['evidence']=='inferred-occluded' else ''
        svg.append(f'<polygon points="{points}" fill="{color}" stroke="{color}"{dash}><title>{f["id"]}: {f["evidence"]} / {f["confidence"]}</title></polygon>')
        x,z=f['fullImagePixels'][0]
        svg.append(f'<text x="{x+5}" y="{z-5}" fill="white" fill-opacity="1" stroke="black" stroke-width="3" paint-order="stroke">{f["address"].split()[0]} {f["kind"]}</text>')
    svg.append('</g></svg>')
    (ROOT/'property-east-overlay.svg').write_text('\n'.join(svg),encoding='utf-8')
    print('Saved',len(out['features']),'property features')
    print('Home',json.dumps(out['home']))
