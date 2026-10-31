// THP movies (thp/**/*.thp): the videos of the menus, the course previews of the cup selection, the
// title and the ending. A THP is a header, a component list (video and optional ADPCM audio) and a
// chain of frames; each frame holds its own and the next frame's size, one size per component, then
// the component data, padded to 32 bytes. Video frames are baseline JPEG (4:2:0) written without
// byte stuffing: an 0xFF inside the compressed data is not followed by 0x00 as JPEG requires.
//
// Header (big-endian): 'THP\0', version (0x00011000 = 1.1), largest frame size, largest audio samples
// per frame, frame rate (float), frame count, first frame size, size of all frames, component list
// offset, frame offset table offset (0 = none), first frame offset, last frame offset.

export function isTHP(data) {
  return data?.length >= 0x30 && data[0] === 0x54 && data[1] === 0x48 && data[2] === 0x50 && data[3] === 0;
}

export function parseTHP(data) {
  if (!isTHP(data)) throw new Error('Not a THP movie');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = v.getUint32(4);
  const header = {
    version, maxBufferSize: v.getUint32(8), maxAudioSamples: v.getUint32(0x0c), fps: v.getFloat32(0x10), frameCount: v.getUint32(0x14),
    firstFrameSize: v.getUint32(0x18), dataSize: v.getUint32(0x1c), componentsOffset: v.getUint32(0x20), offsetsOffset: v.getUint32(0x24),
    firstFrameOffset: v.getUint32(0x28), lastFrameOffset: v.getUint32(0x2c),
  };
  const c = header.componentsOffset, count = v.getUint32(c);
  const types = [...data.subarray(c + 4, c + 4 + count)];
  let at = c + 20;
  let video = null, audio = null;
  for (const type of types) {
    if (type === 0) {
      video = { width: v.getUint32(at), height: v.getUint32(at + 4), type: version >= 0x11000 ? v.getUint32(at + 8) : 0 };
      at += version >= 0x11000 ? 12 : 8;
    } else if (type === 1) {
      audio = { channels: v.getUint32(at), frequency: v.getUint32(at + 4), samples: v.getUint32(at + 8), tracks: version >= 0x11000 ? v.getUint32(at + 12) : 1 };
      at += version >= 0x11000 ? 16 : 12;
    } else throw new Error(`Unknown THP component type ${type}`);
  }
  if (!video) throw new Error('This THP has no video');
  const frames = [];
  let offset = header.firstFrameOffset, size = header.firstFrameSize;
  for (let i = 0; i < header.frameCount; i++) {
    if (offset + 8 + count * 4 > data.length) throw new Error(`THP frame ${i} is outside the file`);
    const sizes = types.map((_, k) => v.getUint32(offset + 8 + k * 4));
    const parts = [];
    let p = offset + 8 + count * 4;
    for (const s of sizes) { parts.push([p, s]); p += s; }
    frames.push({ offset, size, parts });
    const next = v.getUint32(offset);
    offset += size;
    size = next;
  }
  return { data, header, types, video, audio, frames };
}

// Video data of frame i as the game stores it.
export function thpVideoData(thp, i) {
  const frame = thp.frames[i];
  const [at, size] = frame.parts[thp.types.indexOf(0)];
  return thp.data.subarray(at, at + size);
}

// Start of the compressed scan data (after the SOS segment) and its end (before EOI).
function scanRange(jpeg) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG image');
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) throw new Error('Broken JPEG segment');
    const marker = jpeg[i + 1];
    if (marker === 0xff) { i++; continue; }
    const length = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xda) {
      let end = jpeg.length;
      while (end > i + 2 && !(jpeg[end - 2] === 0xff && jpeg[end - 1] === 0xd9)) end--;
      return { start: i + 2 + length, end: end - 2 };
    }
    i += 2 + length;
  }
  throw new Error('JPEG without image data');
}

