// Yaz0 compression (used by Mario Kart Wii .szs files).
import { decompressSync as decompressLzma } from 'lzma-web/decompress';

export function isYaz0(data) {
  return data.length >= 16 && data[0] === 0x59 && data[1] === 0x61 && data[2] === 0x7A && data[3] === 0x30;
}

export function isWLZ(data) {
  return data.length >= 16 && data[0] === 0x57 && data[1] === 0x4c && data[2] === 0x5a && data[3] === 0x61;
}

export function isWU8(data) {
  return data.length >= 16 && data[0] === 0x57 && data[1] === 0x55 && data[2] === 0x38 && data[3] === 0x61;
}

export function isWBZ(data) {
  return data.length >= 16 && data[0] === 0x57 && data[1] === 0x42 && data[2] === 0x5a && data[3] === 0x61;
}

export function isYBZ(data) {
  return isYaz0(data) && data[16] === 0x42 && data[17] === 0x5a && data[18] === 0x68;
}

export const WLZ_MESSAGE = 'WLZ/WBZ/WU8 decoding may need files from the original Mario Kart Wii Race/Course tracks.';

export function yaz0Decompress(src) {
  if (!isYaz0(src)) throw new Error('File is not Yaz0 compressed');
  const size = ((src[4] << 24) | (src[5] << 16) | (src[6] << 8) | src[7]) >>> 0;
  // YLZ keeps a Yaz0 header but stores an LZMA-alone stream after it. Large Riivolution
  // packs (including Insane Kart Wii) use it for their .szs tracks.
  if (src[16] === 0x5d && src[17] === 0 && src[18] === 0) {
    let decoded;
    try { decoded = decompressLzma(src.subarray(16)); }
    catch (error) { throw new Error(`Corrupted YLZ (LZMA) data: ${error.message}`); }
    if (typeof decoded === 'string') throw new Error('Corrupted YLZ data: expected a binary archive');
    if (decoded.length !== size) throw new Error(`Corrupted YLZ data: expected ${size} bytes, got ${decoded.length}`);
    return decoded;
  }
  if (src[16] === 0x42 && src[17] === 0x5a && src[18] === 0x68)
    throw new Error('YBZ (bzip2) archives are decoded by the desktop backend');
  const dst = new Uint8Array(size);
  let s = 16, d = 0;
  while (d < size) {
    const header = src[s++];
    for (let bit = 0x80; bit && d < size; bit >>= 1) {
      if (header & bit) {
        dst[d++] = src[s++];
      } else {
        const b1 = src[s++], b2 = src[s++];
        const dist = (((b1 & 0x0F) << 8) | b2) + 1;
        let len = b1 >> 4;
        len = len === 0 ? src[s++] + 0x12 : len + 2;
        let from = d - dist;
        if (from < 0) throw new Error('Corrupted Yaz0 data');
        for (let i = 0; i < len && d < size; i++) dst[d++] = dst[from++];
      }
    }
  }
  return dst;
}

const WINDOW = 0x1000;
const MAX_LEN = 0x111;
const HASH_SIZE = 1 << 15;

// LZ compressor with hash chains. level = search depth (higher = smaller output, slower).
export function yaz0Compress(src, level = 64) {
  const n = src.length;
  const out = new Uint8Array(16 + n + Math.ceil(n / 8) + 16);
  out.set([0x59, 0x61, 0x7A, 0x30]);
  out[4] = (n >>> 24) & 0xFF; out[5] = (n >>> 16) & 0xFF; out[6] = (n >>> 8) & 0xFF; out[7] = n & 0xFF;
  let o = 16;

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hash = (p) => (((src[p] << 10) ^ (src[p + 1] << 5) ^ src[p + 2]) & (HASH_SIZE - 1));
  let inserted = 0;
  const insertUpTo = (p) => {
    for (; inserted < p && inserted + 2 < n; inserted++) {
      const h = hash(inserted);
      prev[inserted] = head[h];
      head[h] = inserted;
    }
    if (inserted < p) inserted = p;
  };

  const findMatch = (p) => {
    if (p + 2 >= n) return [0, 0];
    insertUpTo(p);
    let best = 0, bestDist = 0;
    const maxLen = Math.min(MAX_LEN, n - p);
    let cand = head[hash(p)];
    let depth = level;
    while (cand >= 0 && p - cand <= WINDOW && depth-- > 0) {
      if (src[cand + best] === src[p + best]) {
        let l = 0;
        while (l < maxLen && src[cand + l] === src[p + l]) l++;
        if (l > best) { best = l; bestDist = p - cand; if (l === maxLen) break; }
      }
      cand = prev[cand];
    }
    return best >= 3 ? [best, bestDist] : [0, 0];
  };

  let p = 0;
  while (p < n) {
    const headerPos = o++;
    let header = 0;
    for (let bit = 0; bit < 8 && p < n; bit++) {
      let [len, dist] = findMatch(p);
      // Lazy matching: if the next byte gives a clearly better match, emit a literal first.
      if (len > 0 && len < MAX_LEN) {
        const [l2] = findMatch(p + 1);
        if (l2 > len + 1) len = 0;
      }
      if (len === 0) {
        header |= 0x80 >> bit;
        out[o++] = src[p++];
      } else {
        const d = dist - 1;
        if (len >= 0x12) {
          out[o++] = (d >> 8) & 0x0F;
          out[o++] = d & 0xFF;
          out[o++] = len - 0x12;
        } else {
          out[o++] = ((len - 2) << 4) | ((d >> 8) & 0x0F);
          out[o++] = d & 0xFF;
        }
        p += len;
      }
    }
    out[headerPos] = header;
  }
  return out.slice(0, o);
}
