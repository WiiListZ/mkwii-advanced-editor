// Probes true multi-bone skinning from Blender through the complete converter.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { import3DModel } from "../src/model-operations.ts";

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
  console.log(`ok ${model.weights.size} weighted matrices and SHP0 imported together`);
} finally {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup path");
  rmSync(dir, { recursive: true, force: true });
}