// A THP frame as a standard JPEG that any decoder reads: every 0xFF of the scan data is stuffed.
export function thpFrameToJPEG(frame) {
  const { start, end } = scanRange(frame);
  let extra = 0;
  for (let k = start; k < end; k++) if (frame[k] === 0xff) extra++;
  const out = new Uint8Array(end + extra + 2);
  out.set(frame.subarray(0, start));
  let o = start;
  for (let k = start; k < end; k++) { out[o++] = frame[k]; if (frame[k] === 0xff) out[o++] = 0; }
  out[o++] = 0xff; out[o] = 0xd9;
  return out;
}

// A standard JPEG (for example from a canvas) as a THP frame: APPn and COM segments are left out
// and the stuffing after 0xFF is removed. Only baseline 3-component 4:2:0 images are accepted,
// which is what the game's decoder reads; restart markers are not allowed either.
export function jpegToTHPFrame(jpeg, width, height) {
  const { start, end } = scanRange(jpeg);
  const head = [0xff, 0xd8];
  let i = 2;
  while (i < start) {
    const marker = jpeg[i + 1], length = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xdd) throw new Error('JPEG with restart markers');
    if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) throw new Error('Only baseline JPEG can be used in a THP');
    if (marker === 0xc0) {
      const h = (jpeg[i + 5] << 8) | jpeg[i + 6], w = (jpeg[i + 7] << 8) | jpeg[i + 8], comps = jpeg[i + 9];
      if (w !== width || h !== height) throw new Error(`JPEG is ${w}×${h}, the movie is ${width}×${height}`);
      if (comps !== 3 || jpeg[i + 11] !== 0x22 || jpeg[i + 14] !== 0x11 || jpeg[i + 17] !== 0x11) throw new Error('THP frames must be colour JPEG with 4:2:0 subsampling');
    }
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) head.push(...jpeg.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  const out = [];
  for (let k = start; k < end; k++) {
    if (jpeg[k] === 0xff) {
      const next = jpeg[k + 1];
      if (next === 0x00) { out.push(0xff); k++; continue; }
      if (next >= 0xd0 && next <= 0xd7) throw new Error('JPEG with restart markers');
    }
    out.push(jpeg[k]);
  }
  // The original frames keep their video data a multiple of 4 bytes long (zeros after EOI).
  const bytes = [...head, ...out, 0xff, 0xd9];
  while (bytes.length % 4) bytes.push(0);
  return Uint8Array.from(bytes);
}

const pad32 = (n) => (n + 31) & ~31;

// The movie with new video frames (THP frame data, one per frame; null keeps a frame as it is).
// Audio and everything before the first frame are kept. The header gets the new sizes.
export function buildTHP(thp, videoFrames) {
  const videoIndex = thp.types.indexOf(0);
  const head = thp.data.subarray(0, thp.header.firstFrameOffset);
  const built = thp.frames.map((frame, i) => {
    const parts = frame.parts.map(([at, size], k) => (k === videoIndex && videoFrames[i] ? videoFrames[i] : thp.data.subarray(at, at + size)));
    const raw = 8 + parts.length * 4 + parts.reduce((n, p) => n + p.length, 0);
    return { parts, size: pad32(raw) };
  });
  const total = head.length + built.reduce((n, f) => n + f.size, 0);
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  out.set(head);
  let at = head.length, last = 0;
  built.forEach((frame, i) => {
    v.setUint32(at, built[(i + 1) % built.length].size);
    v.setUint32(at + 4, built[(i - 1 + built.length) % built.length].size);
    frame.parts.forEach((p, k) => v.setUint32(at + 8 + k * 4, p.length));
    let p = at + 8 + frame.parts.length * 4;
    for (const part of frame.parts) { out.set(part, p); p += part.length; }
    last = at;
    at += frame.size;
  });
  v.setUint32(8, Math.max(...built.map((f) => f.size)));
  v.setUint32(0x18, built[0].size);
  v.setUint32(0x1c, total - head.length);
  v.setUint32(0x2c, last);
  return out;
}

