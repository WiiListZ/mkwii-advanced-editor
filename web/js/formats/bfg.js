// A track's fog (posteffect/posteffect.bfg): four entries of 0x1C bytes. Entry 0 is the one the original
// tracks without fog areas set up, and an AREA of type 2 swaps to the entry in its setting 1.
// Fields not understood are kept as they are.

export const BFG_ENTRIES = 4;
const ENTRY_SIZE = 0x1C;

export const FOG_TYPES = [
  [0, 'No fog'],
  [1, 'Linear'], [2, 'Exponential'], [3, 'Exponent squared'], [4, 'Inverse exponent'], [5, 'Inverse exponent squared'],
  [6, 'Linear (orthographic)'], [7, 'Exponential (orthographic)'], [8, 'Exponent squared (orthographic)'], [9, 'Inverse exponent (orthographic)'], [10, 'Inverse exponent squared (orthographic)'],
];

// What each kind does, for the editor. The counts are of the settings in use on the game's own tracks.
export const FOG_KIND_HELP = {
  0: 'This setting has no fog.',
  1: 'Grows at an even rate from Starts at to Thickest at.',
  2: 'Grows fast just after Starts at, then slowly: it thickens early. 10 of the 53 fog settings of the original tracks.',
  3: 'Stays thin for a moment after Starts at, then grows fast and levels off.',
  4: 'Stays thin for most of the way and grows fast just before Thickest at: clear near you, thick far away. The usual one: 32 of the 53 fog settings of the original tracks.',
  5: 'Like inverse exponent, but it starts rising earlier and eases into its full thickness. 10 of the 53 fog settings of the original tracks.',
  6: 'Linear, for a camera without perspective. The picture here shows it as the plain kind. Only one fog setting of the original tracks uses one of these.',
  7: 'Exponential, for a camera without perspective. The picture here shows it as the plain kind.',
  8: 'Exponent squared, for a camera without perspective. The picture here shows it as the plain kind.',
  9: 'Inverse exponent, for a camera without perspective. The picture here shows it as the plain kind.',
  10: 'Inverse exponent squared, for a camera without perspective. The picture here shows it as the plain kind.',
};

export const FOG_HELP = {
  settings: 'A track has four fog settings. Original tracks use Fog 0 as the track\'s fog, and the others only show inside an area that swaps to them.',
  kind: 'How the fog grows between Starts at and Thickest at. It does not change where those are, only how it gets from one to the other.',
  colour: 'What the fog fades things into. Usually close to the colour of the sky at the horizon, so that far things seem to melt into it.',
  start: 'How far from the camera the fog begins, in track units. Nearer than this there is none. Lower it for more fog close to you. In the middle of the original tracks\' values: 20,000. A negative value starts it behind the camera.',
  end: 'How far from the camera the fog covers everything in its colour, in track units. This is the main control of how much fog there is: lower means more. Keep it above Starts at. The usual value on the original tracks is 500,000.',
  fade: 'How long the change takes when an area swaps to this fog, in frames; the game runs 60 a second. 1 is at once, and 0 is the game\'s own 33 seconds. The usual value on the original tracks is 20. The picture here does not show it: it only happens in the game.',
  range: 'Evens the fog out across the screen, so that things at its sides get the same fog as things at the same distance in the middle. On in 41 of the 53 fog settings of the original tracks. The picture here does not show it: it only happens in the game.',
  areas: 'An area of type Fog Swap changes to the fog in its first setting while a kart is inside it. Adding one puts it at the centre of the view, to move and size in the 3D view.',
  view: 'Where the picture is taken from: where the 3D view is looking now, or just behind the start line, about where a player sees the track from.',
};

export const emptyFogEntry = () => ({ type: 0, start: 0, end: 100000, color: [255, 255, 255], colorExtra: 0, rangeCorrection: 0, center: 0, fade: 1, extra: [0, 0] });

export function parseBFG(data) {
  if (data.length < ENTRY_SIZE * BFG_ENTRIES) throw new Error('This fog file is too short');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: BFG_ENTRIES }, (_, i) => {
    const at = i * ENTRY_SIZE;
    return {
      type: view.getInt32(at), start: view.getFloat32(at + 4), end: view.getFloat32(at + 8),
      color: [data[at + 0x0C], data[at + 0x0D], data[at + 0x0E]], colorExtra: data[at + 0x0F],
      rangeCorrection: view.getUint16(at + 0x10), center: view.getUint16(at + 0x12),
      fade: view.getFloat32(at + 0x14), extra: [view.getUint16(at + 0x18), view.getUint16(at + 0x1A)],
    };
  });
}

// original: what the file held beyond the entries, kept when there is any.
export function buildBFG(entries, original = null) {
  const out = new Uint8Array(Math.max(ENTRY_SIZE * BFG_ENTRIES, original?.length || 0));
  if (original) out.set(original);
  const view = new DataView(out.buffer);
  entries.slice(0, BFG_ENTRIES).forEach((entry, i) => {
    const at = i * ENTRY_SIZE;
    view.setInt32(at, entry.type);
    view.setFloat32(at + 4, entry.start);
    view.setFloat32(at + 8, entry.end);
    out.set([...entry.color, entry.colorExtra ?? 0], at + 0x0C);
    view.setUint16(at + 0x10, entry.rangeCorrection);
    view.setUint16(at + 0x12, entry.center ?? 0);
    view.setFloat32(at + 0x14, entry.fade);
    view.setUint16(at + 0x18, entry.extra?.[0] ?? 0);
    view.setUint16(at + 0x1A, entry.extra?.[1] ?? 0);
  });
  return out;
}

// The fade is stored as one over its length in frames; 0 means the game's own 33 seconds.
export const fadeFrames = (fade) => fade > 0 ? Math.round(1 / fade) : 0;
export const fadeValue = (frames) => frames > 0 ? 1 / frames : 0;

// How much of the fog's colour shows at a distance, 0 to 1, by the console's formulas.
export function fogAmount(type, start, end, distance) {
  if (type <= 0) return 0;
  const shape = ((type - 1) % 5) + 1;
  const f = Math.max(0, Math.min(1, (distance - start) / ((end - start) || 1)));
  if (shape === 1) return f;
  if (shape === 2) return 1 - 2 ** (-8 * f);
  if (shape === 3) return 1 - 2 ** (-8 * f * f);
  if (shape === 4) return 2 ** (-8 * (1 - f));
  return 2 ** (-8 * (1 - f) * (1 - f));
}
