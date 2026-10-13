// Optional integration test for importing Blender formats into a real course_model.brres.
// Usage: bun run tests/model-import.smoke.ts <path-to-track.szs>
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { import3DModel } from "../src/model-operations.ts";
import { parseBRRES } from "../web/js/formats/brres.js";
import { findFile, parseU8 } from "../web/js/formats/u8.js";
import { isYaz0, yaz0Decompress } from "../web/js/formats/yaz0.js";

const source = process.argv[2];
if (!source) throw new Error("Pass a Mario Kart Wii track SZS path");
const blender = process.env.MKWII_BLENDER || "C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe";
const dir = await mkdtemp(join(tmpdir(), "mkwii-model-smoke-"));
try {
  const script = join(dir, "samples.py");
  await writeFile(script, `import bpy, os, sys
folder = sys.argv[sys.argv.index('--') + 1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2)
cube = bpy.context.object
cube.name = 'ImportSample'
material = bpy.data.materials.new('SampleMaterial')
material.diffuse_color = (0.8, 0.2, 0.1, 1)
material.use_nodes = True
image = bpy.data.images.new('ImportSampleTexture', width=2, height=2)
image.pixels = [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1]
image.filepath_raw = os.path.join(folder, 'sample.png')
image.file_format = 'PNG'
image.save()
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
material.node_tree.links.new(texture.outputs['Color'], material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
cube.data.materials.append(material)
bpy.ops.export_scene.fbx(filepath=os.path.join(folder, 'sample.fbx'), use_selection=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'sample.glb'), export_format='GLB', use_selection=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'sample.gltf'), export_format='GLTF_SEPARATE', use_selection=True)
bpy.ops.wm.collada_export(filepath=os.path.join(folder, 'sample.dae'), selected=True)
bpy.ops.wm.stl_export(filepath=os.path.join(folder, 'sample.stl'), export_selected_objects=True)
bpy.ops.wm.ply_export(filepath=os.path.join(folder, 'sample.ply'), export_selected_objects=True)
`);
  const child = Bun.spawn([blender, "--background", "--factory-startup", "--python", script, "--", dir], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Could not generate sample models: ${out}\n${err}`);
  const bytes = new Uint8Array(await readFile(source));
  const tree = parseU8(isYaz0(bytes) ? yaz0Decompress(bytes) : bytes);
  const course = findFile(tree, "course_model.brres");
  if (!course?.data) throw new Error("Track has no course_model.brres");
  const before = parseBRRES(course.data);
  const model = before.models.find((entry: any) => entry.name === "course") || before.models[0];
  for (const extension of ["stl", "ply", "dae", "fbx", "glb", "gltf"]) {
    const result = await import3DModel(course.data, join(dir, `sample.${extension}`), [0, 0, 0]);
    const after = parseBRRES(result);
    const changed = after.models.find((entry: any) => entry.name === model.name);
    if (!changed || changed.objects.length <= model.objects.length) throw new Error(`${extension} did not add geometry`);
    if (["dae", "fbx", "glb", "gltf"].includes(extension) && after.textures.size <= before.textures.size)
      throw new Error(`${extension} did not import its image texture`);
    console.log(`${extension}: ${model.objects.length} → ${changed.objects.length} model parts`);
  }
} finally {
  const base = resolve(tmpdir()) + sep;
  if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
  await rm(dir, { recursive: true, force: true });
}
