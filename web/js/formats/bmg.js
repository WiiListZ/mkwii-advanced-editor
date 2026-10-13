// BMG message files (MESGbmg1), the game's text: message/Common.bmg, Menu.bmg, Race.bmg…
// inside Scene/UI/<scene>_<language>.szs. Mario Kart Wii uses UTF-16 big-endian text.
//
// Sections: INF1 (per message: offset into DAT1 + attribute bytes), DAT1 (the strings),
// MID1 (message IDs). Escape sequences (0x1A, size byte, data) insert colours, button icons,
// player names, numbers… They are kept byte for byte and shown in the text as {1A:hex}, where the
// hex starts with the size byte.

const ESC = /\{1A:([0-9a-fA-F]+)\}/g;
const align = (n, a) => (n + a - 1) & ~(a - 1);

export function isBMG(data) {
  return data?.length >= 0x20 && String.fromCharCode(...data.subarray(0, 8)) === 'MESGbmg1';
}

export function parseBMG(data) {
  if (!isBMG(data)) throw new Error('Not a BMG message file');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const encoding = data[0x10];
  if (encoding !== 2) throw new Error(`Unsupported BMG text encoding ${encoding} (only UTF-16 is used by Mario Kart Wii)`);
  const sections = [];
  let o = 0x20;
  for (let i = 0; i < dv.getUint32(0x0c) && o + 8 <= data.length; i++) {
    const magic = String.fromCharCode(...data.subarray(o, o + 4)), size = dv.getUint32(o + 4);
    sections.push({ magic, offset: o, size, bytes: data.slice(o, o + size) });
    if (!size) break;
    o += size;
  }
  const inf = sections.find((s) => s.magic === 'INF1'), dat = sections.find((s) => s.magic === 'DAT1'), mid = sections.find((s) => s.magic === 'MID1');
  if (!inf || !dat) throw new Error('BMG without INF1/DAT1');
  const count = dv.getUint16(inf.offset + 8), entrySize = dv.getUint16(inf.offset + 10);
  const datStart = dat.offset + 8;
  const messages = [];
  for (let i = 0; i < count; i++) {
    const e = inf.offset + 16 + i * entrySize;
    const offset = dv.getUint32(e);
    const id = mid ? dv.getUint32(mid.offset + 16 + i * 4) : i;
    messages.push({ id, attributes: data.slice(e + 4, e + entrySize), text: decodeString(data, dv, datStart + offset, dat.offset + dat.size) });
  }
  return { data, sections, entrySize, infHeader: data.slice(inf.offset + 8, inf.offset + 16), messages };
}

function decodeString(data, dv, p, end) {
  let s = '';
  while (p + 1 < end) {
    const c = dv.getUint16(p);
    if (c === 0) break;
    if (c === 0x1a) {
      const size = data[p + 2];
      s += `{1A:${[...data.subarray(p + 2, p + Math.max(3, size))].map((b) => b.toString(16).padStart(2, '0')).join('')}}`;
      p += Math.max(3, size);
      continue;
    }
    s += String.fromCharCode(c);
    p += 2;
  }
  return s;
}

function encodeString(text) {
  const out = [];
  let last = 0;
  const pushText = (t) => { for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); out.push(c >> 8, c & 0xff); } };
  for (const m of text.matchAll(ESC)) {
    pushText(text.slice(last, m.index));
    const bytes = m[1].match(/../g).map((h) => parseInt(h, 16));
    bytes[0] = bytes.length + 2; // the size byte counts the 0x1A character too
    out.push(0x00, 0x1a, ...bytes);
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  out.push(0, 0);
  return out;
}

