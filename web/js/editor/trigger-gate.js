// Trigger gates: collision that a kart drives through, as the game's Sound Triggers (0x18) and Effect
// Triggers (0x1A) are used ("activates when the player passes through it", mkwiiki's KCL flag page).
// Painted on the road, the road would stop being road there; a gate is a new upright rectangle across
// the road instead, which leaves the road as it is. Nintendo's tracks do the same: their Sound Triggers
// are upright one-sided gates, in pairs about 200 apart, the first facing ahead (for karts going back)
// and the second facing the karts with the new variant.

export const GATE_TYPES = new Set([0x18, 0x1a]);

// Where the road ends sideways: walls of every kind, fall boundaries and solid falls.
const EDGE_TYPES = new Set([0x0a, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x14, 0x19, 0x1c, 0x1e, 0x1f]);

// The gate across the road at `point` for karts going along `direction` ([x, z]): from one edge of
// the road to the other, found by stepping sideways and looking for the ground below with
// groundAt(x, y, z) -> { y, type, normalY } | null. It stops at a wall, a drop or a step, a steep
// slope, or where there is no ground; then a margin. From below the road to above a kart in the air.
export function gateAcross(point, direction, groundAt, { step = 100, most = 8000, margin = 150, below = 300, above = 1500, least = 500 } = {}) {
  const length = Math.hypot(direction[0], direction[1]) || 1;
  const along = [direction[0] / length, direction[1] / length];
  const side = [-along[1], along[0]];
  const reach = (sign) => {
    let lastY = point[1], distance = 0, low = point[1], high = point[1];
    for (let s = step; s <= most; s += step) {
      const x = point[0] + side[0] * s * sign, z = point[2] + side[1] * s * sign;
      const ground = groundAt(x, lastY, z);
      if (!ground || EDGE_TYPES.has(ground.type) || ground.normalY < 0.6 || Math.abs(ground.y - lastY) > 250) break;
      lastY = ground.y; distance = s;
      low = Math.min(low, ground.y); high = Math.max(high, ground.y);
    }
    return { distance: Math.max(least, distance + margin), low, high };
  };
  const left = reach(-1), right = reach(1);
  const bottom = Math.min(left.low, right.low) - below, top = Math.max(left.high, right.high) + above;
  const at = (sign, d) => [point[0] + side[0] * d * sign, point[2] + side[1] * d * sign];
  const [lx, lz] = at(-1, left.distance), [rx, rz] = at(1, right.distance);
  return {
    width: left.distance + right.distance,
    along,
    corners: [[lx, bottom, lz], [rx, bottom, rz], [rx, top, rz], [lx, top, lz]],
  };
}

// The way karts go at `point` ([x, y, z]): along the nearest point of the enemy routes (ENPT groups),
// from the point before it to the one after, as [dx, dz]; null when no route point is within
// `maxDistance`.
export function routeDirection(enpt, point, maxDistance = 6000) {
  let best = null, bestDistance = Infinity;
  for (const group of enpt || []) {
    const points = group.points || [];
    if (points.length < 2) continue;
    points.forEach((p, i) => {
      const distance = Math.hypot(p.pos[0] - point[0], p.pos[2] - point[2]);
      if (distance >= bestDistance) return;
      const a = points[Math.max(0, i - 1)].pos, b = points[Math.min(points.length - 1, i + 1)].pos;
      bestDistance = distance; best = [b[0] - a[0], b[2] - a[2]];
    });
  }
  return best && bestDistance < maxDistance ? best : null;
}

// Which way a trigger piece faces, from its triangles' normal (sum) and the way karts go there:
// "toward" (crossed going forward), "ahead" (crossed by karts driving back), "flat" (crossed from
// above or below), "sideways", or "upright" when no route says the way.
export function gateFacing(normal, direction) {
  const length = Math.hypot(...normal) || 1, ny = normal[1] / length;
  if (Math.abs(ny) > 0.5) return 'flat';
  if (!direction) return 'upright';
  const d = Math.hypot(direction[0], direction[1]) || 1, h = Math.hypot(normal[0], normal[2]) || 1;
  const dot = (normal[0] * direction[0] + normal[2] * direction[1]) / d / h;
  return dot < -0.5 ? 'toward' : dot > 0.5 ? 'ahead' : 'sideways';
}

// How far before the gate the one for karts going back stands: Nintendo's own pairs are about 200
// apart along the road.
export const BACK_GATE_GAP = 200;

// The gate's triangles, 2 triangles of 9 numbers. Collision faces one way, as Nintendo's gates do:
// "toward" faces the karts coming along the road (the gate they cross going forward), "ahead" faces
// the way they go (the one karts going back cross).
export function gateTriangles(corners, facing = "toward") {
  const [a, b, c, d] = corners;
  return (facing === "ahead" ? [[a, c, b], [a, d, c]] : [[a, b, c], [a, c, d]]).map((tri) => tri.flat());
}

// The triangles of a trigger gate as Nintendo places them: the gate with `variant`, facing the karts;
// with `back` (a variant number), first a gate facing ahead, BACK_GATE_GAP before it, for karts going
// back (it brings back what was there before). Going forward a kart meets the back gate first and this
// one last, so it ends with `variant` either way. Returns [{ tri, variant }].
export function gatePair(gate, variant, back = null) {
  const out = gateTriangles(gate.corners, "toward").map((tri) => ({ tri, variant }));
  if (back === null || back === undefined) return out;
  const [dx, dz] = [-gate.along[0] * BACK_GATE_GAP, -gate.along[1] * BACK_GATE_GAP];
  const behind = gate.corners.map(([x, y, z]) => [x + dx, y, z + dz]);
  return [...gateTriangles(behind, "ahead").map((tri) => ({ tri, variant: back })), ...out];
}
