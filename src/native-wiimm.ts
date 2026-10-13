// Reads Wiimm compression wrappers and reconstructs WU8 using object files from
// the user's own Mario Kart Wii tracks. No game data is distributed with the app.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
// @ts-ignore - seek-bzip has no TypeScript declarations.
import Bunzip from "seek-bzip";
import { decompressSync as decompressLzma } from "lzma-web/decompress";
// @ts-ignore - shared browser module.
import { isYaz0, isYBZ, isWBZ, isWLZ, isWU8, yaz0Decompress } from "../web/js/formats/yaz0.js";
// @ts-ignore - shared browser module.
import { isU8, listFiles, parseU8 } from "../web/js/formats/u8.js";
import { WU8_REQUIRED_FILES } from "./wu8-required.ts";

const number = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at);
const magic = (data: Uint8Array) => String.fromCharCode(...data.subarray(0, 4));
const sourceCache = new Map<string, Promise<Map<string, Uint8Array>>>();

export function decompressWiimm(bytes: Uint8Array): Uint8Array {
  if (isYBZ(bytes)) {
    const expected = number(bytes, 4);
    const result = new Uint8Array(Bunzip.decode(Buffer.from(bytes.subarray(16)), expected));
    if (result.length !== expected) throw new Error("Corrupted YBZ archive: wrong decompressed size");
    return result;
  }
  if (isWBZ(bytes)) {
    if (bytes.length < 16) throw new Error("Truncated WBZ archive");
    return new Uint8Array(Bunzip.decode(Buffer.from(bytes.subarray(16))));
  }
  if (isWLZ(bytes)) {
    if (bytes.length < 29) throw new Error("Truncated WLZ archive");
    const result = decompressLzma(bytes.subarray(16));
    if (typeof result === "string") throw new Error("Corrupted WLZ archive: expected binary data");
    return result;
  }
  return isYaz0(bytes) ? yaz0Decompress(bytes) : bytes;
}

function courseDir(paths: string[]) {
  for (const path of paths) {
    if (!path) continue;
    const p = resolve(path);
    const candidates = /common\.szs$/i.test(p) ? [join(dirname(p), "Course")] :
      /[\\/]Race[\\/]Course$/i.test(p) ? [p] : [join(p, "Race", "Course"), join(p, "Course")];
    for (const dir of candidates)
      if (existsSync(join(dir, "beginner_course.szs")) && existsSync(join(dir, "rainbow_course.szs"))) return dir;
  }
  return null;
}

async function originalFiles(dir: string): Promise<Map<string, Uint8Array>> {
  let pending = sourceCache.get(dir);
  if (!pending) {
    pending = (async () => {
      const files = new Map<string, Uint8Array>();
      for (const entry of await readdir(dir)) {
        if (!/\.szs$/i.test(entry)) continue;
        let archive: Uint8Array;
        try { archive = decompressWiimm(new Uint8Array(await readFile(join(dir, entry)))); }
        catch { continue; }
        if (!isU8(archive)) continue;
        for (const file of listFiles(parseU8(archive))) {
          const name = file.path.toLowerCase();
          if (WU8_REQUIRED_FILES.has(name) && !files.has(name)) files.set(name, file.node.data);
        }
      }
      return files;
    })();
    sourceCache.set(dir, pending);
    pending.catch(() => sourceCache.delete(dir));
  }
  return pending;
}

