// BRSTM music streams (files/sound/strm) and the GameCube/Wii DSP-ADPCM codec they use.
// Read, decode to PCM, and write new streams (encoded to DSP-ADPCM) with the same track layout.

const clamp16 = (v) => (v < -32768 ? -32768 : v > 32767 ? 32767 : v);

// ---- DSP-ADPCM ----------------------------------------------------------------------------------
// 8-byte frames of 14 samples: header (predictor << 4 | scale exponent), then 14 signed nibbles.
// Each sample = (nibble * 2^scale * 2048 + 1024 + c1 * hist1 + c2 * hist2) >> 11.
export function decodeDSP(data, offset, samples, coefs, state = { h1: 0, h2: 0 }, out = new Int16Array(samples), outOffset = 0) {
  let { h1, h2 } = state;
  for (let i = 0; i < samples; i++) {
    const frame = Math.floor(i / 14), at = i % 14;
    const p = offset + frame * 8;
    const ps = data[p];
    const c1 = coefs[(ps >> 4) * 2], c2 = coefs[(ps >> 4) * 2 + 1], scale = 1 << (ps & 15);
    const byte = data[p + 1 + (at >> 1)];
    let n = at & 1 ? byte & 15 : byte >> 4;
    if (n >= 8) n -= 16;
    const s = clamp16(((n * scale) << 11) + 1024 + c1 * h1 + c2 * h2 >> 11);
    out[outOffset + i] = s;
    h2 = h1; h1 = s;
  }
  state.h1 = h1; state.h2 = h2;
  return out;
}

// Eight predictor coefficient pairs for a channel, in 11-bit fixed point. Frames are grouped by the
// pair that predicts them best and each pair is refitted by least squares over its frames (Lloyd
// iterations); each frame's statistics are normalised by its energy, since the ADPCM scale adapts
// to loudness anyway.
export function dspCoefficients(pcm) {
  const stats = [];
  for (let f = 0; f * 14 < pcm.length; f++) {
    let r00 = 0, r11 = 0, r22 = 0, r12 = 0, r01 = 0, r02 = 0;
    for (let i = f * 14; i < Math.min(pcm.length, f * 14 + 14); i++) {
      const x = pcm[i], a = i > 0 ? pcm[i - 1] : 0, b = i > 1 ? pcm[i - 2] : 0;
      r00 += x * x; r11 += a * a; r22 += b * b; r12 += a * b; r01 += x * a; r02 += x * b;
    }
    if (r00 < 16) continue;
    const n = 1 / (r00 + r11 + 1);
    stats.push([r00 * n, r11 * n, r22 * n, r12 * n, r01 * n, r02 * n]);
  }
  const fit = (list) => {
    const t = [0, 0, 0, 0, 0, 0];
    for (const st of list) for (let k = 0; k < 6; k++) t[k] += st[k];
    const [, r11, r22, r12, r01, r02] = t;
    const det = r11 * r22 - r12 * r12;
    if (Math.abs(det) < 1e-12) return r11 > 1e-12 ? [Math.max(-15.9, Math.min(15.9, r01 / r11)), 0] : [0, 0];
    const a = (r01 * r22 - r02 * r12) / det, b = (r02 * r11 - r01 * r12) / det;
    return [Math.max(-15.9, Math.min(15.9, a)), Math.max(-15.9, Math.min(15.9, b))];
  };
  const err = ([a, b], st) => st[0] - 2 * a * st[4] - 2 * b * st[5] + a * a * st[1] + 2 * a * b * st[3] + b * b * st[2];
  let centers = [fit(stats)];
  // Split until 8 pairs, refining after each split.
  while (centers.length < 8) {
    centers = centers.flatMap(([a, b]) => [[a * 1.01 + 0.01, b * 1.01 - 0.01], [a * 0.99 - 0.01, b * 0.99 + 0.01]]).slice(0, 8);
    for (let round = 0; round < 10; round++) {
      const groups = centers.map(() => []);
      for (const st of stats) {
        let best = 0, bestE = Infinity;
        centers.forEach((c, k) => { const e = err(c, st); if (e < bestE) { bestE = e; best = k; } });
        groups[best].push(st);
      }
      centers = centers.map((c, k) => (groups[k].length ? fit(groups[k]) : c));
    }
  }
  const coefs = new Int16Array(16);
  centers.forEach(([a, b], k) => { coefs[k * 2] = clamp16(Math.round(a * 2048)); coefs[k * 2 + 1] = clamp16(Math.round(b * 2048)); });
  return coefs;
}

