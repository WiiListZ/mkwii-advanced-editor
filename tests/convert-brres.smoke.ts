// Standalone 3D-to-BRRES conversion, including a skeletal animation.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { convert3DToBRRES } from "../src/model-operations.ts";
import { parseBRRES } from "../web/js/formats/brres.js";

const dir = mkdtempSync(join(tmpdir(), "mkwii-convert-brres-"));
try {
  const obj = join(dir, "static.obj");
  await Bun.write(obj, "v 0 0 0\nv 100 0 0\nv 0 100 0\nf 1 2 3\n");
  const staticModel = parseBRRES(await convert3DToBRRES(obj));
  if (!staticModel.models[0]?.objects.length) throw new Error("Static OBJ conversion has no geometry");

  const blender = process.env.MKWII_BLENDER || "C:/Program Files/Blender Foundation/Blender 4.4/blender.exe";
  if (!existsSync(blender)) throw new Error("Blender is needed for the animated conversion smoke test");
  const script = join(dir, "make.py"), source = join(dir, "animated.blend");
  await Bun.write(script, `import bpy, sys
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
mesh = bpy.context.object
arm = bpy.data.armatures.new('Armature')
rig = bpy.data.objects.new('Rig', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bone = arm.edit_bones.new('Root')
bone.head = (0, 0, 0)
bone.tail = (0, 0, 1)
bpy.ops.object.mode_set(mode='OBJECT')
group = mesh.vertex_groups.new(name='Root')
group.add(list(range(len(mesh.data.vertices))), 1.0, 'REPLACE')
modifier = mesh.modifiers.new('Armature', 'ARMATURE')
modifier.object = rig
rig.pose.bones['Root'].location.x = 0
rig.pose.bones['Root'].keyframe_insert(data_path='location', frame=1)
rig.pose.bones['Root'].location.x = 1
rig.pose.bones['Root'].keyframe_insert(data_path='location', frame=31)
# A second animation on its own NLA track, as glTF and FBX imports keep them.
move = rig.animation_data.action
move.name = 'Move'
track = rig.animation_data.nla_tracks.new()
track.name = 'Move'
track.strips.new('Move', 1, move)
rig.animation_data.action = None
rig.pose.bones['Root'].location.x = 0
rig.pose.bones['Root'].scale = (1, 1, 1)
rig.pose.bones['Root'].keyframe_insert(data_path='scale', frame=1)
rig.pose.bones['Root'].scale = (2, 2, 2)
rig.pose.bones['Root'].keyframe_insert(data_path='scale', frame=21)
rig.animation_data.action.name = 'Grow'
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
`);
  const made = Bun.spawnSync([blender, "--background", "--factory-startup", "--python", script, "--", source], { windowsHide: true });
  if (made.exitCode) throw new Error("Blender fixture failed: " + new TextDecoder().decode(made.stderr).slice(-600));
  const animated = parseBRRES(await convert3DToBRRES(source));
  if (!animated.models[0]?.objects.length || !animated.chr.size) throw new Error("Animated conversion lost geometry or CHR0");
  const restPose = parseBRRES(await convert3DToBRRES(source, "-"));
  if (!restPose.models[0]?.objects.length || !restPose.models[0]?.bones.some((bone: any) => bone.name.endsWith("Root")) || restPose.chr.size)
    throw new Error("Rest-pose conversion must keep the skeleton without CHR0 animation");
  const everything = parseBRRES(await convert3DToBRRES(source, "*"));
  const frames = [...everything.chr.values()].map((chr: any) => `${chr.name}:${chr.frames}`).sort().join(" ");
  if (frames !== "Grow_CHR:50 Move_CHR:75") throw new Error(`Converting every animation gave ${frames}`);
  console.log("Static, animated, all-animations and skeleton-only standalone BRRES conversion passed");
} finally {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary conversion test directory");
  rmSync(dir, { recursive: true, force: true });
}
