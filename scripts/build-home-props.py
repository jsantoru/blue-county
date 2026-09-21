"""Author the four reference Home ornaments in Blender and export a compact kit.

Blender --background --python scripts/build-home-props.py
Original editable parts remain in the .blend; export joins each prop by material.
All dimensions below use game metres, X right, Y up, Z toward the house.
"""
from pathlib import Path
from collections import defaultdict
import bpy, math, json, hashlib, random
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets'
BLEND = ROOT / 'asset-source/beverly-home-props.blend'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.world = bpy.data.worlds.new('Soft afternoon studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.45,.50,.57,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .6
random.seed(2442)
parts=defaultdict(list)
current=''
offset=0

def v(p): return Vector((p[0]+offset, -p[2], p[1]))
def texture(name, base, stone=False):
    w,h=128,256
    image=bpy.data.images.new(name, width=w, height=h, alpha=False)
    pixels=[]
    for yy in range(h):
        for xx in range(w):
            u,t=xx/w, yy/h
            if stone:
                grain=.9+random.random()*.16
                grain-=max(0,math.sin(u*35+t*19)*math.sin(t*41-u*17)-.38)*.13
            else:
                phase=t*91+math.sin(u*14)*.9+math.sin(u*28+t*5)*.4
                grain=.86+.10*math.sin(phase)+random.random()*.06
                grain-=max(0, math.sin(phase*1.87)-.85)*.43
                grain+=max(0,math.sin(u*27+t*11)*math.sin(t*31-u*5)-.55)*.32
            pixels.extend([min(1,c*grain) for c in base]+[1])
    image.pixels=pixels
    image.pack()
    return image

def material(name, color, rough=.7, metal=0, image=None):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if image:
        node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
        m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
    return m

paint=material('Bench | worn sage painted timber',(.23,.29,.18),.8,image=texture('Sage paint grain',(.31,.37,.23)))
oak=material('Wheel | aged oak grain',(.37,.27,.16),.87,image=texture('Aged oak grain',(.42,.34,.23)))
postwood=material('Mailbox | silvered cedar',(.40,.36,.28),.91,image=texture('Silvered cedar grain',(.47,.43,.34)))
iron=material('Iron | dark weathered graphite',(.052,.065,.049),.65,.72)
steel=material('Fasteners | aged zinc',(.32,.34,.30),.48,.8)
mailpaint=material('Mailbox | charcoal olive enamel',(.13,.16,.115),.42,.48)
flagmat=material('Mailbox | muted red enamel',(.49,.065,.039),.43,.35)
ivory=material('House number | warm ivory',(.88,.89,.81),.48,.15)
stone=material('Birdbath | weathered pale limestone',(.63,.64,.57),.86,image=texture('Limestone mineral flecks',(.74,.75,.67),True))
water=material('Birdbath | shallow dark water',(.16,.22,.17),.16,.22)

def finish(o,name,mat,bevel=0,smooth=False):
    o.name=f'{current} | {name}'
    if mat:o.data.materials.append(mat)
    if bevel:
        m=o.modifiers.new('Softened hand finished edges','BEVEL');m.width=bevel;m.segments=3
        m.affect='EDGES'
        m=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');m.keep_sharp=True
    if smooth and o.type=='MESH':
        for p in o.data.polygons:p.use_smooth=True
    parts[current].append(o)
    return o

def box(name,p,size,mat,bevel=.005):
    bpy.ops.mesh.primitive_cube_add(size=1,location=v(p));o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,bevel)

def beam(name,a,b,r,mat,vertices=10,r2=None):
    a,b=v(a),v(b);d=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r if r2 is None else r2,depth=d.length,location=(a+b)/2)
    o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return finish(o,name,mat,0,True)

def tube(name,points,r,mat,polyline=False):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.resolution_u=12
    data.bevel_depth=r;data.bevel_resolution=2;data.resolution_u=10
    if polyline:
        spline=data.splines.new('POLY');spline.points.add(len(points)-1)
        for bp,p in zip(spline.points,points):bp.co=(*v(p),1)
    else:
        spline=data.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
        for bp,p in zip(spline.bezier_points,points):bp.co=v(p);bp.handle_left_type=bp.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o)
    return finish(o,name,mat)

