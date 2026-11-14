// SCN0 scenes of a BRRES: light sets, ambient lights, lights, fog and cameras. Mario Kart Wii's own
// scenes are static (one frame) with every value stored as a constant, so the values are changed
// in place; an entry whose values are animated (flags not all "fixed") is shown read-only.
// Layout after ABMatt's SCN0 packer, checked on the game's seven SCN0 files.

const str = (d, at) => { let e = at; while (e < d.length && d[e]) e++; return new TextDecoder().decode(d.subarray(at, e)); };
const groupOf = (d, v, at) => Array.from({ length: v.getUint32(at + 4) }, (_, i) => {
  const e = at + 24 + i * 16;
  return { name: str(d, at + v.getInt32(e + 8)), offset: at + v.getInt32(e + 12) };
});
const rgba = (d, at) => [d[at], d[at + 1], d[at + 2], d[at + 3]];
const vec = (v, at) => [v.getFloat32(at), v.getFloat32(at + 4), v.getFloat32(at + 8)];

// Entry fields: [name, offset, kind] with kind 'f' float, 'v' 3 floats, 'c' RGBA bytes, 'u' u32.
export const SCN0_FIELDS = {
  'Lights(NW4R)': [['start', 36, 'v'], ['color', 48, 'c'], ['end', 52, 'v'], ['distanceFunction', 64, 'u'], ['referenceDistance', 68, 'f'], ['referenceBrightness', 72, 'f'], ['spotFunction', 76, 'u'], ['cutoff', 80, 'f'], ['specularColor', 84, 'c'], ['shininess', 88, 'f']],
  'AmbLights(NW4R)': [['color', 24, 'c']],
  'Fog(NW4R)': [['type', 24, 'u'], ['start', 28, 'f'], ['end', 32, 'f'], ['color', 36, 'c']],
  'Cameras(NW4R)': [['position', 32, 'v'], ['aspect', 44, 'f'], ['near', 48, 'f'], ['far', 52, 'f'], ['rotation', 56, 'v'], ['aim', 68, 'v'], ['twist', 80, 'f'], ['fovY', 84, 'f'], ['orthoHeight', 88, 'f']],
};
// An entry's values are constants when its flags say so (as in every scene of the game).
const isStatic = (section, d, v, at) => section === 'Lights(NW4R)' ? (v.getUint16(at + 28) & 0xFFF8) === 0xFFF8
  : section === 'AmbLights(NW4R)' ? !!(d[at + 20] & 0x80)
  : section === 'Cameras(NW4R)' ? (v.getUint16(at + 24) & 0xFFFE) === 0xFFFE
  : section === 'Fog(NW4R)' ? true : false;

export function readSCN0s(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength), out = [];
  for (const folder of groupOf(data, v, v.getUint16(12) + 8)) {
    if (folder.name !== 'AnmScn(NW4R)') continue;
    for (const res of groupOf(data, v, folder.offset)) {
      const o = res.offset, version = v.getUint32(o + 8);
      const scene = { name: res.name, offset: o, version, frames: version >= 5 ? v.getUint16(o + 0x34) : null, sections: {} };
      for (const section of groupOf(data, v, o + v.getInt32(o + 0x10))) {
        const fields = SCN0_FIELDS[section.name];
        scene.sections[section.name] = groupOf(data, v, section.offset).map((entry) => {
          const at = entry.offset, values = {};
          for (const [name, offset, kind] of fields || []) values[name] = kind === 'v' ? vec(v, at + offset) : kind === 'c' ? rgba(data, at + offset) : kind === 'u' ? v.getUint32(at + offset) : v.getFloat32(at + offset);
          return { name: entry.name, offset: at, editable: !!fields && isStatic(section.name, data, v, at), values,
            ...(section.name === 'LightSet(NW4R)' ? { ambient: str(data, at + v.getInt32(at + 20)), lights: Array.from({ length: data[at + 26] }, (_, i) => str(data, at + 28 + v.getInt32(at + 28 + i * 4))) } : {}) };
        });
      }
      out.push(scene);
    }
  }
  return out;
}

// patch: { field: value } for one entry of one scene; returns a changed copy of the BRRES.
export function setSCN0Values(data, sceneName, sectionName, entryName, patch) {
  const scene = readSCN0s(data).find((s) => s.name === sceneName);
  const entry = scene?.sections[sectionName]?.find((e) => e.name === entryName);
  if (!entry) throw new Error(`${sectionName} ${entryName} not found in ${sceneName}`);
  if (!entry.editable) throw new Error(`${entryName} is animated: its values are not constants and cannot be changed here`);
  const out = data.slice(), v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (const [name, value] of Object.entries(patch)) {
    const field = SCN0_FIELDS[sectionName].find((f) => f[0] === name);
    if (!field) throw new Error(`Unknown field ${name}`);
    const [, offset, kind] = field, at = entry.offset + offset;
    if (kind === 'v') { if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${name} needs three numbers`); value.forEach((x, i) => v.setFloat32(at + i * 4, x)); }
    else if (kind === 'c') { if (value.length !== 4) throw new Error(`${name} needs four colour values`); value.forEach((x, i) => { out[at + i] = Math.max(0, Math.min(255, Math.round(x))); }); }
    else if (kind === 'u') { if (!Number.isInteger(value) || value < 0) throw new Error(`${name} needs a whole number`); v.setUint32(at, value); }
    else { if (!Number.isFinite(value)) throw new Error(`${name} needs a number`); v.setFloat32(at, value); }
  }
  return out;
}
