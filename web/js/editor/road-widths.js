// Round the width profile while remaining below every clearance limit. First
// take the minimum over a neighbourhood, then blur over the same neighbourhood.
// Every contributing minimum includes this sample, so the result cannot grow
// past its safe width (ordinary blur alone would make edges fold again).
export function smoothRoadWidths(frames, widths, options = {}) {
  const n = frames.length;
  if (n < 3) return;
  const run = frames.map((f, i) => Math.max(1, Math.hypot(frames[(i + 1) % n].c[0] - f.c[0], frames[(i + 1) % n].c[2] - f.c[2])));
  const reach = Math.min(options.reach || 2800, run.reduce((a, b) => a + b, 0) / 4);
  const neighbours = frames.map((_, i) => {
    const near = [[i, 1]];
    for (const direction of [-1, 1]) {
      let at = i, distance = 0;
      for (let count = 1; count < n / 2; count++) {
        const next = (at + direction + n) % n;
        distance += run[direction > 0 ? at : next];
        if (distance >= reach) break;
        near.push([next, (1 - (distance / reach) ** 2) ** 3]); at = next;
      }
    }
    return near;
  });
  const filter = (profile, maximum = false) => {
    const envelope = neighbours.map((near) => [0, 1].map((side) => near.reduce((v, [j]) => maximum ? Math.max(v, profile[j][side]) : Math.min(v, profile[j][side]), maximum ? 0 : Infinity)));
    return neighbours.map((near) => {
      const total = near.reduce((sum, [, weight]) => sum + weight, 0);
      return [0, 1].map((side) => near.reduce((sum, [j, weight]) => sum + envelope[j][side] * weight, 0) / total);
    });
  };
  const limits = filter(options.limits || widths);
  // The dual operation gives a smooth apron at least as wide as the grid.
  const floors = options.floors ? filter(options.floors, true) : null;
  // Preserve the person's width profile where there is room. Smooth min/max
  // round the handover to a safety limit or apron without eroding Width ×.
  const blend = (a, b, maximum) => {
    const band = Math.max(.001, Math.min(600, Math.min(a, b) * 2));
    const h = Math.max(0, 1 - Math.abs(a - b) / band), round = h * h * h * band / 6;
    return maximum ? Math.max(a, b) + round : Math.min(a, b) - round;
  };
  for (let i = 0; i < n; i++) for (let side = 0; side < 2; side++) {
    if (!options.limits) { widths[i][side] = Math.min(widths[i][side], limits[i][side]); continue; }
    const desired = floors?.[i][side] > 0 ? blend(widths[i][side], floors[i][side], true) : widths[i][side];
    widths[i][side] = Math.max(0, Math.min(options.limits[i][side], blend(desired, limits[i][side], false)));
  }
}
