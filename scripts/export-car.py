"""Export the saved read-only 442 snapshot, never the actively edited source.

Blender --background --python scripts/export-car.py
"""
from pathlib import Path
from collections import defaultdict
import bpy, bmesh, json, hashlib, math, struct, re
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

# Cut the existing body sheets along the source's authored shut line. The
# original car has a continuous skin here, so merely parenting the handles and
# door cards would leave a blue wall across the opening. These half-planes form
# the convex front/bottom/rear of that outline; the open top retains the curved
# source shoulder instead of replacing it with a flat rectangular door.
DOOR_OUTLINE = [(-.59, 1.002), (-.61, .83), (-.63, .58), (-.64, .34),
                (-.61, .315), (.67, .315), (.71, .35), (.72, .65), (.72, 1.08)]
DOOR_HINGES = {'L': (.866, -.59, .72), 'R': (-.866, -.59, .72)}
DOOR_ANGLE = math.radians(68)
door_partitions = {}

def clip_polygon(points, a, b):
    """Split a world-space face by a line in source Y/Z; retain both pieces."""
    def distance(p):
        return (b[0]-a[0])*(p.z-a[1]) - (b[1]-a[1])*(p.y-a[0])
    inside, outside = [], []
    for p, q in zip(points, points[1:]+points[:1]):
        dp, dq = distance(p), distance(q)
        target = inside if dp >= -1e-8 else outside
        target.append(p)
        if (dp < -1e-8) != (dq < -1e-8):
            t = dp/(dp-dq)
            cut = p.lerp(q, t)
            inside.append(cut)
            outside.append(cut)
    return inside, outside

def partition_door(mesh, name):
    buckets = {'Body': [], 'Door': []}
    for poly in mesh.polygons:
        remaining = [mesh.vertices[i].co.copy() for i in poly.vertices]
        for a, b in zip(DOOR_OUTLINE, DOOR_OUTLINE[1:]):
            if len(remaining) < 3: break
            remaining, outside = clip_polygon(remaining, a, b)
            if len(outside) >= 3:
                buckets['Body'].append((outside, poly.material_index, poly.use_smooth))
        if len(remaining) >= 3:
            buckets['Door'].append((remaining, poly.material_index, poly.use_smooth))
    output = {}
    for group, faces in buckets.items():
        if not faces: continue
        verts, indices, metadata, index_by_coord = [], [], [], {}
        for points, material, smooth in faces:
            face = []
            for point in points:
                key = tuple(round(v, 7) for v in point)
                if key not in index_by_coord:
                    index_by_coord[key] = len(verts)
                    verts.append(tuple(point))
                idx = index_by_coord[key]
                if not face or face[-1] != idx: face.append(idx)
            if len(face) > 2 and face[0] == face[-1]: face.pop()
            if len(set(face)) < 3: continue
            indices.append(face)
            metadata.append((material, smooth))
        part = bpy.data.meshes.new(name+'_'+group)
        part.from_pydata(verts, [], indices)
        for material in mesh.materials: part.materials.append(material)
        for polygon, (material, smooth) in zip(part.polygons, metadata):
            polygon.material_index = material
            polygon.use_smooth = smooth
        part.update()
        output[group] = part
    assert output.get('Body') and output.get('Door'), 'Door partition empty: '+name
    door_partitions[name] = {group: len(part.polygons) for group, part in output.items()}
    return output

def moving_door_part(name):
    base = re.sub(r'\.\d+$', '', name)
    if base in {'Door handle shadow', 'Chrome door handle', 'Door key barrel',
                'Mirror stalk', 'Round exterior mirror housing', 'Mirror glass',
                'Triangular quarter vent window', 'Vent window chrome frame'}:
        return True
    if name.startswith('Interior | '):
        label = name.split(' | ', 1)[1]
        return label.startswith(('Driver ', 'Passenger ')) and any(
            token in label for token in ('door', 'armrest chrome plinth',
                                         'window winder pivot', 'window crank')) and 'rear' not in label
    return 'door panel gap' in name

def add_game_part(source_name, mesh, group, ratio):
    obj = bpy.data.objects.new('GAME_'+source_name+'_'+group, mesh)
    scene.collection.objects.link(obj)
    if ratio < 1:
        dec = obj.modifiers.new('Game geometry reduction', 'DECIMATE')
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=dec.name)
    groups[group].append(obj)
    return obj

