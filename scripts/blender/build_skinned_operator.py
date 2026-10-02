#!/usr/bin/env python3
"""Build a continuous weighted operator from the CC0 MakeHuman base.
Run: Blender --background --factory-startup --threads 4 --python this_file
The JSON skin uses global rest positions and translation-only bind matrices.
"""
from pathlib import Path
from collections import defaultdict
import math, json, hashlib, shutil
import bpy, bmesh
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/'assets/blender/operator/reference/base.obj'
DST=ROOT/'public/models/skinned-operator'
WORK=ROOT/'assets/blender/skinned-operator'
DST.mkdir(parents=True,exist_ok=True);WORK.mkdir(parents=True,exist_ok=True)
(DST/'textures').mkdir(exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
V=[];UV=[];GROUP=defaultdict(list);group=''
for l in SRC.read_text().splitlines():
 if l.startswith('v '):V.append(Vector(map(float,l.split()[1:4])))
 elif l.startswith('vt '):UV.append(tuple(map(float,l.split()[1:3])))
 elif l.startswith('g '):group=l[2:]
 elif l.startswith('f '):GROUP[group].append([(int(t.split('/')[0])-1,int(t.split('/')[1])-1 if '/' in t else -1) for t in l.split()[1:]])
inds={i for f in GROUP['body'] for i,_ in f};low=min(V[i].y for i in inds); high=max(V[i].y for i in inds);S=2.16/(high-low)
def jraw(name):
 ii={i for f in GROUP['joint-'+name] for i,_ in f};return sum((V[i] for i in ii),Vector())/len(ii)
cz=jraw('pelvis').z
# Runtime coordinates are Y-up, +Z forward. Blender is Z-up, -Y forward.
def coord(v):return Vector((v.x*S,(v.y-low)*S-1,(v.z-cz)*S))
def b(v):return Vector((v[0],-v[2],v[1]))
def r(v):return Vector((v[0],v[2],-v[1]))
def joint(n):return coord(jraw(n))
J={n:joint(n) for n in ['pelvis','spine-3','spine-1','neck','head','head-2']}
BONES=[]
def bone(name,parent,h,t):BONES.append({'name':name,'parent':next((i for i,v in enumerate(BONES) if v['name']==parent),-1),'head':list(h),'tail':list(t)})
bone('root',None,(0,-1,0),(0,-.9,0));bone('pelvis','root',J['pelvis'],J['spine-3']);bone('spine','pelvis',J['spine-3'],J['spine-1']);bone('chest','spine',J['spine-1'],J['neck']);bone('neck','chest',J['neck'],J['head']);bone('head','neck',J['head'],J['head-2'])
for side in ['L','R']:
 s=side.lower();bone('upper_arm.'+side,'chest',joint(s+'-shoulder'),joint(s+'-elbow'));bone('forearm.'+side,'upper_arm.'+side,joint(s+'-elbow'),joint(s+'-hand'));bone('hand.'+side,'forearm.'+side,joint(s+'-hand'),joint(s+'-finger-3-1'))
for side in ['L','R']:
 s=side.lower();bone('thigh.'+side,'pelvis',joint(s+'-upper-leg'),joint(s+'-knee'));bone('shin.'+side,'thigh.'+side,joint(s+'-knee'),joint(s+'-ankle'));bone('foot.'+side,'shin.'+side,joint(s+'-ankle'),joint(s+'-foot-2'))
BY={v['name']:i for i,v in enumerate(BONES)}
MAT={
 'uniform':{'albedo':'#768074','roughness':.91,'metallic':0,'texture':'textures/fabric.png','normal':'textures/fabric-normal.png'},
 'trousers':{'albedo':'#687064','roughness':.93,'metallic':0,'texture':'textures/fabric.png','normal':'textures/fabric-normal.png'},
 'carrier':{'albedo':'#626957','roughness':.9,'metallic':0,'texture':'textures/fabric.png','normal':'textures/fabric-normal.png'},
 'webbing':{'albedo':'#393f32','roughness':.94,'metallic':0,'texture':'textures/fabric.png'},
 'rubber':{'albedo':'#303533','roughness':.84,'metallic':.01},
 'helmet':{'albedo':'#73786a','roughness':.77,'metallic':.08,'texture':'textures/fabric.png'},
 'lens':{'albedo':'#283c3e','roughness':.12,'metallic':.42},
 'patch':{'albedo':'#b8b49c','roughness':.83,'metallic':0},
}
def srgb(x):return ((x+.055)/1.055)**2.4 if x>.04045 else x/12.92
# Neutral fabric has visible dye variation and fabric wrinkles at game distance.
# Its value range remains light enough to multiply once by team-tinted albedo.
def hash_noise(x,y):
 n=(x*374761393+y*668265263)&0xffffffff;n=((n^(n>>13))*1274126177)&0xffffffff
 return ((n^(n>>16))&65535)/65535
def noise2(x,y,scale):
 x/=scale;y/=scale;ix=math.floor(x);iy=math.floor(y);fx=x-ix;fy=y-iy
 fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
 return (hash_noise(ix,iy)*(1-fx)+hash_noise(ix+1,iy)*fx)*(1-fy)+(hash_noise(ix,iy+1)*(1-fx)+hash_noise(ix+1,iy+1)*fx)*fy
def cloth_height(x,y):
 return noise2(x,y,45)*.16+noise2(x,y,11)*.055+math.sin(x*.91)*math.sin(y*.71)*.018
for normal in [False,True]:
 im=bpy.data.images.new('woven-normal' if normal else 'woven-albedo',512,512,alpha=False);px=[]
 for yy in range(512):
  for xx in range(512):
   fine=hash_noise(xx,yy);broad=noise2(xx,yy,65);middle=noise2(xx+73,yy+18,19)
   if normal:
    nx=(cloth_height(xx-1,yy)-cloth_height(xx+1,yy))*2.1;ny=(cloth_height(xx,yy-1)-cloth_height(xx,yy+1))*2.1
    nn=Vector((nx,ny,1)).normalized();color=tuple(.5+.5*v for v in nn)
   else:
    wear=max(0,math.sin(xx*.049+math.sin(yy*.034)*1.4))**8*.055
    val=max(.50,min(.98,.51+broad*.29+middle*.115+fine*.045+wear));color=(val,val*.991,val*.977)
   px.extend((*color,1))
 im.pixels[:]=px;im.filepath_raw=str(DST/'textures'/('fabric-normal.png' if normal else 'fabric.png'));im.file_format='PNG';im.save()
MATS={}
for name, spec in MAT.items():
 m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');rgb=[int(spec['albedo'][i:i+2],16)/255 for i in (1,3,5)];bs.inputs['Base Color'].default_value=(*map(srgb,rgb),1);bs.inputs['Roughness'].default_value=spec['roughness'];bs.inputs['Metallic'].default_value=spec['metallic'];m.diffuse_color=(*rgb,1)
 if 'texture' in spec:
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(DST/spec['texture']),check_existing=True)
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*map(srgb,rgb),1);m.node_tree.links.new(tex.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
 if 'normal' in spec:
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(DST/spec['normal']),check_existing=True);tex.image.colorspace_settings.name='Non-Color';nm=m.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.22;m.node_tree.links.new(tex.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
 MATS[name]=m
OBJECTS=[]
def finish(obj,mat,rigid=None):
 obj.data.materials.append(MATS[mat]);obj['rigid']=rigid or '';OBJECTS.append(obj)
 for p in obj.data.polygons:p.use_smooth=True
 return obj

def source_mesh(group,name,material):
 faces=GROUP[group];index={old:i for i,old in enumerate(sorted({i for f in faces for i,_ in f}))};verts=[b(coord(V[old])) for old in index];mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],[[index[i] for i,_ in f] for f in faces]);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
 uv=mesh.uv_layers.new(name='UVMap')
 for p,f in zip(mesh.polygons,faces):
  for li,(_,ti) in zip(p.loop_indices,f):uv.data[li].uv=UV[ti] if ti>=0 else (0,0)
 finish(obj,material)
 return obj
