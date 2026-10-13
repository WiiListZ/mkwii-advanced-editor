import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rszstPath, wszstPath } from "./chr0-import.ts";
// @ts-ignore Shared JavaScript BRRES reader.
import { parseBRRES } from "../web/js/formats/brres.js";

export type ImportedShape = { name: string; frames: number; shapes: {
  mesh: string; base: number[][]; targets: { name: string; positions: number[][]; values: number[] }[];
}[] };
export type ShapeController = { base: string; target: string; values: number[] };

async function run(exe: string, cwd: string, ...args: string[]) {
  const child = Bun.spawn([exe, ...args], { cwd, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Weighted model conversion failed: ${(out + "\n" + err).trim().slice(-900)}`);
}

function readBuffers(bytes: Buffer) {
  if (bytes.toString("ascii", 0, 4) !== "RBUF" || bytes.readUInt32BE(4) !== 100) throw new Error("Unsupported RiiStudio buffer format");
  const count = bytes.readUInt32BE(8), result: Buffer[] = [];
  if (count > 100000 || 16 + count * 8 > bytes.length) throw new Error("Invalid RiiStudio buffer table");
  for (let i = 0; i < count; i++) {
    const offset = bytes.readUInt32BE(16 + i * 8), size = bytes.readUInt32BE(20 + i * 8);
    if (offset + size > bytes.length) throw new Error("Invalid RiiStudio buffer range");
    result.push(bytes.subarray(offset, offset + size));
  }
  return result;
}

function writeBuffers(parts: Buffer[]) {
  const align = (value: number) => (value + 63) & ~63;
  let position = align(16 + parts.length * 8);
  const size = position + parts.reduce((total, part) => total + align(part.length), 0);
  const out = Buffer.alloc(size);
  out.write("RBUF", 0, "ascii");
  out.writeUInt32BE(100, 4);
  out.writeUInt32BE(parts.length, 8);
  out.writeUInt32BE(size, 12);
  for (let i = 0; i < parts.length; i++) {
    out.writeUInt32BE(position, 16 + i * 8);
    out.writeUInt32BE(parts[i].length, 20 + i * 8);
    parts[i].copy(out, position);
    position += align(parts[i].length);
  }
  return out;
}

function shiftBufferIds(value: any, offset: number) {
  if (Array.isArray(value)) return value.forEach((entry) => shiftBufferIds(entry, offset));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if ((key === "dataBufferId" || key === "vertexDataBufferId") && typeof item === "number") value[key] = item + offset;
    else shiftBufferIds(item, offset);
  }
}

// ABMatt converts a rigged DAE, including multiple bone weights, into a separate BRRES.
// Merge its MDL0 data through RiiStudio and replace only the MDL0 subfile in the original
// archive. Other animation resources and existing TEX0 files retain their original bytes.
export async function mergeWeightedModel(original: Uint8Array, imported: Uint8Array, dir: string,
  shapeAnimation?: ImportedShape, shapeControllers: ShapeController[] = []) {
  const rszst = rszstPath(), wszst = wszstPath();
  if (!rszst || !wszst) throw new Error("Weighted model import requires RiiStudio rszst.exe and Wiimm's wszst tool");
  const originalBRRES = join(dir, "weighted-original.brres"), importedBRRES = join(dir, "weighted-imported.brres");
  const oldJsonPath = join(dir, "weighted-original.json"), newJsonPath = join(dir, "weighted-imported.json");
  const mergedJsonPath = join(dir, "weighted-merged.json"), mergedBRRES = join(dir, "weighted-merged.brres");
  await writeFile(originalBRRES, original);
  await writeFile(importedBRRES, imported);
  await run(rszst, dir, "brres-to-json", originalBRRES, oldJsonPath);
  await run(rszst, dir, "brres-to-json", importedBRRES, newJsonPath);
  const base = JSON.parse(await readFile(oldJsonPath, "utf8")), addition = JSON.parse(await readFile(newJsonPath, "utf8"));
  if (!base.models.length || addition.models.length !== 1) throw new Error("Weighted model import needs a target model and one imported model");
  const model = base.models.find((entry: any) => entry.name === "course") || base.models[0], added = addition.models[0];
  if (addition.textures.some((texture: any) => base.textures.some((old: any) => old.name === texture.name))) throw new Error("Imported texture name conflicts with a course texture");
  const oldBuffers = readBuffers(await readFile(oldJsonPath.replace(/\.json$/, ".bin")));
  const newBuffers = readBuffers(await readFile(newJsonPath.replace(/\.json$/, ".bin")));
  if (shapeAnimation) {
    for (const shape of shapeAnimation.shapes) {
      const positionBuffers = added.positions.filter((entry: any) => entry.name === shape.mesh);
      if (!positionBuffers.length) throw new Error(`Cannot match shape key mesh ${shape.mesh} to imported vertices`);
      for (const position of positionBuffers) {
        if (position.q_type !== 4 || position.q_stride !== 12 || position.q_divisor !== 0) throw new Error(`Shape key mesh ${shape.mesh} needs float position vertices`);
        const baseBytes = newBuffers[position.dataBufferId];
        if (!baseBytes || baseBytes.length % 12) throw new Error("Invalid position buffer for shape keys");
        const indices: number[] = [];
        for (let i = 0; i < baseBytes.length; i += 12) {
          const point = [0, 4, 8].map((offset) => baseBytes.readFloatLE(i + offset));
          let match = -1, best = 0.0001;
          for (let j = 0; j < shape.base.length; j++) {
            const distance = point.reduce((sum, value, axis) => sum + (value - shape.base[j][axis]) ** 2, 0);
            if (distance < best) { best = distance; match = j; }
          }
          if (match < 0) throw new Error(`Cannot match shape key vertex in ${shape.mesh}`);
          indices.push(match);
        }
        for (const target of shape.targets) {
          if (target.positions.length !== shape.base.length || target.values.length !== shapeAnimation.frames + 1) throw new Error("Invalid shape key frame or vertex count");
          const name = `${position.name}_${target.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          if (added.positions.some((entry: any) => entry.name === name) || model.positions.some((entry: any) => entry.name === name)) throw new Error(`Shape key name ${name} already exists`);
          const bytes = Buffer.from(baseBytes);
          indices.forEach((index, vertex) => [0, 1, 2].forEach((axis) => bytes.writeFloatLE(target.positions[index][axis], vertex * 12 + axis * 4)));
          added.positions.push({ ...position, id: added.positions.length, name, dataBufferId: newBuffers.push(bytes) - 1 });
          shapeControllers.push({ base: position.name, target: name, values: target.values });
        }
      }
    }
  }
  shiftBufferIds(added, oldBuffers.length);
  for (const key of ["positions", "normals", "colors", "texcoords"]) {
    const offset = model[key].length;
    for (const entry of added[key]) entry.id += offset;
    model[key].push(...added[key]);
  }
  const boneOffset = model.bones.length, materialOffset = model.materials.length;
  const meshOffset = model.meshes.length, matrixOffset = model.matrices.length;
  for (const bone of added.bones) {
    if (bone.parent >= 0) bone.parent += boneOffset;
    bone.children = bone.children.map((index: number) => index + boneOffset);
    for (const call of bone.draw_calls) { call.material += materialOffset; call.poly += meshOffset; }
  }
  for (const material of added.materials) material.id += materialOffset;
  for (const matrix of added.matrices) for (const weight of matrix.weights) weight.bone_id += boneOffset;
  for (const mesh of added.meshes) {
    if (mesh.current_matrix >= 0) mesh.current_matrix += matrixOffset;
    for (const primitive of mesh.mprims) primitive.matrices = primitive.matrices.map((index: number) => index + matrixOffset);
  }
  for (const key of ["bones", "materials", "matrices", "meshes"]) model[key].push(...added[key]);
  for (let axis = 0; axis < 3; axis++) {
    model.info.min[axis] = Math.min(model.info.min[axis], added.info.min[axis]);
    model.info.max[axis] = Math.max(model.info.max[axis], added.info.max[axis]);
  }
  base.textures.push(...addition.textures);
  await writeFile(mergedJsonPath, JSON.stringify(base));
  await writeFile(mergedJsonPath.replace(/\.json$/, ".bin"), writeBuffers([...oldBuffers, ...newBuffers]));
  await run(rszst, dir, "json-to-brres", mergedJsonPath, mergedBRRES);

  const originalDir = join(dir, "weighted-extracted-original"), mergedDir = join(dir, "weighted-extracted-merged");
  await run(wszst, dir, "EXTRACT", originalBRRES, "--dest", originalDir);
  await run(wszst, dir, "EXTRACT", mergedBRRES, "--dest", mergedDir);
  const modelFolder = "3DModels(NW4R)", modelName = model.name;
  const sourceModel = join(mergedDir, modelFolder, modelName);
  const targetModel = join(originalDir, modelFolder, modelName);
  await copyFile(sourceModel, targetModel);
  if (addition.textures.length) {
    const textureFolder = "Textures(NW4R)";
    await mkdir(join(originalDir, textureFolder), { recursive: true });
    for (const texture of addition.textures) await copyFile(join(mergedDir, textureFolder, texture.name), join(originalDir, textureFolder, texture.name));
  }
  const output = join(dir, "weighted-final.brres");
  await run(wszst, dir, "CREATE", "--brres", originalDir, "--dest", output);
  const result = new Uint8Array(await readFile(output)), before = parseBRRES(original), after = parseBRRES(result);
  const old = before.models.find((item: any) => item.name === model.name) || before.models[0];
  const next = after.models.find((item: any) => item.name === old.name);
  if (!next || next.objects.length !== old.objects.length + added.meshes.length || next.bones.length !== old.bones.length + added.bones.length
    || next.weights.size < old.weights.size + added.matrices.filter((entry: any) => entry.weights.length > 1).length)
    throw new Error("Weighted model merge did not retain imported geometry, bones and weights");
  for (const object of old.objects) {
    const matching = next.objects.find((entry: any) => entry.name === object.name);
    if (!matching || matching.triangles !== object.triangles) throw new Error(`Weighted merge changed existing object ${object.name}`);
  }
  for (const other of before.models.filter((item: any) => item.name !== old.name)) {
    const retained = after.models.find((item: any) => item.name === other.name);
    if (!retained || retained.objects.length !== other.objects.length) throw new Error(`Weighted merge changed another model ${other.name}`);
  }
  for (const name of before.textures.keys()) if (!after.textures.has(name)) throw new Error(`Weighted merge removed texture ${name}`);
  for (const kind of ["chr", "srt", "pat", "clr", "shp", "vis"])
    for (const name of before[kind]?.keys?.() || []) if (!after[kind]?.has(name)) throw new Error(`Weighted merge removed ${kind} ${name}`);
  return result;
}
