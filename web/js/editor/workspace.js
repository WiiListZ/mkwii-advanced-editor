// Accept an extracted game's files directory, or either common parent directory.
export async function findWorkspaceRoot(path, { exists, listDir, join }) {
  const base = path.replace(/[\\/]+$/, '');
  const candidates = [base, join(base, 'files'), join(base, 'DATA', 'files')];
  const count = (root, folder, ext) => listDir(join(root, ...folder), [ext]).then((files) => files.length).catch(() => 0);
  for (const root of candidates) {
    const [common, tracks, menus, music, archive] = await Promise.all([
      exists(join(root, 'Race', 'Common.szs')),
      count(root, ['Race', 'Course'], 'szs'),
      count(root, ['Scene', 'UI'], 'szs'),
      count(root, ['sound', 'strm'], 'brstm'),
      exists(join(root, 'sound', 'revo_kart.brsar')),
    ]);
    if (common || tracks || menus || music || archive) return root;
  }
  return null;
}

// Riivolution stores files relative to the SD root, independently of their disc paths.
// Keep that translation explicit: a mod can place Race/Course in any folder.
export async function findRiivolutionWorkspace(xmlPath, xml, { exists, listDir, join, parse, externalPath }) {
  const mod = parse(xml);
  const parent = (path) => path.replace(/[\\/][^\\/]+$/, '');
  const sdRoot = /[\\/]riivolution$/i.test(parent(xmlPath)) ? parent(parent(xmlPath)) : parent(xmlPath);
  const files = {}, folders = {}, discPaths = {}, inferred = {}, explicitFolders = {};
  const valid = (path) => path && !path.split('/').some((part) => part === '..' || part === '.' || part.includes(':'));
  for (const patch of mod.patches) for (const item of patch.items) {
    if (item.tag !== 'file' && item.tag !== 'folder') continue;
    const disc = String(item.attrs.disc || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const external = externalPath(patch, item).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if ((item.tag === 'file' && (!valid(disc) || !valid(external))) || (disc && !valid(disc)) || (external && !valid(external))) continue;
    const key = disc.toLowerCase(), source = external ? join(sdRoot, ...external.split('/')) : sdRoot;
    if (!(await exists(source))) continue;
    discPaths[key] ??= disc;
    if (item.tag === 'folder') { folders[key] ??= source; explicitFolders[key] ??= source; }
    else {
      files[key] ??= source;
      const folder = disc.split('/').slice(0, -1).join('/').toLowerCase();
      const dir = parent(source);
      if (!(folder in inferred)) inferred[folder] = dir;
      else if (inferred[folder]?.toLowerCase() !== dir.toLowerCase()) inferred[folder] = null;
    }
  }
  for (const [key, source] of Object.entries(inferred)) if (key && source && !(key in folders)) folders[key] = source;
  const workspace = { xmlPath, sdRoot, files, folders, discPaths, explicitFolders };
  const resource = (path) => resolveRiivolutionPath(workspace, path.split('/'), join);
  const hasFile = (path) => resource(path) ? exists(resource(path)) : false;
  const hasFiles = (path, ext) => resource(path) ? listDir(resource(path), [ext]).then((items) => items.length > 0).catch(() => false) : false;
  const [common, tracks, menus, music, archive] = await Promise.all([
    hasFile('Race/Common.szs'), hasFiles('Race/Course', 'szs'),
    hasFiles('Scene/UI', 'szs'), hasFiles('sound/strm', 'brstm'),
    hasFile('sound/revo_kart.brsar'),
  ]);
  if (!common && !tracks && !menus && !music && !archive) return null;
  return workspace;
}

export function resolveRiivolutionPath(workspace, parts, join = (...values) => values.join('\\')) {
  const relative = parts.join('/').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const key = relative.toLowerCase();
  if (workspace.files[key]) return workspace.files[key];
  if (workspace.folders[key]) return workspace.folders[key];
  const prefix = Object.keys(workspace.folders).filter((folder) => !folder || key.startsWith(folder + '/')).sort((a, b) => b.length - a.length)[0];
  return prefix !== undefined ? join(workspace.folders[prefix], ...relative.slice(prefix ? prefix.length + 1 : 0).split('/')) : '';
}
