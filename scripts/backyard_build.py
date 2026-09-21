"""Reproduce Home's mapped woodland/creek and a small, explicit scenic channel cut.

The stream centerline is source geometry. Width, depth, bank shape, plant species
and interior stems are rendering estimates, not measurements from the source.
"""
from pathlib import Path
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / 'docs' / 'research-backyard'


def terrain_height(g, x, z):
    u = max(0, min(g['cols'] - 1, (x-g['minX'])/(g['maxX']-g['minX'])*(g['cols']-1)))
    v = max(0, min(g['rows'] - 1, (z-g['minZ'])/(g['maxZ']-g['minZ'])*(g['rows']-1)))
    a, b = min(g['cols']-2, int(u)), min(g['rows']-2, int(v))
    fx, fz = u-a, v-b
    h00, h10 = g['heights'][b*g['cols']+a:b*g['cols']+a+2]
    h01, h11 = g['heights'][(b+1)*g['cols']+a:(b+1)*g['cols']+a+2]
    return h00+(h10-h00)*fx+(h01-h00)*fz if fx+fz <= 1 else h11+(h01-h11)*(1-fx)+(h10-h11)*(1-fz)


def nearest(points, x, z):
    best = (float('inf'), 0, 0)
    for i, (a, b) in enumerate(zip(points, points[1:])):
        dx, dz = b[0]-a[0], b[1]-a[1]
        t = max(0, min(1, ((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz or 1)))
        distance = math.hypot(x-a[0]-dx*t, z-a[1]-dz*t)
        if distance < best[0]: best = distance, i, t
    return best


def apply_backyard(data, manifest):
    woods = json.loads((RESEARCH/'woodland-observations.json').read_text(encoding='utf-8'))
    hydro = json.loads((RESEARCH/'hydro-observations.json').read_text(encoding='utf-8'))
    source = hydro['stream']
    bounds = woods['bounds']
    paths, current = [], []
    def eligible(p):
        x, z = p
        if not (bounds['minX'] <= x <= bounds['maxX'] and bounds['minZ'] <= z <= bounds['maxZ']): return False
        for road in data['roads']:
            ps = [[q[0],q[2]] for q in road['points']]
            if nearest(ps, x, z)[0] < road['width']/2+12: return False
        return True
    original = source['pointsXZ']
    for a, b in zip(original, original[1:]):
        count = max(1, math.ceil(math.dist(a,b)/1.2))
        for i in range(count):
            p = [a[k]+(b[k]-a[k])*i/count for k in range(2)]
            if eligible(p): current.append(p)
            elif current:
                paths.append(current)
                current = []
    if current: paths.append(current)
    points = max(paths, key=len)
    assert len(points) > 30, 'Expected the mapped backyard stream reach'
    ground = data['terrain']
    stations, distance = [], 0
    for i, p in enumerate(points):
        if i: distance += math.dist(points[i-1],p)
        # Channel width varies gently around 2.2 m. This is an explicitly inferred
        # visual cross-section, separate from the unaltered source centerline.
        width = 2.2 + .32*math.sin(distance*.075) + .12*math.sin(distance*.31)
        level = terrain_height(ground,*p)-.32
        # The 30m DEM smooths away the actual ravine and puts an artificial hump
        # across this mapped downstream line. Keep water descending; carve the
        # representative bed below it instead of rendering uphill flowing water.
        if stations:
            level = min(level, stations[-1]['waterY']-.002*(distance-stations[-1]['distance']))
        stations.append({'point':[round(q,5) for q in p], 'width':round(width,4),
                         'waterY':round(level,6), 'distance':round(distance,5)})
    length = distance
    for station in stations:
        fade = min(1, station['distance']/9, (length-station['distance'])/9)
        station['width'] *= .15+.85*max(0,fade)
        station['fade'] = round(max(0,fade),6)
    dx=(ground['maxX']-ground['minX'])/(ground['cols']-1)
    dz=(ground['maxZ']-ground['minZ'])/(ground['rows']-1)
    first_x=math.floor((bounds['minX']-ground['minX'])/dx)
    last_x=math.ceil((bounds['maxX']-ground['minX'])/dx)
    first_z=math.floor((bounds['minZ']-ground['minZ'])/dz)
    last_z=math.ceil((bounds['maxZ']-ground['minZ'])/dz)
    subdivision=40
    grid={'minX':ground['minX']+first_x*dx,'maxX':ground['minX']+last_x*dx,
          'minZ':ground['minZ']+first_z*dz,'maxZ':ground['minZ']+last_z*dz,
          'cols':(last_x-first_x)*subdivision+1,'rows':(last_z-first_z)*subdivision+1,
          'heights':[]}
    # A small bucket index limits each high-resolution sample to nearby flowlines.
    buckets={}
    for i,(a,b) in enumerate(zip(points,points[1:])):
        for iz in range(math.floor((min(a[1],b[1])-10)/8),math.floor((max(a[1],b[1])+10)/8)+1):
            for ix in range(math.floor((min(a[0],b[0])-10)/8),math.floor((max(a[0],b[0])+10)/8)+1):
                buckets.setdefault((ix,iz),[]).append(i)
    for row in range(grid['rows']):
        z=grid['minZ']+(grid['maxZ']-grid['minZ'])*row/(grid['rows']-1)
        for col in range(grid['cols']):
            x=grid['minX']+(grid['maxX']-grid['minX'])*col/(grid['cols']-1)
            base=terrain_height(ground,x,z)
            best=(float('inf'),0,0)
            for i in buckets.get((math.floor(x/8),math.floor(z/8)),[]):
                d,_,t=nearest(points[i:i+2],x,z)
                if d<best[0]:best=d,i,t
            d,i,t=best
            if d<9:
                a,b=stations[i:i+2]
                blend=lambda key:a[key]+(b[key]-a[key])*t
                half=blend('width')/2
                water=blend('waterY')
                bank=max(2.1,min(6,(base-water)*1.9))
                if d<half+bank:
                    if d<=half:
                        target=water-.21+.15*(d/max(.1,half))**2
                    else:
                        f=(d-half)/bank
                        f=f*f*(3-2*f)
                        target=(water-.06)*(1-f)+base*f
                    base += (min(base,target)-base)*blend('fade')
            grid['heights'].append(round(base,6))
    backyard={'schemaVersion':1,'name':'Home woods and Stony Creek','bounds':bounds,
        'woodlands':woods['woodlands'],'canopies':woods['canopies'],
        'stream':{**source,'stations':stations,'renderedLengthMeters':round(length,2),
            'widthStatus':'Inferred approximately 2.2 m; not measured',
            'depthStatus':'Approximately 0.2 m water depth; inferred ravine cut reconciles the coarse DEM hump with a descending stream. Bank elevations and cross-section are not surveyed.',
            'reachLimit':'Only the inspected woodland reach, ending before the existing West Ridge road; no unverified culvert reconstruction.'},
        'terrain':grid,'sources':woods['sources'],
        'limits':['Mapped stream plan geometry and aerial woodland edge; unmeasured bank grade, stream width/depth, interior stems and plant species are representative.',
                  'The local terrain grid refines interpolation of the existing DEM and adds a shallow scenic channel; it is not new lidar elevation.']}
    data['backyard']=backyard
    manifest['backyard']={k:v for k,v in backyard.items() if k not in ['terrain','stream','woodlands','canopies']}
    manifest['backyard'].update(streamName=source['name'],streamId=source['id'],
        renderedLengthMeters=round(length,2),terrainGrid=[grid['cols'],grid['rows']],
        cacheHashEncoding='UTF-8 text with LF line endings, independent of Git checkout platform',
        cacheSha256={name:hashlib.sha256((RESEARCH/name).read_text(encoding='utf-8').encode('utf-8')).hexdigest()
                     for name in ['hydro-observations.json','woodland-observations.json']})
    manifest['adjustments'].append('Home backyard uses the USGS Stony Creek centerline and dated NYS woodland edge. Local fine terrain is an interpolation with an inferred shallow channel, not a new elevation survey; roads and house footprints remain unchanged.')
    print(f"Backyard: {len(stations)} Stony Creek stations / {length:.1f}m; local terrain {grid['cols']}x{grid['rows']}")
