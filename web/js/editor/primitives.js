// Primitive shapes to add to a track, with deformations. Every shape is built with its base on y = 0
// and centred on the origin, and is divided often enough for the deformations to bend it smoothly.
// Faces wind counter-clockwise seen from outside. The limits keep a shape cheap for a Wii.

export const PRIMITIVE_MAX_TRIANGLES = 6000;
export const PRIMITIVE_SHAPES = {
  box: 'Block', wedge: 'Ramp', prism: 'Triangle', cylinder: 'Cylinder', cone: 'Cone', sphere: 'Sphere', torus: 'Ring', stairs: 'Stairs', plane: 'Flat panel',
};
export const PRIMITIVE_DEFAULTS = {
  shape: 'box', width: 2000, height: 1000, depth: 2000,
  sides: 16, slices: 6, steps: 6, arc: 360, hollow: 0, ring: .25,
  taperX: 1, taperZ: 1, twist: 0, bend: 0, shearX: 0, shearZ: 0, bulge: 0, roughness: 0, seed: 1,
};
const LIMITS = {
  width: [10, 100000], height: [10, 100000], depth: [10, 100000], sides: [3, 64], slices: [1, 48], steps: [2, 32], arc: [10, 360], hollow: [0, .95], ring: [.02, .49],
  taperX: [0, 4], taperZ: [0, 4], twist: [-720, 720], bend: [-270, 270], shearX: [-3, 3], shearZ: [-3, 3], bulge: [-2, 2], roughness: [0, .5], seed: [1, 9999],
};

export function primitiveSpec(values = {}) {
  const spec = { ...PRIMITIVE_DEFAULTS, ...values };
  if (!PRIMITIVE_SHAPES[spec.shape]) throw new Error(`Unknown shape ${spec.shape}`);
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    const value = Number(spec[key]);
    if (!Number.isFinite(value)) throw new Error(`Invalid value for ${key}`);
    spec[key] = Math.max(low, Math.min(high, value));
  }
  for (const key of ['sides', 'slices', 'steps', 'seed']) spec[key] = Math.round(spec[key]);
  return spec;
}

// A quad made of two triangles, from corners in counter-clockwise order seen from outside.
const quad = (out, a, b, c, d) => { out.push([a, b, c], [a, c, d]); };

// A wall between two outlines at y0 and y1, cut into `slices` levels so that it can bend.
function wall(out, from, to, slices, at) {
  for (let s = 0; s < slices; s++) quad(out, at(from, s / slices), at(to, s / slices), at(to, (s + 1) / slices), at(from, (s + 1) / slices));
}

function boxFaces(out, w, h, d, slices, grid = slices) {
  const x = w / 2, z = d / 2;
  const corners = [[-x, z], [x, z], [x, -z], [-x, -z]];
  corners.forEach((corner, i) => {
    const next = corners[(i + 1) % 4];
    for (let g = 0; g < grid; g++) {
      const a = [corner[0] + (next[0] - corner[0]) * g / grid, corner[1] + (next[1] - corner[1]) * g / grid];
      const b = [corner[0] + (next[0] - corner[0]) * (g + 1) / grid, corner[1] + (next[1] - corner[1]) * (g + 1) / grid];
      wall(out, a, b, slices, (p, t) => [p[0], h * t, p[1]]);
    }
  });
  for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
    const x0 = -x + w * i / grid, x1 = -x + w * (i + 1) / grid, z0 = -z + d * j / grid, z1 = -z + d * (j + 1) / grid;
    quad(out, [x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]);
    quad(out, [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]);
  }
}

// Solid of a closed outline, with an optional inner wall and a part of the turn only.
function turned(out, radiusAt, spec, h) {
  const { sides, slices, arc, hollow } = spec;
  const full = arc >= 360, count = Math.max(3, full ? sides : Math.ceil(sides * arc / 360));
  const angle = (i) => (i / count) * arc * Math.PI / 180;
  const ring = (i, t, inner = false) => {
    const r = radiusAt(t) * (inner ? hollow : 1);
    return [Math.cos(angle(i)) * r * spec.width / 2, h * t, Math.sin(angle(i)) * r * spec.depth / 2];
  };
  for (let i = 0; i < count; i++) for (let s = 0; s < slices; s++) {
    const t0 = s / slices, t1 = (s + 1) / slices;
    quad(out, ring(i + 1, t0), ring(i, t0), ring(i, t1), ring(i + 1, t1));
    if (hollow > 0) quad(out, ring(i, t0, true), ring(i + 1, t0, true), ring(i + 1, t1, true), ring(i, t1, true));
  }
  const cap = (t, y, up) => {
    for (let i = 0; i < count; i++) {
      const a = ring(i, t), b = ring(i + 1, t);
      if (hollow > 0) {
        const c = ring(i, t, true), d = ring(i + 1, t, true);
        if (up) quad(out, a, c, d, b); else quad(out, c, a, b, d);
      } else if (radiusAt(t) > 1e-6) out.push(up ? [[0, y, 0], a, b].reverse() : [[0, y, 0], a, b]);
    }
  };
  cap(1, h, true); cap(0, 0, false);
  if (!full) for (const [i, flip] of [[0, false], [count, true]]) for (let s = 0; s < slices; s++) {
    const t0 = s / slices, t1 = (s + 1) / slices;
    const outer0 = ring(i, t0), outer1 = ring(i, t1);
    const inner0 = hollow > 0 ? ring(i, t0, true) : [0, h * t0, 0], inner1 = hollow > 0 ? ring(i, t1, true) : [0, h * t1, 0];
    if (flip) quad(out, inner0, outer0, outer1, inner1); else quad(out, outer0, inner0, inner1, outer1);
  }
}

