import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBRRES } from "../web/js/formats/brres.js";
import { preserveExistingBRRESTextures, transplantBRRESTextures } from "./brres-palettes.ts";

// ABMatt's material clipboard copies the native GX shader, indirect settings,
// all texture layers and the original looping SRT0 animation together.
export async function applyGeneratedBoost(data: Uint8Array, original: any, names: string[], exe: string, dir: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "donor.brres"), original.source);
  await writeFile(join(dir, "course.brres"), data);
  await writeFile(join(dir, "boost.txt"), `copy material for ${original.native.material.name} in donor.brres\n${names.map((name) => `paste material for ${name} in course.brres`).join("\n")}\nsave course.brres overwrite\n`);
  const child = Bun.spawn([exe, "-f", "boost.txt", "-o"], { cwd: dir, env: process.env, windowsHide: true, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Could not add the game's animated boost material: ${(out + err).slice(-900)}`);
  let result = new Uint8Array(await readFile(join(dir, "course.brres")));
  result = await preserveExistingBRRESTextures(data, result, join(dir, "preserved"));
  const textures = Object.fromEntries(Object.keys(original.native.textures).map((name) => [name, name]));
  result = await transplantBRRESTextures(original.source, result, textures, join(dir, "native-textures"));
  const parsed = parseBRRES(result), model = parsed.models.find((m: any) => m.name === "course")!;
  for (const name of names) {
    const material = model.materials.find((m: any) => m.name === name);
    if (material?.layers.length !== original.native.material.layers.length || ![...parsed.srt.values()].some((s: any) => s.loop && s.materials.has(name))) throw new Error("The original boost material or its animation was not preserved");
  }
  return result;
}
