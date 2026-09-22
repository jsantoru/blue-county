"""Original Blender-built Lug Nuts cars, in-place game assets and review previews.

blender --background --python-exit-code 1 --python scripts/build-club-cars.py
Photographs are visual reference only; no user photo pixels enter these assets.
Geometry helpers take GAME coordinates (+X left, +Y up, +Z forward) and author
Blender X/-Y/Z. glTF export_yup produces the game's coordinates without a wrapper.
"""
import bpy, bmesh, math, json, struct, hashlib, random, argparse, sys
from pathlib import Path
from mathutils import Vector, Matrix
from math import sin, cos, pi, sqrt
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public'/'assets'/'club-cars';OUT.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT/'asset-source';SOURCE.mkdir(exist_ok=True)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--member',choices=('lou','chris','craig','ed'),help='Rebuild one member, preserving other delivered files and editable collections')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
unchanged_files={file:hashlib.sha256(file.read_bytes()).hexdigest() for file in list(OUT.glob('*'))+list((ROOT/'public'/'assets').glob('oldsmobile*')) if file.is_file() and args.member and not file.name.startswith(args.member+'.') and not file.name.startswith(args.member+'-')}
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC'
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_percentage=100
scene.eevee.taa_render_samples=128
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.render.image_settings.file_format='PNG'
random.seed(442)

def collection_signature(col):
 """Content fingerprint of the preserved source, excluding viewport visibility."""
 h=hashlib.sha256()
 for obj in sorted(col.all_objects,key=lambda o:o.name):
  h.update(repr((obj.name,obj.parent.name if obj.parent else None,[list(row) for row in obj.matrix_local])).encode())
  if obj.type=='MESH':
   for vertex in obj.data.vertices:h.update(struct.pack('<3f',*vertex.co))
   for face in obj.data.polygons:h.update(struct.pack('<'+'I'*len(face.vertices),*face.vertices))
   for mat in obj.data.materials:
    h.update(repr((mat.name,list(mat.diffuse_color),mat.roughness,mat.metallic)).encode())
 return h.hexdigest()

preserved=[]
if args.member:
 source_path=SOURCE/'lug-nuts-cars.blend'
 if not source_path.exists():raise RuntimeError('--member requires the existing shared Blender source')
 owners={'lou':'Lou','chris':'Chris','craig':'Craig','ed':'Ed'}
 with bpy.data.libraries.load(str(source_path),link=False) as (data_from,data_to):
  data_to.collections=[name for name in data_from.collections if any(name.startswith(owner+' | ') for ident,owner in owners.items() if ident!=args.member)]
 for col in data_to.collections:
  scene.collection.children.link(col)
  preserved.append((col,collection_signature(col),col.hide_render,col.hide_viewport))
  col.hide_render=True;col.hide_viewport=True

CARS=[
 dict(id='lou',name='1976 Pontiac Trans Am',owner='Lou',paint=(.75,.062,.018),color='Carousel Red',front=2.48,rear=2.42,width=.95,frontAxle=1.41,rearAxle=-1.34,radius=.345,track=.81,roof=1.49,seatY=-.10,kind='transam',interior=(.032,.035,.034)),
 dict(id='chris',name='1968 Chevrolet Camaro RS/SS',owner='Chris',paint=(.063,.071,.080),color='Graphite (temporary pending owner color)',front=2.36,rear=2.34,width=.91,frontAxle=1.36,rearAxle=-1.385,radius=.338,track=.77,roof=1.51,seatY=-.10,kind='camaro',interior=(.04,.041,.039)),
 dict(id='craig',name='1965 Pontiac 2+2 Convertible',owner='Craig',paint=(.34,.086,.030),color='Samoan Bronze',front=2.74,rear=2.70,width=1.01,frontAxle=1.51,rearAxle=-1.54,radius=.352,track=.86,roof=None,seatY=.10,kind='pontiac',interior=(.68,.66,.56)),
 dict(id='ed',name='1953 Buick Estate Woody Wagon',owner='Ed',paint=(.025,.15,.29),color='Deep blue with ash and walnut woodwork',front=2.70,rear=2.64,width=1.01,frontAxle=1.53,rearAxle=-1.57,radius=.372,track=.85,roof=1.84,seatY=.10,kind='buick',interior=(.19,.095,.044)),
]

