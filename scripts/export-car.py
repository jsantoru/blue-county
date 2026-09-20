"""Export the saved read-only 442 snapshot, never the actively edited source.

Blender --background --python scripts/export-car.py
"""
from pathlib import Path
from collections import defaultdict
import bpy, json, hashlib, math, struct
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'asset-source' / '1968_oldsmobile_442.snapshot.blend'
OUTPUT = ROOT / 'public' / 'assets'
OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SNAPSHOT))
scene = bpy.context.scene
scene.frame_set(1)  # Authored closed-hood pose. No animation is exported.
source_objects = list(scene.objects)
source_hash = hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()

def is_car(o):
    return o.type in {'MESH','CURVE','SURFACE','FONT'} and not any('Studio' in c.name for c in o.users_collection)

car = [o for o in source_objects if is_car(o)]
source_names = [o.name for o in car]

# Forward -Y and up +Z imply physical LEFT +X (and game +Z/+Y likewise
# imply LEFT +X). Inspect transforms: historical source side labels are inverted.
def interior_object(label):
    matches = [o for o in car if o.name == 'Interior | ' + label]
    assert len(matches) == 1, 'Expected one interior component: ' + label
    return matches[0]

steering = interior_object('Walnut steering wheel rim')
bpy.context.view_layer.update()
interior_reflected = steering.matrix_world.translation.x < 0
if interior_reflected:
    reflection = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))
    transforms = [(o, o.matrix_world.copy()) for o in car if o.name.startswith('Interior | ')]
    for obj, original in transforms:
        if obj.type == 'FONT':
            original.translation.x *= -1
            obj.matrix_world = original  # Move text without reflecting its glyphs.
        else:
            obj.matrix_world = reflection @ original
    bpy.context.view_layer.update()

drive_checks = {'Walnut steering wheel rim': .398, 'Steering column': .398,
                'Instrument cluster black recess': .367, 'Clutch pedal': .540,
                'Brake pedal': .426, 'Accelerator pedal': .311, 'Passenger glovebox': -.485}
for label, expected_x in drive_checks.items():
    assert abs(interior_object(label).matrix_world.translation.x - expected_x) < .0001, 'US left-hand-drive check failed: ' + label
steering_center = steering.matrix_world.translation.copy()

# Resolve actual physical wheel sides from the evaluated tire centers rather
# than carrying the historical LEFT/RIGHT object labels into the manifest.
wheel_specs = []
wheel_centers = {o.name: sum((o.matrix_world @ Vector(corner) for corner in o.bound_box), Vector()) / 8
                 for o in car if 'redline tire' in o.name.lower()}
for axle, letter in [('FRONT','F'), ('REAR','R')]:
    for physical_side, sign in [('L',1), ('R',-1)]:
        candidates = [o for o in car if o.name.startswith(axle+' ') and 'redline tire' in o.name.lower()
                      and wheel_centers[o.name].x * sign > 0]
        assert len(candidates) == 1, 'Expected one physical wheel: ' + letter + physical_side
        tire = candidates[0]
        wheel_specs.append((letter+physical_side, tire.name.split(' |')[0], tuple(round(v,6) for v in wheel_centers[tire.name])))
for o in car:
    for m in o.modifiers:
        if m.type == 'BEVEL': m.segments = min(m.segments,2)
    if o.type in {'CURVE','FONT'}:
        o.data.resolution_u = min(o.data.resolution_u,3)
        o.data.bevel_resolution = min(o.data.bevel_resolution,1)
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
groups = defaultdict(list)
mapping = {}
unoptimized_triangles = 0

for o in car:
    ev = o.evaluated_get(deps)
    mesh = bpy.data.meshes.new_from_object(ev, depsgraph=deps)
    mesh.transform(o.matrix_world)
    if o.matrix_world.determinant() < 0:
        mesh.flip_normals()  # Reflection must preserve exterior-facing triangles.
    mesh.calc_loop_triangles()
    unoptimized_triangles += len(mesh.loop_triangles)
    obj = bpy.data.objects.new('GAME_' + o.name,mesh)
    scene.collection.objects.link(obj)
    group = next((code for code,prefix,_ in wheel_specs if o.name.startswith(prefix+' |')), 'Body')
    # The source tire has ~40k triangles; preserve the molded outline while
    # reducing tessellation that is smaller than a pixel at chase distance.
    ratio = .22 if 'redline tire' in o.name else (.38 if len(mesh.loop_triangles)>800 else 1)
    if ratio < 1:
        dec = obj.modifiers.new('Game geometry reduction','DECIMATE')
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=dec.name)
    groups[group].append(obj)
    mapping[o.name] = group