function shapeTriangles(spec) {
  const out = [], { width: w, height: h, depth: d, slices, sides } = spec;
  switch (spec.shape) {
    case 'box': boxFaces(out, w, h, d, slices, Math.max(1, Math.min(8, slices))); break;
    case 'plane': for (let i = 0; i < slices; i++) for (let j = 0; j < slices; j++) {
      const x0 = -w / 2 + w * i / slices, x1 = -w / 2 + w * (i + 1) / slices, z0 = -d / 2 + d * j / slices, z1 = -d / 2 + d * (j + 1) / slices;
      quad(out, [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]);
    } break;
    case 'wedge': case 'prism': {
      // Same profile along x: a ramp rises along z, a triangle peaks in its middle.
      const peak = spec.shape === 'prism' ? 0 : d / 2;
      const profile = [[-d / 2, 0], [d / 2, 0], [peak, h]];
      for (let i = 0; i < slices; i++) {
        const x0 = -w / 2 + w * i / slices, x1 = -w / 2 + w * (i + 1) / slices;
        profile.forEach((p, k) => {
          const q = profile[(k + 1) % 3];
          for (let s = 0; s < slices; s++) {
            const a = [p[0] + (q[0] - p[0]) * s / slices, p[1] + (q[1] - p[1]) * s / slices];
            const b = [p[0] + (q[0] - p[0]) * (s + 1) / slices, p[1] + (q[1] - p[1]) * (s + 1) / slices];
            quad(out, [x0, a[1], a[0]], [x1, a[1], a[0]], [x1, b[1], b[0]], [x0, b[1], b[0]]);
          }
        });
      }
      for (let s = 0; s < slices; s++) for (let t = 0; t < slices - s; t++) {
        // Barycentric grid of the side triangle: along the base, then towards the peak.
        const point = (along, up) => [-d / 2 + d * along / slices + (peak + d / 2) * up / slices, h * up / slices];
        const a = point(t, s), b = point(t + 1, s), c = point(t, s + 1), e = point(t + 1, s + 1);
        out.push([[w / 2, a[1], a[0]], [w / 2, c[1], c[0]], [w / 2, b[1], b[0]]]);
        out.push([[-w / 2, a[1], a[0]], [-w / 2, b[1], b[0]], [-w / 2, c[1], c[0]]]);
        if (t < slices - s - 1) {
          out.push([[w / 2, b[1], b[0]], [w / 2, c[1], c[0]], [w / 2, e[1], e[0]]]);
          out.push([[-w / 2, b[1], b[0]], [-w / 2, e[1], e[0]], [-w / 2, c[1], c[0]]]);
        }
      }
      break;
    }
    case 'cylinder': turned(out, () => 1, spec, h); break;
    case 'cone': turned(out, (t) => 1 - t, { ...spec, hollow: 0 }, h); break;
    case 'sphere': {
      const rings = Math.max(2, slices * 2);
      const point = (i, j) => {
        const v = j / rings * Math.PI, u = i / sides * Math.PI * 2;
        return [Math.cos(u) * Math.sin(v) * w / 2, h / 2 * (1 + Math.cos(v)), Math.sin(u) * Math.sin(v) * d / 2];
      };
      for (let i = 0; i < sides; i++) for (let j = 0; j < rings; j++) {
        const a = point(i, j), b = point(i + 1, j), c = point(i + 1, j + 1), e = point(i, j + 1);
        if (j > 0) out.push([a, b, c]);
        if (j < rings - 1) out.push([a, c, e]);
      }
      break;
    }
    case 'torus': {
      const rings = Math.max(3, slices * 2), tube = spec.ring;
      const point = (i, j) => {
        const u = i / sides * Math.PI * 2, v = j / rings * Math.PI * 2, r = .5 - tube + tube * Math.cos(v);
        return [Math.cos(u) * r * w, h / 2 + Math.sin(v) * h / 2, Math.sin(u) * r * d];
      };
      for (let i = 0; i < sides; i++) for (let j = 0; j < rings; j++) quad(out, point(i, j), point(i, j + 1), point(i + 1, j + 1), point(i + 1, j));
      break;
    }
    case 'stairs': {
      const { steps } = spec, sd = d / steps, sh = h / steps;
      for (let s = 0; s < steps; s++) {
        const z0 = d / 2 - s * sd, z1 = z0 - sd, y1 = (s + 1) * sh, x = w / 2;
        // The riser in front, the tread on top, both sides down to the ground.
        quad(out, [-x, s * sh, z0], [x, s * sh, z0], [x, y1, z0], [-x, y1, z0]);
        quad(out, [-x, y1, z0], [x, y1, z0], [x, y1, z1], [-x, y1, z1]);
        quad(out, [x, 0, z0], [x, 0, z1], [x, y1, z1], [x, y1, z0]);
        quad(out, [-x, 0, z1], [-x, 0, z0], [-x, y1, z0], [-x, y1, z1]);
        quad(out, [-x, 0, z0], [-x, 0, z1], [x, 0, z1], [x, 0, z0]);
      }
      quad(out, [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2], [-w / 2, h, -d / 2], [w / 2, h, -d / 2]);
      break;
    }
  }
  return out;
}

