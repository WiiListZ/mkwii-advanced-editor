// End-to-end Blender .blend -> BRRES SRT0/CLR0 import using real course assets.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { import3DModel } from "../src/model-operations.ts";

const game = process.env.MKWII_GAME_DIR;
if (!game) { console.log("MKWII_GAME_DIR not set: skipped"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "mkwii-import-material-"));
try {
  const scene = join(dir, "animated.blend"), script = join(dir, "make.py");
  writeFileSync(script, `import bpy, sys
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
obj = bpy.context.object
obj.name = 'AnimatedCube'
mat = bpy.data.materials.new('AnimatedPaint')
mat.use_nodes = True
obj.data.materials.append(mat)
nodes = mat.node_tree.nodes
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
texcoord = nodes.new('ShaderNodeTexCoord')
mapping = nodes.new('ShaderNodeMapping')
image_node = nodes.new('ShaderNodeTexImage')
image = bpy.data.images.new('Paint', width=16, height=16, alpha=True)
image.pixels[:] = [1.0, 1.0, 1.0, 1.0] * (16 * 16)
image.filepath_raw = sys.argv[-1] + '.png'
image.file_format = 'PNG'
image.save()
image_node.image = image
mat.node_tree.links.new(texcoord.outputs['UV'], mapping.inputs['Vector'])
mat.node_tree.links.new(mapping.outputs['Vector'], image_node.inputs['Vector'])
mat.node_tree.links.new(image_node.outputs['Color'], bsdf.inputs['Base Color'])
bpy.context.scene.render.fps = 60
mapping.inputs['Location'].default_value[0] = 0
mapping.inputs['Location'].keyframe_insert(data_path='default_value', frame=1, index=0)
mapping.inputs['Location'].default_value[0] = 1
mapping.inputs['Location'].keyframe_insert(data_path='default_value', frame=61, index=0)
bsdf.inputs['Base Color'].default_value = (1, 0, 0, 1)
bsdf.inputs['Base Color'].keyframe_insert(data_path='default_value', frame=1)
bsdf.inputs['Base Color'].default_value = (0, 0, 1, 1)
bsdf.inputs['Base Color'].keyframe_insert(data_path='default_value', frame=61)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
`);
  const blender = "C:/Program Files/Blender Foundation/Blender 4.4/blender.exe";
  const created = Bun.spawnSync([blender, "--background", "--factory-startup", "--python", script, "--", scene]);
  if (created.exitCode) throw new Error("Could not create Blender fixture: " + new TextDecoder().decode(created.stderr).slice(-800));
  const tree = parseU8(yaz0Decompress(readFileSync(join(game, "Race/Course/castle_course.szs"))));
  const source = findFile(tree, "course_model.brres")!.data;
  const next = await import3DModel(source, scene, [0, 100, 0]);
  const before = parseBRRES(source), after = parseBRRES(next);
  if (after.models[0].objects.length <= before.models[0].objects.length || after.srt.size <= before.srt.size || after.clr.size <= before.clr.size)
    throw new Error("Imported model, SRT0 or CLR0 missing");
  console.log("ok animated Blender material imported as SRT0 and CLR0");
} finally {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup path");
  rmSync(dir, { recursive: true, force: true });
}