for o in source_objects:
    bpy.data.objects.remove(o,do_unlink=True)

# Preserve source base colors and PBR metal/roughness. Procedural paint noise
# cannot be represented by glTF. Thin optical parts use alpha rather than
# screen-space transmission, preventing repeated scene refraction passes.
for mat in bpy.data.materials:
    if not mat.use_nodes: continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if not bsdf: continue
    for link in list(mat.node_tree.links):
        if link.to_node == bsdf and link.to_socket.name == 'Normal':
            mat.node_tree.links.remove(link)
    if 'glass' in mat.name.lower() and 'headlight' not in mat.name.lower():
        bsdf.inputs['Transmission Weight'].default_value = 0
        bsdf.inputs['Alpha'].default_value = .20
        mat.surface_render_method = 'DITHERED'
        mat.diffuse_color = (*mat.diffuse_color[:3],.20)
    elif 'Headlight optical' in mat.name:
        bsdf.inputs['Transmission Weight'].default_value = 0
        bsdf.inputs['Metallic'].default_value = .22
        bsdf.inputs['Roughness'].default_value = .18

def empty(name,parent=None,location=(0,0,0)):
    obj = bpy.data.objects.new(name,None)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj

root = empty('Oldsmobile442')
root['vehicle']='1968 Oldsmobile 442 convertible'
root['source_sha256']=source_hash
root['hood_pose']='closed, source frame 1'
nodes = {}
for name,objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    node = bpy.context.object
    node.name = 'Body' if name=='Body' else 'WheelMesh_' + name
    node.data.name = node.name + '_geometry'
    node.parent = root
    nodes[name] = node

for code,prefix,center in wheel_specs:
    steer = empty('WheelSteer_'+code,root,center)
    spin = empty('WheelSpin_'+code,steer)
    obj = nodes[code]
    obj.data.transform(__import__('mathutils').Matrix.Translation(-Vector(center)))
    obj.parent = spin
    obj.location = (0,0,0)

car_vertices = [o.matrix_world @ v.co for o in nodes.values() for v in o.data.vertices]
bpy.context.view_layer.update()
car_vertices = [o.matrix_world @ v.co for o in nodes.values() for v in o.data.vertices]
mins = [min(v[i] for v in car_vertices) for i in range(3)]
maxs = [max(v[i] for v in car_vertices) for i in range(3)]
gmin = [mins[0],mins[2],-maxs[1]]
gmax = [maxs[0],maxs[2],-mins[1]]
triangles = 0
for o in nodes.values():
    o.data.calc_loop_triangles()
    triangles += len(o.data.loop_triangles)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUTPUT/'oldsmobile-442.glb'),export_format='GLB',
                         use_selection=True, export_yup=True, export_animations=False,
                         export_extras=True,export_cameras=False,export_lights=False,
                         export_apply=True,export_texcoords=False,export_normals=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'asset-source'/'oldsmobile-442.game.blend'))

raw=(OUTPUT/'oldsmobile-442.glb').read_bytes()
json_length=struct.unpack_from('<I',raw,12)[0]
gltf=json.loads(raw[20:20+json_length])
export_nodes = {n.get('name'): n for n in gltf.get('nodes',[])}
for code,_,_ in wheel_specs:
    assert 'WheelSteer_'+code in export_nodes and 'WheelSpin_'+code in export_nodes
assert not gltf.get('animations') and not gltf.get('cameras')
assert not any('Studio' in str(n) for n in gltf['nodes'])

