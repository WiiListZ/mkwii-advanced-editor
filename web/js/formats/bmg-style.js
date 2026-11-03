// Native MKWii BMG colour IDs (group 0, tag 1), not arbitrary RGB escapes.
// Palette references: Wiimm's BMG colour table and the original UI glyph-rendering palette
// documented in MKW-SP's GlyphRenderer::setupColors (SP-only colours are deliberately omitted).
export const BMG_COLOURS = [
  { id: 0x00, label: 'Default (layout)', rgba: null },
  { id: 0x02, label: 'White', rgba: [255, 255, 255, 255] },
  { id: 0x32, label: 'Red', rgba: [255, 0, 0, 255] },
  { id: 0x33, label: 'Green', rgba: [0, 186, 0, 255] },
  { id: 0x31, label: 'Blue', rgba: [0, 111, 255, 255] },
  { id: 0x30, label: 'Yellow', rgba: [255, 255, 0, 255] },
  { id: 0x20, label: 'Team red', rgba: [255, 70, 70, 255] },
  { id: 0x21, label: 'Team blue', rgba: [100, 180, 255, 255] },
  { id: 0x40, label: 'Soft red', rgba: [234, 117, 125, 255] },
  { id: 0x01, label: 'Pure red', rgba: [255, 0, 0, 255] },
  ...[255, 218, 182, 145, 109, 73, 36, 0].map((green, i) => ({ id: 0x10 + i, label: `Yellow–red ${i + 1}`, rgba: [255, green, 0, 255] })),
  { id: 0x08, label: 'Transparent', rgba: [255, 255, 255, 0] },
];
const PALETTE = new Map(BMG_COLOURS.map((colour) => [colour.id, colour]));
const COLOUR = /\{1A:08000001([0-9a-f]{4})\}/gi;
const STYLE = /\{1A:080000(?:0000([0-9a-f]{2})|01([0-9a-f]{4}))\}/gi;
const ESCAPE = /\{1A:[0-9a-f]+\}/gi;

export const bmgColour = (id) => PALETTE.get(id)?.rgba || null;
export const bmgColourCode = (id) => `{1A:08000001${id.toString(16).padStart(4, '0')}}`;
export const stripBmgStyles = (text) => text.replace(STYLE, '');
export const stripBmgColours = (text) => text.replace(COLOUR, '');
export const isBmgStyle = (hex) => /^080000(?:0000[0-9a-f]{2}|01[0-9a-f]{4})$/i.test(hex);

export function bmgColourAt(text, at) {
  let colour = 0;
  for (const match of text.matchAll(COLOUR)) {
    if (match.index + match[0].length > at) break;
    colour = parseInt(match[1], 16);
  }
  return colour;
}

// Runs retain scale and colour independently; changing one does not reset the other.
export function bmgStyleRuns(text) {
  const runs = [];
  let at = 0, scale = 1, colour = 0;
  for (const match of text.matchAll(STYLE)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index), scale, colour });
    if (match[1] !== undefined) scale = Math.max(1, parseInt(match[1], 16)) / 100;
    else colour = parseInt(match[2], 16);
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), scale, colour });
  return runs;
}

// Input is the editable body (the leading font-size setting is managed separately by the UI).
// A collapsed selection means the whole message. Existing colour tags inside the target are
// replaced, while icons, size changes, unknown escapes and colours outside it remain intact.
export function bmgSelectionRange(text, selectionStart, selectionEnd) {
  let start = Math.max(0, Math.min(text.length, selectionStart)), end = Math.max(0, Math.min(text.length, selectionEnd));
  if (start > end) [start, end] = [end, start];
  for (const match of text.matchAll(ESCAPE)) {
    const stop = match.index + match[0].length;
    if (start > match.index && start < stop) start = match.index;
    if (end > match.index && end < stop) end = stop;
  }
  const splitsPair = (at) => at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]);
  if (splitsPair(start)) start--;
  if (splitsPair(end)) end++;
  return { start, end };
}

export function colourBmgSelection(text, selectionStart, selectionEnd, id) {
  if (!PALETTE.has(id)) throw new Error('Choose a native game text colour');
  const { start, end } = selectionStart === selectionEnd ? { start: 0, end: text.length } : bmgSelectionRange(text, selectionStart, selectionEnd);
  const before = text.slice(0, start).replace(/(?:\{1A:08000001[0-9a-f]{4}\})+$/gi, '');
  const selected = stripBmgColours(text.slice(start, end)), after = text.slice(end);
  const prefix = id === bmgColourAt(before, before.length) ? '' : bmgColourCode(id);
  const restore = bmgColourAt(text, end);
  const suffix = after && !/^\{1A:08000001[0-9a-f]{4}\}/i.test(after) && restore !== id ? bmgColourCode(restore) : '';
  const value = before + prefix + selected + suffix + after;
  return { text: value, start: before.length + prefix.length, end: before.length + prefix.length + selected.length };
}