def lathe(name,profile,mat,segments=48):
    vertices=[];faces=[]
    for radius,y in profile:
        for i in range(segments):
            a=i*math.tau/segments;vertices.append(tuple(v((math.cos(a)*radius,y,math.sin(a)*radius))))
    for j in range(len(profile)-1):
        for i in range(segments):
            ni=(i+1)%segments;faces.append((j*segments+i,j*segments+ni,(j+1)*segments+ni,(j+1)*segments+i))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o)
    # Cylindrical UV coordinates preserve mineral scale without a live procedural shader.
    uv=mesh.uv_layers.new(name='Surface coordinates')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi=mesh.loops[li].vertex_index;uv.data[li].uv=(vi%segments/segments,vi//segments/max(1,len(profile)-1))
    return finish(o,name,mat,0,True)

# Front window bench: restrained domestic dimensions and original green tone.
current='Home_Bench';offset=0
for x in [-.50,.50]:
    tube('Swept cast iron side frame',[(x,.025,-.205),(x,.26,-.175),(x,.43,-.13),(x,.49,.03),(x,.43,.19),(x,.025,.22)],.022,iron)
    tube('Backrest upright',[(x,.27,.175),(x,.53,.205),(x,.90,.255)],.019,iron)
    tube('Curved armrest',[(x,.41,-.17),(x,.64,-.15),(x,.665,.02),(x,.64,.18),(x,.50,.205)],.018,iron)
    for z in [-.205,.22]:box('Flattened ground foot',(x,.022,z),(.095,.032,.068),iron,.01)
    beam('Cast frame diagonal',(x,.12,-.19),(x,.40,.17),.011,iron)
beam('Under seat stretcher',(-.50,.29,.025),(.50,.29,.025),.012,iron)
for i in range(5):
    z=-.195+i*.091
    box(f'Seat slat {i+1}',(0,.43,z),(1.29,.04,.076),paint,.007)
    for x in [-.49,.49]:beam('Recessed slat screw',(x,.45,z),(x,.453,z),.007,steel,12)
for i in range(4):
    y=.585+i*.086;z=.222+(y-.585)*.10
    box(f'Back slat {i+1}',(0,y,z),(1.29,.065,.034),paint,.006)
    for x in [-.49,.49]:beam('Back slat bolt',(x,y,z-.018),(x,y,z-.023),.008,steel,12)

# Decorative wagon wheel: pivot is its hub centre, matching the existing anchor.
current='Home_WagonWheel';offset=2.0
def wheel_ring(name,radius,minor,mat):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=minor,major_segments=64,minor_segments=8,location=v((0,0,0)))
    o=bpy.context.object;o.rotation_euler[0]=math.pi/2
    return finish(o,name,mat,0,True)
wheel_ring('Oak felloe outer rim',.426,.035,oak)
wheel_ring('Forged outer iron tire',.463,.013,iron)
wheel_ring('Inner felloe bead',.401,.011,oak)
for i in range(12):
    a=i*math.tau/12;x,y=math.sin(a),math.cos(a)
    beam(f'Tapered oak spoke {i+1}',(x*.066,y*.066,0),(x*.414,y*.414,0),.023,oak,8,.014)
    beam('Iron rim rivet',(x*.458,y*.458,-.017),(x*.458,y*.458,-.028),.006,steel,10)
    if i%2==0:
        # Small joining plates are placed at the felloe seams.
        beam('Felloe join plate',(x*.403,y*.403,-.031),(x*.448,y*.448,-.031),.008,iron,6)
beam('Turned hardwood hub',(0,0,-.07),(0,0,.07),.071,oak,32)
beam('Iron hub collar',(0,0,-.078),(0,0,-.060),.076,iron,32)
beam('Axle recess',(0,0,-.080),(0,0,-.081),.026,iron,24)
beam('Axle washer',(0,0,-.083),(0,0,-.087),.014,steel,16)

