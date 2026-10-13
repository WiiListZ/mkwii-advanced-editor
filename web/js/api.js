// Bridge to the Bun backend (native dialogs, disk access, settings).
// When the page runs without the backend (plain browser), file inputs and downloads are used instead.

const params = new URLSearchParams(location.search);
const token = params.get('t');

export const hasBackend = !!token;
export const startupFile = params.get('open');

async function call(route, { method = 'GET', query = {}, body, raw = false } = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`/api/${route}${qs ? '?' + qs : ''}`, {
    method,
    headers: { 'x-token': token, ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return raw ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

export const FILTERS = {
  track: [{ name: 'Track files', extensions: ['szs', 'wlz', 'wbz', 'wu8', 'kmp', 'kcl'] }],
  // File › Open: everything the editor can open, change and save back.
  editable: [
    { name: 'All supported files', extensions: ['szs', 'wlz', 'wbz', 'wu8', 'arc', 'carc', 'kmp', 'kcl', 'brres', 'bmg', 'breff', 'breft', 'bin', 'brstm', 'brsar', 'xml'] },
    { name: 'Tracks and archives', extensions: ['szs', 'wlz', 'wbz', 'wu8', 'arc', 'carc', 'kmp', 'kcl'] },
    { name: 'Models (BRRES)', extensions: ['brres'] },
    { name: 'Game text (BMG)', extensions: ['bmg'] },
    { name: 'Effects (BREFF / BREFT)', extensions: ['breff', 'breft'] },
    { name: 'Vehicle, character and item parameters (BIN)', extensions: ['bin'] },
    { name: 'Music and sounds (BRSTM / BRSAR)', extensions: ['brstm', 'brsar'] },
    { name: 'Riivolution XML', extensions: ['xml'] },
  ],
  szs: [{ name: 'SZS archive', extensions: ['szs'] }],
  kmp: [{ name: 'KMP course data', extensions: ['kmp'] }],
  kcl: [{ name: 'KCL collision', extensions: ['kcl'] }],
  obj: [{ name: 'Wavefront OBJ', extensions: ['obj'] }],
  png: [{ name: 'PNG image', extensions: ['png'] }],
  model: [{ name: '3D model (BRRES / SZS / WLZ / WBZ / WU8 / OBJ)', extensions: ['brres', 'szs', 'wlz', 'wbz', 'wu8', 'obj'] }],
  brres: [{ name: 'BRRES model', extensions: ['brres'] }],
  glb: [{ name: 'glTF binary model with animations', extensions: ['glb'] }],
  exportModel: [{ name: 'Collada with textures', extensions: ['dae'] }, { name: 'Wavefront OBJ with textures', extensions: ['obj'] }],
  importModel: [{ name: '3D model', extensions: ['obj', 'fbx', 'gltf', 'glb', 'dae', 'stl', 'ply', 'blend'] }],
  objflow: [{ name: 'ObjFlow.bin or Common.szs', extensions: ['bin', 'szs'] }],
  json: [{ name: 'JSON documentation', extensions: ['json'] }],
  audio: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'opus', 'flac', 'm4a', 'aac', 'webm', 'brstm'] }],
  wav: [{ name: 'WAV audio', extensions: ['wav'] }],
  flac: [{ name: 'FLAC audio (lossless)', extensions: ['flac'] }],
  ogg: [{ name: 'Ogg Opus audio', extensions: ['ogg', 'opus'] }],
  brstm: [{ name: 'BRSTM stream (game format)', extensions: ['brstm'] }],
  any: [],
};

const baseName = (p) => p.split(/[\\/]/).pop();

// Compact triangle list for URLs: [0,1,2,3,7,8] -> "0-3,7-8".
function triangleRanges(list) {
  const sorted = [...new Set(list)].sort((a, b) => a - b), out = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(',');
}

// Browser fallback: <input type=file>.
function pickLocalFile(filters) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    const exts = filters.flatMap((f) => f.extensions).filter((e) => e !== '*');
    if (exts.length) input.accept = exts.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { path: null, name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}

