// End-to-end animated glTF import into a real Mario Kart Wii course BRRES.
// Usage: bun run tests/animation.smoke.ts <track.szs>
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { import3DModel } from "../src/model-operations.ts";
import { wszstPath } from "../src/chr0-import.ts";
import { parseBRRES, evalTrack } from "../web/js/formats/brres.js";
import { parseU8, buildU8, findFile } from "../web/js/formats/u8.js";
import { isYaz0, yaz0Decompress, yaz0Compress } from "../web/js/formats/yaz0.js";
import { BrresModelBuilder, bindCHR, applyCHRFrame } from "../web/js/editor/brresmodel.js";

const source = process.argv[2];
if (!source) throw new Error("Pass a track SZS path");
const blender = process.env.MKWII_BLENDER || "C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe";
const dir = await mkdtemp(join(tmpdir(), "mkwii-animation-smoke-"));
try {
  const script = join(dir, "sample.py"), input = join(dir, "animated.glb");
  await writeFile(script, `import bpy, math, os, sys
from mathutils import Euler
path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.object.armature_add()
rig = bpy.context.object
rig.name = 'AnimRig'
rig.data.bones[0].name = 'AnimBone'
bpy.ops.mesh.primitive_cube_add(size=2)
cube = bpy.context.object
cube.name = 'AnimatedCube'
group = cube.vertex_groups.new(name='AnimBone')
group.add(list(range(len(cube.data.vertices))), 1.0, 'REPLACE')
modifier = cube.modifiers.new('Armature', 'ARMATURE')
modifier.object = rig
bone = rig.pose.bones['AnimBone']
bone.location = (0, 0, 0)
bone.keyframe_insert(data_path='location', frame=1)
bone.location = (4, 0, 0)
bone.keyframe_insert(data_path='location', frame=31)
bone.rotation_mode = 'QUATERNION'
bone.rotation_quaternion = Euler((0, 0, 0)).to_quaternion()
bone.keyframe_insert(data_path='rotation_quaternion', frame=1)
bone.rotation_quaternion = Euler((0, 0, math.pi / 4)).to_quaternion()
bone.keyframe_insert(data_path='rotation_quaternion', frame=31)
bone.scale = (1, 1, 1)
bone.keyframe_insert(data_path='scale', frame=1)
bone.scale = (1.25, 1.25, 1.25)
bone.keyframe_insert(data_path='scale', frame=31)
bpy.context.scene.render.fps = 60
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
cube.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True)
bpy.ops.export_scene.gltf(filepath=path[:-4] + '.gltf', export_format='GLTF_SEPARATE', use_selection=True, export_animations=True)
bpy.ops.export_scene.fbx(filepath=path[:-4] + '.fbx', use_selection=True, bake_anim=True)
bpy.ops.wm.collada_export(filepath=path[:-4] + '.dae', selected=True, include_animations=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2)
moving = bpy.context.object
moving.name = 'MovingProp'
moving.location = (0, 0, 0)
moving.keyframe_insert(data_path='location', frame=1)
moving.location = (3, 0, 0)
moving.keyframe_insert(data_path='location', frame=31)
bpy.context.scene.frame_set(1)
bpy.ops.export_scene.gltf(filepath=path[:-4] + '-object.glb', export_format='GLB', use_selection=True, export_animations=True)
`);
  const child = Bun.spawn([blender, "--background", "--factory-startup", "--python", script, "--", input], { cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Could not create animated sample: ${out}\n${err}`);
  const szs = new Uint8Array(await readFile(source));
  const tree = parseU8(isYaz0(szs) ? yaz0Decompress(szs) : szs);
  const course = findFile(tree, "course_model.brres");
  if (!course) throw new Error("Track has no course_model.brres");
  const originalBRRES = course.data;
  const before = parseBRRES(originalBRRES);
  const result = await import3DModel(originalBRRES, input, [1000, 200, 500]);
  const after = parseBRRES(result);
  const original = before.models.find((m: any) => m.name === "course") || before.models[0];
  const updated = after.models.find((m: any) => m.name === original.name);
  if (!updated || updated.objects.length <= original.objects.length) throw new Error("Animated mesh was not imported");
  const importedBone = updated.bones.find((bone: any) => bone.name.endsWith("_AnimBone"));
  if (!importedBone || Math.abs(importedBone.trans[0] - 1000) > 0.01) throw new Error("Animated model was not placed at the chosen point");
  if (!updated.objects.slice(original.objects.length).some((object: any) => object.mtx.some((id: number) => updated.boneMatrix.get(id) === importedBone.index)))
    throw new Error("Imported mesh is not attached to its animated bone");
  const chr = [...after.chr.values()].find((entry: any) => entry.bones.has(importedBone.name));
  if (!chr) throw new Error("Imported CHR0 is missing the sample bone");
  const track = chr.bones.get(importedBone.name).trans[0];
  const first = evalTrack(track, 0), last = evalTrack(track, chr.frames);
  if (Math.abs(last - first) < 0.1) throw new Error(`Imported animation does not move: ${first} → ${last}`);
  const animatedChannels = chr.bones.get(importedBone.name);
  if (!animatedChannels.rot.some((t: any) => Math.abs(evalTrack(t, chr.frames) - evalTrack(t, 0)) > 1)
    || !animatedChannels.scale.some((t: any) => Math.abs(evalTrack(t, chr.frames) - evalTrack(t, 0)) > 0.1))
    throw new Error("Rotation or scale animation was lost");
  const preview = new BrresModelBuilder(after).build(updated, { skinned: true, lit: false });
  const binding = bindCHR(chr, preview);
  if (!binding) throw new Error("Editor could not bind the saved CHR0 to the imported bone");
  applyCHRFrame(binding, 0);
  const previewBone = binding.targets.find((target: any) => target.bone.name === importedBone.name)?.bone;
  const previewStart = previewBone?.position.x;
  applyCHRFrame(binding, chr.frames);
  if (!previewBone || Math.abs(previewBone.position.x - previewStart) < 0.1) throw new Error("Editor preview did not move the imported bone");
  course.data = result;
  const saved = join(dir, "animated-course.szs");
  await writeFile(saved, yaz0Compress(buildU8(tree), 8));
  const reopened = parseU8(yaz0Decompress(new Uint8Array(await readFile(saved))));
  const reopenedCHR = parseBRRES(findFile(reopened, "course_model.brres").data).chr.get(chr.name);
  if (!reopenedCHR || reopenedCHR.frames !== chr.frames) throw new Error("Saved SZS lost the imported animation");
  const wszst = wszstPath();
  if (wszst) {
    // Nintendo's own tracks already raise warnings (exit code 2): only a worse result is a failure.
    const check = async (file: string) => {
      const child = Bun.spawn([wszst, "CHECK", file], { cwd: dir, stdout: "pipe", stderr: "pipe", windowsHide: true });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, text: `${out}\n${err}` };
    };
    const original = await check(resolve(source)), result = await check(saved);
    if (result.code > original.code) throw new Error(`Wiimm SZS check got worse (${original.code} → ${result.code}): ${result.text}`);
  }
  for (const extension of ["gltf", "fbx", "dae"]) {
    const formatResult = parseBRRES(await import3DModel(originalBRRES, join(dir, `animated.${extension}`), [1000, 200, 500]));
    const formatCHR = [...formatResult.chr.values()].find((entry: any) => [...entry.bones.keys()].some((name: string) => name.includes("AnimBone")));
    const moved = formatCHR && [...formatCHR.bones.values()].some((bone: any) => bone.trans && Math.abs(evalTrack(bone.trans[0], formatCHR.frames) - evalTrack(bone.trans[0], 0)) > 0.1);
    if (!formatCHR || !moved)
      throw new Error(`${extension} animation was not imported`);
    console.log(`${extension.toUpperCase()} animation: ${formatCHR.frames} frames`);
  }
  const objectResult = parseBRRES(await import3DModel(originalBRRES, join(dir, "animated-object.glb"), [1000, 200, 500]));
  const objectCHR = [...objectResult.chr.values()].find((entry: any) => [...entry.bones.keys()].some((name: string) => name.includes("ObjectMotion")));
  if (!objectCHR || ![...objectCHR.bones.values()].some((bone: any) => bone.trans && Math.abs(evalTrack(bone.trans[0], objectCHR.frames) - evalTrack(bone.trans[0], 0)) > 0.1))
    throw new Error("Whole-object animation was not imported");
  const objectModel = objectResult.models.find((m: any) => m.name === original.name);
  const motionBone = objectModel.bones.find((bone: any) => bone.name.includes("ObjectMotion"));
  if (!objectModel.objects.slice(original.objects.length).some((object: any) => object.mtx.some((id: number) => objectModel.boneMatrix.get(id) === motionBone.index)))
    throw new Error("Moving object is not attached to its generated animation bone");
  console.log(`Whole-object animation: ${objectCHR.frames} frames`);
  const repeated = parseBRRES(await import3DModel(result, input, [1500, 200, 500]));
  const repeatedModel = repeated.models.find((m: any) => m.name === original.name);
  if (repeatedModel.objects.length <= updated.objects.length || repeated.chr.size <= after.chr.size)
    throw new Error("Importing a second animated model did not retain both animations");
  console.log(`Animated GLB → BRRES → SZS: ${updated.objects.length - original.objects.length} mesh, ${chr.frames} frames, bone X ${first} → ${last}, preview and archive verified`);
} finally {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe cleanup path");
  await rm(dir, { recursive: true, force: true });
}
