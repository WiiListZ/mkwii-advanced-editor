// Bun adds an embedded .bun section to its runtime. UPX leaves only enough
// header space for its own sections; reserve one more without changing RVAs.
export function reservePESectionHeader(bytes: Uint8Array): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64 || v.getUint16(0, true) !== 0x5a4d) throw new Error("Not a Windows executable");
  const pe = v.getUint32(60, true), optional = pe + 24;
  if (optional + 112 > bytes.length || v.getUint32(pe, true) !== 0x4550 || v.getUint16(optional, true) !== 0x20b)
    throw new Error("Not a Windows x64 PE executable");
  const count = v.getUint16(pe + 6, true), sections = optional + v.getUint16(pe + 20, true);
  const headers = v.getUint32(optional + 60, true), alignment = v.getUint32(optional + 36, true);
  if (!alignment || headers > bytes.length || sections + count * 40 > headers) throw new Error("Invalid PE headers");
  const needed = Math.ceil((sections + (count + 1) * 40) / alignment) * alignment;
  if (needed <= headers) return bytes;
  // UPX removes the symbol table, certificate and debug directory. Reject a
  // future layout containing extra file-offset references rather than shift it incorrectly.
  if (v.getUint32(pe + 12, true) || v.getUint32(optional + 112 + 4 * 8, true) || v.getUint32(optional + 112 + 6 * 8, true))
    throw new Error("Packed runtime has unsupported file-offset metadata");
  const delta = needed - headers, out = new Uint8Array(bytes.length + delta), next = new DataView(out.buffer);
  out.set(bytes.subarray(0, headers)); out.set(bytes.subarray(headers), needed);
  for (let i = 0; i < count; i++) {
    const at = sections + i * 40, pointer = v.getUint32(at + 20, true), length = v.getUint32(at + 16, true);
    if (length && (pointer < headers || pointer + length > bytes.length)) throw new Error("Invalid packed PE section");
    if (pointer >= headers) next.setUint32(at + 20, pointer + delta, true);
  }
  next.setUint32(optional + 60, needed, true);
  return out;
}
