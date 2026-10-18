// Objects (KMP GOBJ) of another track or archive, to add them to the open track with their model.

import { listFiles } from '../formats/u8.js';

// Files of an object model in an archive: root files named like a resource (`itembox.brres`) and
// files inside folders named like it (the same rule as the tracks folder library).
export function objectFiles(tree, names) {
  if (!tree) return [];
  const stems = new Set(names.map((n) => n.toLowerCase()));
  return listFiles(tree).filter((f) => {
    const parts = f.path.toLowerCase().split('/');
    return parts.length === 1 ? stems.has(parts[0].replace(/\.[^.]+$/, '')) : parts.slice(0, -1).some((p) => stems.has(p));
  }).map((f) => ({ path: f.path, data: f.node.data }));
}

const settingsKey = (o) => [...o.settings, o.presence, ...o.scale].join(',');

// Placed objects grouped by type, most used first: { objectId, count, sample } where `sample` holds
// the settings, scale and presence most of them share.
export function placedObjects(gobj) {
  const byId = new Map();
  for (const o of gobj || []) {
    let entry = byId.get(o.objectId);
    if (!entry) byId.set(o.objectId, entry = { objectId: o.objectId, count: 0, variants: new Map() });
    entry.count++;
    const key = settingsKey(o), variant = entry.variants.get(key);
    if (variant) variant.count++;
    else entry.variants.set(key, { count: 1, object: o });
  }
  return [...byId.values()].map(({ objectId, count, variants }) => {
    const o = [...variants.values()].sort((a, b) => b.count - a.count)[0].object;
    return { objectId, count, sample: { settings: [...o.settings], scale: [...o.scale], presence: o.presence } };
  }).sort((a, b) => b.count - a.count || a.objectId - b.objectId);
}
