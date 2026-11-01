import { ShapeUtils, Vector2 } from "three";

// Normalize legal OBJ faces for ABMatt's triangle-only reader, which also cannot
// resolve negative indices or empty UV fields in v//vn face references.
export function normalizeOBJFaces(lines: string[], vertices: number[][]) {
  const totalUVs = lines.filter((line) => /^vt\s/.test(line)).length;
  const totalNormals = lines.filter((line) => /^vn\s/.test(line)).length;
  let seenVertices = 0, seenUVs = 0, seenNormals = 0, dummyUV = false;
  const normals: number[][] = [], out: string[] = [];
  const index = (text: string, seen: number, total: number, kind: string) => {
    const number = Number(text), resolved = number < 0 ? seen + number + 1 : number;
    if (!Number.isInteger(number) || number === 0 || resolved < 1 || resolved > total)
      throw new Error(`OBJ face has an invalid ${kind} index: ${text}`);
    return resolved;
  };
  for (const original of lines) {
    const line = original.trim();
    if (/^v\s/.test(line)) seenVertices++;
    if (/^vt\s/.test(line)) seenUVs++;
    if (/^vn\s/.test(line)) seenNormals++;
    if (!/^f\s/.test(line)) { out.push(line); continue; }
    const corners = line.split("#", 1)[0].trim().split(/\s+/).slice(1).map((word) => {
      const parts = word.split("/");
      return { v: index(parts[0], seenVertices, vertices.length, "vertex"),
        uv: parts[1] ? index(parts[1], seenUVs, totalUVs, "UV") : 0,
        normal: parts[2] ? index(parts[2], seenNormals, totalNormals, "normal") : 0 };
    });
    if (corners.length < 3) throw new Error("OBJ face needs at least three vertices");
    const points = corners.map((corner) => vertices[corner.v - 1]), normal = [0, 0, 0];
    // Newell's normal chooses the projection of a possibly concave polygon.
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
      normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
      normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    const axes = [0, 1, 2].filter((i) => i !== axis);
    const triangles = corners.length === 3 ? [[0, 1, 2]] : ShapeUtils.triangulateShape(points.map((p) => new Vector2(p[axes[0]], p[axes[1]])), []);
    if (!triangles.length) throw new Error("OBJ polygon cannot be triangulated; check for crossing or collapsed edges");
    const length = Math.hypot(...normal), unit = length ? normal.map((value) => value / length) : [0, 1, 0];
    let generatedNormal = 0;
    if (corners.some((corner) => !corner.normal)) { normals.push(unit); generatedNormal = totalNormals + normals.length; }
    for (const triangle of triangles) {
      // Earcut can reverse winding for one of the projection planes.
      const [a, b, c] = triangle.map((i) => points[i]), u = b.map((v, i) => v - a[i]), v = c.map((x, i) => x - a[i]);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (cross.reduce((sum, value, i) => sum + value * normal[i], 0) < 0) triangle.reverse();
      out.push("f " + triangle.map((i) => {
        const corner = corners[i];
        if (!corner.uv) dummyUV = true;
        return `${corner.v}/${corner.uv || totalUVs + 1}/${corner.normal || generatedNormal}`;
      }).join(" "));
    }
  }
  if (dummyUV) out.push("vt 0 0");
  out.push(...normals.map((normal) => `vn ${normal.join(" ")}`));
  return out;
}

// The OBJ converter discards v x y z r g b colours. COLLADA has an explicit
// COLOR stream, supported by ABMatt, so use it for vertex-coloured imports.
export function vertexColoredOBJToDAE(lines: string[], materials: { name: string; texture: string }[], name: string) {
  const positions: number[] = [], colors: number[] = [], uv: number[] = [], normals: number[] = [];
  const groups = new Map<string, number[]>();
  let material = materials[0]?.name || "imported";
  for (const line of lines) {
    const words = line.trim().split(/\s+/), command = words.shift();
    if (command === "v") {
      const values = words.map(Number); positions.push(...values.slice(0, 3));
      colors.push(...(values.length >= 6 ? values.slice(3, 6) : [1, 1, 1]), values.length >= 7 ? values[6] : 1);
    } else if (command === "vt") uv.push(...words.slice(0, 2).map(Number));
    else if (command === "vn") normals.push(...words.slice(0, 3).map(Number));
    else if (command === "usemtl") material = words.join(" ");
    else if (command === "f") {
      if (!groups.has(material)) groups.set(material, []);
      for (const corner of words) {
        const [v, t, n] = corner.split("/").map((x) => Number(x) - 1);
        groups.get(material)!.push(v, n, t, v);
      }
    }
  }
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const source = (id: string, values: number[], params: string[]) => `<source id="${id}"><float_array id="${id}-array" count="${values.length}">${values.join(" ")}</float_array><technique_common><accessor source="#${id}-array" count="${values.length / params.length}" stride="${params.length}">${params.map((p) => `<param name="${p}" type="float"/>`).join("")}</accessor></technique_common></source>`;
  const images = materials.map((m, i) => `<image id="image${i}"><init_from>${escape(m.texture)}</init_from></image>`).join("");
  const effects = materials.map((_, i) => `<effect id="effect${i}"><profile_COMMON><newparam sid="surface${i}"><surface type="2D"><init_from>image${i}</init_from></surface></newparam><newparam sid="sampler${i}"><sampler2D><source>surface${i}</source></sampler2D></newparam><technique sid="common"><lambert><diffuse><texture texture="sampler${i}" texcoord="UVMap"/></diffuse></lambert></technique></profile_COMMON></effect>`).join("");
  const mats = materials.map((m, i) => `<material id="${escape(m.name)}" name="${escape(m.name)}"><instance_effect url="#effect${i}"/></material>`).join("");
  const triangles = [...groups].map(([mat, indices]) => `<triangles count="${indices.length / 12}" material="${escape(mat)}"><input semantic="VERTEX" source="#vertices" offset="0"/><input semantic="NORMAL" source="#normals" offset="1"/><input semantic="TEXCOORD" source="#uv" offset="2" set="0"/><input semantic="COLOR" source="#colors" offset="3" set="0"/><p>${indices.join(" ")}</p></triangles>`).join("");
  const bindings = materials.map((m) => `<instance_material symbol="${escape(m.name)}" target="#${escape(m.name)}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset><library_images>${images}</library_images><library_effects>${effects}</library_effects><library_materials>${mats}</library_materials><library_geometries><geometry id="mesh" name="${escape(name)}"><mesh>${source("positions", positions, ["X", "Y", "Z"])}${source("normals", normals, ["X", "Y", "Z"])}${source("uv", uv, ["S", "T"])}${source("colors", colors, ["R", "G", "B", "A"])}<vertices id="vertices"><input semantic="POSITION" source="#positions"/></vertices>${triangles}</mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="scene"><node id="model" name="${escape(name)}"><instance_geometry url="#mesh"><bind_material><technique_common>${bindings}</technique_common></bind_material></instance_geometry></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>`;
}
