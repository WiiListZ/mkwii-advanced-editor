// Circular fillets in the X/Z plane. The control point remains the corner's
// handle; its two neighbouring segments provide the incoming/outgoing tangents.
// Reserve less than half of either segment so adjacent fillets cannot overlap.
export function curveCorner(points, index) {
  const n = points.length, p = points[index];
  if (n < 3 || !p || !Number.isFinite(p.radius) || p.radius <= 0) return null;
  const previous = points[(index + n - 1) % n], next = points[(index + 1) % n];
  const before = Math.hypot(p.x - previous.x, p.z - previous.z), after = Math.hypot(next.x - p.x, next.z - p.z);
  if (before < 1 || after < 1) return null;
  const incoming = [(p.x - previous.x) / before, (p.z - previous.z) / before];
  const outgoing = [(next.x - p.x) / after, (next.z - p.z) / after];
  const turn = Math.atan2(incoming[0] * outgoing[1] - incoming[1] * outgoing[0], incoming[0] * outgoing[0] + incoming[1] * outgoing[1]);
  if (Math.abs(turn) < .001 || Math.abs(turn) > Math.PI - .001) return null;
  const tangent = Math.tan(Math.abs(turn) / 2), maximum = Math.min(before, after) * .45 / tangent;
  const radius = Math.min(p.radius, maximum), trim = radius * tangent, sign = Math.sign(turn);
  const entry = [p.x - incoming[0] * trim, p.z - incoming[1] * trim];
  const exit = [p.x + outgoing[0] * trim, p.z + outgoing[1] * trim];
  const center = [entry[0] - incoming[1] * sign * radius, entry[1] + incoming[0] * sign * radius];
  return { radius, maximum, entry, exit, center, turn, angle: Math.atan2(entry[1] - center[1], entry[0] - center[0]), before: trim / before, after: trim / after };
}

export function cornerArc(corner, fraction) {
  const angle = corner.angle + corner.turn * fraction;
  return [corner.center[0] + Math.cos(angle) * corner.radius, corner.center[1] + Math.sin(angle) * corner.radius];
}

// Blend the untouched spline into a fillet with matching tangent directions.
// Two rounded endpoints share a straight connector. Y and road width continue
// to use the original interpolation, so a radius edit never invents elevation.
export function roundedSegmentXZ(p, q, tangents, a, b, t) {
  if (a && t <= a.after) return cornerArc(a, .5 + .5 * t / a.after);
  if (b && t >= 1 - b.before) return cornerArc(b, .5 * (t - 1 + b.before) / b.before);
  const start = a ? a.exit : [p.x, p.z], end = b ? b.entry : [q.x, q.z];
  const span = 1 - (a?.after || 0) - (b?.before || 0), u = (t - (a?.after || 0)) / span, u2 = u * u, u3 = u2 * u;
  return [0, 1].map((k) => {
    const chord = k === 0 ? q.x - p.x : q.z - p.z;
    const m1 = (a ? chord : tangents[0][k]) * span, m2 = (b ? chord : tangents[1][k]) * span;
    return (2 * u3 - 3 * u2 + 1) * start[k] + (-2 * u3 + 3 * u2) * end[k] + (u3 - 2 * u2 + u) * m1 + (u3 - u2) * m2;
  });
}
