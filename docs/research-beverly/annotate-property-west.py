"""Reproduce the west/north property audit from retained NYSDOP source pixels.

The observations below are hand traces, not automated image classifications.
Crop coordinates are native source pixels unless a scale of 2 is supplied.
No online service, runtime file, or original research file is modified.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
GEO = json.loads((ROOT / 'ortho2025-export-georeference.json').read_text())
PRIOR = json.loads((ROOT / 'west-observations.json').read_text())
PROVENANCE = json.loads((ROOT / 'fetched-reference-provenance.json').read_text())
SUBDIVISION = json.loads((ROOT / 'alternative-28-subdivision.json').read_text())
TERRACE_GEO = json.loads((ROOT / 'alternative-28-2025-georeference.json').read_text())
EXTENT = GEO['extent']
R, LAT, LON = 6378137, 41.283879, -74.3662393
N, U, M, L = (570, 115), (380, 430), (235, 890), (130, 1340)
features = []


def source(points, origin=(0, 0), scale=1):
    return [[round(origin[0] + u / scale, 2), round(origin[1] + v / scale, 2)] for u, v in points]


def local(points):
    result = []
    for u, v in points:
        ex = EXTENT['xmin'] + u / GEO['width'] * (EXTENT['xmax'] - EXTENT['xmin'])
        ey = EXTENT['ymax'] - v / GEO['height'] * (EXTENT['ymax'] - EXTENT['ymin'])
        lon = math.degrees(ex / R)
        lat = math.degrees(2 * math.atan(math.exp(ey / R)) - math.pi / 2)
        result.append([round((lon - LON) * 111320 * math.cos(math.radians(LAT)), 3), round((LAT - lat) * 111320, 3)])
    return result


def add(number, kind, origin, pixels, confidence='medium', notes='', evidence='observed', scale=1, suffix='', **options):
    pixels = source(pixels, origin, scale)
    feature = {
        'id': f'beverly-{number}-{kind}{suffix}', 'address': f'{number} Beverly Dr',
        'kind': kind, 'geometryType': 'polygon', 'sourceId': 'nysdop-spring-2025-beverly',
        'sourcePixels': pixels, 'points': local(pixels), 'evidence': evidence,
        'confidence': confidence, 'notes': notes,
    }
    feature.update(options)
    features.append(feature)
    return feature


def drive(number, origin, pixels, confidence='high', notes='', centerline=None, evidence='observed'):
    old = next(d for d in PRIOR['driveways'] if d['address'] == f'{number} Beverly Dr')
    f = add(number, 'driveway', origin, pixels, confidence, notes, evidence)
    center = source(centerline, origin) if centerline else old['sourcePixels']
    f.update(centerlineSourcePixels=center, centerlinePoints=local(center), widthMeters=old['widthMeters'],
             replacesDrivewayAddresses=[f'{number} Beverly Dr'], surface='paved')


# Northern bend: side parking aprons are visible in addition to the access strip.
drive(20, N, [(758,236),(747,194),(744,164),(736,140),(718,131),(721,113),(738,108),(753,132),(759,164),(760,193),(776,239)], 'medium',
      'Gray paved side apron and northern strip are visible. The southern mouth passes beneath an evergreen; its edges and short connection interpolate the exposed ends. No pavement is claimed beneath the house.', evidence='inferred-occluded',
      centerline=[(765,236),(755,198),(751,168),(740,142),(722,124)])
drive(22, N, [(547,213),(545,155),(547,116),(541,102),(539,89),(539,44),(555,46),(575,77),(568,111),(566,154),(566,210)], 'high',
      'Continuous light-gray paved access with a broad side parking apron east of the house; edge widens near the side garage. The road tie-in extends to the visible asphalt margin.',
      centerline=[(556,213),(555,160),(557,115),(556,86),(546,64)])
drive(24, N, [(399,232),(374,175),(353,117),(326,87),(340,69),(353,84),(374,117),(391,162),(425,225)], 'medium',
      'Narrow dark paved strip with a wider house-end apron. Tree shadows and the conifer screen the upper edge; interpolation is limited to that screened section.', evidence='inferred-occluded')
drive(26, N, [(216,294),(184,265),(143,247),(121,230),(102,210),(88,190),(98,175),(116,188),(132,210),(155,227),(196,249),(237,281)], 'medium',
      'Paved access bends from the western bend to a wider garage-side apron. Bare branches screen the middle; the exposed mouth and apron establish the route, with screened edges approximate.', evidence='inferred-occluded')
drive(27, N, [(231,304),(261,335),(288,375),(310,407),(312,421),(333,423),(333,399),(322,378),(307,365),(276,323),(246,296)], 'high',
      'Dark paved strip broadens beside the west garage wall; the south parking end and road apron are visible. The house roof remains outside this polygon.',
      centerline=[(238,300),(270,332),(293,367),(315,391),(322,411)])

# West side, north of the central wooded area.
drive(28, U, [(339,152),(301,140),(266,132),(245,140),(227,136),(209,130),(203,137),(215,146),(238,147),(265,146),(299,158),(334,173)], 'medium',
      'Visible paved strip south of the house opens into a side parking area east of the small dark outbuilding. That outbuilding roof is excluded. Bare branches partly obscure the strip; conservative edges interpolate through them.', evidence='inferred-occluded',
      centerline=[(337,159),(295,147),(265,139),(241,143),(217,139)])
drive(29, U, [(360,150),(396,166),(435,187),(470,204),(484,218),(487,240),(480,262),(495,265),(502,242),(508,218),(501,205),(480,191),(440,171),(401,150),(368,133)], 'high',
      'Continuous dark asphalt bends into the side parking pad north/east of the main house; the driveway does not extend through the roof. A separate small circular garden/hot-tub-sized object is not classified as a swimming pool.',
      centerline=[(364,141),(401,160),(441,181),(481,203),(494,222),(487,260)])
drive(30, U, [(298,309),(267,297),(238,295),(213,307),(200,318),(190,337),(185,350),(205,357),(217,333),(234,321),(250,318),(289,331)], 'medium',
      'The access follows a bent strip north and east of the house and broadens at its southern garage end. Bare branches conceal parts of the northern bend, so those edges are approximate.', evidence='inferred-occluded')
drive(31, U, [(255,448),(298,464),(350,482),(386,491),(411,490),(430,482),(429,472),(408,466),(404,472),(387,473),(356,468),(304,451),(263,431)], 'high',
      'Broad dark asphalt strip and flared parking head west/south of the garage are visible; the garage-end edge stops outside the roof.',
      centerline=[(261,440),(303,458),(355,475),(386,481),(414,480),(418,474)])
drive(32, U, [(174,569),(150,557),(119,544),(104,533),(101,515),(85,509),(78,508),(74,523),(78,537),(92,548),(117,561),(151,575),(166,583)], 'high',
      'Exposed strip south of the house has a broad two-car parking head. Polygon follows pavement rather than an even-width strip.',
      centerline=[(174,573),(149,565),(119,551),(94,537),(89,524)])

# Middle west limb. Distinguish visible aprons from canopy-screened access.
drive(33, M, [(330,128),(373,144),(419,159),(463,169),(491,169),(512,160),(540,168),(545,145),(523,148),(501,141),(486,151),(462,152),(422,143),(379,128),(335,111)], 'high',
      'Paved strip widens into an irregular parking head along the south side of the house; the white-edged rear platform is separate from this surface.',
      centerline=[(337,133),(380,137),(426,151),(467,160),(496,159),(520,153)])
drive(34, M, [(290,252),(259,244),(230,238),(195,224),(179,210),(179,198),(161,193),(146,223),(141,240),(176,249),(206,258),(231,266),(254,265),(283,273)], 'medium',
      'Visible paved approach bends around the southeast corner into a wider garage apron. The east middle is partially screened by a large crown; its continuation is interpolated.', evidence='inferred-occluded')
drive(35, M, [(275,248),(323,262),(370,277),(406,289),(427,292),(431,305),(414,308),(372,295),(325,280),(270,266)], 'low',
      'Dense branch cover screens nearly all the center strip. Only the road-end opening and house-end parked vehicle establish this interpolated access; polygon width and hidden edges are approximate. No additional side parking pad is asserted.', evidence='inferred-occluded')
drive(36, M, [(237,314),(207,302),(176,292),(150,287),(125,278),(111,283),(104,299),(110,304),(129,310),(139,301),(170,307),(203,319),(230,332)], 'medium',
      'Paved strip lies north of the house, with a clearly exposed broad light-gray apron beside its northeast corner. Branches screen the roadward half.', evidence='inferred-occluded')
drive(37, M, [(222,401),(260,414),(308,430),(355,446),(386,462),(399,462),(414,445),(410,439),(399,438),(381,442),(357,429),(313,414),(265,398),(228,384)], 'high',
      'Continuous dark paved approach and widened southern parking head visible. This trace excludes the light rear platform on the east side of the building.',
      centerline=[(220,401),(263,407),(312,422),(355,438),(387,453),(399,442)])

# Southern west limb and bottom bend.
drive(38, L, [(267,31),(245,19),(215,8),(181,-4),(164,-6),(155,8),(151,20),(135,13),(136,0),(141,-14),(159,-22),(184,-21),(221,-9),(251,3),(274,16)], 'high',
      'Dark paved strip north of the roof, widening toward the garage and a parking pad on the western end. Part of the source trace falls just north of this working crop, but remains in the original image.',
      centerline=[(261,27),(236,14),(204,3),(171,-12),(150,-5),(141,13)])
drive(39, L, [(267,109),(311,124),(361,142),(404,158),(430,167),(441,164),(453,151),(441,145),(422,138),(417,144),(406,143),(366,129),(318,112),(275,94)], 'high',
      'Dark paved driveway and right-angle parking apron immediately south of the house are unobscured. Orange rear deck is traced separately.',
      centerline=[(270,103),(317,119),(363,135),(407,150),(432,157)])
drive(40, L, [(211,197),(181,184),(149,174),(129,169),(116,174),(110,180),(99,177),(99,162),(111,153),(129,152),(154,158),(187,169),(220,182)], 'medium',
      'Narrow paved strip north of the house and visible west parking end; middle passes under bare branches. No extension across the house footprint is inferred.', evidence='inferred-occluded')
drive(41, L, [(246,168),(281,180),(327,198),(356,209),(365,213),(369,221),(383,220),(398,218),(398,195),(384,184),(366,185),(333,179),(288,162),(252,150)], 'medium',
      'Access terminates at the exposed north-side vehicle parking apron. Bare branches obscure the roadward connection. Rear hardscape east/south of the house is a separate patio, not driveway.', evidence='inferred-occluded',
      centerline=[(254,159),(292,177),(339,191),(374,201),(383,211)])
drive(42, L, [(215,320),(189,329),(156,340),(127,350),(112,362),(98,369),(91,359),(101,344),(121,333),(151,323),(180,313),(207,302)], 'high',
      'Light-gray paved strip runs west from the lower bend to the northern parking apron. Visible pavement stops at the north end of the main roof.',
      centerline=[(214,315),(184,322),(151,332),(124,343),(105,357)])
drive(43, L, [(554,484),(578,476),(611,458),(636,438),(650,416),(656,387),(662,360),(658,345),(641,338),(630,337),(624,347),(635,356),(636,378),(632,401),(625,421),(606,440),(577,456),(548,466)], 'high',
      'Large continuous asphalt bend with a broad paved garage court on the east side of the solar-panel roof. The light horizontal roof/extension north of the main roof is explicitly excluded from paving; the old centerline endpoint incorrectly approached that roof.',
      centerline=[(558,478),(591,462),(622,438),(639,414),(646,386),(649,355)])
drive(44, L, [(300,430),(275,446),(251,465),(221,484),(209,493),(205,511),(215,520),(220,505),(220,495),(240,484),(265,479),(289,461),(313,446)], 'medium',
      'Driveway runs southwest from the bend, then broadens into the visible parking head north/west of the house. Bare branch cover obscures part of the roadside half.', evidence='inferred-occluded',
      centerline=[(291,438),(272,459),(249,475),(224,490),(216,506)])

# Pools: points describe the visible basin/cover, not a surrounding fence.
add(28, 'pool', (480,350), [(132,192),(159,199),(180,202),(196,218),(198,240),(182,259),(189,272),(166,283),(142,276),(121,260),(118,242)],
    'medium', 'Angular irregular green pool surface with light coping is visible northwest of the house. Northern/eastern portions are screened by branches; boundary closes conservatively through that screen. Surface reads as water, without a visible taut seasonal cover. Basin depth is unmeasured.',
    evidence='inferred-occluded', scale=2, form='in-ground', surface='water', waterColor=0x32695f, copingWidthMeters=0.45)
add(30, 'pool', (440,630), [(74,64),(88,64),(123,77),(123,91),(100,158),(93,169),(80,173),(56,164),(51,153),(64,99)],
    'high', 'Green water basin with rounded corners and surrounding light coping, west of the house. Bare branches screen the northeast corner. Outline follows water/coping edge rather than the outer paved enclosure.',
    scale=2, form='in-ground', surface='water', waterColor=0x3e726d, copingWidthMeters=0.4)
add(32, 'pool', (370,830), [(77,69),(106,77),(108,88),(96,125),(88,133),(68,126),(63,117),(72,78)],
    'medium', 'Small rounded rectangular pool west of the house. Green surface has a sharp diagonal light band and reads as a seasonal cover; water versus cover and wall height cannot be proved from this export. Ground-flush rim is a rendering approximation, not a surveyed construction type.',
    scale=2, form='in-ground', surface='covered', coverColor=0x486f56, copingWidthMeters=0.25)


def ellipse(cx, cy, rx, ry, count=20):
    return [(cx + math.cos(i*2*math.pi/count)*rx, cy + math.sin(i*2*math.pi/count)*ry) for i in range(count)]


add(33, 'pool', M, ellipse(651,157,16,17), 'high',
    'Circular pool east of the house, with an opaque blue-gray cover showing bright irregular creases. Visible edge/shadow supports an above-ground pool; 1.15 m wall height is approximate and not measurable from the nadir image.',
    form='above-ground', surface='covered', heightMeters=1.15, coverColor=0x546471, copingWidthMeters=0.16)
add(34, 'pool', M, ellipse(116,116,19,18), 'high',
    'Circular pool northwest of the house, with an opaque gray cover and pale irregular creases. Edge shadow and adjoining platform support an above-ground pool; 1.15 m wall height is approximate.',
    form='above-ground', surface='covered', heightMeters=1.15, coverColor=0x687677, copingWidthMeters=0.16)

# Only plainly visible hard platforms are included. No furniture or railings are inferred.
add(31, 'deck', U, [(447,416),(467,423),(464,444),(440,436)], 'medium',
    'Small rear platform at the east side of the house; perimeter and shadow are visible. Material and vertical height are approximate; no rail or stairs invented.', heightMeters=0.35, railEdges=[])
add(33, 'deck', M, [(543,117),(557,123),(551,148),(539,151),(537,143)], 'medium',
    'Light rear platform beside the east wall; outer edge and small shadow visible. Height is approximate. Covered pool-side platform is recorded separately.', heightMeters=0.4, railEdges=[])
add(33, 'deck', M, [(666,159),(681,164),(670,204),(657,200)], 'medium',
    'Narrow light/brown pool-side platform east/southeast of the circular covered pool. Shape is directly visible; approximately pool-rim elevation, with exact construction and rails unverified.', heightMeters=1.15, railEdges=[], suffix='-poolside')
add(34, 'deck', M, [(132,113),(145,110),(151,126),(145,139),(130,134),(135,126)], 'medium',
    'Narrow platform wraps the eastern side of the circular pool. Light outer edges and darker walking surface are visible. Pool-rim elevation is approximate; rails omitted rather than invented.', heightMeters=1.15, railEdges=[])
add(35, 'deck', M, [(478,244),(495,249),(491,266),(474,261)], 'medium',
    'Small rectangular light/brown platform immediately east of the roof, visible through bare branches. Exact board material and elevation remain approximate; no furniture, rails or stairs asserted.', heightMeters=0.35, railEdges=[])
add(37, 'deck', M, [(432,411),(446,416),(442,428),(431,424),(426,437),(416,434),(422,419)], 'medium',
    'Small light-edged stepped rear platform outside the southeast roof corner. Outline includes visible narrow return; height and construction are approximate. Rails and stair counts not resolved.', heightMeters=0.35, railEdges=[])
add(39, 'deck', L, [(470,95),(480,98),(475,117),(465,113)], 'high',
    'Small orange-brown wood-toned rectangle adjoining the east/rear wall. Surface and projecting shadow are directly visible. Height is a low-platform approximation; no unsupported railing or furniture is added.', heightMeters=0.45, railEdges=[])
add(41, 'patio', L, [(416,277),(435,272),(444,278),(442,295),(450,301),(449,321),(426,326),(419,308)], 'high',
    'Light patterned rear hardscape terrace east/southeast of the roof, with a narrower section near the wall. Paving/terrace geometry is visible; exact retaining heights and overhead structure are unresolved, so rendered as low patio.', heightMeters=0.06)

# Number 28's original L footprint is preserved while the renderer uses two
# source-derived wings. Its exposed terrace therefore need not be omitted to
# accommodate a single rectangular envelope. This source uses its own crop grid.
features.append({**SUBDIVISION['terrace'],
                 'buildingRenderPartsSource':'alternative-28-subdivision.json'})

out = {
    'schemaVersion': 1,
    'coordinateSystem':'local-meters-x-east-z-south',
    'origin':{'lat':LAT,'lon':LON},
    'sourcePixelOrigin':'top-left of the original retained image identified by sourceId; default 1800 x 2650 reference, number 28 terrace 1100 x 919 export. Number 28 also includes equivalent fullImagePixels.',
    'sources': [{
        'id':'nysdop-spring-2025-beverly',
        'url':PROVENANCE['urls']['beverly-2025-ortho.jpg'],
        'imagePath':'docs/research-beverly/beverly-2025-ortho.jpg',
        'georeferencePath':'docs/research-beverly/ortho2025-export-georeference.json',
        'vintage':'Spring 2025; exact flight day not established',
        'pixelSize':{'groundMetersApprox':0.23778,'widthPixels':1800,'heightPixels':2650},
        'width':1800,'height':2650,'pixelSizeMeters':0.23778,
        'credit':'NYS ITS Geospatial Services / NYSDOP, Spring 2025',
        'useNote':'Public NYS reference imagery, not CC0. See findings.md for official access/use qualifications. No aerial image is used as a runtime ground texture.'
    }, {
        'id':'nysdop-2025-alternative-28',
        'url':TERRACE_GEO['source'],
        'imagePath':'docs/research-beverly/alternative-28-2025.jpg',
        'georeferencePath':'docs/research-beverly/alternative-28-2025-georeference.json',
        'vintage':'Spring 2025; exact flight day not established',
        'width':TERRACE_GEO['width'],'height':TERRACE_GEO['height'],
        'pixelSizeMeters':0.06638,
        'credit':TERRACE_GEO['credit'],
        'useNote':'Oversampled official export for inspection, not additional native detail. Public NYS reference imagery, not CC0. See findings.md for access/use qualifications. Not a runtime texture.',
        'corroboratingGeoreferencePaths':[f'docs/research-beverly/alternative-28-{year}-georeference.json' for year in [2013,2016,2021]],
    }],
    'method':'Manual edge audit against the cached original image and cropped enlargements. Existing centerlines are retained only when still consistent with visible pavement; many garage aprons and parking heads now have actual polygon outlines. At garage thresholds, conservative termination outside the retained rendered building envelope is preferred within the source uncertainty; no polygon continues beneath a house. Coordinates use the returned export extent, not the requested bbox. No property-owner data was requested.',
    'auditedAt':'2026-09-20',
    'uncertainty':'Typically 0.5–1.5 m for exposed edges; greater where tree crowns, shadows or building displacement obscure an edge. Roof overhang can differ from older state footprint edges. Heights, pool depth, deck construction and stairs cannot be measured from this nadir image. No lawn schema extension; established landcover is retained.',
    'coverageAddresses':[f'{n} Beverly Dr' for n in [20,22,24,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44]],
    'notClassified':[
        {'address':'20 Beverly Dr','notes':'Small light-bordered northern projection may be an open platform or flat roof. It falls inside the retained building envelope and is not asserted as a separate deck.'},
        {'address':'29 Beverly Dr','notes':'Small circular object east of the house may be a hot tub or garden feature; it is not asserted to be a swimming pool.'},
        {'address':'38 Beverly Dr','notes':'Rear roof/platform boundary not clear enough to assert an additional deck.'},
        {'address':'40 Beverly Dr','notes':'Rear roof/platform boundary not clear enough to assert an additional deck.'},
        {'address':'42 Beverly Dr','notes':'Bright terrace-like shapes beside the roof are partly screened and cannot be separated confidently from roof/porch edges.'},
        {'address':'43 Beverly Dr','notes':'Dark northern square platform lies within the roof envelope and cannot be distinguished securely from a flat roof section. No separate deck is asserted.'},
        {'address':'44 Beverly Dr','notes':'No clearly resolved pool or open deck is asserted; this is not proof of absence.'},
    ],
    'features':features,
}


def polygon_area(points):
    return abs(sum(x*z2-x2*z for (x,z),(x2,z2) in zip(points,points[1:]+points[:1])))/2


sources_by_id = {s['id']:s for s in out['sources']}
for feature in features:
    assert len(feature['points']) >= 3
    assert all(math.isfinite(c) for point in feature['points'] for c in point)
    image_source = sources_by_id[feature['sourceId']]
    assert all(0 <= u <= image_source['width'] and 0 <= v <= image_source['height'] for u,v in feature['sourcePixels'])
    feature['areaSquareMeters'] = round(polygon_area(feature['points']), 2)
    assert feature['areaSquareMeters'] > 1, feature['id']
assert len({f['id'] for f in features}) == len(features)
assert len([f for f in features if f['kind']=='driveway']) == 22
(ROOT/'property-west-observations.json').write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
print({kind:sum(f['kind']==kind for f in features) for kind in ['driveway','deck','pool','patio']})
