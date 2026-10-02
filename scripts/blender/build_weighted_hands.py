#!/usr/bin/env python3
"""Extract CC0 MakeHuman hands, skin with bone heat weights and preserve authored grips.
Run with Blender 4.5 --background --factory-startup --python this_file.py.
"""
import bpy, math, json, hashlib, shutil
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models/weighted-hands'; SRC=ROOT/'assets/blender/weighted-hands'
REF=ROOT/'assets/blender/hands/reference'
verts=[Vector()]; groups={}; current=[]
for line in (REF/'base.obj').read_text().splitlines():
 if line.startswith('v '): verts.append(Vector(tuple(map(float,line.split()[1:4]))))
 elif line.startswith('g '): current=line.split()[1:]
 elif line.startswith('f '):
  face=[int(v.split('/')[0]) for v in line.split()[1:]]
  for g in current: groups.setdefault(g,[]).append(face)
joints={k:sum((verts[v] for v in set(sum(fs,[]))),Vector())/len(set(sum(fs,[]))) for k,fs in groups.items() if k.startswith('joint-')}
def frame(side):
 wrist=joints[f'joint-{side}-hand']; front=(sum((joints[f'joint-{side}-finger-{n}-1'] for n in range(2,6)),Vector())/4-wrist).normalized()
 across=(joints[f'joint-{side}-finger-2-1']-joints[f'joint-{side}-finger-5-1']).normalized(); across=(across-front*across.dot(front)).normalized(); up=across.cross(front).normalized()
 if up.z<0: up=-up
 return wrist,across,up,front
def local(p,side):
 w,x,y,z=frame(side); q=p-w; return Vector((q.dot(x)*.1,q.dot(y)*.1,q.dot(z)*.1))