for o in car:
    ev = o.evaluated_get(deps)
    mesh = bpy.data.meshes.new_from_object(ev, depsgraph=deps)
    mesh.transform(o.matrix_world)
    if o.matrix_world.determinant() < 0:
        mesh.flip_normals()  # Reflection must preserve exterior-facing triangles.
    mesh.calc_loop_triangles()
    unoptimized_triangles += len(mesh.loop_triangles)
    group = next((code for code,prefix,_ in wheel_specs if o.name.startswith(prefix+' |')), 'Body')
    # The source tire has ~40k triangles; preserve the molded outline while
    # reducing tessellation that is smaller than a pixel at chase distance.
    ratio = .22 if 'redline tire' in o.name else (.38 if len(mesh.loop_triangles)>800 else 1)
    side = 'L' if sum(v.co.x for v in mesh.vertices) > 0 else 'R'
    if any(part in o.name for part in ('continuous sculpted body side', 'cabin shoulder', 'belt molding')):
        pieces = partition_door(mesh, o.name)
        for part, geometry in pieces.items():
            add_game_part(o.name, geometry, 'Door'+side if part == 'Door' else 'Body', 1)
        bpy.data.meshes.remove(mesh)
        mapping[o.name] = ['Body', 'Door'+side]
    else:
        if moving_door_part(o.name):
            group = 'Door'+side
            if o.name.startswith('Interior | '):
                # The static source card extended 9.5 cm through its rear seam.
                # Fit those original card details inside the actual cut aperture.
                for vertex in mesh.vertices: vertex.co.y = vertex.co.y*.94-.087
        add_game_part(o.name, mesh, group, ratio)
        mapping[o.name] = group

def source_interp(value, anchors):
    if value <= anchors[0][0]: return anchors[0][1]
    for (a,x), (b,y) in zip(anchors, anchors[1:]):
        if value <= b:
            t = (value-a)/(b-a)
            t = t*t*(3-2*t)
            return x+(y-x)*t
    return anchors[-1][1]

def source_top(y):
    return source_interp(y, [(-2.51,.905),(-2.28,.99),(-1.43,1.015),(-.63,1.00),
                            (-.36,.975),(.53,.965),(.93,1.055),(1.49,1.075),
                            (2.09,1.015),(2.48,.925)])

def source_skin_x(y,z):
    width = source_interp(y, [(-2.51,.951),(-2.21,.966),(-1.43,.966),(-.55,.927),
                              (.38,.905),(1.32,.966),(1.8,.958),(2.48,.941)])
    t = max(0, min(1, (z-.275)/(source_top(y)-.275)))
    return width-.092*(1-t)**2-.052*t**7+.014*math.sin(math.pi*t)

paint = bpy.data.materials.get('Midnight Sapphire | metallic lacquer')
rubber = bpy.data.materials.get('Rubber') or next(m for m in bpy.data.materials if 'rubber' in m.name.lower())
chrome = next(m for m in bpy.data.materials if 'chrome' in m.name.lower())
assert paint

