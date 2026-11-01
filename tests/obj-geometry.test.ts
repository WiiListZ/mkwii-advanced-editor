import { expect, test } from "bun:test";
import { normalizeOBJFaces } from "../src/obj-geometry.ts";

test("OBJ concave polygons retain area and winding, with relative indices and v//vn references", () => {
  const vertices = [[0, 0, 0], [3, 0, 0], [3, 0, 3], [1, 0, 1], [0, 0, 3]];
  const out = normalizeOBJFaces([...vertices.map((v) => `v ${v.join(" ")}`), "vn 0 -1 0", "f -5//1 -4//1 -3//1 -2//1 -1//1 # concave"], vertices);
  const faces = out.filter((line) => line.startsWith("f "));
  expect(faces.length).toBe(3); expect(out).toContain("vt 0 0");
  let area = 0;
  for (const face of faces) {
    const points = face.slice(2).split(" ").map((corner) => {
      expect(corner).toMatch(/^\d+\/1\/1$/);
      return vertices[Number(corner.split("/")[0]) - 1];
    });
    const [a, b, c] = points;
    const signed = ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    expect(signed).toBeGreaterThan(0); area += signed;
  }
  expect(area).toBeCloseTo(6);
});

test("OBJ missing normals are generated without changing supplied UV references", () => {
  const vertices = [[0, 0, 0], [1, 0, 0], [0, 0, 1]];
  const out = normalizeOBJFaces(["v 0 0 0", "v 1 0 0", "v 0 0 1", "vt 0 0", "vt 1 0", "vt 0 1", "f 1/1 2/2 3/3"], vertices);
  expect(out).toContain("f 1/1/1 2/2/1 3/3/1");
  expect(out).toContain("vn 0 -1 0");
  expect(() => normalizeOBJFaces(["v 0 0 0", "f -4 1 2"], vertices)).toThrow("invalid vertex index");
});
