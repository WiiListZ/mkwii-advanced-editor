import { expect, test } from "bun:test";
import { generatedCourseModel } from "./generated-model.ts";
import { parseBRRES, partsSharingVertices, setBRRESVertexValues } from "../web/js/formats/brres.js";

test.skipIf(process.platform !== "win32")("vertex positions and texture coordinates are changed in place", async () => {
  const base = await generatedCourseModel();
  const model = parseBRRES(base).models[0], part = model.objects[0];
  const set = Number(Object.keys(part.uvIds)[0]), uvArray = part.uvArrayIds[set], uvEntry = part.uvIds[set][0];
  const posEntry = part.positionIndices[0], old = [...model.arrays.pos.get(part.positionArrayId).data.subarray(posEntry * 3, posEntry * 3 + 3)];
  let out = setBRRESVertexValues(base, model.name, "uv", uvArray, new Map([[uvEntry, [0.25, 0.75]]]));
  out = setBRRESVertexValues(out, model.name, "pos", part.positionArrayId, new Map([[posEntry, [old[0] + 50, old[1] + 2000, old[2]]]]));
  expect(out.length).toBe(base.length);
  const after = parseBRRES(out).models[0];
  const uv = after.arrays.uv.get(uvArray).data;
  expect([uv[uvEntry * 2], uv[uvEntry * 2 + 1]].map((x: number) => Math.round(x * 1000) / 1000)).toEqual([0.25, 0.75]);
  const pos = after.arrays.pos.get(part.positionArrayId).data;
  expect(Math.round(pos[posEntry * 3 + 1])).toBe(Math.round(old[1] + 2000));
  // The model's bounds take in the moved vertex.
  expect(after.max[1]).toBeGreaterThanOrEqual(old[1] + 1999);
  expect(after.objects[0].uvs[set].some((v: number) => Math.abs(v - 0.75) < 1e-3)).toBe(true);
  expect(partsSharingVertices(model, "pos", part.positionArrayId, part.positionIndices, 0)).toEqual([]);
  expect(() => setBRRESVertexValues(base, model.name, "uv", uvArray, new Map([[999999, [0, 0]]]))).toThrow("not in the array");
});