def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.84
 tex=m.node_tree.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=370;tex.inputs['Detail'].default_value=2
 bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.13;bump.inputs['Distance'].default_value=.001
 m.node_tree.links.new(tex.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal']);return m
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mats={'glove':mat('woven olive nylon',(.078,.094,.075)),'rubber':mat('dark stitched suede',(.049,.059,.048)),'sleeve':mat('woven combat shirt',(.075,.09,.071)),'gun':mat('opaque gunmetal',(.04,.042,.038))}
def flat(m):return [round(m[r][c],8) for c in range(4) for r in range(4)]
def payload(ob, transform=Matrix.Identity(4), rig=None):
 mesh=ob.data;mesh.calc_loop_triangles(); ps=[transform@v.co for v in mesh.vertices];norm=transform.to_3x3().inverted().transposed()
 data={'name':ob.name,'positions':[round(v,6) for p in ps for v in p],'normals':[round(v,6) for p in mesh.vertices for v in (norm@p.normal).normalized()], 'uvs':[round(v,5) for p in ps for v in (p.z*8+.5,p.y*8+.5)],'indices':[v for t in mesh.loop_triangles for v in (reversed(t.vertices) if transform.determinant()<0 else t.vertices)]}
 if rig:
  ids={b.name:i for i,b in enumerate(rig.data.bones)};weights=[];indices=[]
  for vert in mesh.vertices:
   pairs=sorted([(ids[ob.vertex_groups[g.group].name],g.weight) for g in vert.groups if ob.vertex_groups[g.group].name in ids],key=lambda x:-x[1])[:4]
   total=sum(w for _,w in pairs)
   if total<1e-9:pairs=[(0,1)];total=1
   indices.extend([i for i,_ in pairs]+[0]*(4-len(pairs)));weights.extend([round(w/total,7) for _,w in pairs]+[0]*(4-len(pairs)))
  data['matricesIndices']=indices;data['matricesWeights']=weights
 return data
def bone_pose(rig,hand,closed):
 for pb in rig.pose.bones:
  pb.rotation_mode='QUATERNION';pb.rotation_quaternion=Quaternion()
  if pb.name=='palm':continue
  _,f,s=pb.name.split('-');f=int(f);s=int(s)
  angles=([.34,.64,.40] if f==1 else ([.33,.57,.42] if f==2 and hand=='trigger' else [1.08,1.03,.53]))
  angle=angles[s-1]*(1 if closed else .13)
  axis=Vector((1,0,0)) if f!=1 else Vector((.52,-.72,.46)).normalized()
  pb.rotation_quaternion=Quaternion(pb.bone.matrix_local.to_3x3().inverted()@axis,angle)
 bpy.context.view_layer.update()
def build_hand(style,hand):
 side='r' if hand=='trigger' else 'l'; w,x,y,z=frame(side)
 # Shared anatomical topology is preserved. No nearest-finger classification.
 raw={};faces=[]
 for face in groups['body']:
  pts=[local(verts[i],side) for i in face];center=sum(pts,Vector())/len(pts)
  if -.05<center.x<.105 and -.034<center.y<.038 and -.015<center.z<.19:
   faces.append(face)
   for i,p in zip(face,pts):raw[i]=p
 remap={v:i for i,v in enumerate(raw)};faces=[[remap[v] for v in f] for f in faces if all(v in raw for v in f)]
 if x.cross(y).dot(z)<0:faces=[list(reversed(f)) for f in faces]
 mesh=bpy.data.meshes.new(f'{style}-{hand}-anatomical-topology');mesh.from_pydata(list(raw.values()),[],faces);mesh.update()
 ob=bpy.data.objects.new(f'{style}-{hand}-glove',mesh);bpy.context.collection.objects.link(ob);ob.data.materials.append(mats['glove'])
 for p in mesh.polygons:p.use_smooth=True
 bpy.context.view_layer.objects.active=ob;ob.select_set(True)
 sub=ob.modifiers.new('joint deformation support loops','SUBSURF');sub.levels=1;bpy.ops.object.modifier_apply(modifier=sub.name)
 ob.select_set(False)
 arm=bpy.data.armatures.new(f'{style}-{hand}-skeleton');rig=bpy.data.objects.new(f'{style}-{hand}-rig',arm);bpy.context.collection.objects.link(rig)
 bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 palm=arm.edit_bones.new('palm');palm.head=(0,0,-.018);palm.tail=(0,0,.052)
 for f in range(1,6):
  parent=palm
  for s in range(1,4):
   b=arm.edit_bones.new(f'finger-{f}-{s}');b.head=local(joints[f'joint-{side}-finger-{f}-{s}'],side);b.tail=local(joints[f'joint-{side}-finger-{f}-{s+1}'],side);b.parent=parent;b.use_connect=s>1;parent=b
 bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(True)
 bpy.ops.object.parent_set(type='ARMATURE_AUTO')
 # Enforce normalized 4-influence weights in both saved source and runtime.
 for v in ob.data.vertices:
  ws=sorted([(g.group,g.weight) for g in v.groups],key=lambda a:-a[1]);keep=ws[:4];total=sum(a[1] for a in keep)
  for gid,_ in ws:ob.vertex_groups[gid].remove([v.index])
  if total<1e-8:ob.vertex_groups['palm'].add([v.index],1,'REPLACE')
  else:
   for gid,weight in keep:ob.vertex_groups[gid].add([v.index],weight/total,'REPLACE')
 if hand=='trigger': orientation=Matrix(((0,1,0),(1,0,0),(0,0,1)))
 elif style=='pistol': orientation=Matrix(((0,-1,0),(1,0,0),(0,0,1)))
 else:orientation=Matrix(((0,-1,0),(0,0,1),(1,0,0)))
 # Origin = actual central palm surface contact. Wrist is behind this point.
 contact=Vector((0,-.011,.047));transform=orientation.to_4x4();transform.translation=-(orientation@contact)
 data=payload(ob,transform,rig);bones=[]
 poses={}
 for label,closed in [('open',False),('grip',True)]:
  bone_pose(rig,hand,closed);poses[label]={}
  for pb in rig.pose.bones:
   m=pb.parent.matrix.inverted()@pb.matrix if pb.parent else pb.matrix
   poses[label][pb.name]=flat(transform@m@transform.inverted())
 for b in rig.data.bones:
  bind=b.parent.matrix_local.inverted()@b.matrix_local if b.parent else b.matrix_local
  bones.append({'name':b.name,'parent':list(rig.data.bones).index(b.parent) if b.parent else -1,'bind':flat(transform@bind@transform.inverted()),'open':poses['open'][b.name],'grip':poses['grip'][b.name]})
 # Protection panels reuse the exact anatomical vertices and skin weights.
 # This keeps the panel on the knuckle throughout the bend (no detached pads).
 details=[]
 for f in range(2,6):
  bone=rig.data.bones[f'finger-{f}-1']; center=bone.head_local.lerp(bone.tail_local,.23)
  selected=[]
  for poly in ob.data.polygons:
   p=poly.center
   if abs(p.x-center.x)<.0065 and abs(p.z-center.z)<.012 and poly.normal.y>.55:selected.append(poly)
  used=sorted({v for poly in selected for v in poly.vertices});remap={v:i for i,v in enumerate(used)}
  me=bpy.data.meshes.new(f'knuckle-panel-{f}');me.from_pydata([ob.data.vertices[i].co+ob.data.vertices[i].normal*.00065 for i in used],[],[[remap[i] for i in p.vertices] for p in selected]);me.update()
  pad=bpy.data.objects.new(f'{style}-{hand}-knuckle-protection-{f}',me);bpy.context.collection.objects.link(pad);me.materials.append(mats['rubber'])
  for p in me.polygons:p.use_smooth=True
  for g in ob.vertex_groups:pad.vertex_groups.new(name=g.name)
  for old,new in remap.items():
   for group in ob.data.vertices[old].groups:pad.vertex_groups[group.group].add([new],group.weight,'REPLACE')
  mod=pad.modifiers.new('panel skin binding','ARMATURE');mod.object=rig;pad.parent=rig
  details.append(payload(pad,transform,rig));pad.matrix_parent_inverse=Matrix.Identity(4);pad.matrix_basis=Matrix.Identity(4)
 data['details']=details
 data['bones']=bones;data['wrist']=[round(v,6) for v in transform@Vector((0,0,-.006))];data['contact']=[0,0,0];data['wristDirection']=[round(v,6) for v in orientation@Vector((0,0,1))];data['wristAcross']=[round(v,6) for v in orientation@Vector((1,0,0))]
 data['materialRole']='glove';data['role']='glove'
 # Keep a real armature modifier and vertex groups in the blend. Export basis applied consistently to rig and mesh.
 rig.matrix_world=transform;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
 for o in bpy.context.selected_objects:o.select_set(False)
 return data,rig,ob,transform

def sleeve_payload():
 # Elliptical tailored sleeve with several changing folds, open at both ends.
 ps=[];faces=[];rings=13;seg=32
 for j in range(rings):
  t=j/(rings-1);rx=.048*(1-t)+.030*t;rz=.043*(1-t)+.025*t
  for i in range(seg):
   a=i*math.tau/seg;fold=1+.105*math.sin(t*29+a*3)+.028*math.sin(t*43-a*5)
   ps.append((math.cos(a)*rx*fold+.012*math.sin(math.pi*t),t-.5,math.sin(a)*rz*fold+.008*math.sin(math.pi*t)))
 for j in range(rings-1):
  for i in range(seg):faces.append((j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i))
 mesh=bpy.data.meshes.new('tailored sleeve');mesh.from_pydata(ps,[],faces);mesh.update();ob=bpy.data.objects.new('sleeve',mesh);bpy.context.collection.objects.link(ob)
 for p in mesh.polygons:p.use_smooth=True
 data=payload(ob);bpy.data.objects.remove(ob,do_unlink=True);return data

OUT.mkdir(parents=True,exist_ok=True);SRC.mkdir(parents=True,exist_ok=True);bpy.context.preferences.filepaths.save_version=0
assets={};objects={}
for style in ['pistol','rifle']:
 assets[style]={'hands':{},'defaults': {'gripRight':[.0357,-.1092,-.025571] if style=='pistol' else [.030,-.060,-.045], 'gripLeft':[-.02499,-.10504,.005029] if style=='pistol' else [-.030,.020,.290]},'sleeveEnd': {'trigger':[.19,-.72,-.30],'support':[-.22,-.72,-.26]}}
 for hand in ['trigger','support']:
  data,rig,ob,transform=build_hand(style,hand);assets[style]['hands'][hand]=data;objects[(style,hand)]=(rig,ob,transform)
result={'schemaVersion':2,'license':'CC0-1.0 MakeHuman derivative; project-authored rig and sleeves','variants':assets,'sleeve':sleeve_payload()}
(OUT/'weighted-hands.json').write_text(json.dumps(result,separators=(',',':')))
for (style,hand),(rig,ob,tr) in objects.items():
 rig.hide_render=True;ob.hide_render=True
 for child in rig.children:child.hide_render=True
# Review shots use the exact opaque project weapon mesh, never a proxy.
def gun(style):
 p=ROOT/'public/models'/('tactical-weapons/px9.json' if style=='pistol' else 'm4a1/m4a1.json');data=json.loads(p.read_text());obs=[]
 for part in data['parts']:
  me=bpy.data.meshes.new(part['name']);me.from_pydata([part['positions'][i:i+3] for i in range(0,len(part['positions']),3)],[],[part['indices'][i:i+3] for i in range(0,len(part['indices']),3)]);me.update();o=bpy.data.objects.new(part['name'],me);bpy.context.collection.objects.link(o);o.data.materials.append(mats['gun']);obs.append(o)
  for poly in me.polygons:poly.use_smooth=True
 return obs
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.world.color=(.17,.17,.17)
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-1.8
for loc,energy,size in [((.8,.9,.8),100,1),((-.9,.6,-.1),75,1),((0,-.3,1),50,.8)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO'
for style in ['pistol','rifle']:
 guns=gun(style)
 sleeves=[]

 for hand in ['trigger','support']:
  rig,ob,tr=objects[(style,hand)];rig.hide_render=False;ob.hide_render=False;placement=Matrix.Translation(Vector(assets[style]['defaults']['gripRight' if hand=='trigger' else 'gripLeft']))
  rig.matrix_world=placement@tr;ob.matrix_basis=Matrix.Identity(4)
  for child in rig.children:
   if child!=ob:child.hide_render=False;child.matrix_basis=Matrix.Identity(4)
 for pose in ['grip','magazine']:
  if pose=='magazine':
   rig,ob,tr=objects[(style,'support')];pos=Vector((-.025,-.105,.10)) if style=='rifle' else Vector((-.037,-.17,-.027));rig.matrix_world=Matrix.Translation(pos)@tr;ob.matrix_basis=Matrix.Identity(4)
   for child in rig.children:
    if child!=ob:child.matrix_basis=Matrix.Identity(4)
  cam.location=(.58,.24,-.52) if style=='pistol' else (-.66,.24,-.46);target=Vector((0,-.055,.075 if style=='pistol' else .17));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=.47 if style=='pistol' else .76
  for hand in ['trigger','support']:
   rig,ob,tr=objects[(style,hand)];wrist=rig.matrix_world@Vector((0,0,-.006));end=Vector(assets[style]['sleeveEnd'][hand]);delta=wrist-end
   p=result['sleeve'];direction=(rig.matrix_world.to_3x3()@Vector((0,0,1))).normalized();across=(rig.matrix_world.to_3x3()@Vector((1,0,0))).normalized();points=[]
   for i in range(0,len(p['positions']),3):
    x,t,z=p['positions'][i:i+3];t+=.5;t2=t*t;t3=t2*t
    point=end*(2*t3-3*t2+1)+delta*(.7*(t3-2*t2+t))+wrist*(-2*t3+3*t2)+direction*(.14*(t3-t2))
    tangent=(delta*(.7*(3*t2-4*t+1)-6*t2+6*t)+direction*(.14*(3*t2-2*t))).normalized();xaxis=(across-tangent*across.dot(tangent)).normalized();zaxis=xaxis.cross(tangent).normalized()
    points.append(point+xaxis*x+zaxis*z)
   me=bpy.data.meshes.new('review tailored sleeve');me.from_pydata(points,[],[p['indices'][i:i+3] for i in range(0,len(p['indices']),3)]);me.update();[setattr(p,'use_smooth',True) for p in me.polygons]
   so=bpy.data.objects.new('review sleeve',me);bpy.context.collection.objects.link(so);so.data.materials.append(mats['sleeve']);sleeves.append(so)
   bpy.ops.mesh.primitive_torus_add(major_radius=.0265,minor_radius=.004,major_segments=28,minor_segments=10,location=wrist);cuff=bpy.context.object;cuff.rotation_mode='QUATERNION';cuff.rotation_quaternion=Vector((0,0,1)).rotation_difference(direction);cuff.data.materials.append(mats['rubber']);[setattr(p,'use_smooth',True) for p in cuff.data.polygons];sleeves.append(cuff)
  scene.render.filepath=str(SRC/f'{style}-{pose}.png');bpy.ops.render.render(write_still=True)
  for so in sleeves:bpy.data.objects.remove(so,do_unlink=True)
  sleeves=[]
 for o in guns:bpy.data.objects.remove(o,do_unlink=True)
 for hand in ['trigger','support']:
  rig,ob,tr=objects[(style,hand)];rig.hide_render=True;ob.hide_render=True
  for child in rig.children:child.hide_render=True
  rig.matrix_world=tr;ob.matrix_basis=Matrix.Identity(4)
# Keep all source rigs inspectable; spread for opening Blender.
for (style,hand),(rig,ob,tr) in objects.items():
 rig.hide_render=False;ob.hide_render=False;rig.show_in_front=True
 for child in rig.children:child.hide_render=False
 pos=Vector((0 if style=='pistol' else .3,0 if hand=='trigger' else .3,0));rig.matrix_world=Matrix.Translation(pos)@tr;ob.matrix_basis=Matrix.Identity(4)
bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'weighted-tactical-hands.blend'))
shutil.copy2(REF/'LICENSE.ASSETS.md',OUT/'LICENSE.ASSETS.md')
manifest={'schemaVersion':1,'source':str(REF.relative_to(ROOT)),'sourceSha256':hashlib.sha256((REF/'base.obj').read_bytes()).hexdigest(),'license':'CC0-1.0','method':'MakeHuman anatomical mesh, Blender bone heat skinning, normalized four weights, 16 bones per hand; authored grip and open poses','files':{}}
for p in OUT.iterdir():
 if p.is_file() and p.name!='manifest.json':manifest['files'][p.name]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('WEIGHTED HANDS COMPLETE',OUT)