// Encodes PCM to DSP-ADPCM frames: every frame tries the 8 predictors and the scales that fit,
// keeping the one with the smallest error (the decoder's own history is used, so errors don't drift).
export function encodeDSP(pcm, coefs) {
  const frames = Math.ceil(pcm.length / 14);
  const out = new Uint8Array(frames * 8);
  let h1 = 0, h2 = 0;
  const nib = new Int8Array(14), best = new Int8Array(14);
  for (let f = 0; f < frames; f++) {
    let bestErr = Infinity, bestPs = 0, bestH1 = 0, bestH2 = 0;
    for (let p = 0; p < 8; p++) {
      const c1 = coefs[p * 2], c2 = coefs[p * 2 + 1];
      // Smallest scale that fits the largest prediction error of the frame.
      let maxErr = 0, a = h1, b = h2;
      for (let i = 0; i < 14; i++) {
        const x = pcm[f * 14 + i] ?? 0;
        const pred = (c1 * a + c2 * b + 1024) >> 11;
        maxErr = Math.max(maxErr, Math.abs(x - pred));
        b = a; a = x;
      }
      let scale = 0;
      while (scale < 12 && (maxErr >> scale) > 7) scale++;
      for (let s = Math.max(0, scale - 1); s <= Math.min(11, scale + 1); s++) {
        let err = 0, y1 = h1, y2 = h2;
        for (let i = 0; i < 14; i++) {
          const x = pcm[f * 14 + i] ?? 0;
          const pred = c1 * y1 + c2 * y2 + 1024;
          let n = Math.round((x * 2048 - pred) / (2048 << s));
          n = n < -8 ? -8 : n > 7 ? 7 : n;
          const y = clamp16(((n << s) << 11) + pred >> 11);
          nib[i] = n;
          err += (x - y) ** 2;
          y2 = y1; y1 = y;
          if (err >= bestErr) break;
        }
        if (err < bestErr) { bestErr = err; bestPs = (p << 4) | s; best.set(nib); bestH1 = y1; bestH2 = y2; }
      }
    }
    out[f * 8] = bestPs;
    for (let i = 0; i < 14; i += 2) out[f * 8 + 1 + i / 2] = ((best[i] & 15) << 4) | (best[i + 1] & 15);
    h1 = bestH1; h2 = bestH2;
  }
  return out;
}

// ---- BRSTM ----------------------------------------------------------------------------------------
class Reader {
  constructor(d) { this.d = d; this.v = new DataView(d.buffer, d.byteOffset, d.byteLength); }
  u8(o) { return this.d[o]; }
  u16(o) { return this.v.getUint16(o); }
  s16(o) { return this.v.getInt16(o); }
  u32(o) { return this.v.getUint32(o); }
}

export function parseBRSTM(data) {
  const r = new Reader(data);
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'RSTM') throw new Error('Not a BRSTM stream');
  const head = r.u32(0x10), adpc = r.u32(0x18), dataSection = r.u32(0x20);
  const base = head + 8;
  const p1 = base + r.u32(head + 0x0c), p2 = base + r.u32(head + 0x14), p3 = base + r.u32(head + 0x1c);
  const info = {
    codec: r.u8(p1), loop: !!r.u8(p1 + 1), channels: r.u8(p1 + 2), sampleRate: r.u16(p1 + 4),
    loopStart: r.u32(p1 + 8), samples: r.u32(p1 + 12), dataOffset: r.u32(p1 + 16), blocks: r.u32(p1 + 20),
    blockSize: r.u32(p1 + 24), blockSamples: r.u32(p1 + 28), lastBlockSize: r.u32(p1 + 32), lastBlockSamples: r.u32(p1 + 36),
    lastBlockPadded: r.u32(p1 + 40),
  };
  const trackCount = r.u8(p2), trackType = r.u8(p2 + 1);
  const tracks = [];
  for (let t = 0; t < trackCount; t++) {
    const tp = base + r.u32(p2 + 4 + t * 8 + 4);
    const q = trackType === 1 ? tp + 8 : tp;
    const count = r.u8(q);
    tracks.push({ volume: trackType === 1 ? r.u8(tp) : 127, pan: trackType === 1 ? r.u8(tp + 1) : 64, channels: Array.from({ length: count }, (_, i) => r.u8(q + 1 + i)) });
  }
  const channelInfo = [];
  for (let c = 0; c < info.channels; c++) {
    const cp = base + r.u32(p3 + 4 + c * 8 + 4);
    const ap = base + r.u32(cp + 4);
    const coefs = new Int16Array(16);
    for (let i = 0; i < 16; i++) coefs[i] = r.s16(ap + i * 2);
    channelInfo.push({ coefs, ps: r.u16(ap + 0x22), loopPs: r.u16(ap + 0x28), loopH1: r.s16(ap + 0x2a), loopH2: r.s16(ap + 0x2c) });
  }
  return { ...info, trackType, tracks, channelInfo, adpcOffset: adpc, dataSection, data };
}