# Pale pedestal visible in the left bed: modeled with a proper shallow bowl.
current='Home_Birdbath';offset=3.5
lathe('Turned limestone pedestal',[(0,0),(.18,0),(.205,.022),(.205,.055),(.18,.080),(.128,.098),(.112,.14),(.092,.18),(.075,.30),(.064,.44),(.085,.49),(.108,.52),(.095,.55)],stone)
lathe('Shallow rolled rim basin',[(.078,.53),(.14,.557),(.211,.591),(.235,.631),(.236,.650),(.224,.661),(.209,.651),(.195,.625),(.15,.602),(.06,.594),(0,.594)],stone,64)
lathe('Water sitting inside bowl',[(0,.604),(.146,.604)],water,48)

# Numbered rural mailbox. Front faces game -Z, and its post base is the pivot.
current='Home_Mailbox';offset=4.8
box('Weathered cedar post',(0,.65,0),(.107,1.3,.107),postwood,.008)
box('Timber mounting arm',(0,1.19,-.11),(.115,.09,.57),postwood,.006)
beam('Timber support knee',(0,.96,.025),(0,1.17,-.28),.033,postwood,6)
box('Post end grain cap',(0,1.307,0),(.109,.014,.109),postwood,.003)
box('Small road reflector',(0,.16,-.058),(.067,.082,.013),flagmat,.005)
box('Mail body lower',(0,1.344,-.10),(.30,.235,.57),mailpaint,.008)
# Rounded roof is a solid extruded arch, continuous with the lower box.
verts=[];faces=[];steps=32
for z in [-.385,.185]:
    for i in range(steps+1):
        a=i*math.pi/steps;verts.append(tuple(v((math.cos(a)*.15,1.461+math.sin(a)*.15,z))))
for i in range(steps):faces.append((i,i+1,steps+2+i,steps+1+i))
faces.extend([tuple(range(steps,-1,-1)),tuple(range(steps+1,2*(steps+1)))])
mesh=bpy.data.meshes.new('Arched sheet metal');mesh.from_pydata(verts,[],faces);mesh.update()
o=bpy.data.objects.new('Arched sheet metal',mesh);scene.collection.objects.link(o);finish(o,'Rounded enamel roof',mailpaint,0,True)
for z in [-.388,.188]:
    pts=[(-.151,1.228,z),(-.151,1.455,z)]
    pts += [(math.cos(math.pi-i*math.pi/32)*.151,1.46+math.sin(math.pi-i*math.pi/32)*.151,z) for i in range(33)]
    pts +=[(.151,1.228,z),(-.151,1.228,z)]
    # The seam follows the folded box edge without Bezier overshoot at corners.
    tube('Rolled door seam' if z<0 else 'Rear folded seam',pts,.005,steel,polyline=True)
box('Door lower inset',(0,1.350,-.394),(.271,.208,.008),mailpaint,.009)
box('Finger latch',(0,1.520,-.404),(.060,.021,.022),steel,.005)
beam('Bottom hinge barrel',(-.105,1.240,-.402),(.105,1.240,-.402),.009,steel,16)
box('Flag pivot bracket',(.162,1.395,-.13),(.022,.051,.04),iron,.004)
beam('Flag pivot bolt',(.162,1.395,-.13),(.182,1.395,-.13),.011,steel,16)
box('Lowered red flag arm',(.177,1.417,-.015),(.014,.027,.245),flagmat,.005)
box('Red signal flag',(.179,1.458,.086),(.016,.095,.072),flagmat,.006)
for z in [-.27,.07]:
    beam('Wood arm fixing screw',(-.015,1.243,z),(-.015,1.247,z),.009,steel,12)
for side in [-1,1]:
    # True font-outline mesh: readable number at each long side of the box.
    data=bpy.data.curves.new('House number 2','FONT');data.body='2';data.align_x='CENTER';data.align_y='CENTER'
    data.size=.125;data.extrude=.0006;data.bevel_depth=.0003;data.bevel_resolution=1;data.resolution_u=6
    o=bpy.data.objects.new('House number 2',data);scene.collection.objects.link(o)
    o.location=v((side*.155,1.338,.025))
    # Text local X runs along mailbox length, local Y is game up.
    from mathutils import Matrix
    o.rotation_euler=Matrix(((0,0,side),(side,0,0),(0,1,0))).to_euler()
    # HomeFrame has a reflected right/up/back basis. Pre-reflect only the
    # glyph so the placed game numeral reads correctly from either side.
    o.scale.x=-1
    finish(o,'Raised ivory numeral 2',ivory)