const hash = (seed, x, y, z) => {
  const v = Math.sin(seed * 12.9898 + Math.round(x) * .0713 + Math.round(y) * .1171 + Math.round(z) * .0391) * 43758.5453;
  return v - Math.floor(v) - .5;
};

// Deformations, in this order: taper, shear, bulge, roughness, twist, bend. All along the height.
function deform(p, spec) {
  const h = spec.shape === 'plane' ? Math.max(spec.width, spec.depth) : spec.height;
  const t = spec.shape === 'plane' ? (p[0] + spec.width / 2) / spec.width : p[1] / h;
  let [x, y, z] = p;
  const taperX = 1 + (spec.taperX - 1) * t, taperZ = 1 + (spec.taperZ - 1) * t;
  x *= taperX; z *= taperZ;
  x += spec.shearX * p[1]; z += spec.shearZ * p[1];
  if (spec.bulge) {
    const swell = 1 + spec.bulge * Math.sin(Math.PI * t);
    x *= swell; z *= swell;
  }
  if (spec.roughness) {
    const size = Math.max(spec.width, spec.height, spec.depth) * spec.roughness * .2;
    x += hash(spec.seed, p[0], p[1], p[2]) * size;
    y += hash(spec.seed + 1, p[0], p[1], p[2]) * size;
    z += hash(spec.seed + 2, p[0], p[1], p[2]) * size;
  }
  if (spec.twist) {
    const a = spec.twist * t * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    [x, z] = [x * c - z * s, x * s + z * c];
  }
  if (spec.bend) {
    // Curves the height axis into an arc of this angle, in the x direction.
    const a = spec.bend * Math.PI / 180, radius = h / a, angle = a * (y / h), r = radius - x;
    [x, y] = [radius - r * Math.cos(angle), r * Math.sin(angle)];
  }
  return [x, y, z];
}

// Triangles of a shape as flat [x, y, z] × 3 lists, base near y = 0 and centred on the origin.
export function buildPrimitive(values) {
  const spec = primitiveSpec(values);
  const faces = shapeTriangles(spec);
  if (faces.length > PRIMITIVE_MAX_TRIANGLES) throw new Error(`This shape has ${faces.length} triangles; the limit is ${PRIMITIVE_MAX_TRIANGLES}. Use fewer sides or slices.`);
  let low = Infinity;
  const tris = [];
  for (const face of faces) {
    const moved = face.map((p) => deform(p, spec));
    const u = moved[1].map((v, i) => v - moved[0][i]), w = moved[2].map((v, i) => v - moved[0][i]);
    if (Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) < 1e-4) continue;
    for (const p of moved) low = Math.min(low, p[1]);
    tris.push(moved.flat());
  }
  for (const tri of tris) for (let c = 1; c < 9; c += 3) tri[c] -= low;
  return tris;
}

// Wavefront OBJ with one colour on every vertex, which the model importer turns into vertex colours.
export function primitiveOBJ(tris, hex = '#c8c8c8') {
  const rgb = [1, 3, 5].map((at) => (parseInt(hex.slice(at, at + 2), 16) / 255).toFixed(4)).join(' ');
  const lines = ['# Primitive made in MKWii Advanced Editor', 'o primitive'];
  for (const tri of tris) for (let c = 0; c < 9; c += 3) lines.push(`v ${tri[c].toFixed(3)} ${tri[c + 1].toFixed(3)} ${tri[c + 2].toFixed(3)} ${rgb}`);
  for (let t = 0; t < tris.length; t++) lines.push(`f ${t * 3 + 1} ${t * 3 + 2} ${t * 3 + 3}`);
  return lines.join('\n') + '\n';
}
