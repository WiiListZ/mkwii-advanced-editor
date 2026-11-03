import { expect, test } from "bun:test";
import { brotliCompressSync } from "node:zlib";
import { toolPackageEntries } from "../src/tool-package.ts";

function packageBytes(files: any, payload: Uint8Array, magic = "MKWTLS01") {
  const manifest = Buffer.from(JSON.stringify(files)), header = Buffer.alloc(12);
  header.write(magic); header.writeUInt32BE(manifest.length, 8);
  return brotliCompressSync(Buffer.concat([header, manifest, payload]));
}

test("solid tool package reads exact binary files and empty files", () => {
  const packed = packageBytes([{ name: "tools/bin.exe", size: 4 }, { name: "LICENSE", size: 0 }], new Uint8Array([0, 255, 1, 128]));
  const entries = [...toolPackageEntries(packed)];
  expect(entries.map(([name]) => name)).toEqual(["tools/bin.exe", "LICENSE"]);
  expect([...entries[0][1]]).toEqual([0, 255, 1, 128]); expect(entries[1][1].length).toBe(0);
});

test("solid tool package rejects incomplete payloads and unsupported headers", () => {
  expect(() => [...toolPackageEntries(packageBytes([{ name: "file", size: 4 }], new Uint8Array(3)))]).toThrow("Invalid bundled tool entry");
  expect(() => [...toolPackageEntries(packageBytes([], new Uint8Array(1)))]).toThrow("size mismatch");
  expect(() => [...toolPackageEntries(packageBytes([], new Uint8Array(), "UNKNOWN!"))]).toThrow("Invalid bundled tool package");
});

test("solid tool package rejects escaping paths and case-insensitive duplicates", () => {
  for (const name of ["../outside", "/absolute", "C:/absolute", "folder\\file", "folder/../file", "folder//file"])
    expect(() => [...toolPackageEntries(packageBytes([{ name, size: 0 }], new Uint8Array()))]).toThrow("Invalid bundled tool entry");
  expect(() => [...toolPackageEntries(packageBytes([{ name: "FILE", size: 0 }, { name: "file", size: 0 }], new Uint8Array()))]).toThrow("Invalid bundled tool entry");
});
