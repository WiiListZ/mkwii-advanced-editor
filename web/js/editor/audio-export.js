// More export formats for the sound editor: MP3 (LAME, through lamejs), AIFF, and AAC in an M4A
// file (the browser's AAC encoder, WebCodecs, with a small MP4 writer). WAV and FLAC are in
// audio.js, Ogg Opus in ogg-opus.js.

import { Mp3Encoder } from '@breezystack/lamejs';

// ---- MP3 -------------------------------------------------------------------------------------------
// Sample rates an MP3 can have; others are resampled to the next one up before encoding.
export const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
export const mp3Rate = (rate) => MP3_RATES.find((r) => r >= rate) || 48000;

// Int16 channels (1 or 2) at one of MP3_RATES.
export function encodeMP3(channels, sampleRate, kbps = 192) {
  if (!MP3_RATES.includes(sampleRate)) throw new RangeError(`MP3 cannot store ${sampleRate} Hz`);
  const count = Math.min(2, channels.length);
  const encoder = new Mp3Encoder(count, sampleRate, kbps);
  const parts = [];
  const block = 1152 * 8;
  for (let at = 0; at < channels[0].length; at += block) {
    const left = channels[0].subarray(at, at + block);
    const out = count === 2 ? encoder.encodeBuffer(left, channels[1].subarray(at, at + block)) : encoder.encodeBuffer(left);
    if (out.length) parts.push(Uint8Array.from(out));
  }
  const end = encoder.flush();
  if (end.length) parts.push(Uint8Array.from(end));
  return concat(parts);
}

// ---- AIFF ------------------------------------------------------------------------------------------
// Int16 channels, big-endian PCM; the sample rate is an 80-bit extended float.
export function encodeAIFF(channels, sampleRate) {
  const count = channels.length, frames = channels[0].length, data = frames * count * 2;
  const out = new Uint8Array(54 + data), v = new DataView(out.buffer);
  const str = (o, s) => [...s].forEach((c, i) => { out[o + i] = c.charCodeAt(0); });
  str(0, 'FORM'); v.setUint32(4, 46 + data); str(8, 'AIFF');
  str(12, 'COMM'); v.setUint32(16, 18); v.setUint16(20, count); v.setUint32(22, frames); v.setUint16(26, 16);
  writeExtended(v, 28, sampleRate);
  str(38, 'SSND'); v.setUint32(42, 8 + data); v.setUint32(46, 0); v.setUint32(50, 0);
  for (let i = 0, o = 54; i < frames; i++) for (let c = 0; c < count; c++, o += 2) v.setInt16(o, channels[c][i]);
  return out;
}

function writeExtended(v, at, value) {
  // Whole sample rates only: exponent and a 64-bit mantissa with the leading 1 explicit.
  const exponent = Math.floor(Math.log2(value));
  v.setUint16(at, 16383 + exponent);
  const mantissa = BigInt(Math.round(value)) << BigInt(63 - exponent);
  v.setBigUint64(at + 2, mantissa);
}

// ---- AAC (M4A) -------------------------------------------------------------------------------------
export const AAC_RATE = 48000;

export async function aacSupported(channels = 2) {
  if (typeof AudioEncoder === 'undefined') return false;
  try { return !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: AAC_RATE, numberOfChannels: channels, bitrate: 192000 })).supported; }
  catch { return false; }
}

// Float32 channels (1 or 2) at 48 kHz.
export async function encodeM4A(channels, { bitrate = 192000 } = {}) {
  if (!(await aacSupported(Math.min(2, channels.length)))) throw new Error('AAC encoding is not available on this computer');
  const count = Math.min(2, channels.length), frames = channels[0].length;
  const samples = [];
  let config = null, failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const d = meta?.decoderConfig?.description;
      if (d && !config) config = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer, d.byteOffset || 0, d.byteLength);
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      samples.push(bytes);
    },
    error: (e) => { failure = e; },
  });
  encoder.configure({ codec: 'mp4a.40.2', sampleRate: AAC_RATE, numberOfChannels: count, bitrate, aac: { format: 'aac' } });
  const step = 4800;
  for (let at = 0; at < frames; at += step) {
    const n = Math.min(step, frames - at);
    const planar = new Float32Array(n * count);
    for (let c = 0; c < count; c++) planar.set(channels[c].subarray(at, at + n), c * n);
    encoder.encode(new AudioData({ format: 'f32-planar', sampleRate: AAC_RATE, numberOfFrames: n, numberOfChannels: count, timestamp: Math.round(at * 1e6 / AAC_RATE), data: planar }));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return muxM4A(samples, { sampleRate: AAC_RATE, channels: count, config: config || audioSpecificConfig(AAC_RATE, count), bitrate });
}

// AAC-LC AudioSpecificConfig, when the encoder does not give one.
export function audioSpecificConfig(rate, channels) {
  const index = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(rate);
  return Uint8Array.of((2 << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3));
}

// An MP4 audio file with one AAC track: every frame (1024 samples) in one chunk of mdat.
export function muxM4A(frames, { sampleRate, channels, config, bitrate }) {
  const duration = frames.length * 1024;
  const u8 = (...b) => Uint8Array.of(...b);
  const u16 = (n) => u8(n >> 8 & 255, n & 255);
  const u32 = (n) => u8(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
  const text = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  const box = (type, ...parts) => { const body = concat(parts); return concat([u32(8 + body.length), text(type), body]); };
  const full = (type, version, flags, ...parts) => box(type, u8(version, flags >> 16 & 255, flags >> 8 & 255, flags & 255), ...parts);
  const matrix = concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const descriptor = (tag, ...parts) => { const body = concat(parts); return concat([u8(tag, 0x80, 0x80, 0x80, body.length), body]); };
  const esds = full('esds', 0, 0, descriptor(0x03, u16(1), u8(0),
    descriptor(0x04, u8(0x40, 0x15, 0, 0x18, 0), u32(bitrate), u32(bitrate), descriptor(0x05, config)),
    descriptor(0x06, u8(0x02))));
  const mp4a = box('mp4a', new Uint8Array(6), u16(1), new Uint8Array(8), u16(channels), u16(16), u16(0), u16(0), u32(sampleRate << 16 >>> 0), esds);
  const sizes = concat(frames.map((f) => u32(f.length)));
  const stbl = (offset) => box('stbl',
    full('stsd', 0, 0, u32(1), mp4a),
    full('stts', 0, 0, u32(1), u32(frames.length), u32(1024)),
    full('stsc', 0, 0, u32(1), u32(1), u32(frames.length), u32(1)),
    full('stsz', 0, 0, u32(0), u32(frames.length), sizes),
    full('stco', 0, 0, u32(1), u32(offset)));
  const moov = (offset) => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(sampleRate), u32(duration), u32(0x10000), u16(0x100), new Uint8Array(10), matrix, new Uint8Array(24), u32(2)),
    box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(duration), new Uint8Array(8), u16(0), u16(1), u16(0x100), u16(0), matrix, u32(0), u32(0)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(sampleRate), u32(duration), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), text('soun'), new Uint8Array(12), text('SoundHandler\0')),
        box('minf',
          full('smhd', 0, 0, u16(0), u16(0)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          stbl(offset)))));
  const ftyp = box('ftyp', text('M4A '), u32(0), text('M4A '), text('isom'), text('mp42'));
  const head = ftyp.length + moov(0).length + 8;
  const data = concat(frames);
  return concat([ftyp, moov(head), u32(8 + data.length), text('mdat'), data]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
