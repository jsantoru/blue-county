"""Compile reviewed property observations without fetching live map resources."""
from pathlib import Path
import json, math, hashlib

RESEARCH = Path(__file__).resolve().parents[1] / 'docs/research-beverly'

def apply_properties(data, survey, manifest, nearest, point):
    files = ['property-east-observations.json', 'property-west-observations.json']
    observations = [json.loads((RESEARCH / name).read_text(encoding='utf-8')) for name in files]
    features = [f for source in observations for f in source['features']]
    surfaces = [dict(f) for f in features if f['kind'] == 'driveway' and f['geometryType'] == 'polygon']
    survey['propertyFeatures'] = [dict(f) for f in features if f['kind'] in ['deck', 'pool', 'patio']]
    survey['propertySources'] = [s for source in observations for s in source['sources']]
    survey['propertySourceSha256'] = {name: hashlib.sha256((RESEARCH / name).read_bytes()).hexdigest() for name in files}
    subdivision_name = 'alternative-28-subdivision.json'
    subdivision = json.loads((RESEARCH / subdivision_name).read_text(encoding='utf-8'))
    building = next(b for b in data['buildings'] if b['id'] == subdivision['sourceBuildingId'])
    building['renderParts'] = [{
        'id': part['id'],
        'points': [point(*p) for p in part['points'] + part['points'][:1]],
        'entrance': index == len(subdivision['parts']) - 1,
    } for index, part in enumerate(subdivision['parts'])]
    building['renderPartsSource'] = subdivision_name
    survey['propertySourceSha256'][subdivision_name] = hashlib.sha256((RESEARCH / subdivision_name).read_bytes()).hexdigest()
    manifest['adjustments'].append('Number 28 renders two connected wings partitioned from its unchanged NYS L-shaped footprint, preserving the observed open poolside terrace. Wing roof intersections and vertical dimensions remain approximate.')
    for drive in survey['driveways']:
        matching = [f for f in surfaces if f['address'] == drive['address']]
        if not matching: continue
        drive['widthMeters'] = matching[0].get('widthMeters', drive['widthMeters'])
        route = next((f.get('centerlinePoints') for f in matching if f.get('centerlinePoints')), None)
        home = observations[0].get('home', {}) if drive['address'] == '2 Beverly Dr' else {}
        route = home.get('drivewayCenterline', route)
        if route:
            drive['previousSurveyPoints'] = drive['surveyPoints']
            drive['surveyPoints'] = route
            drive['points'] = route[:]
        drive['surfaceIds'] = [f['id'] for f in matching]
        drive['traceStatus'] = 'reviewed-pavement-outline'
        drive['confidence'] = matching[0]['confidence']
        drive['completion'] = 'Full reviewed pavement outline; source dates and canopy-obscured segments are recorded per surface.'
        start = drive['points'][0]
        distance, projection, road = nearest(data['roads'], *start)
        # Join the observed mouth to the retained OSM road edge. This short bridge
        # is a documented alignment adjustment, not extra observed pavement.
        if road['width'] / 2 - .35 < distance < road['width'] / 2 + 9:
            dx, dz = (start[0]-projection[0])/distance, (start[1]-projection[1])/distance
            anchor = [projection[0]+dx*(road['width']/2-.35), projection[1]+dz*(road['width']/2-.35)]
            half = drive['widthMeters']/2
            nx, nz = -dz*half, dx*half
            apron = {'id': matching[0]['id']+'-road-join', 'kind':'driveway', 'address':drive['address'],
                'geometryType':'polygon', 'points':[[anchor[0]+nx,anchor[1]+nz],[start[0]+nx,start[1]+nz],
                    [start[0]-nx,start[1]-nz],[anchor[0]-nx,anchor[1]-nz]],
                'evidence':'alignment-adjustment','confidence':'approximate',
                'notes':'Short connection from reviewed driveway mouth to unchanged OSM road pavement.'}
            surfaces.append(apron)
            drive['surfaceIds'].append(apron['id'])
            drive['points'].insert(0,anchor)
    survey['drivewaySurfaces'] = surfaces
    home = observations[0].get('home', {})
    recommendation = home.get('spawnRecommendation')
    if recommendation:
        x, z = recommendation['positionXZ']
        drive = next(d for d in survey['driveways'] if d['address']=='2 Beverly Dr')
        path = drive['points']
        start_index = min(range(len(path)), key=lambda i: math.dist(path[i], [x,z]))
        departure = [point(x,z)] + [point(*p) for p in reversed(path[:start_index])]
        _, road_point, road = nearest(data['roads'], *path[0])
        departure.append(point(*road_point))
        home_metadata = {'position':point(x,z), 'heading':recommendation['headingRadians'], 'label':'Home',
            'kind':'driveway-apron', 'road':'Beverly Drive', 'distanceToAddressMeters':round(math.hypot(x,z),1),
            'departurePath':departure, 'confidence':recommendation['confidence'],
            'note':'Exposed 2025 parking apron. The curved access is visible in 2010/2013 official aerials but canopy-obscured in 2025; current hidden edges remain approximate.'}
        data['home'] = home_metadata
        manifest['home'] = home_metadata
        manifest['adjustments'] = [s for s in manifest['adjustments'] if not s.startswith('Home is a roadside')]
        manifest['adjustments'].append(home_metadata['note'])
    survey['roadSigns'] = junction_signs(data)
    survey['limits'] = [s for s in survey['limits'] if 'number2 is only' not in s]
    survey['limits'] += [
        'Property pavement, decks and pools are manually traced from dated imagery. Canopy-obscured segments remain explicitly inferred; vertical construction details are approximate.',
        'Stop and street signs at both Beverly/West Ridge junctions are representative US signs placed from verified road geometry; exact real sign locations and stop control were not established by the overhead imagery.']
    manifest['adjustments'].append('Reviewed property outlines replace driveway strips. Small mouth bridges join imagery to the retained OSM pavement; exact property grades remain unresolved by the coarse DEM.')
    apply_home_photographs(data, survey, manifest)

