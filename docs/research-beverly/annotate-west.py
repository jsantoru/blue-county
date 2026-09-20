"""Hand observations from the 2025 ortho, inspected at 1304x1920 display size.
Pixel coordinates refer to the image, not a web map. Re-run offline with stdlib.
"""
import json, math
from pathlib import Path
ROOT = Path(__file__).parent
geo = json.loads((ROOT/'ortho2025-export-georeference.json').read_text())
e = geo['extent']; R=6378137; LAT=41.283879; LON=-74.3662393
def source(p): return [round(p[0]*1800/1304,2), round(p[1]*2650/1920,2)]
def local(p):
    px,py=source(p)
    ex=e['xmin']+(px/1800)*(e['xmax']-e['xmin'])
    ey=e['ymax']-(py/2650)*(e['ymax']-e['ymin'])
    lon=math.degrees(ex/R); lat=math.degrees(2*math.atan(math.exp(ey/R))-math.pi/2)
    return [round((lon-LON)*111320*math.cos(math.radians(LAT)),2),round((LAT-lat)*111320,2)]
# Visible paved strips; where trees screen their middle, the connection is an
# approximate interpolation between exposed ends, identified below.
drives=[
 (20,3.5,[(967,254),(960,227),(957,205),(949,186),(933,173)],'medium'),
 (22,4.1,[(816,238),(815,201),(817,163),(801,149)],'high'),
 (24,3.7,[(711,246),(693,204),(677,164),(658,139)],'high'),
 (26,3.8,[(577,292),(550,270),(512,252),(493,226)],'medium'),
 (27,3.7,[(585,301),(607,322),(629,353),(651,366)],'high'),
 (28,3.9,[(518,427),(487,416),(456,407),(428,402)],'medium'),
 (29,4.1,[(539,425),(568,440),(607,463),(628,479),(627,494)],'high'),
 (30,4.0,[(485,542),(448,533),(422,542),(418,562)],'medium'),
 (31,3.8,[(456,643),(495,657),(542,674),(568,676),(578,664)],'high'),
 (32,4.0,[(402,730),(380,722),(360,713),(348,705),(344,695)],'high'),
 (33,3.9,[(415,741),(459,756),(506,775),(541,769)],'high'),
 (34,3.8,[(377,834),(338,832),(296,813),(285,794)],'medium'),
 (35,3.7,[(368,829),(413,841),(461,856),(478,862)],'low'),
 (36,3.8,[(337,879),(306,869),(282,862),(264,856),(261,865)],'medium'),
 (37,3.8,[(327,937),(391,959),(448,977),(464,968)],'high'),
 (38,3.8,[(283,1002),(255,989),(225,978),(208,976),(205,982)],'high'),
 (39,4.0,[(290,1056),(344,1079),(394,1094),(418,1089)],'high'),
 (40,3.8,[(244,1107),(216,1098),(189,1091),(179,1095)],'medium'),
 (41,3.8,[(278,1086),(318,1105),(352,1119),(378,1131)],'medium'),
 (42,3.6,[(249,1209),(220,1219),(188,1227),(170,1234)],'high'),
 (43,4.2,[(499,1320),(542,1303),(560,1278),(559,1255),(523,1250)],'high'),
 (44,3.8,[(305,1288),(282,1304),(261,1320),(241,1334),(238,1355)],'medium'),
]
# Individual visible large crowns: x,y,radius (display pixels); c=evergreen form.
crowns=[
 (566,47,24,'c'),(609,50,21,'c'),(710,90,34,'b'),(848,87,26,'b'),(1015,181,28,'b'),
 (475,130,22,'b'),(567,198,30,'b'),(591,270,22,'c'),(615,267,23,'c'),(643,263,20,'c'),
 (677,278,30,'b'),(750,298,28,'b'),(711,448,24,'c'),(748,455,23,'c'),
 (439,291,31,'b'),(397,293,25,'b'),(453,352,22,'b'),(531,387,30,'b'),(472,456,29,'b'),
 (403,459,29,'b'),(344,419,30,'b'),(437,579,30,'b'),(492,584,30,'b'),(546,577,28,'c'),
 (620,606,30,'b'),(675,659,32,'b'),(654,716,25,'b'),(601,715,29,'c'),
 (349,603,29,'b'),(384,633,22,'b'),(346,735,25,'c'),(378,776,26,'b'),(429,824,30,'b'),
 (576,798,35,'b'),(592,850,28,'b'),(646,869,26,'b'),(686,784,28,'b'),
 (285,864,28,'b'),(238,832,29,'b'),(327,885,27,'b'),(407,881,30,'b'),(515,891,25,'b'),
 (364,935,30,'c'),(375,975,29,'b'),(440,1005,29,'c'),(534,988,34,'b'),(507,1064,30,'b'),
 (276,974,33,'b'),(246,1048,25,'b'),(285,1116,28,'b'),(317,1090,24,'b'),(392,1102,21,'b'),
 (341,1152,25,'c'),(290,1172,28,'b'),(254,1199,27,'b'),(322,1210,25,'b'),(357,1273,33,'b'),
 (207,1350,21,'c'),(439,1350,22,'b'),(486,1330,22,'b'),(575,1302,25,'c'),(586,1372,32,'c'),
 (629,1397,24,'c'),(567,1464,21,'c'),(531,1474,24,'b'),(549,1534,27,'b'),
 (456,1550,27,'b'),(479,1591,22,'b'),(504,1650,22,'b'),(341,1555,31,'b'),(365,1595,29,'c'),
 (280,1620,27,'c'),(342,1650,27,'b'),(299,1706,34,'b'),(407,1713,30,'b'),
]
woodland=[[(18,30),(326,10),(401,235),(322,385),(279,610),(242,737),(165,851),(132,1037),(65,1136),(5,1040)],
 [(513,827),(602,785),(715,837),(715,1066),(630,1113),(557,1077),(509,987)],
 [(553,1666),(650,1672),(713,1777),(713,1915),(386,1915),(424,1828),(477,1770)]]
