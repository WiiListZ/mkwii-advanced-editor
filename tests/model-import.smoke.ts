// Optional integration test for importing Blender formats into a real course_model.brres.
// Usage: bun run tests/model-import.smoke.ts <path-to-track.szs>
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { import3DModel, convert3DToBRRES } from "../src/model-operations.ts";
import { parseBRRES, decodeTexture } from "../web/js/formats/brres.js";
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
solid = bpy.data.materials.new('SolidRed')
solid.diffuse_color = (1, 0, 0, 1)
solid.use_nodes = True
solid.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (1, 0, 0, 1)
cube.data.materials.append(solid)
for polygon in cube.data.polygons:
    polygon.material_index = polygon.index % 2
bpy.ops.export_scene.fbx(filepath=os.path.join(folder, 'sample.fbx'), use_selection=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'sample.glb'), export_format='GLB', use_selection=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'sample.gltf'), export_format='GLTF_SEPARATE', use_selection=True)
bpy.ops.wm.collada_export(filepath=os.path.join(folder, 'sample.dae'), selected=True)
bpy.ops.wm.stl_export(filepath=os.path.join(folder, 'sample.stl'), export_selected_objects=True)
bpy.ops.wm.ply_export(filepath=os.path.join(folder, 'sample.ply'), export_selected_objects=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(folder, 'sample.blend'))
colours = cube.data.color_attributes.new(name='Colours', type='BYTE_COLOR', domain='CORNER')
cube.data.color_attributes.active_color_index = 0
for i, value in enumerate(colours.data):
    value.color = ((1, 0, 0, 1), (0, 1, 0, 1), (0, 0, 1, 1))[i % 3]
bpy.ops.wm.ply_export(filepath=os.path.join(folder, 'vertex.ply'), export_selected_objects=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'vertex.glb'), export_format='GLB', use_selection=True, export_vertex_color='ACTIVE')
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
  for (const extension of ["stl", "ply", "dae", "fbx", "glb", "gltf", "blend"]) {
    const result = await import3DModel(course.data, join(dir, `sample.${extension}`), [0, 0, 0]);
    const after = parseBRRES(result);
    const changed = after.models.find((entry: any) => entry.name === model.name);
    if (!changed || changed.objects.length <= model.objects.length) throw new Error(`${extension} did not add geometry`);
    if (["dae", "fbx", "glb", "gltf", "blend"].includes(extension)) {
      const added = changed.materials.filter((m: any) => !model.materials.some((old: any) => old.name === m.name));
      if (added.length < 2) throw new Error(`${extension} merged the two materials`);
      const images = added.flatMap((m: any) => m.layers.map((l: any) => after.textures.get(l.texture)));
      if (!images.some((t: any) => {
        const pixels = decodeTexture(t);
        return pixels[0] > 245 && pixels[1] < 10 && pixels[2] < 10;
      })) throw new Error(`${extension} lost its solid red material`);
      if (!images.some((t: any) => new Set(Array.from(decodeTexture(t).filter((_: any, i: number) => i % 4 === 0))).size > 1))
        throw new Error(`${extension} lost the multicolour texture`);
    }
    console.log(`${extension}: ${model.objects.length} → ${changed.objects.length} model parts`);
  }
  const standalone = parseBRRES(await convert3DToBRRES(join(dir, 'sample.blend'), '-', 'converted'));
  if (standalone.models[0]?.materials.length !== 2 || standalone.textures.size !== 2) throw new Error('Standalone conversion lost materials or textures');
  console.log('standalone BRRES: both materials and textures retained');
  for (const extension of ['ply', 'glb']) {
    if (extension === 'glb') {
      const bytes = await readFile(join(dir, 'vertex.glb'));
      const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
      if (!json.meshes.some((m: any) => m.primitives.some((p: any) => p.attributes.COLOR_0 !== undefined))) throw new Error('Vertex-colour GLB fixture has no COLOR_0');
    }
    const coloured = parseBRRES(await import3DModel(course.data, join(dir, `vertex.${extension}`), [0, 0, 0]));
    const mesh = coloured.models.find((m: any) => m.name === model.name);
    const added = mesh.objects.filter((o: any) => !model.objects.some((old: any) => old.name === o.name));
    if (!added.some((o: any) => o.colors && new Set(Array.from(o.colors).filter((_, i) => i % 4 === 0)).size > 1))
      throw new Error(`${extension} lost its vertex colours`);
    console.log(`${extension}: vertex colours retained`);
  }
} finally {
  const base = resolve(tmpdir()) + sep;
  if (!resolve(dir).startsWith(base)) throw new Error("Unsafe temporary directory cleanup path");
  await rm(dir, { recursive: true, force: true });
}