// Rebuilds the file with new texts ({ id: text }); everything else is kept as it was.
export function buildBMG(bmg, changes) {
  const texts = bmg.messages.map((m) => (Object.prototype.hasOwnProperty.call(changes, m.id) ? changes[m.id] : m.text));
  if (texts.every((t, i) => t === bmg.messages[i].text)) return bmg.data;

  // DAT1: an empty string first (shared by every empty message), then each text once.
  const dat = [0, 0], offsets = [], seen = new Map();
  for (const t of texts) {
    if (!t) { offsets.push(0); continue; }
    if (seen.has(t)) { offsets.push(seen.get(t)); continue; }
    seen.set(t, dat.length);
    offsets.push(dat.length);
    dat.push(...encodeString(t));
  }
  const sections = [];
  for (const s of bmg.sections) {
    if (s.magic === 'INF1') {
      const size = align(16 + bmg.messages.length * bmg.entrySize, 32);
      const b = new Uint8Array(size), v = new DataView(b.buffer);
      b.set(s.bytes.subarray(0, 16));
      v.setUint32(4, size);
      bmg.messages.forEach((m, i) => { v.setUint32(16 + i * bmg.entrySize, offsets[i]); b.set(m.attributes, 16 + i * bmg.entrySize + 4); });
      sections.push(b);
    } else if (s.magic === 'DAT1') {
      const size = align(8 + dat.length, 32);
      const b = new Uint8Array(size);
      b.set(s.bytes.subarray(0, 4));
      new DataView(b.buffer).setUint32(4, size);
      b.set(dat, 8);
      sections.push(b);
    } else sections.push(s.bytes);
  }
  const total = 0x20 + sections.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  out.set(bmg.data.subarray(0, 0x20));
  new DataView(out.buffer).setUint32(8, total);
  let o = 0x20;
  for (const b of sections) { out.set(b, o); o += b.length; }
  return out;
}

// Text without escape sequences, for lists and search.
export const plainText = (text) => text.replace(/\{1A:0800000000[0-9a-f]{2}\}/gi, '').replace(ESC, '◆');

// MKWii's 0x1A group 0, tag 0 scales the following text (0x64 = 100%).
const FONT_SIZE_PREFIX = /^\{1A:0800000000([0-9a-fA-F]{2})\}/;
export function fontSizePercent(text) {
  return parseInt(text.match(FONT_SIZE_PREFIX)?.[1] || '64', 16);
}
export function stripFontSizePrefix(text) {
  return text.replace(FONT_SIZE_PREFIX, '');
}
export function setFontSizePercent(text, percent) {
  const body = stripFontSizePrefix(text);
  const size = Math.max(1, Math.min(255, Math.round(percent)));
  return size === 100 ? body : `{1A:0800000000${size.toString(16).padStart(2, '0')}}${body}`;
}

// Escape sequences of a text, in order: { start, end, bytes }.
export function escapes(text) {
  return [...text.matchAll(ESC)].map((m) => ({ start: m.index, end: m.index + m[0].length, bytes: m[1].match(/../g).map((h) => parseInt(h, 16)) }));
}

// Where a message is shown in the game, from its file and ID (ranges of the original files).
const RANGES = {
  Common: [
    [0x2328, 0x2381, 'Character name'], [0x2382, 0x23ef, 'Vehicle name'], [0x23f0, 0x2453, 'Cup name'],
    [0x2454, 0x2486, 'Track name'], [0x2487, 0x248f, 'Mode name'], [0x2490, 0x24b7, 'Track name'], [0x24b8, 0x24ff, 'Battle arena name'],
    [0x2500, 0x25ff, 'Players, scores and ranks'], [0x2600, 0x27ff, 'System message'],
  ],
  Race: [
    [0x3e8, 0x44e, 'Menu after a race'], [0x44f, 0x4b2, 'Message during a race'], [0x4b3, 0x516, 'Results screen'],
    [0x517, 0x57f, 'Positions and scores'], [0x580, 0x5dd, 'Race information'], [0x5de, 0x7ff, 'Controls'],
  ],
};
const FILE_PLACE = { Common: 'Names used everywhere', Menu: 'Menus', Race: 'Races and results', Number: 'Numbers' };
export function messagePlace(file, id) {
  const r = (RANGES[file] || []).find(([a, b]) => id >= a && id <= b);
  return r ? r[2] : FILE_PLACE[file] || file;
}

// Only IDs with a known, specific menu placement get a contextual screen preview.
// The broad Race/Menu ranges describe content, but do not identify a single UI slot.
export function messageScene(file, id) {
  if (file !== 'Common') return null;
  if (id >= 0x2328 && id <= 0x2381) return 'character';
  if (id >= 0x2382 && id <= 0x23ef) return 'vehicle';
  if (id >= 0x23f0 && id <= 0x2453) return 'cup';
  if ((id >= 0x2454 && id <= 0x2486) || (id >= 0x2490 && id <= 0x24b7)) return 'track';
  if (id >= 0x24b8 && id <= 0x24ff) return 'arena';
  return null;
}