// PCM of every channel (Int16Array each).
export function decodeBRSTM(stream) {
  const { data, channels, samples, blocks, blockSize, blockSamples, lastBlockPadded, dataOffset, codec } = stream;
  const out = Array.from({ length: channels }, () => new Int16Array(samples));
  const states = Array.from({ length: channels }, () => ({ h1: 0, h2: 0 }));
  let at = dataOffset;
  for (let b = 0; b < blocks; b++) {
    const last = b === blocks - 1;
    const size = last ? lastBlockPadded : blockSize;
    const count = last ? samples - b * blockSamples : blockSamples;
    for (let c = 0; c < channels; c++) {
      if (codec === 2) decodeDSP(data, at, count, stream.channelInfo[c].coefs, states[c], out[c], b * blockSamples);
      else if (codec === 1) { const v = new DataView(data.buffer, data.byteOffset + at, count * 2); for (let i = 0; i < count; i++) out[c][b * blockSamples + i] = v.getInt16(i * 2); }
      else for (let i = 0; i < count; i++) out[c][b * blockSamples + i] = ((data[at + i] << 24) >> 24) * 256;
      at += size;
    }
  }
  return out;
}

// Changes the loop without re-encoding DSP-ADPCM or disturbing track/channel data.
export function setBRSTMLoop(data, loop, loopStart) {
  const stream = parseBRSTM(data);
  if (!Number.isInteger(loopStart) || loopStart < 0 || loopStart >= stream.samples)
    throw new Error('Loop start must be inside the stream');
  const out = data.slice(), r = new Reader(out), v = r.v;
  const head = r.u32(0x10), base = head + 8;
  const p1 = base + r.u32(head + 0x0c), p3 = base + r.u32(head + 0x1c);
  out[p1 + 1] = loop ? 1 : 0;
  v.setUint32(p1 + 8, loopStart);
  if (stream.codec === 2) {
    const block = Math.floor(loopStart / stream.blockSamples);
    const inBlock = loopStart - block * stream.blockSamples;
    const frame = Math.floor(inBlock / 14);
    const blockBytes = block === stream.blocks - 1 ? stream.lastBlockPadded : stream.blockSize;
    const pcm = decodeBRSTM(stream);
    for (let c = 0; c < stream.channels; c++) {
      const cp = base + r.u32(p3 + 4 + c * 8 + 4);
      const ap = base + r.u32(cp + 4);
      const frameOffset = stream.dataOffset + block * stream.blockSize * stream.channels + c * blockBytes + frame * 8;
      if (frameOffset >= data.length) throw new Error('Invalid BRSTM loop frame');
      v.setUint16(ap + 0x28, data[frameOffset]);
      v.setInt16(ap + 0x2a, loopStart ? pcm[c][loopStart - 1] : 0);
      v.setInt16(ap + 0x2c, loopStart > 1 ? pcm[c][loopStart - 2] : 0);
    }
  }
  return out;
}

const align = (n, a) => Math.ceil(n / a) * a;

