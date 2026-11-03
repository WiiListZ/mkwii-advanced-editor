// Probes true multi-bone skinning from Blender through the complete converter.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { decodeTexture, parseBRRES } from "../web/js/formats/brres.js";
import { import3DModel, importBRRESPart, importOBJModel } from "../src/model-operations.ts";

const game = process.env.MKWII_GAME_DIR;
if (!game) { console.log("MKWII_GAME_DIR not set: skipped"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "mkwii-import-weights-"));
try {
  const source = join(dir, "weighted.blend"), script = join(dir, "make.py");
  writeFileSync(script, `import bpy, sys
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
mesh = bpy.context.object
mesh.name = 'WeightedCube'
material = bpy.data.materials.new('Paint')
material.use_nodes = True
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (1, 0, 0, 1)
material.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value = 0.4
mesh.data.materials.append(material)
mesh.shape_key_add(name='Basis')
shape = mesh.shape_key_add(name='Wide')
for point in shape.data:
    point.co.x *= 1.25
shape.value = 0
shape.keyframe_insert(data_path='value', frame=1)
shape.value = 1
shape.keyframe_insert(data_path='value', frame=31)
shape.value = 0
shape.keyframe_insert(data_path='value', frame=61)
arm = bpy.data.armatures.new('Armature')
rig = bpy.data.objects.new('Rig', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
a = arm.edit_bones.new('A'); a.head = (0, 0, 0); a.tail = (0, 0, 1)
b = arm.edit_bones.new('B'); b.head = (0, 0, 0); b.tail = (0, 0, 1)
bpy.ops.object.mode_set(mode='OBJECT')
for bone in ('A', 'B'):
    group = mesh.vertex_groups.new(name=bone)
    group.add(list(range(len(mesh.data.vertices))), 0.5, 'REPLACE')
modifier = mesh.modifiers.new('Armature', 'ARMATURE')
modifier.object = rig
rig.pose.bones['A'].location.x = 0
rig.pose.bones['A'].keyframe_insert(data_path='location', frame=1)
rig.pose.bones['A'].location.x = 1
rig.pose.bones['A'].keyframe_insert(data_path='location', frame=61)
rig.pose.bones['B'].location.y = 0
rig.pose.bones['B'].keyframe_insert(data_path='location', frame=1)
rig.pose.bones['B'].location.y = 1
rig.pose.bones['B'].keyframe_insert(data_path='location', frame=61)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
`);
  const created = Bun.spawnSync(["C:/Program Files/Blender Foundation/Blender 4.4/blender.exe", "--background", "--factory-startup", "--python", script, "--", source]);
  if (created.exitCode) throw new Error("Blender fixture failed: " + new TextDecoder().decode(created.stderr).slice(-800));
  const tree = parseU8(yaz0Decompress(readFileSync(join(game, "Race/Course/castle_course.szs"))));
  const original = findFile(tree, "course_model.brres")!.data;
  const converted = await import3DModel(original, source, [0, 100, 0]);
  const parsed = parseBRRES(converted), model = parsed.models.find((m: any) => m.name === "course") || parsed.models[0];
  if (!model.weights.size) throw new Error("No blended vertex weights survived import");
  if (!Buffer.from(converted).includes(Buffer.from("SHP0"))) throw new Error("SHP0 was lost during combined skin/shape import");
  const oldTextures = parseBRRES(original).textures;
  const addedTextures = [...parsed.textures].filter(([name]) => !oldTextures.has(name)).map(([, texture]) => texture);
  if (!addedTextures.some((texture: any) => [...decodeTexture(texture).slice(0, 4)].join(',') === '255,0,0,102')) throw new Error('Weighted import lost its red colour or soft transparency: ' + JSON.stringify(addedTextures.map((texture: any) => ({ name: texture.name, format: texture.format, rgba: [...decodeTexture(texture).slice(0, 4)] }))));
  console.log(`ok ${model.weights.size} weighted matrices and SHP0 imported together`);
  const twiceBytes = await import3DModel(converted, source, [1000, 100, 0]);
  const twice = parseBRRES(twiceBytes);
  const next = twice.models.find((m: any) => m.name === model.name);
  if (next.weights.size <= model.weights.size || twice.chr.size <= parsed.chr.size || twice.textures.size <= parsed.textures.size)
    throw new Error('Repeated animated import lost weights, an animation or its own texture');
  if (new Set(next.materials.map((m: any) => m.name)).size !== next.materials.length) throw new Error('Repeated animated import duplicated material names');
  console.log('ok repeated animated imports keep independent materials, textures and animations');
  const staticOBJ = join(dir, "static.obj");
  writeFileSync(staticOBJ, "v 0 0 0\nv 1000 0 0\nv 0 0 1000\nf 1 2 3\n");
  const staticBytes = await importOBJModel(twiceBytes, staticOBJ, [2000, 100, 0]);
  const withStatic = parseBRRES(staticBytes), staticModel = withStatic.models.find((m: any) => m.name === model.name);
  if (staticModel.objects.length !== next.objects.length + 1 || staticModel.weights.size !== next.weights.size || withStatic.chr.size !== twice.chr.size)
    throw new Error('Adding a static model changed the existing skeletal animations or weights');
  const again = parseBRRES(await importOBJModel(staticBytes, staticOBJ, [3000, 100, 0]));
  if (again.models.find((m: any) => m.name === model.name).objects.length !== staticModel.objects.length + 1)
    throw new Error('Repeated static import into a weighted model lost geometry');
  console.log('ok static OBJ imports into an animated course retain weights and animations, including repeated imports');
  for (const object of next.objects) {
    const kept = staticModel.objects.find((o: any) => o.name === object.name);
    if (!kept || kept.positions.length !== object.positions.length || kept.positions.some((value: number, i: number) => Math.abs(value - object.positions[i]) > 1e-5))
      throw new Error(`Static import changed existing vertices of ${object.name}`);
  }
  const originalModel = parseBRRES(original).models.find((m: any) => m.name === model.name);
  const withPart = parseBRRES((await importBRRESPart(staticBytes, original, { model: originalModel.name, part: originalModel.objects[0].name, tag: 'Extra' })).data);
  if (withPart.models.find((m: any) => m.name === model.name).objects.length !== staticModel.objects.length + 1 || withPart.chr.size !== withStatic.chr.size)
    throw new Error('Adding a BRRES part to an animated model lost geometry or animation');
  const weightedPart = next.objects.find((o: any) => !originalModel.objects.some((old: any) => old.name === o.name));
  const fromAnimated = await importBRRESPart(original, twiceBytes, { model: model.name, part: weightedPart.name, tag: 'Baked' });
  if (!parseBRRES(fromAnimated.data).models.find((m: any) => m.name === model.name).objects.some((o: any) => o.name === fromAnimated.name))
    throw new Error('Could not copy a mesh from a source with skeletal and shape animation');
  console.log('ok BRRES parts import into animated targets and from sources containing SHP0');
} finally {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup path");
  rmSync(dir, { recursive: true, force: true });
}
