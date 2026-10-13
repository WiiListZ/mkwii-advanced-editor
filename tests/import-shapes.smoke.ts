// End-to-end animated Blender shape key import into a stock course model.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseU8, findFile } from "../web/js/formats/u8.js";
import { yaz0Decompress } from "../web/js/formats/yaz0.js";
import { parseBRRES } from "../web/js/formats/brres.js";
import { import3DModel } from "../src/model-operations.ts";

const game = process.env.MKWII_GAME_DIR;
if (!game) { console.log("MKWII_GAME_DIR not set: skipped"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "mkwii-import-shapes-"));
try {
  const source = join(dir, "shape.blend"), script = join(dir, "make.py");
  writeFileSync(script, `import bpy, sys
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
obj = bpy.context.object
obj.name = 'MorphCube'
obj.shape_key_add(name='Basis')
key = obj.shape_key_add(name='Wide')
for point in key.data:
    point.co.x *= 1.5
key.value = 0
key.keyframe_insert(data_path='value', frame=1)
key.value = 1
key.keyframe_insert(data_path='value', frame=31)
key.value = 0
key.keyframe_insert(data_path='value', frame=61)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
`);
  const created = Bun.spawnSync(["C:/Program Files/Blender Foundation/Blender 4.4/blender.exe", "--background", "--factory-startup", "--python", script, "--", source]);
  if (created.exitCode) throw new Error("Blender fixture failed: " + new TextDecoder().decode(created.stderr).slice(-800));
  const tree = parseU8(yaz0Decompress(readFileSync(join(game, "Race/Course/castle_course.szs"))));
  const original = findFile(tree, "course_model.brres")!.data;
  const converted = await import3DModel(original, source, [0, 100, 0]);
  const parsed = parseBRRES(converted), model = parsed.models.find((m: any) => m.name === "course") || parsed.models[0];
  if (model.objects.length <= parseBRRES(original).models[0].objects.length) throw new Error("Shape mesh was not imported");
  if (!Buffer.from(converted).includes(Buffer.from("SHP0"))) throw new Error("SHP0 animation is missing");
  const brresPath = join(dir, "result.brres"), jsonPath = join(dir, "result.json");
  writeFileSync(brresPath, converted);
  const dumped = Bun.spawnSync(["C:/Users/MrTigerST/Documents/RiiStudio/rszst.exe", "brres-to-json", brresPath, jsonPath]);
  if (dumped.exitCode) throw new Error("RiiStudio could not parse the shape model");
  const shapeModel = JSON.parse(readFileSync(jsonPath, "utf8")).models[0];
  const target = shapeModel.positions.find((entry: any) => entry.name.includes("Wide"));
  if (!target) throw new Error("Morph target vertices were not stored in the model");
  const base = shapeModel.positions.find((entry: any) => target.name.startsWith(entry.name + "_"));
  if (!base) throw new Error("Morph target has no base position buffer");
  const binary = readFileSync(jsonPath.replace(/\.json$/, ".bin"));
  const vertex = (id: number) => binary.readFloatLE(binary.readUInt32BE(16 + id * 8));
  if (Math.abs(vertex(target.dataBufferId) - vertex(base.dataBufferId)) < 1) throw new Error("Morph target vertices equal the base mesh");
  const shp = Buffer.from(converted), start = shp.indexOf("SHP0");
  const frames = shp.readUInt16BE(start + 0x24);
  if (shp.readUInt32BE(start + 8) !== 4 || frames < 60) throw new Error("SHP0 version or duration is wrong");
  const group = start + shp.readUInt32BE(start + 0x10), controller = group + shp.readUInt32BE(group + 0x18 + 12);
  if (shp.readUInt16BE(controller + 10) !== 1) throw new Error("SHP0 controller is missing a morph track");
  const pointer = controller + 0x14, curve = pointer + shp.readInt32BE(pointer);
  if (shp.readUInt16BE(curve) !== frames + 1 || shp.readFloatBE(curve + 8 + Math.round(frames / 2) * 12 + 4) < 0.99) throw new Error("SHP0 morph curve is wrong");
  console.log("ok shape key mesh and SHP0 imported");
} finally {
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup path");
  rmSync(dir, { recursive: true, force: true });
}
