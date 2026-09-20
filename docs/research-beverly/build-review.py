"""Build a source-photo inspection page; original photos are never modified."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
payload={k:json.loads((ROOT/f).read_text()) for k,f in {
    'reference':'ortho2025-export-georeference.json','footprints':'footprints-local.geojson',
    'parcels':'parcels-local.geojson','observations':'east-observations.json',
    'loop':'verified-loop-extent.json'}.items()}
west=json.loads((ROOT/'west-observations.json').read_text(encoding='utf-8'))
for key in ('driveways','canopies'):
    payload['observations'][key] += west[key]
html='''<!doctype html><meta charset="utf-8"><title>Beverly source reference</title>
<style>body{margin:0;background:#171d22;color:white;font:14px system-ui}header{position:sticky;top:0;z-index:2;background:#171d22ed;padding:10px}label{margin-right:12px}svg{max-width:100%;height:auto;cursor:crosshair}output{display:block;margin-top:6px;color:#b6daec}text{font:18px system-ui;paint-order:stroke;stroke:#000;stroke-width:4;fill:white;pointer-events:none}.hidden{display:none}small{color:#bbb}#viewport{max-width:1350px;margin:auto}</style>
<header><b>Beverly Drive / West Ridge source evidence</b> <small>NYSDOP spring2025 · Original aerial + vector overlays. Approximate visual annotations.</small><br>
<label><input id="footprints" type="checkbox" checked>State building footprints</label><label><input id="parcels" type="checkbox">Parcel address labels</label><label><input id="driveways" type="checkbox" checked>East + west driveway traces</label><label><input id="canopies" type="checkbox">Canopy observations</label><label><input id="loop" type="checkbox">OSM loop</label>
<output id="coordinates">Click the photo for original pixel and local metric coordinates.</output></header>
<div id="viewport"><svg id="photo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 2650"><image href="beverly-2025-ortho.jpg" width="1800" height="2650"/></svg></div>
<script>
const data=PAYLOAD, svg=document.querySelector('svg'), NS='http://www.w3.org/2000/svg', ext=data.reference.extent;
const lat=41.283879,lon=-74.3662393,sx=111320*Math.cos(lat*Math.PI/180);
function worldPixel(lo,la){const mx=lo*Math.PI/180*6378137,my=Math.log(Math.tan(Math.PI/4+la*Math.PI/360))*6378137;return[(mx-ext.xmin)/(ext.xmax-ext.xmin)*1800,(ext.ymax-my)/(ext.ymax-ext.ymin)*2650]}
function localPixel(p){return worldPixel(lon+p[0]/sx,lat-p[1]/111320)}
function add(parent,type,attrs){const n=document.createElementNS(NS,type);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.appendChild(n);return n}
function line(parent,pts,color,width=2){return add(parent,'polyline',{points:pts.map(p=>p.join(',')).join(' '),fill:'none',stroke:color,'stroke-width':width})}
function group(id){const g=add(svg,'g',{id:id+'-layer',class:document.getElementById(id).checked?'':'hidden'});document.getElementById(id).onchange=e=>g.classList.toggle('hidden',!e.target.checked);return g}
const fp=group('footprints');for(const f of data.footprints.features){const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const poly of polygons)for(const ring of poly)line(fp,ring.map(p=>worldPixel(...p)),'#3be7ff',2)}
const pa=group('parcels');for(const f of data.parcels.features){const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const poly of polygons)for(const ring of poly)line(pa,ring.map(p=>worldPixel(...p)),'#d7ef89',1);const r=polygons[0][0],c=[0,1].map(k=>r.slice(0,-1).reduce((s,p)=>s+p[k],0)/(r.length-1));if(Number.isFinite(c[0])){const p=worldPixel(...c);add(pa,'text',{x:p[0],y:p[1]}).textContent=f.properties.PARCEL_ADDR||''}}
const d=group('driveways');for(const t of data.observations.driveways){line(d,t.sourcePixels,t.confidence==='low'?'#ff7262':'#ffcf57',4);const p=t.sourcePixels[0];add(d,'text',{x:p[0]+8,y:p[1]-6}).textContent=t.address.replace(' Beverly Dr','')+(t.confidence==='low'?' ?':'')}
for(const t of data.observations.pavementWidths){line(d,t.sourcePixels,'#ff6eb5',3);const p=t.sourcePixels[0];add(d,'text',{x:p[0]-75,y:p[1]-6}).textContent=t.widthMeters+'m'}
const ca=group('canopies');for(const t of data.observations.canopies){add(ca,'circle',{cx:t.sourcePixels[0],cy:t.sourcePixels[1],r:t.radiusMeters/0.2378,fill:'none',stroke:t.type==='conifer'?'#92ffd2':'#ffd890','stroke-width':2})}
line(group('loop'),data.loop.pointsXZ.map(localPixel),'#ff5e80',4);
svg.onclick=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse()),mx=ext.xmin+q.x/1800*(ext.xmax-ext.xmin),my=ext.ymax-q.y/2650*(ext.ymax-ext.ymin),lo=mx/6378137*180/Math.PI,la=(2*Math.atan(Math.exp(my/6378137))-Math.PI/2)*180/Math.PI;document.getElementById('coordinates').textContent=`Source pixel [${q.x.toFixed(1)}, ${q.y.toFixed(1)}] · local [${((lo-lon)*sx).toFixed(2)}, ${((lat-la)*111320).toFixed(2)}] · WGS84 [${lo.toFixed(8)}, ${la.toFixed(8)}]`};
</script>'''
(ROOT/'review-overlay.html').write_text(html.replace('PAYLOAD',json.dumps(payload,separators=(',',':'))),encoding='utf-8')
print('Wrote review-overlay.html')
