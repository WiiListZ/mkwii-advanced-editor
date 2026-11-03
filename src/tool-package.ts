import { brotliDecompressSync } from "node:zlib";

// A solid Brotli stream compresses shared code across the tools' DLLs. The
// decoded payload is a UTF-8 file manifest followed by the exact file bytes.
export function* toolPackageEntries(compressed: Uint8Array): Generator<[string, Uint8Array]> {
  const raw = brotliDecompressSync(compressed);
  if (raw.length < 12 || raw.toString("ascii", 0, 8) !== "MKWTLS01") throw new Error("Invalid bundled tool package");
  const length = raw.readUInt32BE(8), start = 12 + length;
  if (start > raw.length) throw new Error("Truncated bundled tool manifest");
  const files = JSON.parse(raw.toString("utf8", 12, start));
  if (!Array.isArray(files)) throw new Error("Invalid bundled tool manifest");
  let end = start;
  const names = new Set<string>();
  for (const file of files) {
    if (!file || typeof file.name !== "string" || !file.name || file.name.includes("\\")
      || file.name.startsWith("/") || file.name.includes(":") || file.name.split("/").some((part: string) => !part || part === "." || part === "..")
      || names.has(file.name.toLowerCase()) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > raw.length - end)
      throw new Error("Invalid bundled tool entry");
    names.add(file.name.toLowerCase()); end += file.size;
  }
  if (end !== raw.length) throw new Error("Bundled tool package size mismatch");
  let cursor = start;
  for (const file of files) {
    yield [file.name, raw.subarray(cursor, cursor + file.size)];
    cursor += file.size;
  }
}