body=source_mesh('body','continuous-balaclava-gloves-base','rubber')
# Bake relaxed finger curl into the anatomical mesh before skin weighting. The
# runtime hand bone still represents wrist-to-knuckle, not a displaced fist.
for side in ['L','R']:
 wrist=joint(side.lower()+'-hand');middle=joint(side.lower()+'-finger-3-1');thumb=joint(side.lower()+'-finger-1-1')
 palm=(middle-wrist).cross(thumb-wrist).normalized()
 if palm.x*(1 if side=='L' else -1)>0:palm=-palm
 chains=[]
 for f in range(1,6):
  points=[joint(side.lower()+'-finger-'+str(f)+'-'+str(i)) for i in range(1,5)]
  target=[points[0]]
  axis=(points[1]-points[0]).normalized();curl=(palm-axis*palm.dot(axis)).normalized()
  for seg in range(3):
   angle=math.radians(([12,30,45] if f==1 else [22,55,85])[seg])
   direction=axis*math.cos(angle)+curl*math.sin(angle)
   target.append(target[-1]+direction*(points[seg+1]-points[seg]).length)
  chains.append((points,target))
 for v in body.data.vertices:
  q=r(v.co)
  if (q-wrist).length>.23:continue
  best=None
  for points,target in chains:
   for seg in range(3):
    a,bb=points[seg],points[seg+1];axis=bb-a;t=max(0,min(1,(q-a).dot(axis)/axis.length_squared));d=(q-(a+axis*t)).length
    if best is None or d<best[0]:best=(d,points,target,seg,t)
  if best is None or best[0]>.036:continue
  dist,points,target,seg,t=best
  a,bb=points[seg],points[seg+1];aa,bb2=target[seg],target[seg+1]
  delta=(bb-a).rotation_difference(bb2-aa);deformed=aa+delta@(q-a)
  # Fade at the knuckles so the hand has no hard crease or detached fingers.
  fade=min(1,max(0,((q-points[0]).dot((points[1]-points[0]).normalized())+.008)/.023))
  v.co=b(q.lerp(deformed,fade))
body.data.update()

cloth=source_mesh('helper-tights','continuous-combat-uniform','uniform')
# The continuous outfit follows the source garment topology with added ease and folds.
cloth.data.materials.append(MATS['trousers'])
for p in cloth.data.polygons:
 p.material_index=1 if sum(r(cloth.data.vertices[i].co).y for i in p.vertices)/len(p.vertices)<.19 else 0
