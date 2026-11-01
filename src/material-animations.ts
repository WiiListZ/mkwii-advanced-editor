import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rszstPath, wszstPath } from "./chr0-import.ts";
// @ts-ignore Shared BRRES reader.
import { parseBRRES } from "../web/js/formats/brres.js";

export type MaterialAnimation = {
  name: string;
  frames: number;
  materials: { name: string; uv?: { scaleX: number; scaleY: number; rotation: number; transX: number; transY: number }[]; color?: number[][] }[];
};

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 28) || "Imported";
const changed = (samples: number[]) => samples.some((value) => Math.abs(value - samples[0]) > 1e-6);
const curve = (values: number[]) => ({ keyframes: values.map((value, frame) => ({ frame, value,
  tangent: (values[Math.min(values.length - 1, frame + 1)] - values[Math.max(0, frame - 1)]) / (frame === 0 || frame === values.length - 1 ? 1 : 2) })) });
const colorWord = (rgba: number[]) => rgba.reduce((word, value) => ((word << 8) | Math.max(0, Math.min(255, Math.round(value * 255)))) >>> 0, 0);

async function run(executable: string, cwd: string, ...args: string[]) {
  const child = Bun.spawn([executable, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Animation conversion failed: ${(out + "\n" + err).trim().slice(-800)}`);
}

export async function attachMaterialAnimations(brres: Uint8Array, animation: MaterialAnimation, dir: string) {
  if (!animation.materials?.length) return brres;
  if (!Number.isInteger(animation.frames) || animation.frames < 1 || animation.frames > 65534) throw new Error("Invalid material animation length");
  const rszst = rszstPath(), wszst = wszstPath();
  if (!rszst || !wszst) throw new Error("Material animation import requires RiiStudio rszst.exe and Wiimm's wszst tool");
  const before = parseBRRES(brres), model = before.models.find((m: any) => m.name === "course") || before.models[0];
  if (!model) throw new Error("The course has no model");
  const materialNames = new Set(model.materials.map((m: any) => m.name));
  const srts: any[] = [], clrs: any[] = [];
  for (const material of animation.materials) {
    const name = materialNames.has(material.name) ? material.name : [...materialNames].find((n: string) => n.endsWith("_" + material.name));
    if (!name) throw new Error(`Imported material ${material.name} was not found in the course model`);
    if (material.uv?.length === animation.frames + 1) {
      const axes = ["scaleX", "scaleY", "rotation", "transX", "transY"] as const;
      const values = axes.map((axis) => material.uv!.map((frame) => frame[axis]));
      if (values.some(changed)) srts.push({ target: { materialName: name, matrixIndex: 0, indirect: false },
        matrix: Object.fromEntries(["scaleX", "scaleY", "rot", "transX", "transY"].map((key, i) => [key, curve(values[i])])) });
    }
    if (material.color?.length === animation.frames + 1 && material.color.some((frame) => frame.some((v, i) => Math.abs(v - material.color![0][i]) > 1 / 255))) {
      clrs.push({ name, colors: material.color.map(colorWord) });
    }
  }
  if (!srts.length && !clrs.length) return brres;
  if (before.srt.size + Number(!!srts.length) > 8) throw new Error("The course already has 8 SRT0 texture animations");
  const name = safeName(animation.name);
  let srtName = `${name}_SRT`, clrName = `${name}_CLR`;
  for (let i = 1; before.srt.has(srtName); i++) srtName = `${name.slice(0, 22)}_${i}_SRT`;
  for (let i = 1; before.clr.has(clrName); i++) clrName = `${name.slice(0, 22)}_${i}_CLR`;
  const source = join(dir, "material-source.brres"), jsonPath = join(dir, "material.json"), converted = join(dir, "material-converted.brres");
  await writeFile(source, brres);
  await run(rszst, dir, "brres-to-json", source, jsonPath);
  const json = JSON.parse(await readFile(jsonPath, "utf8"));
  if (srts.length) json.srts.push({ name: srtName, sourcePath: "", frameDuration: animation.frames, wrapMode: "Repeat", xformModel: 0, matrices: srts });
  if (clrs.length) {
    const tracks: any[] = [];
    const materials = clrs.map((entry) => {
      const data = tracks.push({ keyframes: entry.colors.map((value: number) => ({ data: value })) }) - 1;
      return { name: entry.name, flags: 1, targets: [{ data, notAnimatedMask: 0 }] };
    });
    json.clrs.push({ name: clrName, sourcePath: "", frameDuration: animation.frames, wrapMode: "Repeat", materials, tracks });
  }
  await writeFile(jsonPath, JSON.stringify(json));
  await run(rszst, dir, "json-to-brres", jsonPath, converted);
  const generated = parseBRRES(new Uint8Array(await readFile(converted)));
  if ((srts.length && !generated.srt.has(srtName)) || (clrs.length && !generated.clr.has(clrName))) throw new Error("RiiStudio did not write the material animation");

  // Repack only the new animation subfiles into the original archive. This retains the original
  // MDL0, textures, and any CHR0/PAT0/SHP0 that RiiStudio cannot safely round-trip.
  const originalDir = join(dir, "material-original"), generatedDir = join(dir, "material-generated"), output = join(dir, "material-final.brres");
  await run(wszst, dir, "EXTRACT", source, "--dest", originalDir);
  await run(wszst, dir, "EXTRACT", converted, "--dest", generatedDir);
  for (const [folder, resourceName] of [["AnmTexSrt(NW4R)", srtName], ["AnmClr(NW4R)", clrName]]) {
    if (folder === "AnmTexSrt(NW4R)" && !srts.length || folder === "AnmClr(NW4R)" && !clrs.length) continue;
    const from = join(generatedDir, folder);
    const file = (await readdir(from)).find((f) => f.replace(/\.[^.]+$/, "") === resourceName);
    if (!file) throw new Error(`Could not find generated ${resourceName}`);
    const to = join(originalDir, folder);
    await mkdir(to, { recursive: true });
    await cp(join(from, file), join(to, file));
  }
  await run(wszst, dir, "CREATE", "--brres", originalDir, "--dest", output);
  const result = new Uint8Array(await readFile(output)), after = parseBRRES(result);
  const resultModel = after.models.find((m: any) => m.name === model.name);
  if (!resultModel || resultModel.objects.length !== model.objects.length || after.textures.size !== before.textures.size
    || [...before.chr.keys()].some((n) => !after.chr.has(n)) || [...before.srt.keys()].some((n) => !after.srt.has(n))
    || (srts.length && !after.srt.has(srtName)) || (clrs.length && !after.clr.has(clrName)))
    throw new Error("Material animation import changed existing model resources");
  return result;
}