// Parts of the menu movies that show one track, cup or arena each: { label, x, y, width, height }.
// Measured on the original files; `slots` are course IDs (see js/data/cups.js) in the same order.
const strips = (slots) => slots.map((slot, i) => ({ slot, x: 0, y: i * 144, width: 400, height: 144 }));
const battle = (slots) => slots.map((slot, i) => ({ slot, x: i < 3 ? 0 : 336, y: (i % 3) * 250, width: 336, height: 250 }));
export const THP_LAYOUTS = {
  'course/kinoko.thp': { title: 'Mushroom Cup tracks', cup: 0, regions: strips([0x08, 0x01, 0x02, 0x04]) },
  'course/flower.thp': { title: 'Flower Cup tracks', cup: 1, regions: strips([0x00, 0x05, 0x06, 0x07]) },
  'course/star.thp': { title: 'Star Cup tracks', cup: 2, regions: strips([0x09, 0x0f, 0x0b, 0x03]) },
  'course/special.thp': { title: 'Special Cup tracks', cup: 3, regions: strips([0x0e, 0x0a, 0x0c, 0x0d]) },
  'course/koura.thp': { title: 'Shell Cup tracks', cup: 4, regions: strips([0x10, 0x14, 0x19, 0x1a]) },
  'course/banana.thp': { title: 'Banana Cup tracks', cup: 5, regions: strips([0x1b, 0x1f, 0x17, 0x12]) },
  'course/konoha.thp': { title: 'Leaf Cup tracks', cup: 6, regions: strips([0x15, 0x1e, 0x1d, 0x11]) },
  'course/thunder.thp': { title: 'Lightning Cup tracks', cup: 7, regions: strips([0x18, 0x16, 0x13, 0x1c]) },
  'course/cup_select.thp': {
    title: 'Cup selection', regions: [0, 1, 2, 3, 4, 5, 6, 7].map((cup) => ({ cup, x: cup < 4 ? 0 : 336, y: (cup % 4) * 180, width: 336, height: 180 })),
  },
  'battle/battle_wii.thp': { title: 'Wii battle stages', cup: 8, regions: battle([0x21, 0x20, 0x23, 0x22, 0x24]) },
  'battle/battle_retro.thp': { title: 'Retro battle stages', cup: 9, regions: battle([0x27, 0x28, 0x29, 0x25, 0x26]) },
  'battle/battle_cup_select.thp': { title: 'Battle stage selection', regions: [8, 9].map((cup, i) => ({ cup, x: 0, y: i * 264, width: 336, height: 264 })) },
};

export const THP_TITLES = {
  'battle/battle_select.thp': 'Balloon Battle and Coin Runners', 'button/class_top.thp': 'Engine class', 'button/drift_select.thp': 'Drift type',
  'button/indiv_team.thp': 'Solo or team', 'button/multi_top.thp': 'Multiplayer menu', 'button/single_top.thp': 'Single player menu',
  'title/title.thp': 'Title screen', 'title/title_50.thp': 'Title screen (50 Hz)', 'title/title_SD.thp': 'Title screen (SD)', 'title/title_SD_50.thp': 'Title screen (SD, 50 Hz)',
  'title/top_menu.thp': 'Main menu background', 'ending/ending_normal.thp': 'Ending', 'ending/ending_normal_50.thp': 'Ending (50 Hz)',
  'ending/ending_true.thp': 'True ending', 'ending/ending_true_50.thp': 'True ending (50 Hz)',
};

// Layout of a movie from its path ("…\thp\course\kinoko.thp" -> course/kinoko.thp).
export function thpLayout(path) {
  const key = path.replace(/\\/g, '/').split('/').slice(-2).join('/').toLowerCase();
  const entry = Object.entries(THP_LAYOUTS).find(([k]) => k.toLowerCase() === key);
  return entry ? { key: entry[0], ...entry[1] } : null;
}
