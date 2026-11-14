// A small course_model.brres made by the editor's own generator, for tests that change models.
// The generator needs the included converter: it is unpacked here, and the environment restored.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { prepareBundledTools } from "../src/bundled-tools.ts";
import { buildGeneratedTrackModels } from "../src/generated-track-models.ts";
import { findFile, parseU8 } from "../web/js/formats/u8.js";

export async function generatedCourseModel() {
  const dir = await mkdtemp(join(tmpdir(), "mkwii-generated-model-"));
  const old = { a: process.env.MKWII_ABMATT, w: process.env.MKWII_WSZST, p: process.env.PATH };
  try {
    await prepareBundledTools(dir);
    const archive = await buildGeneratedTrackModels({ materials: { road: { color: [1, 0, 0] } }, tris: [
      { mat: "road", v: [0, 0, 0, 1000, 0, 0, 0, 0, 1000], uv: [0, 0, 1, 0, 0, 1] }] });
    return findFile(parseU8(archive), "course_model.brres")!.data as Uint8Array;
  } finally {
    for (const [key, value] of [["MKWII_ABMATT", old.a], ["MKWII_WSZST", old.w], ["PATH", old.p]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (resolve(dir).startsWith(resolve(tmpdir()) + sep)) await rm(dir, { recursive: true, force: true });
  }
}