def detail_mesh(name, vertices, faces, material, group, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    for face in mesh.polygons: face.use_smooth = smooth
    mesh.update()
    # Closed backing/threshold pieces use correctly oriented exterior normals.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    add_game_part(name, mesh, group, 1)

def detail_box(name, center, size, material, group):
    x,y,z = center
    a,b,c = (v*.5 for v in size)
    vertices = [(x+sx*a,y+sy*b,z+sz*c) for sx,sy,sz in
                [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),
                 (1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    faces = [(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]
    detail_mesh(name,vertices,faces,material,group)

for side, sign in [('L',1),('R',-1)]:
    group = 'Door'+side
    outline = list(DOOR_OUTLINE)
    outline[0] = (outline[0][0], source_top(outline[0][0]))
    outline[-1] = (outline[-1][0], source_top(outline[-1][0]))
    # A folded, closed metal edge connects the original skin to the original
    # upholstered card. This becomes visible only once the real door opens.
    vertices = []
    for y,z in outline:
        vertices.extend([(sign*(source_skin_x(y,z)-.006),y,z),
                         (sign*.804,y,z)])
    faces = [(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(outline)-1)]
    # The shaped inner pressing closes the lower strip and front/rear returns;
    # the parchment/black card remains slightly cabin-side of this backing.
    faces.append(tuple(i*2+1 for i in range(len(outline))))
    detail_mesh(side+' stamped door edge and inner pressing',vertices,faces,paint,group)
    # The fixed doorway has its own inset jamb, threshold and chrome scuff
    # plate; none crosses the open passage or is attached to the moving door.
    for end,y in [('front',-.628),('rear',.738)]:
        detail_box(side+' '+end+' aperture jamb',(sign*.798,y,.676),(.112,.027,.64),paint,'Body')
        detail_box(side+' '+end+' weather seal',(sign*.738,y,.684),(.013,.021,.62),rubber,'Body')
    detail_box(side+' fixed rocker threshold',(sign*.785,.043,.344),(.166,1.315,.049),paint,'Body')
    detail_box(side+' sill scuff plate',(sign*.765,.06,.371),(.105,1.16,.007),chrome,'Body')
    detail_box(side+' rear door latch',(sign*.822,.706,.76),(.047,.014,.065),chrome,group)
    for z in (.52,.86):
        detail_box(side+' hinge plate '+str(z),(sign*.85,-.597,z),(.058,.052,.069),chrome,group)

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
    node.name = ('Body' if name=='Body' else 'DoorMesh_'+name[-1]
                 if name.startswith('Door') else 'WheelMesh_'+name)
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

for side, center in DOOR_HINGES.items():
    hinge = empty('DoorHinge_'+side,root,center)
    hinge['door_side'] = side
    hinge['open_sign'] = -1 if side == 'L' else 1
    hinge['max_angle_radians'] = DOOR_ANGLE
    hinge['open_progress'] = 0.0
    obj = nodes['Door'+side]
    obj.data.transform(Matrix.Translation(-Vector(center)))
    obj.parent = hinge
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
# The committed derived Blender scene stays editable and opens in the closed
# pose. It is regenerated from the immutable snapshot by this script.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'asset-source'/'oldsmobile-442.game.blend'), compress=True)

raw=(OUTPUT/'oldsmobile-442.glb').read_bytes()
json_length=struct.unpack_from('<I',raw,12)[0]
gltf=json.loads(raw[20:20+json_length])
export_nodes = {n.get('name'): n for n in gltf.get('nodes',[])}
for code,_,_ in wheel_specs:
    assert 'WheelSteer_'+code in export_nodes and 'WheelSpin_'+code in export_nodes
for side in DOOR_HINGES:
    assert 'DoorHinge_'+side in export_nodes and 'DoorMesh_'+side in export_nodes
    hinge = export_nodes['DoorHinge_'+side]
    expected = DOOR_HINGES[side]
    assert all(abs(a-b) < 1e-5 for a,b in zip(hinge['translation'],[expected[0],expected[2],-expected[1]]))
    assert hinge.get('extras',{}).get('open_progress') == 0
    assert len(hinge.get('children',[])) == 1
assert all(len(parts) == 2 for parts in door_partitions.values()) and len(door_partitions) == 6
assert hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest() == source_hash, 'Read-only source snapshot changed'
assert not gltf.get('animations') and not gltf.get('cameras')
assert not any('Studio' in str(n) for n in gltf['nodes'])

manifest = {
    'version':2,'name':'1968 Oldsmobile 442 convertible','asset':'/assets/oldsmobile-442.glb',
    'sourceSnapshot':'asset-source/1968_oldsmobile_442.snapshot.blend','sourceSha256':source_hash,
    'editableGameSource':'asset-source/oldsmobile-442.game.blend',
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
    'doors':[{'id':side,'side':1 if side == 'L' else -1,
              'hingeNode':'DoorHinge_'+side,'meshNode':'DoorMesh_'+side,
              'hinge':[center[0],center[2],-center[1]],'axis':[0,1,0],
              'openSign':-1 if side == 'L' else 1,'maxAngleRadians':DOOR_ANGLE,
              'closedProgress':0,'openProgress':1,
              'entryOpening':{'zMin':-.72,'zMax':.59,'sillHeight':.375},
              'parts':'Original partitioned body skin, cabin shoulder and belt trim; original door card, armrest, handles, crank, mirror and vent window; modeled inner pressing, folded edges and latch'}
             for side,center in DOOR_HINGES.items()],
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
    'doorPartitionFaces':door_partitions,
    'validation':{'namedWheelNodesVerified':True,'leftHandDriveVerified':True,'physicalWheelSidesVerified':True,
                  'namedDoorNodesVerified':True,'doorHingesVerified':True,'originalSkinPartitioned':True,
                  'noCameras':True,'noAnimations':True,'noStudioNodes':True}
}
(OUTPUT/'vehicle-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('EXPORT_SUCCESS',json.dumps(manifest['statistics']), 'bounds',json.dumps(manifest['bounds']))