function download(name, data) {
  const url = URL.createObjectURL(new Blob([data]));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const api = {
  async checkUpdates() {
    return hasBackend ? call('updates') : { supported: false, currentVersion: '0.0.0', available: false };
  },

  async downloadUpdate() {
    return call('updates', { method: 'POST' });
  },

  async updateProgress() {
    return call('update-progress');
  },

  async applyUpdate() {
    return call('update-apply', { method: 'POST' });
  },

  // Asks for a file and reads it. Returns { path, name, data } or null.
  // Only the path of an existing file (for big files such as a game image, which are not read).
  async choosePath(filters, title) {
    if (!hasBackend) return null;
    return (await call('open-dialog', { method: 'POST', body: { filters, title } })).path || null;
  },

  async openFile(filters = FILTERS.track, title) {
    if (!hasBackend) return pickLocalFile(filters);
    const { path } = await call('open-dialog', { method: 'POST', body: { filters, title } });
    if (!path) return null;
    return { path, name: baseName(path), data: await call('read', { query: { path }, raw: true }) };
  },

  async readPath(path) {
    return { path, name: baseName(path), data: await call('read', { query: { path }, raw: true }) };
  },

  async decodeWiimmArchive(path, data, originals = '') {
    if (!hasBackend) throw new Error('WLZ/WBZ/WU8/YBZ decoding requires the desktop app.');
    return call('decode-archive', { method: 'POST', query: { ...(path ? { path } : {}), ...(originals ? { originals } : {}) }, body: path ? new Uint8Array() : data, raw: true });
  },

  async decodeArchiveBytes(data, path = null, originals = '') {
    const { isYaz0, isWLZ, isWU8, isWBZ, isYBZ, yaz0Decompress } = await import('./formats/yaz0.js');
    if (isWLZ(data) || isWU8(data) || isWBZ(data) || isYBZ(data)) return this.decodeWiimmArchive(path, data, originals);
    return isYaz0(data) ? yaz0Decompress(data) : data;
  },

  // Asks for a destination. Returns a path (backend) or the plain file name (browser).
  async chooseSavePath(defaultName, filters, title) {
    if (!hasBackend) return defaultName;
    const { path } = await call('save-dialog', { method: 'POST', body: { filters, defaultName, title } });
    return path;
  },

  // Writes data. compress: 'yaz0' compresses on the backend (or here in browser mode).
  async writeFile(path, data, { backup = false, edited = false, compress = null } = {}) {
    if (!hasBackend) {
      if (compress === 'yaz0') {
        const { yaz0Compress } = await import('./formats/yaz0.js');
        data = yaz0Compress(data);
      }
      download(baseName(path), data);
      return { ok: true };
    }
    const query = { path };
    if (backup) query.backup = '1';
    if (edited) query.edited = '1';
    if (compress) query.compress = compress;
    return call('write', { method: 'POST', query, body: data });
  },

  async duplicateModel(data, modelName, partName, center, delta, triangles = null) {
    if (!hasBackend) throw new Error('Model duplication requires the desktop app and ABMatt');
    const query = { model: modelName, part: partName, center: center.join(','), delta: delta.join(',') };
    if (triangles?.length) query.tris = triangleRanges(triangles);
    return call('duplicate-model', { method: 'POST', query, body: data, raw: true });
  },

  // Copies one polygon (or piece) of any BRRES into course_model.brres. Returns the patched course_model.brres.
  async importModelPart(data, source, { model, part, piece = null, target = null, tag = '', triangles = null }) {
    if (!hasBackend) throw new Error('Adding game model parts requires the desktop app and ABMatt');
    const body = new Uint8Array(source.length + data.length);
    body.set(source); body.set(data, source.length);
    const query = { model, part, sourceLength: String(source.length), tag };
    if (piece) query.piece = piece.join(',');
    if (target) query.target = target.join(',');
    if (triangles?.length) query.tris = triangleRanges(triangles);
    return call('import-part', { method: 'POST', query, body, raw: true });
  },

  // Windows "open .szs / .kmp / .kcl with the editor" registration (built exe only).
  async fileAssociation() {
    if (!hasBackend) return { available: false, registered: false };
    return call('file-association');
  },

  async setFileAssociation(register) {
    return call('file-association', { method: 'POST', body: { register } });
  },

  async chooseFolder(title, initial = '') {
    if (!hasBackend) return null;
    return (await call('folder-dialog', { method: 'POST', body: { title, initial } })).path;
  },

  // Files contained in every .szs of a folder: { folder, archives: [{ name, files: [path] }] }.
  async archiveIndex(folder) {
    if (!hasBackend) return { folder, archives: [] };
    return call('archive-index', { query: { path: folder } });
  },

  async readArchiveFile(path, file) {
    return call('archive-file', { query: { path, file }, raw: true });
  },

  async exists(path) {
    if (!hasBackend || !path) return false;
    return (await call('exists', { query: { path } })).exists;
  },

  // Paths (with "/", relative to `path`) of the files the editor changed below a folder.
  async modifiedFiles(path) {
    if (!hasBackend) return [];
    return (await call('modified-files', { query: { path } })).files;
  },

  async copyPath(from, to) {
    if (!hasBackend) throw new Error('Copying files requires the desktop app');
    return call('copy', { query: { from, to } });
  },

  async listDir(path, extensions = []) {
    if (!hasBackend) return [];
    return (await call('list-dir', { query: { path, ext: extensions.join(',') } })).files;
  },

  // animation: '' = default, '-' = none, otherwise the name from modelAnimations().
  async import3DModel(data, path, target, animation = '') {
    if (!hasBackend || !path) throw new Error('3D model import requires the desktop app and a model file on disk');
    return call('import-model', { method: 'POST', query: { path, target: target.join(','), animation }, body: data, raw: true });
  },

  async convertModelBRRES(path, animation = '') {
    if (!hasBackend || !path) throw new Error('BRRES conversion requires the desktop app and a model file on disk');
    return call('convert-model-brres', { method: 'POST', query: { path, animation }, raw: true });
  },

  // Converts a BRRES to .dae / .obj (chosen by the extension) with its textures, next to `path`.
  async exportModel(data, path) {
    if (!hasBackend) throw new Error('Exporting the model as DAE/OBJ requires the desktop app and ABMatt');
    return (await call('export-model', { method: 'POST', query: { path }, body: data })).files;
  },

  async deleteAnimation(data, name) {
    if (!hasBackend) throw new Error('Removing animations requires the desktop app');
    return call('delete-animation', { method: 'POST', query: { name }, body: data, raw: true });
  },

  async importResourceAnimation(data, donor, name) {
    if (!hasBackend) throw new Error('Animation import requires the desktop app');
    const body = new Uint8Array(donor.length + data.length);
    body.set(donor); body.set(data, donor.length);
    return call('import-resource-animation', { method: 'POST', query: { donorLength: donor.length, name }, body, raw: true });
  },

  // Writes dropped files to one temporary folder on disk. Returns { name: path }.
  async stageFiles(files) {
    if (!hasBackend) throw new Error('Importing dropped 3D models requires the desktop app');
    const session = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    const paths = {};
    for (const f of files) paths[f.name] = (await call('stage-file', { method: 'POST', query: { session, name: f.name }, body: f.data })).path;
    return paths;
  },

  async modelAnimations(path) {
    if (!hasBackend || !path) return [];
    return (await call('model-animations', { query: { path } })).animations;
  },

  async deleteModel(data, modelName, partName, center, triangles = null) {
    if (!hasBackend) throw new Error('Model deletion requires the desktop app and ABMatt');
    const query = { model: modelName, part: partName, center: center.join(',') };
    if (triangles?.length) query.tris = triangleRanges(triangles);
    return call('delete-model', { method: 'POST', query, body: data, raw: true });
  },

  async getSettings() {
    if (!hasBackend) {
      try { return JSON.parse(localStorage.getItem('mkwii-settings') || '{}'); } catch { return {}; }
    }
    return call('settings');
  },

  async saveSettings(patch) {
    if (!hasBackend) {
      try {
        const next = { ...(await this.getSettings()), ...patch };
        localStorage.setItem('mkwii-settings', JSON.stringify(next));
        return next;
      } catch { return patch; }
    }
    return call('settings', { method: 'POST', body: patch });
  },

  reveal(path) { if (hasBackend && path) call('reveal', { query: { path } }); },

  // Opens one of the project's GitHub pages in the default browser.
  openUrl(url) {
    if (hasBackend) return call('open-url', { query: { url } });
    window.open(url, '_blank', 'noopener');
  },
};
