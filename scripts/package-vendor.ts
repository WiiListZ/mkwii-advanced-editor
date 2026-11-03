// Rebuild the portable tools from the verified upstream files staged in
// .cache/vendor-downloads. All binaries, sources and licenses are retained.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const root = resolve(import.meta.dir, ".."), staged = join(root, ".cache", "vendor-downloads");
const files: { name: string; data: Uint8Array }[] = [];
async function collect(folder: string, prefix: string, base = folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await collect(path, prefix, base);
    else if (entry.isFile()) files.push({ name: `${prefix}/${relative(base, path).replaceAll("\\", "/")}`, data: await readFile(path) });
  }
}
await collect(join(staged, "abmatt-cli"), "abmatt");
await collect(join(staged, "wiimm-cli"), "wiimm");
for (const [from, name] of [["abmatt-v1.3.2-source.tar.gz", "abmatt/source.tar.gz"], ["wiimm-v2.42a-source.tar.gz", "wiimm/source.tar.gz"]])
  files.push({ name, data: await readFile(join(staged, from)) });
files.push({ name: "NOTICE.md", data: await readFile(join(root, "vendor", "NOTICE.md")) });
files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const manifest = Buffer.from(JSON.stringify(files.map(({ name, data }) => ({ name, size: data.length }))));
const header = Buffer.alloc(12); header.write("MKWTLS01"); header.writeUInt32BE(manifest.length, 8);
const raw = Buffer.concat([header, manifest, ...files.map(({ data }) => data)]);
const packed = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
const output = join(root, "vendor", "tools-win-x64.br");
await writeFile(output, packed);
console.log(`Created ${output} (${packed.length.toLocaleString()} bytes, ${files.length} files)`);
console.log(`SHA-256: ${createHash("sha256").update(packed).digest("hex")}`);
