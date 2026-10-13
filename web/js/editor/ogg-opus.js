// Ogg Opus files from PCM, with the browser's Opus encoder (WebCodecs AudioEncoder) and a small
// Ogg muxer. Input: Float32Array channels at 48 kHz (1 or 2 channels).

const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i << 24;
  for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  CRC[i] = c >>> 0;
}
const crc32 = (b) => { let c = 0; for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 255]) >>> 0; return c; };

function page(packets, { granule, serial, sequence, first = false, last = false }) {
  const lacing = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const body = packets.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + body), v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53]); // OggS
  out[5] = (first ? 2 : 0) | (last ? 4 : 0);
  v.setBigUint64(6, BigInt(granule), true);
  v.setUint32(14, serial, true); v.setUint32(18, sequence, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) { out.set(p, at); at += p.length; }
  v.setUint32(22, crc32(out), true);
  return out;
}

export async function encodeOggOpus(channels, { bitrate = 160000, inputRate = 48000 } = {}) {
  if (typeof AudioEncoder === 'undefined') throw new Error('Opus encoding is not available in this window');
  const count = Math.min(2, channels.length), frames = channels[0].length;
  const packets = [];
  let preSkip = 312;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && d.byteLength >= 12) preSkip = new DataView(d instanceof ArrayBuffer ? d : d.buffer).getUint16(10, true);
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push({ bytes, samples: Math.round((chunk.duration || 20000) * 48000 / 1e6) });
    },
    error: (e) => { throw e; },
  });
  encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: count, bitrate });
  const step = 4800;
  for (let at = 0; at < frames; at += step) {
    const n = Math.min(step, frames - at);
    const planar = new Float32Array(n * count);
    for (let c = 0; c < count; c++) planar.set(channels[c].subarray(at, at + n), c * n);
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: count, timestamp: Math.round(at * 1e6 / 48000), data: planar }));
  }
  await encoder.flush();
  encoder.close();

  const serial = (Math.random() * 0xffffffff) >>> 0;
  const head = new Uint8Array(19), hv = new DataView(head.buffer);
  head.set([...'OpusHead'].map((c) => c.charCodeAt(0)));
  head[8] = 1; head[9] = count; hv.setUint16(10, preSkip, true); hv.setUint32(12, inputRate, true);
  const vendor = [...'MKWii Advanced Editor'].map((c) => c.charCodeAt(0));
  const tags = new Uint8Array(8 + 4 + vendor.length + 4), tv = new DataView(tags.buffer);
  tags.set([...'OpusTags'].map((c) => c.charCodeAt(0))); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12);
  const pages = [page([head], { granule: 0, serial, sequence: 0, first: true }), page([tags], { granule: 0, serial, sequence: 1 })];
  let granule = 0, sequence = 2, batch = [], segments = 0;
  const end = preSkip + frames;
  packets.forEach((p, i) => {
    const segs = Math.floor(p.bytes.length / 255) + 1;
    if (segments + segs > 255) { pages.push(page(batch, { granule: Math.min(granule, end), serial, sequence: sequence++ })); batch = []; segments = 0; }
    batch.push(p.bytes); segments += segs; granule += p.samples;
    if (i === packets.length - 1) pages.push(page(batch, { granule: end, serial, sequence: sequence++, last: true }));
  });
  const total = pages.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pages) { out.set(p, at); at += p.length; }
  return out;
}
