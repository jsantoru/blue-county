"""Read-only inspection of the saved source snapshot."""
import bpy, json
from pathlib import Path
scene = bpy.context.scene
scene.frame_set(1)
deps = bpy.context.evaluated_depsgraph_get()
items = []
for o in scene.objects:
    entry = {'name':o.name,'type':o.type,'parent':o.parent.name if o.parent else None,
             'collections':[c.name for c in o.users_collection],
             'location':list(o.matrix_world.translation),'dimensions':list(o.dimensions),
             'modifiers':[(m.type, getattr(m, 'levels', None), getattr(m, 'segments', None)) for m in o.modifiers]}
    if o.type in ('MESH','CURVE','FONT','SURFACE'):
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        entry['triangles'] = len(me.loop_triangles)
        entry['vertices'] = len(me.vertices)
        entry['materials'] = [m.name if m else None for m in me.materials]
        ev.to_mesh_clear()
    items.append(entry)
out = Path(__file__).resolve().parents[1] / 'asset-source' / 'inspection.json'
out.write_text(json.dumps({'frame':scene.frame_current,'units':scene.unit_settings.system,'objects':items},indent=2))
print('INSPECTION', len(items), sum(i.get('triangles',0) for i in items), out)