def p(v):return Vector((v[0],-v[2],v[1]))
def game(v):return [v.x,v.z,-v.y]
def material(name,color,rough=.5,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
 return m

chrome=material('Polished period chrome',(.63,.67,.69),.18,.92)
alloy=material('Machined alloy',(.43,.46,.49),.27,.86)
rubber=material('Black tire rubber',(.014,.017,.018),.91)
black=material('Recessed black grille',(.010,.014,.018),.68)
steel=material('Chassis dark steel',(.041,.050,.058),.64,.5)
cream=material('Warm whitewall rubber',(.76,.74,.65),.84)
red=material('Ruby tail lamp lens',(.43,.008,.009),.23,.10)
amber=material('Amber marker lens',(.95,.28,.011),.25,.08)
lamp=material('Headlamp patterned clear lens',(.31,.39,.43),.13,.40)
glass=material('Pale smoked automotive glass',(.09,.18,.22),.14,.1)
glass.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value=.21
glass.diffuse_color=(*glass.diffuse_color[:3],.21);glass.surface_render_method='DITHERED'
gold=material('Muted Trans Am gold',(.65,.39,.075),.35,.63)
birdInk=material('Trans Am hood graphic dark ink',(.035,.052,.065),.48)
ash=material('Honey ash framing',(.42,.22,.060),.48)
wood=material('Walnut wagon panel grain',(.18,.057,.018),.51)
gauge=material('Warm instrument markings',(.72,.68,.52),.6)

# Original baked grain, valid base color only; never export a height as normals.
def woodgrain(target=wood,base=(.23,.087,.028)):
 import numpy as np
 y,x=np.mgrid[:256,:512];rng=np.random.default_rng(1953)
 lines=np.sin(y*.19+np.sin(x*.027)*1.5+np.sin(x*.009)*2.3)
 fibers=np.sin(y*1.61+np.sin(x*.021))*0.013+rng.normal(0,.010,x.shape)
 rgb=np.array(base)[None,None,:]+(lines*.025+fibers)[:,:,None]
 pixels=np.ones((256,512,4),dtype=np.float32);pixels[:,:,:3]=np.clip(rgb,0,1)
 im=bpy.data.images.new('Original walnut grain' if target is wood else 'Original Buick walnut grain',width=512,height=256);im.pixels.foreach_set(pixels.ravel());im.pack()
 tex=target.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
 target.node_tree.links.new(tex.outputs['Color'],target.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
woodgrain()
buick_wood=material('Walnut wagon panel grain | Buick',(.33,.145,.051),.51)
woodgrain(buick_wood,(.33,.145,.051))

groups=None;car_collection=None
def register(obj,mat,group='Body'):
 for c in list(obj.users_collection):c.objects.unlink(obj)
 car_collection.objects.link(obj)
 if mat:obj.data.materials.append(mat)
 if obj.type=='MESH':
  for f in obj.data.polygons:f.use_smooth=True
 groups[group].append(obj);return obj

def mesh(name,vertices,faces,mat,group='Body',smooth=True):
 data=bpy.data.meshes.new(name);data.from_pydata([p(v) for v in vertices],[],faces);data.update()
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
 obj=bpy.data.objects.new(name,data);car_collection.objects.link(obj);register(obj,mat,group)
 for f in data.polygons:f.use_smooth=smooth
 uv=data.uv_layers.new(name='UVMap')
 for loop in data.loops:
  v=data.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(-v.y*.45,v.z*1.8)
 return obj

def box(name,center,size,mat,group='Body',bevel=.018):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p(center));o=bpy.context.object;o.name=name
 o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  mod=o.modifiers.new('Soft formed edges','BEVEL');mod.width=bevel;mod.segments=3
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True
  bpy.ops.object.modifier_apply(modifier=mod.name)
 return register(o,mat,group)

def ellipsoid(name,center,radii,mat,group='Body',segments=32,rings=16):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=p(center));o=bpy.context.object;o.name=name
 o.scale=(radii[0],radii[2],radii[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 return register(o,mat,group)

def rod(name,start,end,radius,mat,group='Body',vertices=16):
 a=p(start);b=p(end);delta=b-a
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=delta.length,location=(a+b)/2)
 o=bpy.context.object;o.name=name;o.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
 return register(o,mat,group)

def torus(name,center,major,minor,mat,normal=(1,0,0),group='Body',segments=48,tube=10):
 bpy.ops.mesh.primitive_torus_add(major_segments=segments,minor_segments=tube,major_radius=major,minor_radius=minor,location=p(center))
 o=bpy.context.object;o.name=name;o.rotation_euler=p(normal).to_track_quat('Z','Y').to_euler();return register(o,mat,group)

def path(name,points,radius,mat,group='Body',closed=False,capped=False):
 data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=radius;data.bevel_resolution=1
 data.use_fill_caps=capped
 spline=data.splines.new('POLY');spline.points.add(len(points)-1)
 for q,v in zip(spline.points,points):q.co=(*p(v),1)
 spline.use_cyclic_u=closed
 o=bpy.data.objects.new(name,data);car_collection.objects.link(o);data.materials.append(mat)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
 return register(bpy.context.object,None,group)

def text(name,body,location,size,mat,normal=(0,0,1),group='Body'):
 data=bpy.data.curves.new(name,'FONT');data.body=body;data.size=size;data.align_x='CENTER';data.align_y='CENTER';data.extrude=.0005;data.resolution_u=2
 o=bpy.data.objects.new(name,data);car_collection.objects.link(o);o.location=p(location);o.rotation_euler=p(normal).to_track_quat('Z','Y').to_euler();data.materials.append(mat)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
 return register(bpy.context.object,None,group)

def rounded_panel(name,center,size,mat,group='Body',bevel=.012):return box(name,center,size,mat,group,bevel)
def empty(name,parent=None,location=(0,0,0)):
 o=bpy.data.objects.new(name,None);car_collection.objects.link(o);o.parent=parent;o.location=p(location);return o

def interp(t,anchors):
 for (a,x),(b,y) in zip(anchors,anchors[1:]):
  if a<=t<=b:
   u=(t-a)/(b-a);u=u*u*(3-2*u);return x+(y-x)*u
 return anchors[0][1] if t<anchors[0][0] else anchors[-1][1]

def dimensions(c,z):
 w=c['width'];front=c['front'];rear=c['rear'];kind=c['kind']
 # Distinct stamped-body plan views, not a common rectangular extrusion.
 profiles={
  'transam':[(-rear,.89),(-rear+.36,.985),(-1.34,1.035),(-.62,.948),(.55,.95),(1.40,1.035),(front-.32,.98),(front,.88)],
  'camaro':[(-rear,.91),(-rear+.25,.99),(-1.40,1.02),(-.65,.97),(.55,.98),(1.40,1.018),(front-.18,.97),(front,.92)],
  'pontiac':[(-rear,.94),(-rear+.28,1.00),(-1.65,1.025),(-.67,.975),(.58,.98),(1.51,1.02),(front-.20,.98),(front,.97)],
  'buick':[(-rear,.96),(-1.80,1.015),(-.72,.985),(.62,.99),(1.53,1.055),(front-.30,1.025),(front,.97)]}
 width=w*interp(z,profiles[kind])
 if kind=='buick':top=interp(z,[(-rear,1.15),(-1.70,1.19),(-1.20,1.18),(-.87,1.065),(.6,1.055),(1.6,1.17),(front,1.06)])
 elif kind=='pontiac':top=interp(z,[(-rear,.98),(-1.65,1.075),(-.8,1.00),(.65,1.005),(1.5,1.065),(front,1.015)])
 else:top=interp(z,[(-rear,.83),(-1.4,.97),(-.8,.91),(.6,.92),(1.5,.995),(front,.94 if kind=='transam' else .90)])
 return width,top

def skinx(c,z,y):
 w,top=dimensions(c,z);t=max(0,min(1,(y-.27)/(top-.27)))
 roundness=.075 if c['kind']=='transam' else .055 if c['kind']=='buick' else .042
 return w-.11*(1-t)**2-roundness*t**9+.014*sin(t*pi)

def crown(c,x,z):
 w,top=dimensions(c,z);t=abs(x)/w
 # The outer rolled shoulder and bonnet crown are one continuously curved
 # sheet. A lower side tangent reads as stamped metal under broad reflections.
 rise=.15 if c['kind']=='buick' and z>.63 else .053 if c['kind']=='transam' else .042
 return top+rise*(1-t*t)-.021*t**10

def curved_panel(name,corners,mat,group='Body',bulge=(0,0,0),nu=16,nv=12):
 verts=[];faces=[]
 for j in range(nv+1):
  v=j/nv
  for i in range(nu+1):
   u=i/nu;q=Vector(corners[0])*(1-u)*(1-v)+Vector(corners[1])*u*(1-v)+Vector(corners[2])*u*v+Vector(corners[3])*(1-u)*v
   q+=Vector(bulge)*sin(pi*u)*sin(pi*v);verts.append(q)
 for j in range(nv):
  for i in range(nu):
   a=j*(nu+1)+i;faces.append((a,a+1,a+nu+2,a+nu+1))
 return mesh(name,verts,faces,mat,group)

def body(c,paint,upholstery):
 front=c['front'];rear=c['rear'];wheelZ=(c['frontAxle'],c['rearAxle']);r=c['radius'];dw=.64;back=-.77
 samples=sorted(set([round(-rear+(front+rear)*i/160,7) for i in range(161)]+[back,dw]))
 for side in (1,-1):
  # Connected grids share normals along the complete rigid panel, avoiding
  # the old 160 disconnected longitudinal strips and their stair-step shine.
  for start,end,group in [(-rear,back,'Body'),(back,dw,'DoorL' if side>0 else 'DoorR'),(dw,front,'Body')]:
   zs=[z for z in samples if start<=z<=end]
   verts=[];faces=[]
   for z in zs:
    w,top=dimensions(c,z)
    low=.30
    for axle in wheelZ:
     dz=z-axle;arch=r+.047
     if abs(dz)<arch:low=max(low,r+sqrt(arch*arch-dz*dz))
    for k in range(17):
     y=low+(top-low)*k/16;verts.append((side*skinx(c,z,y),y,z))
   for j in range(len(zs)-1):
    for k in range(16):
     a=j*17+k;faces.append((a,a+1,a+18,a+17))
   mesh('Sculpted side sheet',verts,faces,paint,group)
  # Inner door card and closed metal returns belong to the moving door. No
  # static exterior wall spans the passenger doorway behind them.
  group='DoorL' if side>0 else 'DoorR';x=side*(c['width']-.17)
  box('Inner upholstered door card',(x,.635,-.065),(.042,.53,1.36),upholstery,group,.025)
  box('Door padded armrest',(x-side*.045,.715,-.13),(.083,.072,.41),upholstery,group,.023)
  box('Interior chrome door release',(x-side*.075,.81,.39),(.025,.025,.11),chrome,group,.01)
  rod('Window crank',(x-side*.072,.67,.32),(x-side*.072,.61,.23),.012,chrome,group)
  ellipsoid('Window crank knob',(x-side*.08,.61,.23),(.015,.021,.021),black,group,16,10)
  for end in (back,dw):
   verts=[];faces=[];top=dimensions(c,end)[1]
   for i in range(12):
    y=.335+(top-.335)*i/11
    verts.extend([(side*skinx(c,end,y),y,end),(x,y,end)])
   for i in range(11):faces.append((i*2,i*2+1,i*2+3,i*2+2))
   mesh('Shaped door formed edge return',verts,faces,paint,group)
  box('Door bottom folded edge',(side*(c['width']-.145),.335,-.065),(.105,.035,1.4),paint,group,.008)
  box('Fixed doorway sill',(side*(c['width']-.17),.312,-.065),(.13,.047,1.48),steel)
  box('Chrome sill plate',(side*(c['width']-.17),.341,-.065),(.105,.013,1.32),chrome,bevel=.004)
  box('Exterior chrome door handle',(side*(c['width']+.001),1.195 if c['kind']=='buick' else .835,-.54),(.035,.032,.15),chrome,group,.011)
  # Outside rear-view mirror follows the door.
  rod('Mirror stem',(side*(c['width']-.03),.975,.48),(side*(c['width']+.09),1.015,.42),.012,chrome,group)
  ellipsoid('Mirror housing',(side*(c['width']+.11),1.035,.40),(.085,.052,.045),paint if c['kind']=='transam' else chrome,group)
  ellipsoid('Mirror optical face',(side*(c['width']+.11),1.035,.359),(.069,.037,.003),alloy,group,24,12)
  # Wheel-arch rolled lips follow real openings.
  for axle in wheelZ:
   points=[]
   for i in range(37):
    angle=pi*i/36;z=axle+(r+.049)*cos(angle);y=r+(r+.049)*sin(angle)
    points.append((side*(skinx(c,z,y)+.004),y,z))
   path('Rolled fender wheel arch',points,.012,paint if c['kind']=='transam' else chrome)
   verts=[];faces=[]
   for i in range(49):
    angle=pi*i/48;z=axle+(r+.055)*cos(angle);y=r+(r+.055)*sin(angle)
    verts.extend([(side*(skinx(c,z,y)-.009),y,z),(side*(c['track']-.20),y+.055,z)])
   for i in range(48):faces.append((i*2,i*2+1,i*2+3,i*2+2))
   mesh('Dark deep inner wheelhouse',verts,faces,black)
  # Continuous bright belt trim is partitioned at the door boundaries.
  if c['kind']=='pontiac':
   for start,end,grp in [(-rear,back,'Body'),(back,dw,group),(dw,front,'Body')]:
    points=[]
    for i in range(20):
     z=start+(end-start)*i/19;w,top=dimensions(c,z);points.append((side*(w-.006),top-.025,z))
    path('Fine shoulder brightwork',points,.009,chrome,grp)
 # Hood and rear deck preserve the cabin hole.
 rearEnd=-2.43 if c['kind']=='buick' else -1.46
 for start,end,label in [(.64,front,'Long sculpted hood'),(-rear,rearEnd,'Rear deck')]:
  verts=[];faces=[];N=44;U=18
  for j in range(N+1):
   z=start+(end-start)*j/N;w,top=dimensions(c,z)
   for i in range(U+1):
    edge=skinx(c,z,top);x=-edge+2*edge*i/U
    verts.append((x,crown(c,x,z),z))
  for j in range(N):
   for i in range(U):
    a=j*(U+1)+i;faces.append((a,a+1,a+U+2,a+U+1))
  mesh(label,verts,faces,paint)
  for side in (-1,1):
   path('Hood or deck shut line',[(side*dimensions(c,z)[0]*.82,crown(c,side*dimensions(c,z)[0]*.82,z)+.0015,z) for z in [start+(end-start)*i/32 for i in range(33)]],.002,black)
 box('Solid lower chassis',(0,.27,0),(c['width']*1.72,.13,front+rear-.28),steel,bevel=.03)
 box('Cabin footwell floor',(0,.345,-.12),(c['width']*1.60,.075,1.67),black,bevel=.025)
 box('Front lower valance',(0,.48,front-.055),(c['width']*1.85,.32,.16),paint,bevel=.065)
 box('Rear lower valance',(0,.52,-rear+.04),(c['width']*1.85,.35,.16),paint,bevel=.055)
 fasciaY,fasciaH=(.685,.395) if c['kind']=='transam' else (.745,.40) if c['kind']=='camaro' else (.80,.49) if c['kind']=='pontiac' else (.90,.58)
 if c['kind']!='transam':box('Integrated formed nose surround',(0,fasciaY,front-.067),(c['width']*1.89,fasciaH,.14),paint,bevel=.063)
 # Close the exact curved hood-to-grille contour, including the higher Buick
 # hood crown. The lamps/grilles sit in front of this painted nose sheet.
 nose=[];faces=[];fw,top=dimensions(c,front);half=c['width']*.945
 for i in range(41):
  x=-half+2*half*i/40;raise_y=(.15 if c['kind']=='buick' else .045)*max(0,1-(x/fw)**2)
  nose.extend([(x,.49,front+.004),(x,top+raise_y+.001,front+.004)])
 for i in range(40):faces.append((i*2,i*2+1,i*2+3,i*2+2))
 if c['kind']!='transam':mesh('Continuous painted nose above grille',nose,faces,paint)
 else:
  # A pierced body-colour Endura nose. Actual recessed apertures replace the
  # former headlamp boxes stuck onto an unbroken vertical paint slab.
  verts=[];faces=[];nx=96;ny=40
  for j in range(ny+1):
   t=j/ny
   for i in range(nx+1):
    x=-half+2*half*i/nx;y=.43+(crown(c,x,front)-.43)*t
    zz=front+.018-.045*(abs(x)/half)**6-.014*t
    verts.append((x,y,zz))
  for j in range(ny):
   for i in range(nx):
    a=j*(nx+1)+i;v=(Vector(verts[a])+Vector(verts[a+nx+2]))/2;x=abs(v.x);y=v.y
    grilleHole=.062<x<.625 and .673<y<.936
    lampHole=((x-.757)/.121)**4+((y-.813)/.146)**4<1
    if not (grilleHole or lampHole):faces.append((a,a+1,a+nx+2,a+nx+1))
  mesh('Pierced sculpted Endura nose',verts,faces,paint)

def interior(c,paint,upholstery):
 delta=c['seatY']-.10;seat=.55+delta
 for side in (-1,1):
  x=side*.40
  box('Front bucket cushion',(x,seat,-.29),(.57,.17,.53),upholstery,bevel=.07)
  back=box('Front contoured seat back',(x,seat+.25,-.565),(.56,.53,.16),upholstery,bevel=.065);back.rotation_euler.x=-.12
  for s in (-1,1):
   ellipsoid('Rounded seat side bolster',(x+s*.228,seat+.070,-.30),(.048,.055,.23),upholstery,segments=24,rings=12)
   path('Seat back sewn piping',[(x+s*.222,seat+.025,-.458),(x+s*.231,seat+.34,-.495),(x+s*.188,seat+.46,-.510)],.003,upholstery)
  for i in range(8):
   xx=x-.225+i*.064
   path('Seat back pleat',[(xx,seat+.055,-.457),(xx,seat+.42,-.507)],.006,upholstery)
   path('Seat cushion pleat',[(xx,seat+.086,-.47),(xx,seat+.086,-.075)],.005,upholstery)
  if c['kind'] in ('transam','camaro'):
   box('Padded seat headrest',(x,seat+.58,-.61),(.30,.16,.105),upholstery,bevel=.05)
 box('Rear bench cushion',(0,seat+.06,-1.01),(1.34,.17,.42),upholstery,bevel=.065)
 box('Rear upholstered backrest',(0,seat+.29,-1.25),(1.37,.45,.12),upholstery,bevel=.055)
 if c['kind']=='buick':box('Rear cargo rubber floor',(0,.58,-1.94),(1.49,.065,.98),black,bevel=.008)
 dashboardY=.94+delta
 box('Dashboard upper padded brow',(0,dashboardY,.47),(1.54,.16,.34),upholstery if c['kind'] in ('pontiac','buick') else black,bevel=.05)
 box('Dashboard instrument face',(0,dashboardY-.06,.284),(1.47,.20,.055),steel,bevel=.014)
 for x in (.30,.45,.59):
  torus('Driver instrument chrome bezel',(x,dashboardY-.045,.249),.048,.006,chrome,(0,0,-1),segments=28,tube=8)
  ellipsoid('Instrument black dial',(x,dashboardY-.045,.250),(.045,.045,.004),black,segments=24,rings=10)
  rod('Instrument pale needle',(x,dashboardY-.045,.243),(x+.022,dashboardY-.025,.242),.0018,gauge,vertices=8)
  for k in range(10):
   a=(-.78+1.56*k/9)*pi
   rod('Instrument radial engraved ticks',(x+sin(a)*.034,dashboardY-.045+cos(a)*.034,.242),(x+sin(a)*.040,dashboardY-.045+cos(a)*.040,.242),.0012,gauge,vertices=4)
 box('Period dashboard radio',(0,dashboardY-.075,.245),(.25,.058,.022),chrome,bevel=.008)
 box('Radio dark tuning window',(0,dashboardY-.068,.231),(.16,.029,.006),black,bevel=.004)
 for x in (-.1,.1):ellipsoid('Radio turning knob',(x,dashboardY-.07,.227),(.014,.014,.013),black,segments=16,rings=10)
 box('Passenger glove box',(-.48,dashboardY-.065,.247),(.42,.15,.024),upholstery,bevel=.012)
 box('Floor center console',(0,seat-.02,-.13),(.22,.17,.72),black,bevel=.035)
 rod('Chrome gear shifter',(0,seat+.065,.03),(0,seat+.25,-.065),.012,chrome)
 ellipsoid('Ivory gear shift knob',(0,seat+.25,-.065),(.035,.035,.035),cream,segments=20,rings=12)
 for x in (.30,.43,.56):box('Driver pedal',(x,.42+delta,.60),(.07,.04,.095),rubber,bevel=.008)
 center=(.398,1.038+delta,.064);axis=Vector((0,.638,-.77)).normalized()
 rod('Fixed steering column',(.398,.84+delta,.39),center,.026,black)
 torus('Steering wheel rim',center,.176,.014,wood if c['kind']=='pontiac' else black,tuple(axis),'SteeringWheel',64,12)
 for angle in (25,155,270):
  a=math.radians(angle);r=Vector((cos(a),sin(a)*.77,sin(a)*.638))
  rod('Steering wheel spoke',tuple(Vector(center)+r*.025),tuple(Vector(center)+r*.165),.012,chrome,'SteeringWheel')
 a=Vector(center)-axis*.022;b=Vector(center)+axis*.025
 rod('Steering chrome hub',tuple(a),tuple(b),.037,chrome,'SteeringWheel',32)
 ellipsoid('Steering horn pad',tuple(Vector(center)+axis*.03),(.03,.02,.029),black,'SteeringWheel',24,14)
 return center,tuple(axis)

def buick_greenhouse(c,paint):
 """1953 reference: a timber window cage above blue steel doors/fenders."""
 def sx(y,z):return .944-.165*max(0,min(1,(y-1.20)/.57))+.015*sin(pi*max(0,min(1,(-z+.6)/3)))
 def round_yz(poly,amount=.14):
  points=[]
  for i,b in enumerate(poly):
   b=Vector(b);a=b+(Vector(poly[i-1])-b)*amount;d=b+(Vector(poly[(i+1)%len(poly)])-b)*amount
   for j in range(7):
    t=j/6;q=(1-t)**2*a+2*(1-t)*t*b+t*t*d;points.append(tuple(q))
  return points
 def frame(side,name,outer,inner,group):
  a=round_yz(outer);b=round_yz(inner);n=len(a);verts=[];faces=[]
  for depth in (-.018,.024):
   for ring in (a,b):
    verts.extend([(side*(sx(y,z)+depth),y,z) for y,z in ring])
  for i in range(n):
   j=(i+1)%n;faces.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
  timber=mesh(name+' substantial honey ash surround',verts,faces,ash,group,smooth=False)
  bevel=timber.modifiers.new('Small dressed timber edge radius','BEVEL');bevel.width=.004;bevel.segments=2
  bpy.context.view_layer.objects.active=timber;bpy.ops.object.modifier_apply(modifier=bevel.name)
  glassverts=[(side*(sx(y,z)-.010),y,z) for y,z in b]
  center=tuple(sum(p[k] for p in glassverts)/n for k in range(3));glassverts.append(center)
  mesh(name+' inset curved glazing',glassverts,[(i,(i+1)%n,n) for i in range(n)],glass,group)
  path(name+' glazing black rubber',glassverts[:-1],.005,black,group,True)
 for side in (-1,1):
  group='DoorL' if side>0 else 'DoorR'
  # The swept front timber upright, top rail, sill and veneer all open with
  # the door. The seam remains exactly at z=-.77 / +.64.
  frame(side,'Front door',[(1.205,.63),(1.704,.21),(1.79,.07),(1.79,-.735),(1.205,-.748)],[(1.267,.495),(1.680,.139),(1.721,.025),(1.721,-.665),(1.267,-.676)],group)
  frame(side,'Rear door',[(1.218,-.797),(1.79,-.790),(1.765,-1.58),(1.245,-1.61)],[(1.283,-.865),(1.722,-.865),(1.697,-1.514),(1.300,-1.536)],'Body')
  frame(side,'Rear quarter',[(1.245,-1.655),(1.764,-1.644),(1.682,-2.22),(1.265,-2.475)],[(1.302,-1.718),(1.697,-1.708),(1.621,-2.178),(1.318,-2.349)],'Body')
  # Dark inset appears only in the shallow belt directly under the glazing.
  def low(z):return interp(z,[(-2.47,1.225),(-1.35,1.218),(-1.06,1.035),(.64,1.060)])
  for start,end,grp in [(-.748,.638,group),(-2.475,-.797,'Body')]:
   verts=[];faces=[];lower=[];upper=[]
   for j in range(65):
    z=start+(end-start)*j/64;y0=low(z);y1=interp(z,[(-2.475,1.270),(-1.58,1.245),(-.797,1.218),(.64,1.205)])
    x=side*(sx((y0+y1)/2,z)+.014)
    verts.extend([(x,y0+.022,z),(x,y1-.017,z)])
    lower.append((side*(sx(y0,z)+.030),y0,z));upper.append((side*(sx(y1,z)+.026),y1,z))
   for j in range(64):faces.append((j*2,j*2+1,j*2+3,j*2+2))
   veneer=mesh('Narrow upper walnut belt inset',verts,faces,buick_wood,grp)
   solid=veneer.modifiers.new('Veneer panel thickness','SOLIDIFY');solid.thickness=.018;bpy.context.view_layer.objects.active=veneer;bpy.ops.object.modifier_apply(modifier=solid.name)
   path('Honey ash lower belt following painted haunch',lower,.025,ash,grp,capped=True)
   path('Honey ash broad window sill rail',upper,.026,ash,grp,capped=True)
   for z in (start,end):
    y0=low(z);y1=interp(z,[(-2.475,1.270),(-1.58,1.245),(-.797,1.218),(.64,1.205)])
    path('Honey ash belt vertical joint',[(side*(sx(y,z)+.025),y,z) for y in (y0,y1)],.026,ash,grp,capped=True)
  # The painted rear fender rises above the wheel into the lower wood belt.
  verts=[];faces=[]
  for j in range(65):
   z=-2.59+1.75*j/64;w,top=dimensions(c,z)
   for k in range(9):
    t=k/8;x=(w-.23)*(1-t)+skinx(c,z,top)*t;verts.append((side*x,top+.030*sin(pi*t),z))
  for j in range(64):
   for k in range(8):a=j*9+k;faces.append((a,a+1,a+10,a+9))
  mesh('Rounded blue rear haunch shoulder',verts,faces,paint)
  path('Rear side door shut line',[(side*(skinx(c,-1.11,y)+.004),y,-1.11) for y in (.35,.60,.85,1.09)],.0025,black)
  box('Rear door handle above painted haunch',(side*(sx(1.235,-1.53)+.04),1.235,-1.53),(.035,.025,.14),chrome,bevel=.01)
 # Rounded steel roof: fuller transverse crown, tapered rear corners and a
 # gently falling rear header instead of the previous tall rectangular box.
 verts=[];faces=[];N=40;U=24
 for j in range(N+1):
  t=j/N;z=.17-2.42*t;h=interp(t,[(0,1.790),(.23,1.838),(.64,1.83),(1,1.698)])
  w=interp(t,[(0,.80),(.22,.825),(.7,.825),(1,.752)])
  for i in range(U+1):
   u=-1+2*i/U;verts.append((u*w,h+.045*(1-u*u),z+.045*(1-u*u)*cos(pi*t)))
 for j in range(N):
  for i in range(U):a=j*(U+1)+i;faces.append((a,a+1,a+U+2,a+U+1))
 roof=mesh('Buick rounded steel wagon roof',verts,faces,paint)
 solid=roof.modifiers.new('Steel roof and headliner thickness','SOLIDIFY');solid.thickness=.025;bpy.context.view_layer.objects.active=roof;bpy.ops.object.modifier_apply(modifier=solid.name)
 for side in (-1,1):
  path('Buick roof drip edge',[(side*interp(j/N,[(0,.80),(.22,.825),(.7,.825),(1,.752)]),interp(j/N,[(0,1.790),(.23,1.838),(.64,1.83),(1,1.698)])+.004,.17-2.42*j/N) for j in range(N+1)],.009,chrome)
  # A fixed structural header closes the daylight slit between the curved
  # steel roof and timber window cage. Above the opening front door its lower
  # edge remains higher than the complete moving wooden window frame.
  verts=[];faces=[]
  for j in range(81):
   z=-.03-2.22*j/80;t=(.17-z)/2.42
   high=interp(t,[(0,1.790),(.23,1.838),(.64,1.83),(1,1.698)])-.003
   if z>=-.77:low=1.794
   elif z>=-1.644:low=1.764+(z+1.644)/.854*.026-.006
   else:low=1.682+(z+2.22)/.576*.082-.006
   w=interp(t,[(0,.80),(.22,.825),(.7,.825),(1,.752)])
   verts.extend([(side*(sx(low,z)+.024),low,z),(side*(w+.002),high,z),(side*(w-.060),high,z),(side*(sx(low,z)-.025),low,z)])
  for j in range(80):
   for k in range(4):a=j*4+k;b=j*4+(k+1)%4;faces.append((a,a+4,b+4,b))
  faces.extend([(0,3,2,1),(320,321,322,323)])
  mesh('Continuous fitted honey ash roof header',verts,faces,ash,smooth=False)
  group='DoorL' if side>0 else 'DoorR'
  path('Front door upper compression weatherstrip',[(side*(sx(1.793,z)+.013),1.793,z) for z in [.065-.8*j/24 for j in range(25)]],.004,black,group,capped=True)
  path('Rear window sill corner connection',[(side*.86,1.275,-2.475),(side*.925,1.275,-2.478),(side*(sx(1.270,-2.475)+.026),1.270,-2.475)],.026,ash,capped=True)
  path('Rear wood belt corner wrap',[(side*(sx(1.225,-2.475)+.030),1.225,-2.475),(side*.947,1.220,-2.535),(side*.897,1.210,-2.63)],.025,ash,capped=True)
 windshield=[(-.827,1.08,.665),(.827,1.08,.665),(.77,1.79,.17),(-.77,1.79,.17)]
 curved_panel('Buick bowed windshield',windshield,glass,bulge=(0,.008,.065),nu=24,nv=18)
 path('Buick windshield bright surround',windshield,.018,chrome,closed=True)
 rod('Buick divided windshield center bar',(0,1.08,.73),(0,1.81,.228),.013,chrome)
 for x in (-.34,.34):rod('Buick windshield wiper',(x-.15,1.10,.68),(x+.14,1.105,.68),.006,black)
 rear=[(-.73,1.69,-2.23),(.73,1.69,-2.23),(.86,1.275,-2.475),(-.86,1.275,-2.475)]
 curved_panel('Buick sloping rear window',rear,glass,bulge=(0,.015,-.018))
 path('Buick rear window honey frame',rear,.035,ash,closed=True)
 box('Blue painted lower tailgate',(0,.825,-c['rear']+.05),(1.79,.63,.11),paint,bevel=.050)
 box('Narrow rear tailgate walnut belt',(0,1.210,-c['rear']+.01),(1.75,.105,.025),buick_wood,bevel=.013)
 for y in (1.150,1.272):box('Rear tailgate honey belt rail',(0,y,-c['rear']-.012),(1.81,.054,.045),ash,bevel=.016)

def greenhouse(c,paint):
 if c['kind']=='buick':
  buick_greenhouse(c,paint);return
 belt=1.00 if c['kind'] in ('buick','pontiac') else .94
 height=1.60 if c['kind']=='pontiac' else c['roof'];top=height-.072
 frontTop=.15 if c['kind']=='transam' else .20 if c['kind']=='camaro' else .26
 width=.79 if c['kind'] in ('buick','pontiac') else .748
 def wind(u,v):
  half=(.842*(1-v)+width*v)-.025*abs(2*v-1)**10
  return (u*half,belt+(top-belt)*v+.030*(1-u*u)*v,.66+(frontTop-.66)*v+.058*(1-u*u)+.018*sin(pi*v))
 verts=[wind(-1+2*i/24,j/16) for j in range(17) for i in range(25)]
 faces=[(j*25+i,j*25+i+1,(j+1)*25+i+1,(j+1)*25+i) for j in range(16) for i in range(24)]
 mesh('Compound curved windshield',verts,faces,glass)
 perimeter=[wind(-1+2*i/24,0) for i in range(25)]+[wind(1,j/16) for j in range(1,17)]+[wind(1-2*i/24,1) for i in range(1,25)]+[wind(-1,1-j/16) for j in range(1,16)]
 path('Windshield rubber glazing gasket',perimeter,.020,black,closed=True)
 path('Windshield polished perimeter',perimeter,.009,chrome,closed=True)
 for side in (-1,1):
  edge=[wind(side,j/20) for j in range(21)]
  path('Body formed A pillar',[(x+side*.025,y,z-.005) for x,y,z in edge],.032,paint if c['kind']!='pontiac' else chrome)
 for x in (-.36,.36):rod('Windshield wiper blade',(x-.16,belt+.012,.667),(x+.18,belt+.012,.667),.006,black)
 if c['roof'] is None:
  box('Folded convertible top boot',(0,1.045,-1.43),(1.65,.10,.28),black,bevel=.04)
  path('Convertible rear cabin chrome surround',[(-.86,1.05,-.82),(-.87,1.08,-1.40),(-.70,1.095,-1.58),(.70,1.095,-1.58),(.87,1.08,-1.40),(.86,1.05,-.82)],.011,chrome)
  return
 roofStart=frontTop;roofEnd=-2.29 if c['kind']=='buick' else -.98 if c['kind']=='transam' else -.91
 verts=[];faces=[];N=24;U=20
 for j in range(N+1):
  t=j/N;z=roofStart+(roofEnd-roofStart)*t
  for i in range(U+1):
   u=-1+2*i/U;half=width-.025+.023*sin(pi*t)
   x=u*half;y=c['roof']-.042-.030*u*u+.035*sin(pi*t)
   verts.append((x,y,z+.058*(1-u*u)*cos(pi*t)))
 for j in range(N):
  for i in range(U):
   a=j*(U+1)+i;faces.append((a,a+1,a+U+2,a+U+1))
 roof=mesh('Compound crowned steel roof',verts,faces,paint)
 solid=roof.modifiers.new('Roof skin thickness','SOLIDIFY');solid.thickness=.018
 bpy.context.view_layer.objects.active=roof;bpy.ops.object.modifier_apply(modifier=solid.name)
 for side in (-1,1):
  group='DoorL' if side>0 else 'DoorR'
  # Front side windows and upper trim move with the door, exposing the cabin.
  window=[(side*.827,belt,.61),(side*(width-.021),top-.025,frontTop-.065),(side*(width-.006),top+.012,-.70),(side*.844,belt,-.74)]
  curved_panel('Bowed front door glass',window,glass,group,(side*.026,0,0))
  path('Moving door glass weatherseal',window,.011,black,group,closed=True)
  path('Moving door window perimeter',window,.006,ash if c['kind']=='buick' else chrome,group,True)
  path('Rounded body roof cant rail',[(side*(width-.025+.023*sin(pi*j/24)),c['roof']-.072+.035*sin(pi*j/24),roofStart+(roofEnd-roofStart)*j/24) for j in range(25)],.028,paint)
  if c['kind']=='buick':
   for z0,z1 in [(-.83,-1.48),(-1.56,-2.27)]:
    window=[(side*.89,1.015,z0),(side*width,top-.015,z0),(side*width,top-.015,z1),(side*.89,1.015,z1)]
    mesh('Wagon rear side window',window,[(0,1,2,3)],glass,smooth=False)
    path('Ash rear window framing',window,.035,ash,closed=True)
   for z in (-.79,-1.52,-2.32):rod('Wagon ash pillar',(side*.89,1.01,z),(side*width,top,z),.044,ash)
   path('Long roof drip rail',[(side*(width-.020+.023*sin(pi*j/24)),top+.035*sin(pi*j/24)+.015,roofStart+(roofEnd-roofStart)*j/24) for j in range(25)],.009,chrome)
  else:
   quarter=[(side*.85,belt,-.79),(side*(width-.001),top+.013,-.76),(side*(width-.019),top-.023,roofEnd+.025),(side*.855,1.0,-1.30)]
   curved_panel('Curved rear quarter window',quarter,glass,bulge=(side*.02,0,-.006))
   path('Quarter window rubber seal',quarter,.009,black,closed=True)
   # Broad painted C pillars define each coupe's roof silhouette.
   curved_panel('Broad formed rear sail pillar',[(side*(width-.025),top,roofEnd+.045),(side*(width-.15),top+.014,roofEnd-.062),(side*.75,1.015,-1.59),(side*.90,.992,-1.36)],paint,bulge=(side*.036,.016,0))
   path('Roof fine drip moulding',[(side*(width-.020+.023*sin(pi*j/24)),top+.035*sin(pi*j/24)+.017,roofStart+(roofEnd-roofStart)*j/24) for j in range(25)],.007,chrome)
 rearBottom=-2.43 if c['kind']=='buick' else -1.51
 bottomY=1.01 if c['kind']=='buick' else 1.02
 rear=[(-(width-.11),top+.012,roofEnd-.035),(width-.11,top+.012,roofEnd-.035),(.75,bottomY,rearBottom),(-.75,bottomY,rearBottom)]
 curved_panel('Compound curved rear backlight',rear,glass,bulge=(0,.025,-.045));path('Rear window rubber seal',rear,.017,black,closed=True);path('Rear window chrome surround',rear,.008,chrome,closed=True)
 if c['kind']=='buick':
  box('Woody rear tailgate',(0,.76,-c['rear']+.07),(1.78,.46,.11),wood,bevel=.035)
  for x in (-.84,0,.84):box('Ash tailgate upright',(x,.79,-c['rear']+.003),(.065,.44,.045),ash,bevel=.014)
  for y in (.59,.99):box('Ash tailgate crossbar',(0,y,-c['rear']+.003),(1.77,.07,.045),ash,bevel=.014)

def wheels(c):
 result=[]
 for axle,z in [('F',c['frontAxle']),('R',c['rearAxle'])]:
  for sign,side in [(1,'L'),(-1,'R')]:
   code=axle+side;center=(sign*c['track'],c['radius'],z);r=c['radius'];group=code
   # Rounded sidewalls with a flat central tread barrel.
   rod('Tire tread barrel',(center[0]-.135,center[1],z),(center[0]+.135,center[1],z),r-.018,rubber,group,64)
   for offset in (-.12,.12):torus('Rounded tire shoulder',(center[0]+offset,center[1],z),r-.065,.064,rubber,(1,0,0),group,64,12)
   faceX=center[0]+sign*.152;rr=r*.65
   if c['kind']=='buick':torus('Wide creamy whitewall',(faceX,center[1],z),r*.78,r*.105,cream,(1,0,0),group,64,10)
   rod('Rim dark barrel',(faceX-sign*.04,center[1],z),(faceX,center[1],z),rr,black,group,48)
   torus('Polished wheel outer lip',(faceX,center[1],z),rr,.017,chrome,(1,0,0),group,64,10)
   torus('Inner rim bevel',(faceX+sign*.005,center[1],z),rr*.88,.009,alloy,(1,0,0),group,48,8)
   if c['kind']=='buick':
    ellipsoid('Domed Buick full hubcap',(faceX+sign*.014,center[1],z),(.052,rr*.89,rr*.89),chrome,group,40,20)
    torus('Buick hubcap embossed ring',(faceX+sign*.058,center[1],z),rr*.62,.006,alloy,(1,0,0),group)
   elif c['kind']=='pontiac':
    # Period Pontiac eight-lug finned aluminum brake drums, not modern alloys.
    rod('Eight lug finned drum face',(faceX-sign*.016,center[1],z),(faceX+sign*.012,center[1],z),rr*.77,alloy,group,64)
    verts=[];faces=[]
    for n in range(48):
     a=2*pi*n/48;start=len(verts)
     for xx in (faceX,faceX+sign*.025):
      for rad,angle in [(rr*.39,a-.015),(rr*.79,a-.010),(rr*.79,a+.010),(rr*.39,a+.015)]:verts.append((xx,center[1]+cos(angle)*rad,z+sin(angle)*rad))
     faces.extend([tuple(start+k for k in f) for f in [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]])
    mesh('Forty eight radial cooling fins',verts,faces,chrome,group)
    ellipsoid('Pontiac small eight lug center cap',(faceX+sign*.037,center[1],z),(.026,.079,.079),chrome,group,32,16)
    for n in range(8):
     a=2*pi*n/8;ellipsoid('Eight rim mounting nuts',(faceX+sign*.031,center[1]+cos(a)*rr*.82,z+sin(a)*rr*.82),(.013,.011,.011),chrome,group,12,8)
   elif c['kind']=='camaro':
    rod('1968 Rally stamped steel wheel',(faceX-sign*.012,center[1],z),(faceX+sign*.003,center[1],z),rr*.88,alloy,group,48)
    for n in range(5):
     a=2*pi*n/5
     ellipsoid('Rally wheel five cooling windows',(faceX+sign*.008,center[1]+cos(a)*rr*.64,z+sin(a)*rr*.64),(.007,.041,.029),black,group,20,10)
    ellipsoid('Chevrolet Rally derby center cap',(faceX+sign*.034,center[1],z),(.044,.089,.089),chrome,group,32,16)
    torus('Rally wheel bright trim ring',(faceX+sign*.014,center[1],z),rr*.91,.012,chrome,(1,0,0),group,64,8)
   else:
    for n in range(5):
     a=2*pi*n/5+.2
     v=(cos(a),sin(a));per=(-v[1],v[0]);verts=[]
     for radius,half in ((.058,.027),(rr-.011,.037)):
      for sidev in (-1,1):verts.append((faceX+sign*.006,center[1]+radius*v[0]+sidev*half*per[0],z+radius*v[1]+sidev*half*per[1]))
     spoke=mesh('Five cast alloy wheel spokes',verts,[(0,1,3,2)],alloy,group)
     mod=spoke.modifiers.new('Cast spoke depth','SOLIDIFY');mod.thickness=.028;bpy.context.view_layer.objects.active=spoke;bpy.ops.object.modifier_apply(modifier=mod.name)
    ellipsoid('Polished hub cap',(faceX+sign*.022,center[1],z),(.027,.050,.050),chrome,group,28,16)
    for n in range(5):
     a=2*pi*n/5;ellipsoid('Chrome lug nut',(faceX+sign*.028,center[1]+cos(a)*.045,z+sin(a)*.045),(.013,.010,.010),chrome,group,12,8)
   for n in range(40):
    a=2*pi*n/40
    start=(center[0]-.105,center[1]+cos(a)*(r+.001),z+sin(a)*(r+.001))
    end=(center[0]+.105,center[1]+cos(a+.033)*(r+.001),z+sin(a+.033)*(r+.001))
    rod('Tire tread groove',start,end,.003,steel,group,6)
   result.append(dict(id=code,center=list(center),radius=r,steerNode='WheelSteer_'+code,spinNode='WheelSpin_'+code,meshNode='WheelMesh_'+code,axle='front' if axle=='F' else 'rear',steering=axle=='F',drive=axle=='R',steeringAxis=[0,1,0],spinAxis=[1,0,0],forwardSpinSign=1))
 return result

def headlight(x,y,z,r=.107):
 torus('Deep chrome headlamp bezel',(x,y,z),r,.012,chrome,(0,0,1),segments=48)
 ellipsoid('Recessed headlamp reflector',(x,y,z-.015),(r*.94,r*.94,.035),alloy,segments=32,rings=16)
 ellipsoid('Clear sealed beam glass',(x,y,z+.008),(r*.88,r*.88,.020),lamp,segments=32,rings=16)
 for i in range(-3,4):
  xx=x+i*r*.22;half=sqrt(max(0,(r*.82)**2-(xx-x)**2))
  rod('Sealed beam vertical lens flute',(xx,y-half,z+.025),(xx,y+half,z+.025),.0018,chrome,vertices=6)
 torus('Lens etched concentric ridge',(x,y,z+.024),r*.73,.0015,alloy,(0,0,1),segments=40,tube=6)

def grille(center,size,split=False,teeth=False,dark=False):
 x,y,z=center;w,h=size
 box('Black radiator grille recess',center,(w,h,.033),black,bevel=.014)
 path('Grille chrome outline',[(x-w/2,y-h/2,z+.022),(x+w/2,y-h/2,z+.022),(x+w/2,y+h/2,z+.022),(x-w/2,y+h/2,z+.022)],.004 if dark else .011,steel if dark else chrome,closed=True)
 if teeth:
  for i in range(17):box('Buick vertical grille tooth',(x-w*.46+i*w*.92/16,y,z+.04),(.035,h*.90,.05),chrome,bevel=.013)
 else:
  for j in range(5):rod('Grille horizontal fine bar',(x-w*.475,y-h*.4+j*h*.2,z+.021),(x+w*.475,y-h*.4+j*h*.2,z+.021),.0015 if dark else .0038,black if dark else alloy)
  for j in range(18):rod('Grille narrow vertical bar',(x-w*.46+j*w*.92/17,y-h*.43,z+.021),(x-w*.46+j*w*.92/17,y+h*.43,z+.021),.002,steel,vertices=6)

def trim(c,paint):
 front=c['front'];rear=c['rear'];kind=c['kind'];w=c['width']
 if kind=='transam':
  for side in (-1,1):
   box('Deep black headlamp cavity',(side*.757,.813,front-.045),(.258,.304,.027),black,bevel=.060)
   rim=[]
   for j in range(65):
    a=2*pi*j/64;x=side*.757+.126*math.copysign(abs(cos(a))**.50,cos(a));y=.813+.151*math.copysign(abs(sin(a))**.50,sin(a));rim.append((x,y,front-.006))
   path('Rolled body coloured headlamp surround',rim,.018,paint,closed=True)
   headlight(side*.757,.825,front-.018,.103)
   grille((side*.343,.804,front-.028),(.559,.264),dark=True)
   path('Recessed grille thin bright edge',[(side*.062,.674,front+.010),(side*.624,.674,front+.003),(side*.624,.936,front-.005),(side*.062,.936,front+.007)],.005,chrome,closed=True)
   box('Lower twin air opening',(side*.395,.407,front+.049),(.41,.091,.016),black,bevel=.018)
   box('Amber front indicator',(side*.76,.421,front+.052),(.16,.05,.018),amber,bevel=.012)
   # Front side extractor behind the wheel, with three fine horizontal slots.
   for j in range(3):box('Fender air extractor',(side*(w-.024),.823-j*.025,.91),(.015,.011,.21),black,bevel=.004)
  box('Shaker hood raised scoop',(0,1.056,.78),(.39,.095,.53),paint,bevel=.047)
  box('Shaker rear-facing air mouth',(0,1.065,.513),(.30,.041,.008),black,bevel=.01)
  # Original stylized bird silhouette follows the actual photo's gold/dark motif.
  h=lambda z,x=0:crown(c,x,z)+.003
  for side in (-1,1):
   outline=[(0,h(1.29)+.004,1.29),(side*.17,h(1.18,.17)+.004,1.18),(side*.73,h(1.59,.73)+.004,1.59),(side*.68,h(1.23,.68)+.004,1.23),(side*.45,h(1.05,.45)+.004,1.05),(side*.11,h(.96,.11)+.004,.96)]
   mesh('Gold hood bird spread wing',outline,[tuple(range(len(outline)))],gold,smooth=False)
   for j in range(7):
    x=.22+j*.065;z=1.13+j*.038
    path('Hood bird dark feather',[(side*x,h(z,x)+.010,z),(side*(x+.15),h(z+.20,x+.15)+.010,z+.20)],.006,birdInk)
  mesh('Hood bird body',[(0,h(1.68)+.012,1.68),(.064,h(1.49)+.012,1.49),(.05,h(1.02)+.012,1.02),(0,h(.93)+.012,.93),(-.05,h(1.02)+.012,1.02),(-.064,h(1.49)+.012,1.49)],[(0,1,2,3,4,5)],birdInk,smooth=False)
  box('Pontiac nose divider',(0,.82,front+.030),(.058,.31,.022),paint,bevel=.012)
  text('Trans Am grille name','TRANS AM',(.32,.806,front+.006),.024,chrome)
  for x in (-.70,.70):box('Rear spoiler low mount',(x,.912,-rear+.28),(.16,.075,.20),paint,bevel=.025)
  box('Low integrated rear deck spoiler',(0,.972,-rear+.26),(1.91,.055,.32),paint,bevel=.035)
  for x in (-.46,.46):box('Wide red rear tail lamp',(x,.733,-rear-.035),(.76,.165,.023),red,bevel=.018)
 elif kind=='camaro':
  grille((0,.758,front+.029),(1.55,.29))
  for side in (-1,1):
   box('RS concealed headlight door',(side*.615,.762,front+.057),(.278,.254,.016),black,bevel=.012)
   for j in range(7):rod('RS cover grille ribs',(side*.615-.117,.666+j*.031,front+.070),(side*.615+.117,.666+j*.031,front+.070),.0034,alloy)
   box('Lower amber parking lamp',(side*.42,.461,front+.07),(.195,.074,.023),amber,bevel=.012)
   for j in range(4):box('SS hood stack insert',(side*.23,1.022,.78+j*.056),(.14,.018,.036),chrome,bevel=.004)
   for j in range(3):box('Rear quarter simulated vent',(side*w,.762,-.98-j*.055),(.014,.095,.026),chrome,bevel=.004)
   for j in range(2):box('1968 rear lens',(side*(.48+j*.22),.75,-rear-.058),(.19,.13,.031),red,bevel=.012)
  box('Thin Camaro chrome bumper',(0,.527,front+.084),(1.79,.075,.11),chrome,bevel=.028)
  box('Chrome Camaro rear bumper',(0,.46,-rear-.072),(1.79,.083,.13),chrome,bevel=.027)
  text('RS SS front badge','SS',(0,.755,front+.079),.096,chrome)
  text('Camaro rear badge','CAMARO',(0,.763,-rear-.075),.035,chrome,(0,0,-1))
 elif kind=='pontiac':
  for side in (-1,1):
   grille((side*.395,.758,front+.026),(.673,.295))
   rod('Pontiac center grille spear',(side*.74,.758,front+.055),(side*.065,.758,front+.055),.014,chrome)
   for y in (.658,.926):headlight(side*.866,y,front+.054,.108)
   path('Stacked lamp bright surround',[(side*.732,.525,front+.039),(side*.988,.525,front+.039),(side*.988,1.063,front+.039),(side*.732,1.063,front+.039)],.018,chrome,closed=True)
   box('Rear Pontiac tail lens',(side*.66,.755,-rear-.055),(.43,.115,.023),red,bevel=.012)
  box('Pontiac vertical central nose',(0,.79,front+.048),(.080,.39,.09),paint,bevel=.014)
  verts=[];faces=[]
  for j in range(49):
   x=-1.01+2.02*j/48;z=front+.09+.11*(1-abs(x)/1.01)**1.3;y=.472-.033*(1-abs(x)/1.01)
   for dy,dz in [(-.062,-.025),(-.050,.022),(.047,.028),(.065,-.02)]:verts.append((x,y+dy,z+dz))
  for j in range(48):
   for k in range(3):a=j*4+k;faces.append((a,a+4,a+5,a+1))
  mesh('Broad peaked stamped Pontiac bumper',verts,faces,chrome)
  box('Broad Pontiac rear chrome bumper',(0,.447,-rear-.069),(1.97,.12,.145),chrome,bevel=.036)
  path('Pontiac hood center crease',[(0,dimensions(c,z)[1]+.053,z) for z in [.66,1.15,1.85,2.4,front]],.006,chrome)
  for side in (-1,1):text('Pontiac 2+2 fender emblem','2+2',(side*(w+.009),.81,1.00),.06,chrome,(side,0,0))
 else:
  grille((0,.793,front+.052),(1.45,.375),teeth=True)
  for side in (-1,1):
   headlight(side*.842,1.071,front+.045,.123)
   torus('Buick raised lamp eyebrow',(side*.842,1.071,front+.025),.151,.025,paint,(0,0,1),segments=48)
   ellipsoid('Buick front amber parking lamp',(side*.842,.755,front+.047),(.105,.055,.031),amber)
   for z in (.82,1.04,1.26):
    x=side*(skinx(c,z,1.015)+.013)
    torus('Three Buick chrome VentiPorts',(x,1.015,z),.038,.009,chrome,(side,0,0),segments=24,tube=8)
    ellipsoid('Buick porthole black inset',(x-side*.003,1.015,z),(.008,.032,.032),black,segments=20,rings=10)
   # Wide stamped Sweepspear curves down ahead of the rear wheel. Its middle
   # span belongs to the opening front door, not a fixed strip across it.
   sections=[([(2.18,.885),(1.63,.915),(.64,.923)],'Body'),([(.64,.923),(-.35,.925),(-.77,.882)],'DoorL' if side>0 else 'DoorR'),([(-.77,.882),(-1.02,.781),(-1.13,.612),(-1.065,.476),(-.93,.414)],'Body')]
   for controls,grp in sections:
    points=[]
    for j in range(len(controls)-1):
     p0=Vector(controls[max(0,j-1)]);p1=Vector(controls[j]);p2=Vector(controls[j+1]);p3=Vector(controls[min(len(controls)-1,j+2)])
     for k in range(12):
      t=k/12;q=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t);points.append(tuple(q))
    points.append(controls[-1]);verts=[];faces=[]
    for j,(z,y) in enumerate(points):
     prev=Vector(points[max(0,j-1)]);nxt=Vector(points[min(len(points)-1,j+1)]);d=(nxt-prev).normalized();normal=Vector((-d.y,d.x))
     half=interp(z,[(-1.13,.045),(-.93,.042),(-.4,.033),(1.0,.027),(2.18,.008)])
     for q,out in [(-1,.008),(-.8,.020),(.8,.020),(1,.008)]:
      zz=z+normal.x*half*q;yy=y+normal.y*half*q;verts.append((side*(skinx(c,zz,yy)+out),yy,zz))
    for j in range(len(points)-1):
     for k in range(3):a=j*4+k;faces.append((a,a+4,a+5,a+1))
    mesh('Broad curved Buick chrome Sweepspear',verts,faces,chrome,grp)
   for start,end,grp in [(1.02,.64,'Body'),(.64,-.77,'DoorL' if side>0 else 'DoorR'),(-.77,-.93,'Body')]:
    path('Buick bright rocker edge',[(side*(skinx(c,z,.35)+.012),.35,z) for z in [start+(end-start)*j/20 for j in range(21)]],.014,chrome,grp)
   path('Buick rear fender slim horizontal moulding',[(side*(skinx(c,z,.91)+.018),.91,z) for z in [-1.28-1.31*j/32 for j in range(33)]],.009,chrome)
   box('Buick rear lamp chrome plinth',(side*.87,.847,-rear-.053),(.12,.23,.071),chrome,bevel=.036)
   box('Buick rear ruby lamp',(side*.87,.865,-rear-.094),(.088,.145,.021),red,bevel=.032)
  path('Large bowed Buick front bumper',[(-1.01,.48,front+.015),(-.5,.445,front+.115),(0,.455,front+.17),(.5,.445,front+.115),(1.01,.48,front+.015)],.065,chrome)
  for x in (-.64,.64):box('Buick bumper guard',(x,.58,front+.148),(.10,.30,.13),chrome,bevel=.025)
  box('Buick rear bumper',(0,.421,-rear-.10),(1.97,.15,.17),chrome,bevel=.036)
  path('Buick hood center bright spine',[(0,crown(c,0,z)+.008,z) for z in [.74+1.66*j/32 for j in range(33)]],.006,chrome)
  rod('Buick hood ornament',(0,crown(c,0,2.24)+.01,2.24),(0,crown(c,0,2.39)+.09,2.39),.017,chrome)
  ellipsoid('Buick hood ornament leading tip',(0,crown(c,0,2.39)+.09,2.39),(.03,.014,.09),chrome)
 for end in (front+.105,-rear-.15):
  normal=(0,0,1 if end>0 else -1)
  box('Club license plate',(0,.415,end),(.29,.135,.014),cream,bevel=.008)
  text('Lug Nuts club plate','LUGNUTS',(0,.415,end+normal[2]*.009),.035,black,normal)
 for side in (-1,1):
  rod('Chrome dual exhaust',(side*.61,.28,-rear+.1),(side*.61,.28,-rear-.12),.047,chrome)
  ellipsoid('Exhaust black mouth',(side*.61,.28,-rear-.123),(.038,.038,.002),black)

