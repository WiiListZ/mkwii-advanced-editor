import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { attachCHR0, type ImportedAnimation } from "./chr0-import.ts";
// @ts-ignore Shared Wii format reader used by the frontend.
import { evalTrack, parseBRRES, setCHR0Loop } from "../web/js/formats/brres.js";

export async function importResourceAnimation(target: Uint8Array, donor: Uint8Array, name: string) {
  const destination = parseBRRES(target);
  const source = parseBRRES(donor);
  const model = destination.models[0];
  const chr = source.chr.get(name);
  if (!model || !chr) throw new Error("Model or source CHR0 animation not found");
  const bones: ImportedAnimation["bones"] = {};
  for (const bone of model.bones) {
    const tracks = chr.bones.get(bone.name);
    if (!tracks) continue;
    const sample = (curve: any[] | null, fallback: number[], frame: number) =>
      curve ? curve.map((axis, i) => evalTrack(axis, frame) ?? fallback[i]) : fallback;
    bones[bone.name] = {
      frames: Array.from({ length: chr.frames + 1 }, (_, frame) => [
        ...sample(tracks.scale, bone.scale, frame),
        ...sample(tracks.rot, bone.rot, frame),
        ...sample(tracks.trans, bone.trans, frame),
      ]),
    };
  }
  if (!Object.keys(bones).length) throw new Error("The animation has no bones matching this model");
  const animation: ImportedAnimation = { name, frames: chr.frames, bones };
  const dir = await mkdtemp(join(tmpdir(), "mkwii-asset-animation-"));
  try {
    let result = await attachCHR0(target, animation, dir);
    if (!chr.loop) {
      const added = [...parseBRRES(result).chr.keys()].find((key) => !destination.chr.has(key));
      if (!added) throw new Error("Imported animation not found in the result");
      result = setCHR0Loop(result, added, false);
    }
    return result;
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe temporary animation directory");
    await rm(dir, { recursive: true, force: true });
  }
}
