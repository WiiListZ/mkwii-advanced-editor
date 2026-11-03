import { expect, test } from "bun:test";
import { reservePESectionHeader } from "../scripts/pe-section-space.ts";

function packedPE(headers = 512) {
  const bytes = new Uint8Array(headers + 1024), v = new DataView(bytes.buffer);
  v.setUint16(0, 0x5a4d, true); v.setUint32(60, 120, true); v.setUint32(120, 0x4550, true);
  v.setUint16(126, 3, true); v.setUint16(140, 240, true); v.setUint16(144, 0x20b, true);
  v.setUint32(180, 512, true); v.setUint32(204, headers, true);
  for (let i = 0; i < 3; i++) {
    const at = 384 + i * 40;
    v.setUint32(at + 8, 4096, true); v.setUint32(at + 12, (i + 1) * 4096, true);
    v.setUint32(at + 16, i ? 512 : 0, true); v.setUint32(at + 20, headers + Math.max(0, i - 1) * 512, true);
  }
  bytes.set([1, 2, 255, 128], headers); bytes.set([7, 8, 9], headers + 512);
  return bytes;
}

test("packed runtime gains section-header room without changing its mapped image or payload", () => {
  const original = packedPE(), saved = original.slice(), padded = reservePESectionHeader(original), v = new DataView(padded.buffer);
  expect(original).toEqual(saved); expect(padded.length).toBe(original.length + 512);
  expect(v.getUint32(204, true)).toBe(1024);
  expect(padded.subarray(1024)).toEqual(original.subarray(512));
  expect(v.getUint32(424 + 20, true)).toBe(1024); expect(v.getUint32(464 + 20, true)).toBe(1536);
  expect(v.getUint32(424 + 12, true)).toBe(8192); expect(v.getUint32(464 + 12, true)).toBe(12288);
  expect(384 + 4 * 40).toBeLessThanOrEqual(v.getUint32(204, true));
});

test("runtime headers with enough space are retained and unknown file offsets are rejected", () => {
  const original = packedPE(1024); expect(reservePESectionHeader(original)).toBe(original);
  const unsupported = packedPE(); new DataView(unsupported.buffer).setUint32(132, 800, true);
  expect(() => reservePESectionHeader(unsupported)).toThrow("unsupported file-offset metadata");
  expect(() => reservePESectionHeader(new Uint8Array(20))).toThrow("Not a Windows executable");
});