# Organized, editable original parts remain in named collections in the .blend.
for key,objects in parts.items():
    collection=bpy.data.collections.new(key+' · editable parts');scene.collection.children.link(collection)
    for o in objects:
        for c in list(o.users_collection):c.objects.unlink(o)
        collection.objects.link(o)
    collection['reference']='User supplied Home street views; close construction detail representative.'

# Studio camera/lights remain in the editable source, excluded from runtime GLB.
bpy.ops.object.camera_add(location=(6.6,-7.2,4.4));camera=bpy.context.object
camera.name='Studio | four prop overview';target=Vector((2.55,0,.60))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
camera.data.type='ORTHO';camera.data.ortho_scale=6.3
for name,loc,power,size in [('key',(2,-4,6),650,5),('rim',(4,3,4),800,4)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.name='Studio | '+name
    light.data.energy=power;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(Vector((2.5,0,.5))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=True
# Open the blend with all four assets comfortably framed in solid/material view.
for area in bpy.context.screen.areas if bpy.context.screen else []:
    if area.type=='VIEW_3D':area.spaces.active.region_3d.view_distance=7
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

# Join evaluated duplicate parts for compact runtime primitive batches; originals
# remain untouched in the saved authoring scene.
export_objects=[];counts={}
for key,objects in parts.items():
    bpy.ops.object.select_all(action='DESELECT');copies=[]
    for original in objects:
        duplicate=original.copy();duplicate.data=original.data.copy();scene.collection.objects.link(duplicate)
        duplicate.select_set(True);copies.append(duplicate)
    bpy.context.view_layer.objects.active=copies[0]
    bpy.ops.object.convert(target='MESH');bpy.ops.object.join();joined=bpy.context.object
    joined.name=key
    # Parent keeps the kit display offset separate from the prop pivot.
    stage={'Home_Bench':0,'Home_WagonWheel':2,'Home_Birdbath':3.5,'Home_Mailbox':4.8}[key]
    parent=bpy.data.objects.new(key+'_Anchor',None);scene.collection.objects.link(parent);parent.location=(stage,0,0)
    bpy.context.view_layer.update();matrix=joined.matrix_world.copy();joined.parent=parent;joined.matrix_world=matrix
    joined.name=key+'_Mesh';parent.name=key
    joined.data.calc_loop_triangles()
    counts[key]={'triangles':len(joined.data.loop_triangles),'materials':len(joined.data.materials),'editableParts':len(objects),
                 'pivot':'hub centre' if key=='Home_WagonWheel' else 'ground centre'}
    export_objects.extend([joined,parent])
bpy.ops.object.select_all(action='DESELECT')
for o in export_objects:o.select_set(True)
glb=OUT/'beverly-home-props.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,
    export_apply=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,
    export_materials='EXPORT',export_extras=True)
manifest={'schemaVersion':1,'name':'Beverly Home reference prop kit','authoring':'Blender '+bpy.app.version_string,
    'source':'asset-source/beverly-home-props.blend','buildScript':'scripts/build-home-props.py',
    'asset':'public/assets/beverly-home-props.glb','units':'meters','runtimeAxes':'X right, Y up, Z toward house',
    'props':counts,'triangles':sum(p['triangles'] for p in counts.values()),
    'primitiveBatches':sum(p['materials'] for p in counts.values()),
    'reference':'Four objects already visible in the user supplied Home street views; anchors and game dimensions retained.',
    'limits':'Fine joinery, fasteners, material wear and bowl profile are representative close-up details, not measured from photographs.',
    'textures':'Original generated grain/mineral textures packed into editable blend and embedded in GLB; no source photographs.',
    'sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(BLEND.read_bytes()).hexdigest()}
(OUT/'beverly-home-props-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest,indent=2))