for obj in [body,cloth]:
 mesh=obj.data;mesh.update()
 normals=[v.normal.copy() for v in mesh.vertices]
 for v,n in zip(mesh.vertices,normals):
  q=r(v.co)
  if obj==cloth:
   folds=0
   for side in ['L','R']:
    for region,rate,amp,width in [('elbow',78,.005,.14),('knee',68,.006,.18),('ankle',100,.004,.1)]:
     pt=joint(side.lower()+'-'+region);d=(q-pt).length;folds+=math.sin((q.y-pt.y)*rate+q.z*17)*amp*math.exp(-d*d/(width*width))
   ease=.037 if q.y<.3 else .027
   if abs(q.x)>.30:
    ease+=.006*max(0,1-(q.y-.50)**2/.08)
    wr=joint(('l' if q.x>0 else 'r')+'-hand');ease-=.02*max(0,1-(q-wr).length/.11)
   v.co+=n*(ease+folds)
  else:v.co+=n*.0035
 mesh.update()
bpy.context.view_layer.objects.active=body
# The connected garment covers torso/legs; removing this invisible underlayer
# keeps budget available for tailored equipment instead of unseen anatomy.
bm=bmesh.new();bm.from_mesh(body.data)
hidden=[]
for f in bm.faces:
 q=r(f.calc_center_median())
 if q.y<.81 and not(abs(q.x)>.485 and q.y<.49):hidden.append(f)
bmesh.ops.delete(bm,geom=hidden,context='FACES');bm.to_mesh(body.data);bm.free()
mod=body.modifiers.new('hidden-base-budget','DECIMATE');mod.ratio=.92;bpy.ops.object.modifier_apply(modifier=mod.name)
# A single subdivision on the low resolution connected outfit yields smooth silhouette and joints.
bpy.context.view_layer.objects.active=cloth;mod=cloth.modifiers.new('garment-surface','SUBSURF');mod.levels=1;bpy.ops.object.modifier_apply(modifier=mod.name)
cloth.data.update()
for v in cloth.data.vertices:
 q=r(v.co);fold=0
 for side in ['L','R']:
  for reg,amp,width in [('elbow',.009,.18),('knee',.008,.19),('ankle',.007,.18)]:
   pt=joint(side.lower()+'-'+reg);d=(q-pt).length;fold+=amp*math.sin((q.y-pt.y)*70+q.x*22+q.z*33)*math.exp(-(d/width)**2)
 v.co+=v.normal*fold
cloth.data.update()
cloth.data.materials.append(MATS['webbing'])
for poly in cloth.data.polygons:
 q=r(poly.center)
 for side in ['L','R']:
  el=joint(side.lower()+'-elbow')
  if (q-el).length<.12 and q.z<el.z-.045:poly.material_index=2
# Integrated knee protection uses the exact continuous trouser surface and skin
# weights. A detached rigid shin plate would float during deep thigh/shin blends.
cloth.data.materials.append(MATS['helmet'])
for vertex in cloth.data.vertices:
 q=r(vertex.co)
 for side in ['L','R']:
  knee=joint(side.lower()+'-knee');dx=(q.x-knee.x)/.089;dy=(q.y-knee.y-.008)/.10
  radius=(abs(dx)**4+abs(dy)**4)**.25
  if radius<1 and q.z>knee.z+.050:
   t=min(1,max(0,(1-radius)/.24));t=t*t*(3-2*t)
   vertex.co+=vertex.normal*(.010*t)
cloth.data.update()
for poly in cloth.data.polygons:
 q=r(poly.center)
 for side in ['L','R']:
  knee=joint(side.lower()+'-knee');dx=(q.x-knee.x)/.084;dy=(q.y-knee.y-.008)/.095
  if abs(dx)**4+abs(dy)**4<1 and q.z>knee.z+.060:poly.material_index=3
# Replace the helper mesh's tiny atlas island with a physical-scale fabric UV.
for poly in cloth.data.polygons:
 for li in poly.loop_indices:
  q=r(cloth.data.vertices[cloth.data.loops[li].vertex_index].co)
  cloth.data.uv_layers.active.data[li].uv=(q.x*1.6+q.z*.8,q.y*1.7)
