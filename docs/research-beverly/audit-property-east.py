"""Independently audit east property geometry against roads.ts house envelopes.

Standard-library planar polygon clipping. Does not change source observations,
map geometry, or game code. All areas are square meters in the local X/Z plane.
"""
from pathlib import Path
import json, math

ROOT=Path(__file__).resolve().parent
def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def signed_area(p):return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(p,p[1:]+p[:1]))/2
def area(p):return abs(signed_area(p)) if len(p)>2 else 0
def clean(p):
    q=[]
    for v in p:
        if not q or math.dist(v,q[-1])>1e-8:q.append(v)
    if len(q)>1 and math.dist(q[0],q[-1])<1e-8:q.pop()
    return q
def triangles(poly):
    p=clean(poly)
    if signed_area(p)<0:p.reverse()
    out=[]
    while len(p)>3:
        for i,b in enumerate(p):
            a,c=p[i-1],p[(i+1)%len(p)]
            if cross(a,b,c)<=1e-9:continue
            if any(all(v>=-1e-9 for v in [cross(a,b,q),cross(b,c,q),cross(c,a,q)]) for j,q in enumerate(p) if j not in [(i-1)%len(p),i,(i+1)%len(p)]):continue
            out.append([a,b,c]);p.pop(i);break
        else:raise ValueError('Cannot triangulate polygon; check self-crossings or duplicate vertices')
    if len(p)==3 and area(p)>1e-9:out.append(p)
    return out
def clip(poly,fn):
    if len(poly)<3:return []
    result=[];previous=poly[-1];pd=fn(previous)
    for current in poly:
        cd=fn(current)
        if (cd>=0)!=(pd>=0):
            t=pd/(pd-cd)
            result.append([previous[k]+(current[k]-previous[k])*t for k in [0,1]])
        if cd>=0:result.append(current)
        previous,pd=current,cd
    return clean(result)
def intersection(poly,convex):
    sign=1 if signed_area(convex)>0 else -1
    for a,b in zip(convex,convex[1:]+convex[:1]):
        poly=clip(poly,lambda p:sign*cross(a,b,p))
        if len(poly)<3:return []
    return poly
def subtract(poly,triangle):
    sign=1 if signed_area(triangle)>0 else -1
    outside=[]
    for a,b in zip(triangle,triangle[1:]+triangle[:1]):
        piece=clip(poly,lambda p:-sign*cross(a,b,p))
        if area(piece)>1e-9:outside.append(piece)
        poly=clip(poly,lambda p:sign*cross(a,b,p))
        if len(poly)<3:break
    return outside
def rectangle(x,z,width,depth,heading):
    c,s=math.cos(heading),math.sin(heading)
    return [[x+lx*c+lz*s,z-lx*s+lz*c] for lx,lz in [(-width/2,-depth/2),(width/2,-depth/2),(width/2,depth/2),(-width/2,depth/2)]]
def nearest(roads,x,z):
    best=None
    for r in roads:
        for a,b in zip(r['points'],r['points'][1:]):
            dx,dz=b[0]-a[0],b[2]-a[2]
            t=max(0,min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz or 1)))
            d=math.hypot(x-a[0]-dx*t,z-a[2]-dz*t)
            if best is None or d<best[0]:best=(d,math.atan2(dx,dz),r['width'])
    return best
def envelopes(data):
    out=[]
    pending=list(data['buildings'])
    while pending:
        building=pending.pop(0)
        # Match roads.ts recursive renderParts handling. The source footprint is
        # still authoritative, but each specified wing has its own envelope.
        if building.get('renderParts'):
            pending[0:0]=[{**building,'id':f"{building['id']}:{part['id']}",
                          'points':part['points'],'renderParts':None,
                          'reference':{**(building.get('reference') or {}),
                                       'entrance':part.get('entrance',i==len(building['renderParts'])-1)}}
                         for i,part in enumerate(building['renderParts'])]
            continue
        p=building.get('points',building.get('footprint',[]))
        if not p:continue
        longest=0;heading=0
        for a,b in zip(p,p[1:]):
            dx,dz=b[0]-a[0],b[2]-a[2];length=dx*dx+dz*dz
            if length>longest:longest=length;heading=math.atan2(dx,dz)
        c,s=math.cos(heading),math.sin(heading);origin=p[0]
        q=[[(v[0]-origin[0])*c-(v[2]-origin[2])*s,(v[0]-origin[0])*s+(v[2]-origin[2])*c] for v in p]
        lo=[min(v[k] for v in q) for k in [0,1]];hi=[max(v[k] for v in q) for k in [0,1]]
        cx,cz=[(lo[k]+hi[k])/2 for k in [0,1]]
        x,z=origin[0]+cx*c+cz*s,origin[2]-cx*s+cz*c
        width=max(2 if building.get('reference') else 4,hi[0]-lo[0]);depth=max(2 if building.get('reference') else 4,hi[1]-lo[1])
        distance,rh,rw=nearest(data['roads'],x,z)
        nx,nz=math.cos(rh),-math.sin(rh)
        extent=(abs(nx*c-nz*s)*width+abs(nx*s+nz*c)*depth)/2
        scale=min(1,(distance-rw/2-2)/max(1,extent))
        if scale<.4:continue
        out.append({'id':building['id'],'address':building.get('address',''),'points':rectangle(x,z,width*scale,depth*scale,heading),'scale':scale})
    return out

def audit(data,observations):
    boxes=envelopes(data);hits=[]
    for feature in observations['features']:
        ts=triangles(feature['points'])
        for box in boxes:
            overlap=sum(area(intersection(t,box['points'])) for t in ts)
            if overlap>1e-4:hits.append({'feature':feature['id'],'building':box['id'],'address':box['address'],'overlapAreaMeters2':round(overlap,6),'envelope':box['points']})
    h=observations['home']['spawnRecommendation'];car=rectangle(*h['positionXZ'],2.1,5.2,h['headingRadians'])
    pieces=[car]
    for f in observations['features']:
        if f['id'] not in observations['home']['connectionFeatureIds']:continue
        for tri in triangles(f['points']):pieces=[p for piece in pieces for p in subtract(piece,tri)]
    blocked=[]
    for box in boxes:
        overlap=area(intersection(car,box['points']))
        if overlap>1e-4:blocked.append({'building':box['id'],'areaMeters2':overlap})
    old_sources=[{'feature':f['id'],'sourceId':f['sourceId'],'evidence':f['evidence'],'confidence':f['confidence']} for f in observations['features'] if not f['sourceId'].endswith('2025')]
    return {'method':'Replicates roads.ts renderParts expansion, longest-edge oriented envelope, minimum dimensions and road-clearance scale; exact convex clipping after polygon triangulation.',
            'houseEnvelopeCount':len(boxes),'featureCount':len(observations['features']),'envelopeIntersections':hits,
            'homeCar':{'lengthMeters':5.2,'widthMeters':2.1,'corners':car,'areaMeters2':area(car),'uncoveredAreaMeters2':sum(area(p) for p in pieces),'uncoveredPieces':pieces,'buildingIntersections':blocked},
            'historicalFeatures':old_sources,
            'limits':'Plan-view envelope and pavement coverage only. Does not certify terrain grade, 3D porch/stair/roof projections, or retained tree clearance.'}

if __name__=='__main__':
    data=json.loads((ROOT.parents[1]/'public/map/warwick.json').read_text())
    observations=json.loads((ROOT/'property-east-observations.json').read_text())
    result=audit(data,observations)
    (ROOT/'property-east-envelope-audit.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
