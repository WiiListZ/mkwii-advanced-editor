// Big-endian binary reader/writer (the Wii's native byte order).

export class BinaryReader {
  constructor(buffer, offset = 0) {
    this.u8a = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.u8a.buffer, this.u8a.byteOffset, this.u8a.byteLength);
    this.pos = offset;
  }
  get length() { return this.u8a.byteLength; }
  seek(p) { this.pos = p; return this; }
  skip(n) { this.pos += n; return this; }
  u8() { return this.view.getUint8(this.pos++); }
  s8() { return this.view.getInt8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  s16() { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  s32() { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
  vec2() { return [this.f32(), this.f32()]; }
  vec3() { return [this.f32(), this.f32(), this.f32()]; }
  str(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  cstr(at) {
    let s = '', p = at;
    while (p < this.u8a.length && this.u8a[p] !== 0) s += String.fromCharCode(this.u8a[p++]);
    return s;
  }
  bytes(n) { const b = this.u8a.slice(this.pos, this.pos + n); this.pos += n; return b; }
}

export class BinaryWriter {
  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
    this.size = 0;
  }
  ensure(n) {
    const need = this.pos + n;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  bump(n) { this.pos += n; if (this.pos > this.size) this.size = this.pos; }
  seek(p) { this.ensure(Math.max(0, p - this.pos)); this.pos = p; if (p > this.size) this.size = p; return this; }
  u8(v) { this.ensure(1); this.view.setUint8(this.pos, v & 0xFF); this.bump(1); }
  s8(v) { this.ensure(1); this.view.setInt8(this.pos, v); this.bump(1); }
  u16(v) { this.ensure(2); this.view.setUint16(this.pos, v & 0xFFFF); this.bump(2); }
  s16(v) { this.ensure(2); this.view.setInt16(this.pos, v); this.bump(2); }
  u32(v) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0); this.bump(4); }
  s32(v) { this.ensure(4); this.view.setInt32(this.pos, v | 0); this.bump(4); }
  f32(v) { this.ensure(4); this.view.setFloat32(this.pos, v); this.bump(4); }
  vec2(v) { this.f32(v[0]); this.f32(v[1]); }
  vec3(v) { this.f32(v[0]); this.f32(v[1]); this.f32(v[2]); }
  str(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  cstr(s) { this.str(s); this.u8(0); }
  bytes(b) { this.ensure(b.length); this.buf.set(b, this.pos); this.bump(b.length); }
  align(a, fill = 0) { while (this.pos % a) this.u8(fill); }
  // Overwrites a u32 at an existing position without moving the cursor.
  patchU32(at, v) { this.view.setUint32(at, v >>> 0); }
  patchU16(at, v) { this.view.setUint16(at, v & 0xFFFF); }
  toUint8Array() { return this.buf.slice(0, this.size); }
}