# Feet are completely inside boots; trim only this hidden garment underlayer.
bm=bmesh.new();bm.from_mesh(cloth.data)
bmesh.ops.delete(bm,geom=[f for f in bm.faces if r(f.calc_center_median()).y<-.79],context='FACES');bm.to_mesh(cloth.data);bm.free()
def mesh_obj(name,verts,faces,mat,rigid):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata([b(v) for v in verts],[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);finish(o,mat,rigid)
 uv=mesh.uv_layers.new(name='UVMap')
 for p in mesh.polygons:
  for li in p.loop_indices:
   q=r(mesh.vertices[mesh.loops[li].vertex_index].co);uv.data[li].uv=(q.x*5+q.z*3,q.y*6)
 return o

def shell(name,rings,mat,rigid,segments=32):
 # Rings contain y, half width, front depth, back depth. Front is +Z.
 verts=[]
 for y,rx,front,back in rings:
  for i in range(segments):
   a=2*math.pi*i/segments;depth=front if math.cos(a)>0 else back;xx=math.copysign(abs(math.sin(a))**.68,math.sin(a));zz=math.copysign(abs(math.cos(a))**.68,math.cos(a))
   verts.append((rx*xx,y,depth*zz))
 faces=[]
 for k in range(len(rings)-1):
  for i in range(segments):a=k*segments+i;bb=k*segments+(i+1)%segments;c=bb+segments;d=a+segments;faces.append((a,bb,c,d) if rings[k+1][0]>rings[k][0] else (a,d,c,bb))
 return mesh_obj(name,verts,faces,mat,rigid)
# Tailored vest is a circumferential garment shell, not a box.
shell('fitted-plate-carrier',[(.29,.235,.236,.151),(.39,.230,.235,.131),(.55,.242,.233,.132),(.66,.249,.204,.141),(.717,.18,.164,.129)],'carrier','chest')
def box(name,loc,size,mat,rigid,bevel=.01):
 bpy.ops.mesh.primitive_cube_add(size=1,location=b(loc));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(o,mat,rigid)
 mod=o.modifiers.new('tailored-rounded-seam','BEVEL');mod.width=bevel;mod.segments=3;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 uv=o.data.uv_layers.active
 return o
def tube(name,points,radius,mat,rigid,sides=8):
 pts=[Vector(v) for v in points];verts=[];faces=[]
 for k,p in enumerate(pts):
  tangent=(pts[min(k+1,len(pts)-1)]-pts[max(0,k-1)]).normalized()
  u=tangent.cross(Vector((0,0,1)))
  if u.length<.1:u=tangent.cross(Vector((0,1,0)))
  u.normalize();v=tangent.cross(u).normalized()
  for i in range(sides):verts.append(p+radius*(u*math.cos(i*2*math.pi/sides)+v*math.sin(i*2*math.pi/sides)))
 for k in range(len(pts)-1):
  for i in range(sides):a=k*sides+i;bb=k*sides+(i+1)%sides;faces.append((a,bb,bb+sides,a+sides))
 return mesh_obj(name,verts,faces,mat,rigid)
def cuff(name,center,axis,radius,width,mat,rigid):
 axis=Vector(axis).normalized();u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u).normalized();verts=[];faces=[]
 for offset,rr in [(-width/2,radius*.95),(-width*.34,radius),(width*.34,radius),(width/2,radius*.95)]:
  for i in range(24):a=i*2*math.pi/24;verts.append(Vector(center)+axis*offset+rr*(u*math.cos(a)+v*math.sin(a)))
 for k in range(3):
  for i in range(24):a=k*24+i;bb=k*24+(i+1)%24;faces.append((a,bb,bb+24,a+24))
 return mesh_obj(name,verts,faces,mat,rigid)
def plate_panel(name,outline,depth,mat,rigid):
 verts=[(x,y,z) for x,y,z in outline]+[(x,y,z-depth) for x,y,z in outline];n=len(outline);faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]
 for i in range(n):faces.append((i,(i+1)%n,(i+1)%n+n,i+n))
 return mesh_obj(name,verts,faces,mat,rigid)
# Explicit plate pocket panels, contrast binding and a segmented cummerbund.
plateOutline=[(-.162,.315,.236),(.162,.315,.236),(.183,.568,.239),(.125,.672,.210),(-.125,.672,.210),(-.183,.568,.239)]
plate_panel('sapi-pocket-panel',plateOutline,.012,'carrier','chest')
tube('plate-pocket-binding',plateOutline+[plateOutline[0]],.0042,'webbing','chest')
for y in [.351,.380]:
 for sign in [-1,1]:tube('cummerbund-webbing',[(sign*.187,y,.199),(sign*.223,y,.140),(sign*.235,y,.015),(sign*.219,y,-.082)],.007,'webbing','chest')
# Reinforced shoulders, deliberately distinct cuffs, and zippered sleeve pockets.
for side,sign in [('L',1),('R',-1)]:
 sh=joint(side.lower()+'-shoulder');el=joint(side.lower()+'-elbow');wr=joint(side.lower()+'-hand');ax=(el-sh).normalized()
 cuff('sleeve-wrist-hem-'+side,wr.lerp(el,.075),(wr-el),.072,.047,'webbing','forearm.'+side)
 cuff('glove-retention-strap-'+side,wr.lerp(el,.002),(wr-el),.055,.020,'rubber','hand.'+side)
 center=sh.lerp(el,.43)+Vector((sign*.067,0,.084));o=box('upper-arm-utility-pocket-'+side,center,(.092,.143,.052),'uniform','upper_arm.'+side,.014)
 u=Vector((-ax.y,ax.x,0)).normalized();pocketRotation=Matrix((b(u),b(Vector((0,0,1))),b(ax))).transposed().to_quaternion();o.rotation_mode='QUATERNION';o.rotation_quaternion=pocketRotation
 line=[center+ax*.055+Vector((0,0,.031)),center-ax*.055+Vector((0,0,.031))]
 tube('sleeve-pocket-zipper-'+side,line,.0037,'rubber','upper_arm.'+side)
 panel=box('sleeve-hook-loop-panel-'+side,center+Vector((0,0,.029)),(.069,.049,.005),'webbing','upper_arm.'+side,.003);panel.rotation_mode='QUATERNION';panel.rotation_quaternion=pocketRotation
 # Soft elbow reinforcement shaped with the joint, skinned across the seam.
 # Elbow reinforcement is a material panel on the continuous garment itself.
 hip=joint(side.lower()+'-upper-leg');knee=joint(side.lower()+'-knee');ank=joint(side.lower()+'-ankle')
 seam=[hip+Vector((sign*.115,0,.018)),hip.lerp(knee,.5)+Vector((sign*.105,0,.04)),knee+Vector((sign*.098,0,.01)),knee.lerp(ank,.56)+Vector((sign*.086,0,.013))]
 tube('double-stitched-trouser-seam-'+side,seam,.0032,'webbing',None)
 cuff('trouser-boot-blousing-'+side,ank+Vector((0,.165,0)),knee-ank,.083,.036,'webbing','shin.'+side)
