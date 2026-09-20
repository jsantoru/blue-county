"""Convert manually inspected 2025 orthophoto observations into auditable coordinates.

These are approximate visual measurements, not survey data. No unseen driveway
connection or facade geometry is inferred. Source photos remain unmodified.
"""
from pathlib import Path
import json, math

ROOT=Path(__file__).resolve().parent
LAT,LON=41.283879,-74.3662393
SX=111320*math.cos(math.radians(LAT))
full=json.loads((ROOT/'ortho2025-export-georeference.json').read_text())
meta={name:json.loads((ROOT/f'{name}-georeference.json').read_text()) for name in ['home-east-south','east-north']}
def convert(name,pt):
    m=meta[name];e=m['extent']
    mx=e['xmin']+pt[0]*(e['xmax']-e['xmin'])/m['width']
    my=e['ymax']-pt[1]*(e['ymax']-e['ymin'])/m['height']
    lon=mx/6378137*180/math.pi
    lat=(2*math.atan(math.exp(my/6378137))-math.pi/2)*180/math.pi
    f=full['extent']
    pixel=[(mx-f['xmin'])/(f['xmax']-f['xmin'])*full['width'],(f['ymax']-my)/(f['ymax']-f['ymin'])*full['height']]
    return [round((lon-LON)*SX,2),round((LAT-lat)*111320,2)],[round(v,2) for v in pixel]

out={'sourceImage':'beverly-2025-ortho.jpg','sourceService':'https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer',
     'coordinateSystem':'local-meters-x-east-z-south','origin':{'lat':LAT,'lon':LON},
     'method':'Manual visual tracing of source orthophoto crops; transformed through returned EPSG3857 extents. Line locations typically +/-1-2m, widths +/-0.8m. Canopy centers and radii represent observed crowns, not surveyed trunks.',
     'limitations':'No facade colors, precise heights, species, curb material, or unseen driveway links inferred. Public parcel address association is approximate and excludes owners.',
     'driveways':[],'canopies':[],'pavementWidths':[]}

def driveway(address,photo,pixels,width,confidence='high',occlusion='No material occlusion on traced segment.',**extra):
    pairs=[convert(photo,p) for p in pixels]
    out['driveways'].append({'address':address,'points':[p[0] for p in pairs],'widthMeters':width,'confidence':confidence,'occlusion':occlusion,
       'sourcePixels':[p[1] for p in pairs],'inspectionImage':photo+'-2025.jpg','inspectionPixels':pixels,**extra})

# Native crop pixel coordinates, read directly from the source images.
driveway('16 Beverly Dr','east-north',[[686,446],[760,423],[838,417],[891,407],[888,385]],3.6,'medium','Tree crown overlaps the first several metres; exposed strip is visible further east.')
driveway('14 Beverly Dr','east-north',[[704,516],[766,501],[836,481],[899,481]],5.0,apronWidthMeters=8.0)
driveway('12 Beverly Dr','east-north',[[668,771],[742,781],[798,784],[835,790],[835,817]],4.4,apronWidthMeters=7.0)
driveway('10 Beverly Dr','east-north',[[582,1151],[664,1167],[730,1178],[777,1176],[784,1137]],3.7,apronWidthMeters=7.5)
driveway('17 Beverly Dr','east-north',[[491,335],[468,353],[444,381]],4.0,'medium','Road-end partly shaded; visible driveway approaches the north side of house.')
driveway('15 Beverly Dr','east-north',[[643,656],[591,657],[558,669],[534,690]],3.2,'medium','Pale access strip partly shaded by branches; surface material uncertain.')
driveway('13 Beverly Dr','east-north',[[601,860],[543,864],[477,868],[439,884]],3.7)
driveway('11 Beverly Dr','east-north',[[546,1080],[489,1076],[441,1072],[403,1071],[397,1094]],4.2,apronWidthMeters=8.0)
driveway('8 Beverly Dr','home-east-south',[[540,318],[610,313],[676,307],[737,309],[747,286]],4.2,apronWidthMeters=7.0)
driveway('6 Beverly Dr','home-east-south',[[475,647],[539,647],[598,647],[649,647],[680,633]],4.4,apronWidthMeters=6.5)
driveway('4 Beverly Dr','home-east-south',[[451,1064],[499,1051],[544,1018],[587,978],[618,945],[656,926]],4.3,apronWidthMeters=7.0)
driveway('2 Beverly Dr','home-east-south',[[355,1466],[387,1459]],4.5,'low','Only the road-mouth stub is traced. Evergreen canopy obscures its connection to the detached garage/main-house apron. Do not extend this stub procedurally.',traceStatus='visible-road-mouth-only',completion='requires ground-level reference')
driveway('9 Beverly Dr','home-east-south',[[405,395],[329,392],[265,398],[222,398]],4.5)
driveway('7 Beverly Dr','home-east-south',[[399,686],[329,685],[271,681],[235,662]],3.7,'medium','Parked vehicles obscure a portion of apron.',apronWidthMeters=6.0)
driveway('5 Beverly Dr','home-east-south',[[380,906],[254,922],[144,938],[89,936],[97,900]],3.8,apronWidthMeters=7.0)