land=[('meadow',[(552,1107),(631,1098),(786,1130),(900,1124),(889,1242),(687,1270),(603,1244)]),
 ('meadow',[(333,1359),(413,1351),(490,1406),(506,1475),(510,1547),(466,1612),(394,1584),(317,1530),(275,1454)]),
 ('meadow',[(499,1360),(555,1363),(572,1490),(615,1565),(640,1640),(534,1670)]),
 ('pond',[(606,1713),(639,1692),(685,1683),(718,1690),(727,1721),(706,1760),(680,1806),(647,1859),(610,1884),(577,1857),(556,1813),(551,1758),(570,1729)]),
 ('pond',[(168,1802),(188,1796),(231,1806),(267,1832),(249,1870),(210,1894),(169,1907),(137,1899),(128,1872),(141,1843)])]
out={'sourceImage':'beverly-2025-ortho.jpg','coordinateSystem':'local-meters-x-east-z-south',
 'method':'Manual observations from 2025 NYS aerial imagery; no facade colors inferred. Canopy locations are observed crown centers, not measured trunks. Measurements have roughly 1–3m planimetric uncertainty, greater under canopy.',
 'driveways':[{'address':f'{n} Beverly Dr','points':list(map(local,ps)),'widthMeters':w,'confidence':conf,'sourcePixels':list(map(source,ps)), 'occlusion':'Some intermediate segments are screened by deciduous crowns; interpolated visible endpoints.' if conf!='high' else 'Exposed paved path clearly visible; final garage threshold approximate.'} for n,w,ps,conf in drives],
 'canopies':[{'center':local([x,y]),'radiusMeters':round(r*428/1304,1),'type':'conifer' if kind=='c' else 'broadleaf','confidence':'medium','sourcePixels':source([x,y]),'notes':'Observed crown; trunk and exact species not resolved from overhead view.'} for x,y,r,kind in crowns],
 'woodlands':[{'points':list(map(local,ps)),'spacing':12,'sourcePixels':list(map(source,ps)),'confidence':'medium','notes':'Observed contiguous canopy area; interior trunks are representative sampling.'} for ps in woodland],
 'landcover':[{'kind':kind,'points':list(map(local,ps)),'sourcePixels':list(map(source,ps)),'confidence':'medium'} for kind,ps in land]}
out['landcover'] += [{'kind':'woodland-floor','points':w['points'],'confidence':'medium'} for w in out['woodlands']]
audit_notes={
 20:'Corrected the road mouth westward to the actual approach. A conifer obscures its final road connection; only a corridor between visible paved ends is supported.',
 28:'Corrected the trace to the visible strip south of the house; original endpoint entered the main footprint. Branches obscure part of the strip.',
 29:'Corrected the road mouth to the east pavement edge and stopped at the visible front parking area before the main footprint.',
 32:'Corrected a gross road-mouth displacement. The visible driveway reaches the road south of the house, alongside its southern parking apron.',
 35:'Endpoint stopped outside the state footprint. Intermediate alignment remains low confidence under dense branches; do not present it as surveyed.',
 36:'Corrected from the south lawn to the visible access north of the house. End stops before the older state footprint; branches partly screen pavement.',
 38:'Corrected to the exposed access north of the house; original approach was on the wrong side of the building.',
 40:'Corrected to the partly visible strip north of the house. Tree crowns obscure the middle; exact edges remain uncertain.',
 42:'Stopped the trace at the visible northern parking apron; original final segment entered the footprint.',
 44:'Corrected to the northwest approach from farther west on the bend. Original trace crossed the house for about eight metres. The approach near the road is partly branch-screened.',
}
for d in out['driveways']:
    n=int(d['address'].split()[0])
    if n in audit_notes:d['occlusion']=audit_notes[n]
for i,c in enumerate(out['canopies']):
    c['trunkPositionVerified']=False
    if i in [9,54,56,59,64,73,74]:
        c['notes']='Observed crown overlaps the mapped road corridor; the trunk is not resolved. This center must not be interpreted as an observed trunk in the roadway.'
    if i==16:
        c['confidence']='low'
        c['notes']='Canopy/shadow boundaries overlap the roof at 28 Beverly; no trunk location is resolved. Do not instantiate a trunk at this source center.'
out['audit']={'date':'2026-09-20','method':'Independent visual inspection of bounded high-resolution exports from the same 2025 service, plus segment sampling against retained state footprint polygons. Temporary crops enlarged existing source imagery; no additional ground detail was invented.',
 'correctedDrivewayAddresses':list(audit_notes),'canopyQualification':'Seven crown centers overlap the road corridor and one overlaps a roof; these are not surveyed trunk positions. No crown was silently moved to manufacture a safe trunk location.',
 'limitations':'Endpoints near garage thresholds and tree-screened strips retain metre-scale uncertainty. Apparent roof edges can differ from older footprint edges; source building polygons were not moved.'}
(ROOT/'west-observations.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print('West survey:',len(drives),'driveway traces,',len(crowns),'crowns,',len(woodland),'wooded areas')
