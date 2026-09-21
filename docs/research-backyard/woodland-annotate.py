"""Convert manually inspected woodland ground-edge pixels into game metres."""
from pathlib import Path
import json, math

ROOT=Path(__file__).resolve().parent
LAT,LON=41.283879,-74.3662393
SX=111320*math.cos(math.radians(LAT))
meta=json.loads((ROOT/'woodland-2025-georeference.json').read_text())
extent=meta['extent'];width=meta['width'];height=meta['height']

def local(pixel):
    mx=extent['xmin']+pixel[0]/width*(extent['xmax']-extent['xmin'])
    my=extent['ymax']-pixel[1]/height*(extent['ymax']-extent['ymin'])
    lon=mx/6378137*180/math.pi
    lat=(2*math.atan(math.exp(my/6378137))-math.pi/2)*180/math.pi
    return [round((lon-LON)*SX,3),round((LAT-lat)*111320,3)]

# Follow the visible leaf-litter/maintained-lawn transition, not projected shadows.
# The southern edge is stopped north of the West Ridge road pavement. East and
# west lawns around the visible buildings are outside the polygon.
pixels=[
    [476,0],[1415,0],[1401,183],[1354,261],[1346,337],[1285,391],
    [1256,461],[1240,535],[1250,636],[1224,699],[1177,761],[1148,840],
    [1154,911],[1210,968],[1219,1002],[1080,1090],[977,1164],[859,1231],
    [748,1275],[657,1319],[618,1311],[610,1254],[575,1201],[511,1195],
    [470,1226],[437,1267],[395,1224],[373,1160],[365,1087],[395,1040],
    [358,1000],[349,942],[345,904],[370,854],[367,792],[385,746],
    [387,697],[423,647],[432,594],[422,544],[431,477],[448,421],
    [436,352],[416,292],[400,237],[410,194],[432,120],[440,65],
]
edge_pixels=[[432,594],[423,647],[387,697],[385,746],[367,792],
             [370,854],[345,904],[349,942],[358,1000],[395,1040],[365,1087]]
sources=[]
for year in [2025,2013]:
    ref=json.loads((ROOT/f'woodland-{year}-georeference.json').read_text())
    sources.append({'id':f'woodland-{year}','vintage':f'Spring {year}',
        'url':ref['source'],'imagePath':f'woodland-{year}.jpg',
        'georeferencePath':f'woodland-{year}-georeference.json','credit':ref['credit']})
data={
    'schemaVersion':1,'coordinateSystem':'local-meters-x-east-z-south',
    'origin':{'lat':LAT,'lon':LON},
    'bounds':{'minX':12,'maxX':178,'minZ':-105,'maxZ':105},
    'sources':sources,
    'woodlands':[{'id':'home-east-deciduous-woods','points':[local(p) for p in pixels],
        'sourceId':'woodland-2025','sourcePixels':pixels,'spacing':8.5,
        'type':'broadleaf','confidence':'medium-high','boundaryUncertaintyMeters':3,
        'notes':'Observed leaf-off wooded ground east of the Beverly back lawns, corroborated by 2013. Polygon follows litter/lawn edge and stops north of West Ridge pavement. Tree spacing is a representative rendering density, not a trunk survey. No property-boundary inference.'}],
    'canopies':[],
    'lawnWoodlandEdge':{'sourceId':'woodland-2025','sourcePixels':edge_pixels,
        'points':[local(p) for p in edge_pixels],'confidence':'medium-high',
        'notes':'Nearest Home rear-lawn boundary is approximately X36m at Z0, roughly 27m east of the rear main-house wall. It is irregular, with isolated edge limbs over the lawn.'},
    'limits':[
        'Overlapping leaf-off limbs and long shadows do not reliably separate individual crown centres. No surveyed trunk points or invented per-crown measurements are supplied.',
        'Broadleaf woodland is evident, but species, undergrowth composition, exact heights, and a legal boundary cannot be identified from aerial imagery.',
        'Top edge is a research-extent clip; this woodland continues north. Bounds include lawns, so procedural woodland must be restricted to the polygon.',
        'The 2013 comparison corroborates the gross wooded corridor; its lower image detail does not independently establish every 2025 edge vertex.',
    ],
}
(ROOT/'woodland-observations.json').write_text(json.dumps(data,indent=2),encoding='utf-8')

def pixel(point):
    x,z=point;lon=LON+x/SX;lat=LAT-z/111320
    mx=lon*math.pi/180*6378137;my=math.log(math.tan(math.pi/4+lat*math.pi/360))*6378137
    return ((mx-extent['xmin'])/(extent['xmax']-extent['xmin'])*width,
            (extent['ymax']-my)/(extent['ymax']-extent['ymin'])*height)
def line(points,color,label):
    coords=' '.join(f'{x:.1f},{y:.1f}' for x,y in map(pixel,points))
    x,y=pixel(points[len(points)//2])
    return f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="4"/><text x="{x+7:.1f}" y="{y-7:.1f}" fill="{color}" font-size="20">{label}</text>'
usgs=[[82.96,-23.64],[82.96,-7.50],[80.28,2.97],[77.27,8.09],[70.33,13.87],[55.60,21.33],[34.85,51.29]]
osm=[[76.41,-19.70],[71.7,-10.94],[79.66,-2.98],[64.4,19.35],[34.11,45.37]]
coords=' '.join(f'{x},{y}' for x,y in pixels)
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><image href="woodland-2025.jpg" width="{width}" height="{height}"/><polygon points="{coords}" fill="#79d68c" fill-opacity=".08" stroke="#8fef93" stroke-width="3"/>'
for x in [20,40,60,80,100,120,140,160]:
    a=pixel([x,-105]);b=pixel([x,105]);svg+=f'<path d="M{a[0]},{a[1]} L{b[0]},{b[1]}" stroke="white" opacity=".25"/><text x="{a[0]+3}" y="24" fill="white" font-size="17">X{x}</text>'
for z in [-80,-60,-40,-20,0,20,40,60,80]:
    a=pixel([-12,z]);b=pixel([178,z]);svg+=f'<path d="M{a[0]},{a[1]} L{b[0]},{b[1]}" stroke="white" opacity=".25"/><text x="4" y="{a[1]-5}" fill="white" font-size="17">Z{z}</text>'
svg+=line(usgs,'#58dfff','USGS 3DHP (selected segment)')+line(osm,'#f9d978','OSM (selected vertices)')
hx,hy=pixel([1.97,2.13]);svg+=f'<circle cx="{hx}" cy="{hy}" r="9" fill="none" stroke="#fff" stroke-width="3"/><text x="{hx+10}" y="{hy}" fill="white" font-size="19">Home</text></svg>'
(ROOT/'woodland-review.svg').write_text(svg,encoding='utf-8')
print(json.dumps({'woodlandPoints':len(pixels),'first':data['woodlands'][0]['points'][0],
                  'homeEdge':data['lawnWoodlandEdge']['points']},indent=2))