def canopy(photo,pixel,radius,kind,confidence='medium',notes='Visible canopy, approximate crown center; trunk position is not resolved.'):
    center,p=convert(photo,pixel)
    out['canopies'].append({'center':center,'radiusMeters':radius,'type':kind,'confidence':confidence,'notes':notes,'sourcePixels':p,'inspectionImage':photo+'-2025.jpg','inspectionPixel':pixel})

# Large visible crowns and evergreen groups beside the eastern limb. These do
# not stand in for every shrub, sapling or individual within a merged canopy.
for pixel,radius,kind in [
    ([514,208],8,'conifer'),([704,325],6.5,'conifer'),([792,421],4.5,'conifer'),
    ([743,706],6.5,'conifer'),([821,696],4.5,'conifer'),([1040,855],9,'broadleaf'),
    ([572,374],8,'broadleaf'),([656,479],8,'broadleaf'),([688,618],7,'broadleaf'),
    ([615,1019],8,'broadleaf'),([584,1068],7,'broadleaf'),([744,1230],9,'broadleaf'),
    ([505,829],7.5,'conifer'),([425,811],7.5,'conifer'),([355,802],8,'conifer'),
    ([276,797],8,'conifer'),([180,807],8,'conifer'),([320,746],7,'broadleaf'),
    ([130,616],9,'conifer'),([461,319],6,'broadleaf')]: canopy('east-north',pixel,radius,kind)
for pixel,radius,kind in [
    ([667,376],7.5,'conifer'),([772,387],7.5,'conifer'),([831,398],6,'conifer'),
    ([531,385],7.5,'conifer'),([332,268],9,'conifer'),([160,131],8,'conifer'),
    ([984,268],15,'broadleaf'),([980,656],15,'broadleaf'),([675,706],7,'conifer'),
    ([767,755],6.5,'conifer'),([901,809],12,'broadleaf'),([307,605],8,'broadleaf'),
    ([395,623],9,'broadleaf'),([436,363],8,'broadleaf'),([322,753],7.5,'broadleaf'),
    ([516,1099],8,'conifer'),([644,1096],8,'conifer'),([735,1103],7,'conifer'),
    ([835,1102],7,'conifer'),([497,1381],9,'conifer'),([415,1444],9,'conifer'),
    ([384,1507],9,'conifer'),([887,1313],18,'broadleaf'),([852,1549],16,'broadleaf'),
    ([612,1706],12,'broadleaf'),([273,1614],10,'broadleaf'),([325,1893],12,'broadleaf')]: canopy('home-east-south',pixel,radius,kind)

def width(photo,pixels,notes):
    pairs=[convert(photo,p) for p in pixels];a,b=[p[0] for p in pairs]
    out['pavementWidths'].append({'edges':[a,b],'widthMeters':round(math.dist(a,b),2),'confidence':'medium','notes':notes,'sourcePixels':[p[1] for p in pairs]})
width('east-north',[[603,912],[655,923]],'Eastern limb near 13 Beverly: apparent asphalt margins, excluding lawn.')
width('east-north',[[563,1030],[616,1042]],'Eastern limb south of 13 Beverly; tree shadows partly cross pavement.')
width('home-east-south',[[400,877],[476,886]],'Eastern limb near 4/5 Beverly bend, perpendicular to road.')
width('home-east-south',[[335,1274],[411,1290]],'Eastern limb opposite 2 Beverly frontage; light shoulders make asphalt edge approximate.')
(ROOT/'east-observations.json').write_text(json.dumps(out,indent=2))
print(f"Saved {len(out['driveways'])} driveway traces, {len(out['canopies'])} canopy observations and {len(out['pavementWidths'])} pavement cross-sections.")
print('Measured widths:',[w['widthMeters'] for w in out['pavementWidths']])