// Writes a DSP-ADPCM BRSTM. `channels`: Int16Array per channel; `tracks`: [{ volume, pan, channels }].
export function buildBRSTM({ channels, sampleRate, loop = true, loopStart = 0, tracks = null, trackType = 1 }) {
  const count = channels.length, samples = channels[0].length;
  tracks = tracks || [{ volume: 127, pan: 64, channels: channels.map((_, i) => i) }];
  const blockSamples = 0x3800, blockSize = 0x2000;
  const blocks = Math.max(1, Math.ceil(samples / blockSamples));
  const lastSamples = samples - (blocks - 1) * blockSamples;
  const lastSize = Math.ceil(lastSamples / 14) * 8, lastPadded = align(lastSize, 0x20);
  const encoded = channels.map((pcm) => { const coefs = dspCoefficients(pcm); return { coefs, frames: encodeDSP(pcm, coefs) }; });
  // Decoder history at each block start (seek table) and at the loop start.
  const history = encoded.map(({ coefs, frames }) => {
    const pcm = decodeDSP(frames, 0, samples, coefs);
    const at = (i) => (i > 0 ? pcm[i - 1] : 0);
    return {
      seek: Array.from({ length: blocks }, (_, b) => [at(b * blockSamples), at(b * blockSamples - 1)]),
      loop: [at(loopStart), at(loopStart - 1)],
    };
  });

  // HEAD
  const part1 = 0x34, part2Header = 4 + tracks.length * 8;
  const trackSize = (t) => (trackType === 1 ? 8 : 0) + align(1 + t.channels.length, 4);
  const part2Size = part2Header + tracks.reduce((s, t) => s + trackSize(t), 0);
  const part3Header = 4 + count * 8;
  const headBody = 0x18 + part1 + part2Size + part3Header + count * (8 + 0x30);
  const headSize = align(8 + headBody, 0x20);
  const adpcSize = align(8 + blocks * count * 4, 0x20);
  const dataStart = 0x40 + headSize + adpcSize;
  const dataBytes = (blocks - 1) * blockSize * count + lastPadded * count;
  const dataSize = align(0x20 + dataBytes, 0x20);
  const total = dataStart + dataSize;
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  const str = (o, s) => [...s].forEach((ch, i) => { out[o + i] = ch.charCodeAt(0); });
  str(0, 'RSTM'); v.setUint16(4, 0xfeff); v.setUint16(6, 0x0100); v.setUint32(8, total); v.setUint16(12, 0x40); v.setUint16(14, 2);
  v.setUint32(0x10, 0x40); v.setUint32(0x14, headSize); v.setUint32(0x18, 0x40 + headSize); v.setUint32(0x1c, adpcSize);
  v.setUint32(0x20, dataStart); v.setUint32(0x24, dataSize);

  const head = 0x40, base = head + 8;
  str(head, 'HEAD'); v.setUint32(head + 4, headSize);
  const ref = (o, target) => { v.setUint32(o, 0x01000000); v.setUint32(o + 4, target - base); };
  const p1 = base + 0x18, p2 = p1 + part1, p3 = p2 + part2Size;
  ref(base, p1); ref(base + 8, p2); ref(base + 16, p3);
  out[p1] = 2; out[p1 + 1] = loop ? 1 : 0; out[p1 + 2] = count; v.setUint16(p1 + 4, sampleRate);
  v.setUint32(p1 + 8, loopStart); v.setUint32(p1 + 12, samples); v.setUint32(p1 + 16, dataStart + 0x20);
  v.setUint32(p1 + 20, blocks); v.setUint32(p1 + 24, blockSize); v.setUint32(p1 + 28, blockSamples);
  v.setUint32(p1 + 32, lastSize); v.setUint32(p1 + 36, lastSamples); v.setUint32(p1 + 40, lastPadded);
  v.setUint32(p1 + 44, blockSamples); v.setUint32(p1 + 48, 4);
  out[p2] = tracks.length; out[p2 + 1] = trackType;
  let tp = p2 + part2Header;
  tracks.forEach((t, i) => {
    v.setUint32(p2 + 4 + i * 8, (trackType === 1 ? 0x01000000 : 0) | (trackType << 8)); v.setUint32(p2 + 4 + i * 8 + 4, tp - base);
    let q = tp;
    if (trackType === 1) { out[tp] = t.volume; out[tp + 1] = t.pan; q = tp + 8; }
    out[q] = t.channels.length;
    t.channels.forEach((c, k) => { out[q + 1 + k] = c; });
    tp += trackSize(t);
  });
  out[p3] = count;
  encoded.forEach(({ coefs, frames }, c) => {
    const cp = p3 + part3Header + c * (8 + 0x30), ap = cp + 8;
    ref(p3 + 4 + c * 8, cp);
    ref(cp, ap);
    coefs.forEach((k, i) => v.setInt16(ap + i * 2, k));
    v.setUint16(ap + 0x22, frames[0]);
    const loopFrame = Math.floor(loopStart / 14);
    v.setUint16(ap + 0x28, frames[loopFrame * 8] ?? 0);
    v.setInt16(ap + 0x2a, history[c].loop[0]); v.setInt16(ap + 0x2c, history[c].loop[1]);
  });

  // ADPC: per block, per channel, history (sample before the block, and the one before it).
  const adpc = 0x40 + headSize;
  str(adpc, 'ADPC'); v.setUint32(adpc + 4, adpcSize);
  for (let b = 0; b < blocks; b++) for (let c = 0; c < count; c++) {
    const o = adpc + 8 + (b * count + c) * 4;
    v.setInt16(o, history[c].seek[b][0]); v.setInt16(o + 2, history[c].seek[b][1]);
  }

  // DATA: blocks interleaved by channel.
  str(dataStart, 'DATA'); v.setUint32(dataStart + 4, dataSize); v.setUint32(dataStart + 8, 0x18);
  let at = dataStart + 0x20;
  for (let b = 0; b < blocks; b++) {
    const last = b === blocks - 1;
    const bytes = last ? lastSize : blockSize;
    for (let c = 0; c < count; c++) {
      out.set(encoded[c].frames.subarray(b * blockSize, b * blockSize + bytes), at);
      at += last ? lastPadded : blockSize;
    }
  }
  return out;
}