shell('combat-shirt-stand-collar',[(.764,.113,.126,.094),(.815,.094,.119,.088),(.846,.088,.113,.079)],'uniform','neck',32)
tube('collar-zipper',[(0,.844,.119),(0,.797,.131),(0,.762,.141),(0,.716,.18)],.0036,'webbing','neck')
# Magazine pouches narrow and closely seated on the carrier front.
for i,x in enumerate([-.117,0,.117]):
 z=.232-.006*abs(x)/.117
 box('stitched-mag-pouch-'+str(i),(x,.425,z+.027),(.100,.160,.052),'carrier','chest',.012)
 box('pouch-binding-'+str(i),(x,.507,z+.033),(.1,.019,.05),'webbing','chest',.006)
 for row in [0,1]:box('webbing-'+str(i)+'-'+str(row),(x,.418+row*.041,z+.056),(.091,.015,.008),'webbing','chest',.003)
# Shoulder straps follow a curved front-to-back route.
for side in [-1,1]:
 x=side*.14;verts=[];faces=[]
 path=[(.207,.655),(.174,.716),(.084,.789),(-.036,.795),(-.117,.746),(-.15,.66)]
 for z,y in path:verts.extend([(x-.026,y,z),(x+.026,y,z)])
 for i in range(len(path)-1):faces.append((i*2,i*2+1,i*2+3,i*2+2))
 o=mesh_obj('shoulder-strap',verts,faces,'webbing','chest');mod=o.modifiers.new('strap-thickness','SOLIDIFY');mod.thickness=.006;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 box('strap-buckle',(x,.669,.208),(.055,.035,.014),'rubber','chest',.007)
box('name-strip',(0,.615,.233),(.145,.027,.007),'patch','chest',.004)
box('radio-pouch',(-.24,.52,.063),(.061,.16,.068),'carrier','chest',.015)
# Duty belt follows the waist instead of spanning empty air.
shell('duty-belt',[(.165,.274,.233,.215),(.208,.265,.239,.207)],'rubber','pelvis')
box('belt-buckle',(0,.181,.248),(.063,.038,.02),'helmet','pelvis',.005)
for side in ['L','R']:
 sign=1 if side=='L' else -1
 hip=joint(side.lower()+'-upper-leg');knee=joint(side.lower()+'-knee');ankle=joint(side.lower()+'-ankle')
 loc=hip.lerp(knee,.48);loc.x+=sign*.095;loc.z+=.018
 box('cargo-bellows-pocket-'+side,loc,(.056,.192,.143),'trousers','thigh.'+side,.02)
 box('cargo-pocket-flap-'+side,loc+Vector((sign*.008,.076,0)),(.058,.035,.148),'webbing','thigh.'+side,.008)
 # Knee protection is embedded in the continuous garment above.
 # Boot: stacked shaped rings following foot outline, no individual toe exposure.
 ax=ankle.x
 rings=[(-1.008,.090,.272,.111),(-.973,.092,.275,.110),(-.932,.090,.263,.107),(-.88,.085,.17,.092),(-.81,.079,.102,.084),(-.735,.078,.074,.079)]
 o=shell('combat-boot-'+side,rings,'rubber',None,24)
 for v in o.data.vertices:v.co.x+=ax
 # flatten bottom foot surface; closed sole independent attached to foot bone
 verts=[tuple(r(v.co)) for v in o.data.vertices[:24]];mesh_obj('boot-outsole-'+side,verts,[tuple(range(24))],'rubber','foot.'+side)
 for n in range(4):box('boot-lace-'+side+str(n),(ax,-.855+n*.031,.137-n*.015),(.092,.009,.014),'webbing','foot.'+side,.003)
 toeSeam=[(ax-.078,-.944,.142),(ax-.062,-.925,.193),(ax,-.923,.232),(ax+.062,-.925,.193),(ax+.078,-.944,.142)]
 tube('boot-vamp-stitched-seam-'+side,toeSeam,.003,'webbing','foot.'+side)
 welt=[]
 for i in range(25):
  angle=i*math.pi*2/24;welt.append((ax+.092*math.copysign(abs(math.sin(angle))**.68,math.sin(angle)),-.977,(.275 if math.cos(angle)>0 else .110)*math.copysign(abs(math.cos(angle))**.68,math.cos(angle))))
 tube('boot-sole-welt-'+side,welt,.004,'webbing','foot.'+side)

