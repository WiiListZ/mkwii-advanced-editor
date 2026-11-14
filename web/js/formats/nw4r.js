// Shared pieces of the NW4R resources inside a BRRES (CHR0, SRT0, CLR0, PAT0, VIS0, SCN0…): the
// name dictionary and the names a resource writes after its own data, so that each one written
// here stands on its own (wszst then pools the names when it packs the BRRES).

export const bytes = (s) => new TextEncoder().encode(s);
export const aligned = (n, to = 4) => Math.ceil(n / to) * to;

// A descending-bit Patricia dictionary. The branch number is the highest differing bit of the
// names, counting bytes from the start of a name. Node 0 is the root; node i + 1 is names[i].
export function dictionary(names) {
  const nodes = [{ bit: 65535, left: 0, right: 0, text: new Uint8Array() }];
  const bitAt = (text, bit) => ((text[bit >>> 3] || 0) >>> (bit & 7)) & 1;
  for (const name of names) {
    const text = bytes(name); let parent = 0, leaf = nodes[0].left;
    while (nodes[parent].bit > nodes[leaf].bit) {
      parent = leaf; leaf = bitAt(text, nodes[leaf].bit) ? nodes[leaf].right : nodes[leaf].left;
    }
    let bit = -1;
    for (let i = Math.max(text.length, nodes[leaf].text.length) - 1; i >= 0; i--) {
      const diff = (text[i] || 0) ^ (nodes[leaf].text[i] || 0);
      if (diff) { bit = i * 8 + 31 - Math.clz32(diff); break; }
    }
    if (bit < 0 || bit >= 65535) throw new Error(`Invalid or duplicate name: ${name}`);
    parent = 0; let child = nodes[0].left;
    while (nodes[parent].bit > nodes[child].bit && nodes[child].bit > bit) {
      parent = child; child = bitAt(text, nodes[child].bit) ? nodes[child].right : nodes[child].left;
    }
    const index = nodes.length, right = bitAt(text, bit);
    nodes.push({ bit, left: right ? child : index, right: right ? index : child, text });
    if (parent && bitAt(text, nodes[parent].bit)) nodes[parent].right = index;
    else nodes[parent].left = index;
  }
  return nodes;
}

export const groupSize = (count) => 8 + (count + 1) * 16;

// Writes a dictionary at `at`: entries[i] = { name, offset } with offset absolute in the resource;
// nameAt(name) gives the absolute place of a name (after its length word).
export function writeGroup(v, at, entries, nameAt) {
  v.setUint32(at, groupSize(entries.length)); v.setUint32(at + 4, entries.length);
  dictionary(entries.map((e) => e.name)).forEach((node, i) => {
    const e = at + 8 + i * 16;
    v.setUint16(e, node.bit); v.setUint16(e + 2, 0); v.setUint16(e + 4, node.left); v.setUint16(e + 6, node.right);
    if (i) { v.setInt32(e + 8, nameAt(entries[i - 1].name) - at); v.setInt32(e + 12, entries[i - 1].offset - at); }
  });
}

// Names stored after the data: a 32-bit length, the text and a zero, 4-byte aligned.
export class StringPool {
  constructor() { this.places = new Map(); this.list = []; }
  add(text) { if (!this.places.has(text)) { this.places.set(text, -1); this.list.push(text); } }
  // Places the names from `cursor`; returns where they end.
  layout(cursor) {
    for (const text of this.list) {
      if (!text || text.includes('\0')) throw new Error('Invalid resource name');
      this.places.set(text, cursor + 4);
      cursor = aligned(cursor + 4 + bytes(text).length + 1);
    }
    return cursor;
  }
  at(text) { const at = this.places.get(text); if (at === undefined || at < 0) throw new Error(`Name ${text} not placed`); return at; }
  write(out) {
    const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (const [text, at] of this.places) { const encoded = bytes(text); v.setUint32(at - 4, encoded.length); out.set(encoded, at); }
  }
}

// Keyframes as the I12 (float) format: count, padding, frame scale, then frame, value, tangent.
export const keysSize = (keys) => 8 + keys.length * 12;
export function writeKeys(v, at, keys) {
  if (!keys.length || keys.length > 65535) throw new Error('A track needs 1 to 65535 keyframes');
  // The game's own animations repeat a frame for a sudden change, and some start before frame 0.
  for (let i = 0; i < keys.length; i++) if (!Number.isFinite(keys[i].f) || !Number.isFinite(keys[i].v) || (i && keys[i].f < keys[i - 1].f)) throw new Error('Keyframes must be numbers in frame order');
  v.setUint16(at, keys.length); v.setUint16(at + 2, 0);
  const span = keys.at(-1).f - keys[0].f;
  v.setFloat32(at + 4, span > 0 ? 1 / span : 0);
  keys.forEach((k, i) => { v.setFloat32(at + 8 + i * 12, k.f); v.setFloat32(at + 12 + i * 12, k.v); v.setFloat32(at + 16 + i * 12, k.t || 0); });
}

// A track as the editors keep it: { const } or { keys: [{ f, v, t }] }; per-frame (linear) tracks
// become one keyframe per frame with matching tangents.
export function trackKeys(track) {
  if (!track) return null;
  if (track.keys) return track.keys;
  if (track.linear) {
    const a = track.linear;
    return Array.from(a, (value, f) => ({ f, v: value, t: ((a[Math.min(a.length - 1, f + 1)] - a[Math.max(0, f - 1)]) / (f === 0 || f === a.length - 1 ? 1 : 2)) || 0 }));
  }
  return null;
}
export const isConst = (track) => !track || track.const !== undefined || (track.keys && track.keys.length === 1 && !track.keys[0].t);
export const constValue = (track, fallback) => !track ? fallback : track.const !== undefined ? track.const : track.keys ? track.keys[0].v : track.linear ? track.linear[0] : fallback;
