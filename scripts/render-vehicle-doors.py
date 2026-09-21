"""Render the actual editable game car closed and open; never resave the asset."""
from pathlib import Path
import bpy, math, json
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'asset-source'/'oldsmobile-442.game.blend'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('Door inspection studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.25,.29,.34,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6
scene.view_settings.view_transform = 'AgX'

def aim(obj, target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

for name,position,power,size in [('Key',(4,-4,6),1400,5),('Fill',(-4,-1,4),1000,4),('Rim',(1,5,5),1700,3)]:
    data = bpy.data.lights.new(name,'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location = position
    aim(obj,(0,0,.7))

bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.015))
floor = bpy.context.object
floor.name = 'Inspection floor (not saved)'
material = bpy.data.materials.new('Inspection floor')
material.diffuse_color = (.10,.125,.15,1)
material.use_nodes = True
material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.10,.125,.15,1)
material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .68
floor.data.materials.append(material)
data = bpy.data.cameras.new('Inspection camera')
camera = bpy.data.objects.new('Inspection camera',data)
scene.collection.objects.link(camera)
scene.camera = camera
data.lens = 53

views = [
    ('vehicle-doors-closed',(5.3,-6.1,3.1),(0,-.05,.74),0,0),
    ('vehicle-doors-left-open',(5.8,-6.5,3.2),(.2,-.05,.72),1,0),
    ('vehicle-doors-doorway',(4.2,.65,2.1),(.35,.05,.74),1,0),
    ('vehicle-doors-right-open',(-5.8,-6.5,3.2),(-.2,-.05,.72),0,1),
    ('vehicle-doors-inner-card',(4.5,3.8,2.8),(.5,.1,.73),1,0),
]
for name,position,target,left,right in views:
    bpy.data.objects['DoorHinge_L'].rotation_euler.z = -math.radians(68)*left
    bpy.data.objects['DoorHinge_R'].rotation_euler.z = math.radians(68)*right
    camera.location = position
    aim(camera,target)
    scene.render.filepath = str(ROOT/'docs'/f'{name}.png')
    bpy.ops.render.render(write_still=True)
print('DOOR_RENDERS_COMPLETE',json.dumps([name+'.png' for name,*_ in views]))