# A consistent studio across all garage cards; no studio node enters a GLB.
studio=bpy.data.collections.new('REVIEW STUDIO');scene.collection.children.link(studio)
def studio_obj(o):
 for col in list(o.users_collection):col.objects.unlink(o)
 studio.objects.link(o);return o
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.015));floor=studio_obj(bpy.context.object);floor.data.materials.append(material('Studio charcoal floor',(.046,.058,.067),.67))
world=bpy.data.worlds.new('Garage soft studio');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.22,.25,.29,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55
for name,where,energy,size in [('Large key',(-4,-5,7),1550,6),('Soft fill',(5,-1,5),1100,5),('Long body rim',(1,5,6),1850,5)]:
 data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
 o=bpy.data.objects.new(name,data);studio.objects.link(o);o.location=where;o.rotation_euler=(Vector((0,0,.7))-o.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('Garage card camera');camera=bpy.data.objects.new('Garage card camera',data);studio.objects.link(camera);scene.camera=camera
camera.location=p((7.4,4.2,8.8));camera.rotation_euler=(p((0,.78,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=57
scene.render.resolution_x=1200;scene.render.resolution_y=760

all_collections=[];all_roots=[];summaries=[]
for c in CARS:
 if args.member and c['id']!=args.member:continue
 for col in all_collections:col.hide_render=True;col.hide_viewport=True
 car_collection=bpy.data.collections.new(c['owner']+' | '+c['name']);scene.collection.children.link(car_collection);all_collections.append(car_collection)
 groups=defaultdict(list)
 paint=material(c['owner']+' | '+c['color'],c['paint'],.29,.62);paint.node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value=.36
 upholstery=material(c['owner']+' upholstery',c['interior'],.82)
 body(c,paint,upholstery);steering_center,steering_axis=interior(c,paint,upholstery);greenhouse(c,paint);specs=wheels(c);trim(c,paint)
 root=empty('ClubCar_'+c['id']);root['owner']=c['owner'];root['vehicle']=c['name'];all_roots.append(root)
 nodes={}
 for group,objects in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for obj in objects:obj.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();obj=bpy.context.object
  obj.name='Body' if group=='Body' else 'DoorMesh_'+group[-1] if group.startswith('Door') else 'SteeringWheelMesh' if group=='SteeringWheel' else 'WheelMesh_'+group
  bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);obj.parent=root;nodes[group]=obj
 for spec in specs:
  steer=empty(spec['steerNode'],root,spec['center']);spin=empty(spec['spinNode'],steer)
  obj=nodes[spec['id']];obj.data.transform(Matrix.Translation(-p(spec['center'])));obj.parent=spin;obj.location=(0,0,0)
 doors=[]
 for side,sign in [('L',1),('R',-1)]:
  center=(sign*(c['width']-.064),.72,.64);hinge=empty('DoorHinge_'+side,root,center);hinge['open_progress']=0.;hinge['open_sign']=-sign
  obj=nodes['Door'+side];obj.data.transform(Matrix.Translation(-p(center)));obj.parent=hinge;obj.location=(0,0,0)
  doors.append(dict(id=side,side=sign,hingeNode=hinge.name,meshNode='DoorMesh_'+side,hinge=list(center),axis=[0,1,0],openSign=-sign,maxAngleRadians=math.radians(68),closedProgress=0,openProgress=1,entryOpening=dict(zMin=-.77,zMax=.64,sillHeight=.36)))
 steering=empty('SteeringWheel',root,steering_center);obj=nodes['SteeringWheel'];obj.data.transform(Matrix.Translation(-p(steering_center)));obj.parent=steering;obj.location=(0,0,0)
 bpy.context.view_layer.update()
 vertices=[game(obj.matrix_world@v.co) for obj in nodes.values() for v in obj.data.vertices]
 mins=[min(v[i] for v in vertices) for i in range(3)];maxs=[max(v[i] for v in vertices) for i in range(3)]
 triangles=0
 for obj in nodes.values():obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
 bpy.ops.object.select_all(action='DESELECT')
 for obj in car_collection.objects:obj.select_set(True)
 glb=OUT/(c['id']+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_extras=True,export_cameras=False,export_lights=False,export_apply=True)
 raw=glb.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);names={n.get('name') for n in doc['nodes']}
 for name in ['Body','DoorHinge_L','DoorHinge_R','SteeringWheel']+[s[key] for s in specs for key in ('steerNode','spinNode','meshNode')]:assert name in names,name
 assert not doc.get('animations') and not doc.get('cameras')
 manifest=dict(version=1,id=c['id'],bodyStyle='convertible' if c['kind']=='pontiac' else 'wagon' if c['kind']=='buick' else 'coupe',seatAnchor=[.398,c['seatY'],-.315],owner=c['owner'],name=c['name'],paintColor=c['color'],asset='/assets/club-cars/'+c['id']+'.glb',preview='/assets/club-cars/'+c['id']+'-preview.png',source='asset-source/lug-nuts-cars.blend',generator='scripts/build-club-cars.py',units='meters',metersPerUnit=1,rootNode=root.name,bodyNode='Body',axes=dict(left='+X',right='-X',up='+Y',forward='+Z'),characterSeatAnchor=[.398,c['seatY'],-.315],steeringWheel=dict(node='SteeringWheel',center=list(steering_center),axis=list(steering_axis),radius=.176),wheels=specs,doors=doors,bounds=dict(min=mins,max=maxs,dimensions=[maxs[i]-mins[i] for i in range(3)]),runtimeIntegration=dict(visualOffsetFromChassis=[0,-.78,0],chassisColliderHalfExtents=[c['width']-.10,.31,(c['front']+c['rear'])/2-.22],chassisColliderCenterOffset=[0,.04,(c['front']-c['rear'])/2],wheelRayMountY=.1,wheelRayLength=1.05,springRestRayLength=1.0),statistics=dict(triangles=triangles,glbBytes=len(raw),nodes=len(doc['nodes']),materials=len(doc['materials']),meshPrimitives=sum(len(m['primitives']) for m in doc['meshes'])),validation=dict(namedWheelNodes=True,openingFrontDoors=True,fixedCabinOpening=True,leftHandDrive=True,steeringPivot=True),references=['User supplied exterior photograph; manually modeled forms, no photo textures'] if c['id'] in ('lou','craig') else ['https://www.gm.com/content/dam/company/no_search/heritage-archive-docs/vehicle-information-kits/chevrolet/1968-Chevrolet-Camaro.pdf'] if c['id']=='chris' else ['https://www.buickheritagealliance.org/index.php/archives/browse/1953'],limits=['Original stylized game approximation; not a scanned vehicle or concours-accurate restoration model.','Shared arcade interior proportions preserve driver fit and gameplay.'])
 if c['id']=='ed':
  manifest['references'].append('User supplied 1953 Buick construction photograph, 2026-09-22; blue paint retained per owner instruction; no photo pixels used')
  manifest['referenceDetails']=dict(sideWood='Honey framing surrounds side windows and narrow dark inset below the sill; lower doors and rear fenders are painted blue',portholesPerSide=3,woodLowerEdgeMeters=1.01,windowSillMeters=1.205,upperFrontDoorWoodMovesWithDoor=True)
  boundsByGroup={}
  for grp,obj in nodes.items():
   woodverts=[]
   for face in obj.data.polygons:
    mat=obj.data.materials[face.material_index]
    if mat and ('Honey ash framing' in mat.name or 'Walnut wagon panel' in mat.name):
     woodverts.extend([game(obj.matrix_world@obj.data.vertices[i].co) for i in face.vertices])
   if woodverts:boundsByGroup[grp]=dict(min=[min(v[i] for v in woodverts) for i in range(3)],max=[max(v[i] for v in woodverts) for i in range(3)])
  manifest['woodMaterialBounds']=boundsByGroup
 (OUT/(c['id']+'-manifest.json')).write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
 scene.render.filepath=str(OUT/(c['id']+'-preview.png'));bpy.ops.render.render(write_still=True)
 summaries.append(dict(id=c['id'],statistics=manifest['statistics'],bounds=manifest['bounds']))
 print('CLUB_CAR_READY',c['id'],json.dumps(manifest['statistics']))
 # Blender names are globally unique, even across hidden collections. Prefix
 # finished editable nodes before constructing the next independently exported
 # car so every GLB retains the exact shared runtime node contract.
 for obj in car_collection.objects:obj.name=c['id']+' | '+obj.name

# Joe's existing 442 is read only: import a temporary preview copy, then remove it.
if not args.member:
 for col in all_collections:col.hide_render=True;col.hide_viewport=True
 existing=set(bpy.data.objects);joe_path=ROOT/'public'/'assets'/'oldsmobile-442.glb';joe_sha=hashlib.sha256(joe_path.read_bytes()).hexdigest()
 bpy.ops.import_scene.gltf(filepath=str(joe_path));joe_objects=set(bpy.data.objects)-existing
 scene.render.filepath=str(OUT/'joe-preview.png');bpy.ops.render.render(write_still=True)
 for obj in joe_objects:bpy.data.objects.remove(obj,do_unlink=True)
 assert hashlib.sha256(joe_path.read_bytes()).hexdigest()==joe_sha
# Editable source presents all four original cars in a spaced lineup.
for i,(col,root) in enumerate(zip(all_collections,all_roots)):
 index=next(j for j,c in enumerate(CARS) if root.name.startswith(c['id']+' | '))
 col.hide_render=False;col.hide_viewport=False;root.location.x=(index-1.5)*3.5
for col,signature,render,viewport in preserved:
 assert collection_signature(col)==signature,'Unrelated source collection changed: '+col.name
 col.hide_render=render;col.hide_viewport=viewport
for file,sha in unchanged_files.items():assert hashlib.sha256(file.read_bytes()).hexdigest()==sha,'Unrelated deliverable changed: '+str(file)
if args.member:
 # Blender refuses a direct save over an appended library's original path.
 # Save the complete local scene separately, then replace that same source.
 next_source=SOURCE/'lug-nuts-cars.rebuild.blend'
 bpy.ops.wm.save_as_mainfile(filepath=str(next_source),compress=True)
 next_source.replace(SOURCE/'lug-nuts-cars.blend')
else:bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'lug-nuts-cars.blend'),compress=True)
if args.member:print('PRESERVED_OTHER_ASSETS',json.dumps({file.name:sha for file,sha in unchanged_files.items()}));print('PRESERVED_SOURCE_COLLECTIONS',json.dumps({col.name:sig for col,sig,_,_ in preserved}))
print('LUG_NUTS_ASSETS_READY',json.dumps(summaries))