def apply_home_photographs(data, survey, manifest):
    source_path = RESEARCH.parent / 'research-streetview/home-photo-reference.json'
    source = json.loads(source_path.read_text(encoding='utf-8'))
    building = next(b for b in data['buildings'] if b['id'] == source['buildingId'])
    building['appearanceConfidence'] = 'Photo-observed front facade from user-supplied views; side/rear relationships confirmed by user, dimensions approximate'
    building['reference'].update(homePhoto=True, wallColor=0xe6e4d9, shutterColor=0x743a33, doorColor=0x70403d, roofColor=0x806b5b)
    building['appearanceSource'] = source['referenceId']
    observation = next(o for o in survey['buildingObservations'] if o['id'] == building['id'])
    observation.update(photographedFacade=True, appearanceConfidence=building['appearanceConfidence'])
    survey['homeReference'] = source
    survey['propertySourceSha256']['../research-streetview/home-photo-reference.json'] = hashlib.sha256(source_path.read_bytes()).hexdigest()
    for feature in survey['propertyFeatures']:
        if feature['id'] == 'east-deck-2':
            feature['renderedBy'] = 'home-yard'
            feature['supersededBy'] = source['referenceId']
            feature['renderNote'] = 'Retained aerial trace is evidence for part of the rear deck. The dedicated Home renderer supplies the complete user-confirmed elevated side/rear deck and patio.'
    survey['sources'].append({'name': 'Home user-supplied street views and direct description', 'url': '../../docs/research-streetview/home-photo-observations.md'})
    survey['limits'] = [s.replace('numbers12,20', 'numbers2,12,20') for s in survey['limits']]
    manifest['adjustments'].append('Home now uses its user-photographed front facade and user-confirmed right-side deck, lower patio and rear screened porch. Fine dimensions and exact yard grades remain approximate; no source photograph is used as a game texture.')

def junction_signs(data):
    """Two mapped junctions; roadside placement is representative, not image-measured."""
    beverly = next(r for r in data['roads'] if r['name']=='Beverly Drive')
    points = beverly['points']
    result = []
    for suffix, junction, previous in [('west', points[0], points[1]), ('east', points[-1], points[-2])]:
        dx, dz = junction[0]-previous[0], junction[2]-previous[2]
        distance = math.hypot(dx,dz)
        dx, dz = dx/distance, dz/distance
        # For +Z travel in this coordinate system, the US right shoulder is -X.
        rightX, rightZ = -dz, dx
        position = [junction[0]-dx*10+rightX*(beverly['width']/2+1.0), junction[2]-dz*10+rightZ*(beverly['width']/2+1.0)]
        direction = math.atan2(dx,dz)
        base = {'source':'Cached OSM Beverly / West Ridge shared-node junction; sign placement inferred',
            'confidence':'representative-junction-placement', 'evidence':'inferred-road-control',
            'notes':'Street names and junction topology verified. Actual sign inventory and position are not independently verified.'}
        result.append({**base,'id':'beverly-'+suffix+'-stop','kind':'stop','position':position,'facingHeading':direction+math.pi})
        ridge = [r for r in data['roads'] if r['name']=='West Ridge Road']
        pairs = [(a,b) for r in ridge for a,b in zip(r['points'],r['points'][1:])]
        ra,rb = min(pairs,key=lambda pair:min(math.hypot(p[0]-junction[0],p[2]-junction[2]) for p in pair))
        ridge_heading = math.atan2(rb[0]-ra[0],rb[2]-ra[2])
        result.append({**base,'id':'beverly-'+suffix+'-street','kind':'street',
            'position':[position[0]-dx*1.15,position[1]-dz*1.15],
            'blades':[{'text':'BEVERLY DR','heading':direction+math.pi/2}, {'text':'WEST RIDGE RD','heading':ridge_heading+math.pi/2}]})
    return result
