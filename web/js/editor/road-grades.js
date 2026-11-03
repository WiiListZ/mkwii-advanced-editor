// Bound changes of grade as well as the grade itself. Limiting only the slope
// still leaves sharp crests that launch karts at ordinary racing speeds.
// Project onto local grade/curvature constraints, retaining the flat grid and
// the ordering/clearance of overlapping road branches.
export function smoothRoadGrades(samples, params, clearancePairs = []) {
  const n = samples.length;
  if (n < 3) return;
  const y = Float64Array.from(samples, (s) => s[1]);
  const fixed = Uint8Array.from(samples, (s) => s[4] === 1 ? 1 : 0);
  const run = Float64Array.from(samples, (s, i) => Math.max(1, Math.hypot(samples[(i + 1) % n][0] - s[0], samples[(i + 1) % n][2] - s[2])));
  const clearance = params.wallHeight + 800;
  const pairs = clearancePairs.map(([i, j]) => y[i] > y[j] ? [i, j] : [j, i]);
  const curvature = .00005, maxSlope = .28;
  for (let pass = 0; pass < 12000; pass++) {
    let largest = 0;
    for (let k = 0; k < n; k++) {
      const i = pass & 1 ? k : n - 1 - k, a = (i + n - 1) % n, b = (i + 1) % n;
      const ca = 1 / run[a], cb = 1 / run[i], ci = -ca - cb;
      const limit = curvature * (run[a] + run[i]) / 2;
      const value = y[a] * ca + y[i] * ci + y[b] * cb;
      const error = value > limit ? value - limit : value < -limit ? value + limit : 0;
      if (error) {
        const weight = (fixed[a] ? 0 : ca * ca) + (fixed[i] ? 0 : ci * ci) + (fixed[b] ? 0 : cb * cb);
        if (weight) {
          const delta = error / weight;
          if (!fixed[a]) y[a] -= delta * ca;
          if (!fixed[i]) y[i] -= delta * ci;
          if (!fixed[b]) y[b] -= delta * cb;
          largest = Math.max(largest, Math.abs(error) / -ci);
        }
      }
      const grade = y[b] - y[i], slopeLimit = maxSlope * run[i];
      const excess = grade > slopeLimit ? grade - slopeLimit : grade < -slopeLimit ? grade + slopeLimit : 0;
      if (excess) {
        const weight = 2 - fixed[i] - fixed[b];
        if (weight) {
          if (!fixed[i]) y[i] += excess / weight;
          if (!fixed[b]) y[b] -= excess / weight;
          largest = Math.max(largest, Math.abs(excess));
        }
      }
    }
    for (const [upper, lower] of pairs) {
      const need = clearance - y[upper] + y[lower], weight = 2 - fixed[upper] - fixed[lower];
      if (need <= 0 || !weight) continue;
      if (!fixed[upper]) y[upper] += need / weight;
      if (!fixed[lower]) y[lower] -= need / weight;
      largest = Math.max(largest, need);
    }
    if (largest < .01) break;
  }
  for (let i = 0; i < n; i++) samples[i][1] = y[i];
}