# Head retains actual face/jaw form under a close fitting balaclava.
head=J['head'];top=J['head-2'].y+.034
# Helmet shell has an open anatomical rim and low-profile crown.
rings=[]
for theta in [0.02,.20,.40,.60,.80,1.,1.18,1.36,1.56]:
 y=1.04+.177*math.cos(theta);rad=math.sin(theta);rings.append((y,.158*rad,.168*rad,.154*rad))
helmet=shell('ballistic-helmet-shell',rings,'helmet','head',40)
for v in helmet.data.vertices:v.co.y-=.043
shell('fitted-balaclava',[(.835,.058,.164,.057),(.887,.102,.198,.079),(.94,.123,.214,.089),(.987,.125,.213,.085),(1.021,.123,.202,.081)],'webbing','head',32)
# Goggle frame/lenses are bent onto the orbital plane rather than a floating billboard.
for sign in [-1,1]:
 verts=[]
 for x,y in [(-.055,-.032),(.055,-.032),(.063,.024),(-.049,.031)]:
  xx=x+sign*.065;zz=.22-.11*abs(xx);verts.append((xx,1.005+y,zz))
 frame=mesh_obj('goggle-frame',verts,[(0,1,2,3)],'rubber','head');mod=frame.modifiers.new('sealed-frame','SOLIDIFY');mod.thickness=.015;bpy.context.view_layer.objects.active=frame;bpy.ops.object.modifier_apply(modifier=mod.name)
 center=sum((Vector(v) for v in verts),Vector())/4
 lens=[tuple(center+(Vector(v)-center)*.78+Vector((0,0,.009))) for v in verts];mesh_obj('curved-ballistic-lens',lens,[(0,1,2,3)],'lens','head')
shell('goggle-elastic-band',[(.979,.134,.202,.100),(1.011,.134,.198,.1)],'webbing','head',40)
box('goggle-nose-bridge',(0,1.005,.229),(.031,.021,.017),'rubber','head',.007)
for sign in [-1,1]:
 box('helmet-rail',(sign*.155,1.073,.022),(.015,.035,.131),'rubber','head',.009)
 box('hearing-protection',(sign*.143,.970,.021),(.037,.113,.075),'rubber','head',.02)
# Rubber rim, pad retention and segmented rails break the featureless dome.
helmetRim=[]
for i in range(41):
 a=i*2*math.pi/40;helmetRim.append((.158*math.copysign(abs(math.sin(a))**.68,math.sin(a)),1.044,.043+(.168 if math.cos(a)>0 else .154)*math.copysign(abs(math.cos(a))**.68,math.cos(a))))
tube('helmet-protective-rim',helmetRim,.0062,'rubber','head')
box('helmet-nvg-bracket',(0,1.088,.205),(.052,.062,.014),'rubber','head',.004)
box('helmet-front-velcro',(0,1.16,.168),(.10,.046,.01),'webbing','head',.006)
for sign in [-1,1]:
 for n in range(4):box('helmet-rail-fastener',(sign*.165,1.071,-.019+n*.028),(.012,.016,.01),'helmet','head',.002)
 tube('headset-support-wire',[(sign*.138,1.052,-.012),(sign*.157,1.011,.014),(sign*.161,.965,.03)],.0032,'rubber','head')
 tube('helmet-chin-retention',[(sign*.141,1.038,.075),(sign*.134,.958,.134),(sign*.09,.881,.157),(sign*.028,.843,.174)],.008,'rubber','head')
# Bound mask seam follows the jaw and centerline, retaining anatomical face shape.
tube('balaclava-center-seam',[(0,1.017,.221),(0,.967,.230),(0,.914,.211),(0,.86,.188)],.0028,'rubber','head')
# Weight calculation in semantic chains with smoothly overlapping joint domains.
def smooth(a,bb,x):
 t=max(0,min(1,(x-a)/(bb-a)));return t*t*(3-2*t)
