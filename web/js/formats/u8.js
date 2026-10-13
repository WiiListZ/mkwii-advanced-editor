// U8 archive (the decompressed content of a .szs file).
// Tree form: { name, children: [...] } for folders, { name, data: Uint8Array } for files.

import { BinaryReader, BinaryWriter } from './binary.js';

const U8_MAGIC = 0x55AA382D;

export function isU8(data) {
  return data.length >= 4 && ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0 === U8_MAGIC;
}

export function parseU8(data) {
  const r = new BinaryReader(data);
  if (r.u32() !== U8_MAGIC) throw new Error('Invalid U8 archive');
  const rootOff = r.u32();
  r.seek(rootOff + 8);
  const total = r.u32();
  const strTable = rootOff + total * 12;

  const readNode = (i) => {
    r.seek(rootOff + i * 12);
    const typeName = r.u32();
    return { type: typeName >>> 24, nameOff: typeName & 0xFFFFFF, a: r.u32(), b: r.u32() };
  };

  // A folder node owns nodes i+1 up to b (exclusive).
  const build = (i) => {
    const n = readNode(i);
    const name = r.cstr(strTable + n.nameOff);
    if (n.type === 1) {
      const dir = { name, children: [] };
      let j = i + 1;
      while (j < n.b) {
        const [child, next] = build(j);
        dir.children.push(child);
        j = next;
      }
      return [dir, n.b];
    }
    return [{ name, data: data.slice(n.a, n.a + n.b) }, i + 1];
  };
  return build(0)[0];
}

export function buildU8(root) {
  // Flatten the tree in DFS order.
  const nodes = [];
  const walk = (node, parent) => {
    const idx = nodes.length;
    const entry = { node, parent, end: 0 };
    nodes.push(entry);
    if (node.children) {
      for (const c of node.children) walk(c, idx);
      entry.end = nodes.length;
    }
  };
  walk(root, 0);

  // String table.
  const names = [];
  let strSize = 0;
  for (const e of nodes) {
    e.nameOff = strSize;
    names.push(e.node.name);
    strSize += e.node.name.length + 1;
  }
  const rootOff = 0x20;
  const headerSize = nodes.length * 12 + strSize;
  const align = (v, a) => Math.ceil(v / a) * a;
  const dataOff = align(rootOff + headerSize, 0x20);

  const w = new BinaryWriter(dataOff + 1024);
  w.u32(U8_MAGIC);
  w.u32(rootOff);
  w.u32(headerSize);
  w.u32(dataOff);
  for (let i = 0; i < 16; i++) w.u8(0);

  // Compute data offsets.
  let cursor = dataOff;
  for (const e of nodes) {
    if (!e.node.children) {
      e.dataOff = cursor;
      cursor = align(cursor + e.node.data.length, 0x20);
    }
  }

  for (const e of nodes) {
    if (e.node.children) {
      w.u32((1 << 24) | e.nameOff);
      w.u32(e.parent);
      w.u32(e.end);
    } else {
      w.u32(e.nameOff);
      w.u32(e.dataOff);
      w.u32(e.node.data.length);
    }
  }
  for (const s of names) w.cstr(s);
  w.align(0x20);
  for (const e of nodes) {
    if (!e.node.children) {
      w.seek(e.dataOff);
      w.bytes(e.node.data);
      w.align(0x20);
    }
  }
  return w.toUint8Array();
}

// Helpers to find/replace files in the tree, ignoring the leading "." folder.
export function listFiles(root, prefix = '') {
  const out = [];
  for (const c of root.children || []) {
    const path = c.name === '.' ? prefix : (prefix ? prefix + '/' + c.name : c.name);
    if (c.children) out.push(...listFiles(c, path));
    else out.push({ path, node: c });
  }
  return out;
}

export function findFile(root, name) {
  const lower = name.toLowerCase();
  return listFiles(root).find((f) => f.path.toLowerCase() === lower || f.path.toLowerCase().endsWith('/' + lower))?.node || null;
}

export function setFile(root, name, data) {
  const existing = findFile(root, name);
  if (existing) { existing.data = data; return; }
  let dir = root.children.find((c) => c.name === '.' && c.children);
  if (!dir) { dir = { name: '.', children: [] }; root.children.push(dir); }
  dir.children.push({ name, data });
  dir.children.sort((a, b) => a.name.localeCompare(b.name));
}

// Adds or replaces a file at a nested path ("effect/wanwan/rk_wanwan.breff"), creating folders.
export function setFilePath(root, path, data) {
  const parts = path.split('/').filter(Boolean);
  let dir = root.children.find((c) => c.name === '.' && c.children);
  if (!dir) { dir = { name: '.', children: [] }; root.children.push(dir); }
  for (const name of parts.slice(0, -1)) {
    let next = dir.children.find((c) => c.children && c.name.toLowerCase() === name.toLowerCase());
    if (!next) {
      next = { name, children: [] };
      dir.children.push(next);
      dir.children.sort((a, b) => a.name.localeCompare(b.name));
    }
    dir = next;
  }
  const file = parts[parts.length - 1];
  const existing = dir.children.find((c) => !c.children && c.name.toLowerCase() === file.toLowerCase());
  if (existing) { existing.data = data; return; }
  dir.children.push({ name: file, data });
  dir.children.sort((a, b) => a.name.localeCompare(b.name));
}

export function deleteFilePath(root, path) {
  const parts = path.split('/').filter(Boolean);
  let dir = root.children.find((c) => c.name === '.' && c.children);
  for (const name of parts.slice(0, -1)) {
    dir = dir?.children.find((c) => c.children && c.name.toLowerCase() === name.toLowerCase());
    if (!dir) return false;
  }
  if (!dir) return false;
  const index = dir.children.findIndex((c) => !c.children && c.name.toLowerCase() === parts.at(-1).toLowerCase());
  if (index < 0) return false;
  dir.children.splice(index, 1);
  return true;
}

export function newSzsTree() {
  return { name: '', children: [{ name: '.', children: [] }] };
}