type Entry = { path: string; offset: number; size: number };
function wu8Entries(data: Uint8Array): { base: number; entries: Entry[] } {
  if (!isWU8(data) || data.length < 0x20) throw new Error("Invalid WU8 archive");
  const base = ((data.length >>> 24) ^ (data.length >>> 16) ^ (data.length >>> 8) ^ data.length) & 0xff;
  const root = number(data, 4), fstSize = number(data, 8);
  if (root < 0x20 || root + fstSize > data.length || fstSize < 13) throw new Error("Corrupted WU8 file table");
  for (let i = root; i < root + fstSize; i++) data[i] ^= base;
  const total = number(data, root + 8), stringBase = root + total * 12;
  if (total < 1 || stringBase > root + fstSize) throw new Error("Corrupted WU8 node table");
  const readName = (offset: number) => {
    const start = stringBase + offset;
    if (start >= root + fstSize) throw new Error("Corrupted WU8 name offset");
    let end = start;
    while (end < root + fstSize && data[end]) end++;
    if (end === root + fstSize) throw new Error("Unterminated WU8 file name");
    return new TextDecoder().decode(data.subarray(start, end));
  };
  const entries: Entry[] = [], dirs: { path: string; end: number }[] = [];
  for (let i = 0; i < total; i++) {
    while (dirs.length && i >= dirs.at(-1)!.end) dirs.pop();
    const at = root + i * 12, first = number(data, at);
    const name = readName(first & 0xffffff);
    const parent = dirs.at(-1)?.path || "";
    const path = name === "." ? parent : (parent ? `${parent}/${name}` : name);
    if (first >>> 24 === 1) {
      const end = number(data, at + 8);
      if (end <= i || end > total) throw new Error("Corrupted WU8 directory");
      dirs.push({ path, end });
    } else {
      const offset = number(data, at + 4), size = number(data, at + 8);
      if (offset + size > data.length) throw new Error("Corrupted WU8 file offset");
      entries.push({ path, offset, size });
    }
  }
  return { base, entries };
}

export async function decodeWiimmNative(bytes: Uint8Array, settingsDir: string, sourcePaths: string[]): Promise<Uint8Array> {
  const data = decompressWiimm(bytes).slice();
  if (isU8(data)) return data;
  if (!isWU8(data)) throw new Error(`Expected a U8/WU8 archive, got ${magic(data) || "empty data"}`);
  const { base, entries } = wu8Entries(data);
  const required = entries.filter((entry) => WU8_REQUIRED_FILES.has(entry.path.toLowerCase()));
  const originals = courseDir(sourcePaths);
  const keys = originals ? await originalFiles(originals) : new Map<string, Uint8Array>();
  let summary = base;
  const applyKey = (entry: Entry, key: Uint8Array) => {
    if (!key.length) throw new Error(`Original game file is empty: ${entry.path}`);
    summary ^= key[Math.floor(key.length / 2)] ^ key[Math.floor(key.length / 3)] ^ key[Math.floor(key.length / 4)];
    for (let i = 0; i < entry.size; i++) data[entry.offset + i] ^= base ^ key[i % key.length];
  };
  for (const entry of required) {
    const name = entry.path.toLowerCase();
    let key = keys.get(name);
    if (!key && !name.includes("..")) {
      const path = resolve(settingsDir, "auto-add", ...entry.path.split("/"));
      if (path.startsWith(resolve(settingsDir, "auto-add") + sep) && existsSync(path)) key = new Uint8Array(await readFile(path));
    }
    if (!key) throw new Error(`WU8 needs ${entry.path} from the original Mario Kart Wii Race/Course tracks. Select that folder in Settings › Game files.`);
    applyKey(entry, key);
  }
  if (!required.length) {
    const key = keys.get("itembox.brres") || (existsSync(join(settingsDir, "auto-add", "itembox.brres"))
      ? new Uint8Array(await readFile(join(settingsDir, "auto-add", "itembox.brres"))) : null);
    if (!key) throw new Error("WU8 needs itembox.brres from the original Mario Kart Wii Race/Course tracks. Select that folder in Settings › Game files.");
    summary ^= key[Math.floor(key.length / 2)] ^ key[Math.floor(key.length / 3)] ^ key[Math.floor(key.length / 4)];
  }
  for (const entry of entries) if (!WU8_REQUIRED_FILES.has(entry.path.toLowerCase()))
    for (let i = 0; i < entry.size; i++) data[entry.offset + i] ^= summary;
  data.set([0x55, 0xaa, 0x38, 0x2d]);
  if (!isU8(data)) throw new Error("WU8 reconstruction failed");
  parseU8(data); // Reject a decoded archive with invalid offsets or names.
  return data;
}
