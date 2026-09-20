"""Read-only geometry audit; reuses the independently implemented envelope math."""
import importlib.util
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('property_geometry_audit',ROOT/'audit-property-east.py')
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
data=json.loads((ROOT.parents[1]/'public/map/warwick.json').read_text())
observations=json.loads((ROOT/'property-west-observations.json').read_text())
boxes=audit.envelopes(data)
hits=[]
for feature in observations['features']:
    assert all(math.isfinite(c) for p in feature['points'] for c in p)
    triangles=audit.triangles(feature['points'])
    assert abs(sum(audit.area(t) for t in triangles)-audit.area(feature['points']))<1e-6
    for box in boxes:
        overlap=sum(audit.area(audit.intersection(t,box['points'])) for t in triangles)
        if overlap>1e-4:
            hits.append({'feature':feature['id'],'building':box['id'],'address':box['address'],'overlapAreaMeters2':round(overlap,6)})
result={
    'method':'Replicates current roads.ts renderParts expansion, longest-edge oriented building envelope and road-clearance scaling via audit-property-east.py. All property polygons triangulate, have finite coordinates, and preserve polygon area.',
    'featureCount':len(observations['features']),
    'counts':{kind:sum(f['kind']==kind for f in observations['features']) for kind in ['driveway','deck','pool','patio']},
    'houseEnvelopeCount':len(boxes),
    'envelopeIntersections':hits,
    'limits':'Source aerial uncertainty is still 0.5–1.5 m or greater under canopy. Plan-view validation excludes 3D roof, trim, stair and porch projections; vertical feature dimensions remain approximations.',
}
(ROOT/'property-west-envelope-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