manifest = {
    'version':1,'name':'1968 Oldsmobile 442 convertible','asset':'/assets/oldsmobile-442.glb',
    'sourceSnapshot':'asset-source/1968_oldsmobile_442.snapshot.blend','sourceSha256':source_hash,
    'exportedWith':bpy.app.version_string,'units':'meters','metersPerUnit':1,
    'rootNode':'Oldsmobile442','bodyNode':'Body','hoodFrame':1,'hoodClosed':True,
    'axes':{'left':'+X','right':'-X','up':'+Y','forward':'+Z','sourceLeft':'+X','sourceRight':'-X','sourceUp':'+Z','sourceForward':'-Y'},
    'driveLayout':{'type':'left-hand drive','driverSide':'+X',
                   'steeringWheelCenter':[steering_center.x,steering_center.z,-steering_center.y],
                   'interiorReflectedDuringExport':interior_reflected,
                   'checkedComponents':list(drive_checks),
                   'note':'Viewed from behind facing forward, the wheel, instrument cluster and pedals are on the left. Source snapshot remains unchanged.'},
    'sourceToGame':'[source.x, source.z, -source.y]; glTF exporter export_yup=True; no extra runtime rotation',
    'bounds':{'min':gmin,'max':gmax,'dimensions':[gmax[i]-gmin[i] for i in range(3)]},
    'runtimeIntegration':{'visualOffsetFromChassis': [0, -0.78, 0], 'chassisColliderHalfExtents': [0.9, 0.31, 2.3], 'chassisColliderCenterOffset': [0, 0.04, 0], 'wheelRayMountY': 0.1, 'wheelRayLength': 1.05, 'springRestRayLength': 1.0, 'note': 'Final arcade suspension setup; runtime reads wheel X/Z centers and radius from wheels. Vehicle visual remains independent of dynamic chassis. Source chassis values above are exporter suggestions.'},
    'chassis':{'suggestedCenterOfMass':[0,.65,0],'visualOffsetFromChassis':[0,-.65,0],
               'colliderHalfExtents':[.86,.30,2.42],'colliderCenterOffset':[0,0,0],
               'note':'Visual origin is source ground center. Place visual group .65m below a physics COM at .65m; tune collider/COM separately.'},
    'wheels':[{'id':code,'sourcePrefix':prefix+' |','steerNode':'WheelSteer_'+code,'spinNode':'WheelSpin_'+code,
               'meshNode':'WheelMesh_'+code,'center':[c[0],c[2],-c[1]],'radius':.345,
               'axle':'front' if code.startswith('F') else 'rear','steering':code.startswith('F'),
               'drive':code.startswith('R'),'steeringAxis':[0,1,0],'spinAxis':[1,0,0],
               'forwardSpinSign':1} for code,prefix,c in wheel_specs],
    'statistics':{'sourceCarObjects':len(source_names),'trianglesBeforeReduction':unoptimized_triangles,
                  'trianglesAfterReduction':triangles,'glbBytes':len(raw),'nodes':len(gltf['nodes']),
                  'meshPrimitives':sum(len(m['primitives']) for m in gltf['meshes']),
                  'materials':len(gltf.get('materials',[]))},
    'appearance':{'paint':'Midnight Sapphire dark blue','upholstery':'Parchment','tires':'Redline','wheels':'Oldsmobile Rally','engine':'Modeled Rocket V8 retained under closed hood'},
    'optimization':['Derived copy only; original source is read-only','Meshes combined by rigid group; material slots retained',
                    'Bevel segments capped at 2; curve resolution 3; curve bevel resolution 1',
                    'Large mesh triangle collapse ratio .38; tire ratio .22; small details retained',
                    'Procedural subpixel paint noise omitted; original base colors/metallic/roughness retained',
                    'Windshield alpha .20 replaces transmission; headlamp transmission replaced by reflective lens',
                    'Studio, floor, cameras, lights and hood animation excluded'],
    'sourceObjectGroups':mapping,
    'validation':{'namedWheelNodesVerified':True,'leftHandDriveVerified':True,'physicalWheelSidesVerified':True,'noCameras':True,'noAnimations':True,'noStudioNodes':True}
}
(OUTPUT/'vehicle-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('EXPORT_SUCCESS',json.dumps(manifest['statistics']), 'bounds',json.dumps(manifest['bounds']))