def weights(q):
 side='L' if q.x>=0 else 'R';sg=1 if q.x>=0 else -1
 sh=Vector(BONES[BY['upper_arm.'+side]]['head']);el=Vector(BONES[BY['forearm.'+side]]['head']);wr=Vector(BONES[BY['hand.'+side]]['head'])
 def chain(a,bb,nameA,nameB,width):
  axis=bb-a;t=(q-a).dot(axis)/axis.length_squared;w=smooth(1-width,1+width,t);return {nameA:1-w,nameB:w}
 # Arms are well separated in rest pose; shoulder blend runs into the chest surface.
 threshold=.19+max(0,.74-q.y)*.65 if q.y>.58 else .30
 armBlend=smooth(threshold-.035,threshold+.035,abs(q.x))
 if q.y>.10 and armBlend>0 and (q-sh).length<.8 and q.y<.88:
  # Project on each bone and interpolate around elbow/wrist.
  upper=(q-sh).dot((el-sh).normalized());fore=(q-el).dot((wr-el).normalized())
  if upper<(el-sh).length-.06:
   w=smooth(-.035,.06,upper);out={'chest':1-w,'upper_arm.'+side:w}
  elif fore<(wr-el).length-.055:
   w=smooth(-.065,.065,fore);out={'upper_arm.'+side:1-w,'forearm.'+side:w}
  else:
   w=smooth((wr-el).length-.055,(wr-el).length+.045,fore);out={'forearm.'+side:1-w,'hand.'+side:w}
  if q.y>.69:
   w=smooth(.69,.82,q.y);torso={'chest':1-w,'neck':w}
  elif q.y>.43:
   w=smooth(.43,.59,q.y);torso={'spine':1-w,'chest':w}
  else:
   w=smooth(.17,.36,q.y);torso={'pelvis':1-w,'spine':w}
  out={k:out.get(k,0)*armBlend+torso.get(k,0)*(1-armBlend) for k in set(out)|set(torso)}
 elif q.y<.17:
  knee=Vector(BONES[BY['shin.'+side]]['head']);ank=Vector(BONES[BY['foot.'+side]]['head'])
  if q.y>knee.y+.10:
   w=1-smooth(-.045,.17,q.y);out={'pelvis':1-w,'thigh.'+side:w}
  elif q.y>ank.y+.06:
   w=1-smooth(knee.y-.10,knee.y+.10,q.y);out={'thigh.'+side:1-w,'shin.'+side:w}
  else:
   w=1-smooth(ank.y-.045,ank.y+.06,q.y)
   w=max(w,smooth(.04,.13,q.z)*(1-smooth(-.85,-.79,q.y)))
   out={'shin.'+side:1-w,'foot.'+side:w}
 elif q.y>.90:out={'head':1}
 elif q.y>.78:
  w=smooth(.78,.93,q.y);out={'neck':1-w,'head':w}
 elif q.y>.69:
  w=smooth(.69,.82,q.y);out={'chest':1-w,'neck':w}
 elif q.y>.43:
  w=smooth(.43,.59,q.y);out={'spine':1-w,'chest':w}
 else:
  w=smooth(.17,.36,q.y);out={'pelvis':1-w,'spine':w}
 return {BY[k]:v for k,v in out.items() if v>1e-7}
# Real Blender armature and vertex groups; all geometry stays in global rest space.
armData=bpy.data.armatures.new('operator-armature');arm=bpy.data.objects.new('operator-armature',armData);bpy.context.collection.objects.link(arm);bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for info in BONES:
 eb=armData.edit_bones.new(info['name']);eb.head=b(info['head']);eb.tail=b(info['tail']);
 if info['parent']>=0:eb.parent=armData.edit_bones[BONES[info['parent']]['name']]
bpy.ops.object.mode_set(mode='OBJECT');arm.select_set(False)
for obj in OBJECTS:
 bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);obj.select_set(False)
 for info in BONES:obj.vertex_groups.new(name=info['name'])
 for v in obj.data.vertices:
  ww={BY[obj['rigid']]:1} if obj['rigid'] else weights(r(v.co))
  if obj.name.startswith('combat-boot-'):
   side=obj.name[-1];q=r(v.co);w=smooth(-.865,-.76,q.y);ww={BY['shin.'+side]:w,BY['foot.'+side]:1-w}
  for bi,weight in ww.items():obj.vertex_groups[bi].add([v.index],weight,'REPLACE')
 mod=obj.modifiers.new('continuous-skeletal-skin','ARMATURE');mod.object=arm;obj.parent=arm
# Consolidate by material for the compact runtime JSON, preserving UV splits only.
parts={};bpy.context.view_layer.update();total=0;allpos=[]
for obj in OBJECTS:
 mesh=obj.data;mesh.calc_loop_triangles();uv=mesh.uv_layers.active
 for tri in mesh.loop_triangles:
  corners=[Vector(tuple(round(x,6) for x in mesh.vertices[mesh.loops[li].vertex_index].co)) for li in tri.loops]
  face=(corners[1]-corners[0]).cross(corners[2]-corners[0])
  if face.length_squared<1e-20:continue
  face.normalize()
  key=mesh.materials[tri.material_index].name
  if key not in parts:parts[key]={'name':key,'material':key,'positions':[],'normals':[],'uvs':[],'indices':[],'boneIndices':[],'boneWeights':[],'_map':{}}
  out=parts[key]
  for li in tri.loops:
   loop=mesh.loops[li];v=mesh.vertices[loop.vertex_index];uvv=uv.data[li].uv if uv else (0,0);n=mesh.corner_normals[li].vector if hasattr(mesh,'corner_normals') else loop.normal
   if n.dot(face)<0:n=face
   tok=(obj.name,v.index,round(uvv[0],6),round(uvv[1],6),*(round(x,5) for x in n))
   if tok not in out['_map']:
    out['_map'][tok]=len(out['positions'])//3;q=r(v.co);nn=r(n);out['positions'].extend(round(x,6) for x in q);out['normals'].extend(round(x,6) for x in nn);out['uvs'].extend(round(x,6) for x in uvv)
    ww=sorted([(g.group,g.weight) for g in v.groups],key=lambda a:-a[1])[:4];tt=sum(w for _,w in ww);ww+=[(0,0)]*(4-len(ww));out['boneIndices'].extend(i for i,_ in ww);out['boneWeights'].extend(round(w/tt,7) for _,w in ww);allpos.append(q)
   out['indices'].append(out['_map'][tok])
  total+=1
for p in parts.values():del p['_map']
bounds={'min':[round(min(v[i] for v in allpos),6) for i in range(3)],'max':[round(max(v[i] for v in allpos),6) for i in range(3)]}
assert total<55000,(total,'triangle budget');assert len(parts)<=12
asset={'schema':'breachline.skinned-operator.v1','bones':BONES,'materials':MAT,'parts':list(parts.values()),'bounds':bounds}
(DST/'operator.json').write_text(json.dumps(asset,separators=(',',':')))
# Join source meshes into one skin with eight material primitives for GLB draw-call parity.
bpy.ops.object.select_all(action='DESELECT')
for o in OBJECTS:o.select_set(True)
bpy.context.view_layer.objects.active=OBJECTS[0];bpy.ops.object.join();combined=bpy.context.object;combined.name='continuous-tactical-operator-skin';OBJECTS=[combined]
# Export only selected skin and meshes, excluding review cameras/lights/floor.
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
for o in OBJECTS:o.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.export_scene.gltf(filepath=str(DST/'operator.glb'),export_format='GLB',use_selection=True,export_skins=True,export_animations=False,export_yup=True)
# Rest source includes actual rig and modifiers; studio objects remain separately named.
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'operator.blend'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=28;scene.render.resolution_x=960;scene.render.resolution_y=1280;scene.render.resolution_percentage=100;scene.world.color=(.18,.18,.18)
scene.view_settings.view_transform='AgX'
for loc,power,size in [((3,-4,4),700,4),((-3,-1,2),400,3),((1,3,3),650,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name='review-light';o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-1.025));bpy.context.object.name='review-ground';floor=bpy.data.materials.new('review-floor');floor.diffuse_color=(.12,.145,.17,1);bpy.context.object.data.materials.append(floor)
bpy.ops.object.camera_add(location=(3,-6,2.2));cam=bpy.context.object;cam.name='review-camera';cam.rotation_euler=(Vector((0,0,.12))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.75;scene.camera=cam
scene.render.filepath=str(WORK/'standing-three-quarter.png');bpy.ops.render.render(write_still=True)
# Stress pose with pelvis lowered and flexion at knees, elbows, and neck.
def posed(name,head,tail):
 info=BONES[BY[name]];restA=b(info['head']);restB=b(info['tail']);h=b(head);t=b(tail);delta=(restB-restA).rotation_difference(t-h);pb=arm.pose.bones[name];pb.matrix=Matrix.Translation(h)@delta.to_matrix().to_4x4()@Matrix.Translation(-restA)@arm.data.bones[name].matrix_local;bpy.context.view_layer.update()
offset=Vector((0,-.22,0))
for info in BONES:
 if info['name']=='root':continue
 h=Vector(info['head'])+offset;t=Vector(info['tail'])+offset
 if info['name']=='head':t+=Vector((0,-.035,.065))
 posed(info['name'],h,t)
for side,sg in [('L',1),('R',-1)]:
 hip=Vector(BONES[BY['thigh.'+side]]['head'])+offset;knee=Vector((sg*.22,-.62,.205));ank=Vector(BONES[BY['foot.'+side]]['head']);foot=Vector(BONES[BY['foot.'+side]]['tail'])
 posed('thigh.'+side,hip,knee);posed('shin.'+side,knee,ank);posed('foot.'+side,ank,foot)
 sh=Vector(BONES[BY['upper_arm.'+side]]['head'])+offset;el=Vector((sg*.27,.21,.20));wr=Vector((sg*.095,.40,.40 if side=='L' else .26));handEnd=wr+Vector((0,-.04,.07))
 posed('upper_arm.'+side,sh,el);posed('forearm.'+side,el,wr);posed('hand.'+side,wr,handEnd)
scene.render.filepath=str(WORK/'crouched-skin-stress.png');bpy.ops.render.render(write_still=True)
# Restore source rest pose; save review pose separately for repeatable visual QA.
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'pose-review.blend'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
shutil.copyfile(ROOT/'assets/blender/operator/reference/LICENSE.ASSETS.md',DST/'LICENSE.CC0.md')
manifest={'schema':'breachline.asset-provenance.v1','name':'continuous-skinned-tactical-operator','source':{'author':'MakeHuman Community','license':'CC0-1.0','url':'https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj','localPath':str(SRC.relative_to(ROOT)),'sha256':sha(SRC)},'derivative':'Project-authored garment shaping, equipment, neutral fabric textures, analytic smooth skin weights and armature.','generator':'scripts/blender/build_skinned_operator.py','triangles':total,'drawCalls':len(parts),'boneCount':len(BONES),'bounds':bounds,'files':{str(p.relative_to(DST)):sha(p) for p in sorted(DST.rglob('*')) if p.is_file() and p.name!='manifest.json'},'sourceFiles':{str(p.relative_to(ROOT)):sha(p) for p in [WORK/'operator.blend',WORK/'pose-review.blend',Path(__file__)]}}
(DST/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'bones':BONES,'bounds':bounds,'triangles':total,'drawCalls':len(parts)}))
