// How much a track holds. There is no documented limit for what fits in the Wii's memory, so most of
// these are set against the largest of the game's own race tracks, measured on the disc. Only those
// with a limit have a real one, from the file format.

import { parseBRRES } from '../formats/brres.js';
import { findFile, listFiles } from '../formats/u8.js';

const MB = 1024 * 1024;
const megabytes = (bytes) => `${(bytes / MB).toFixed(2)} MB`;
const count = (value) => Math.round(value).toLocaleString('en-US');

// Cached by the file's bytes: this runs on every change, and the model rarely changes.
const modelCache = new WeakMap();
function modelUsage(szs) {
  const node = szs && findFile(szs, 'course_model.brres');
  if (!node?.data) return { file: 0, triangles: 0, textures: 0, materials: 0 };
  if (modelCache.has(node.data)) return modelCache.get(node.data);
  const usage = { file: node.data.length, triangles: 0, textures: 0, materials: 0 };
  try {
    const brres = parseBRRES(node.data);
    const model = brres.models.find((m) => m.name === 'course') || brres.models[0];
    for (const object of model?.objects || []) usage.triangles += object.triangles || 0;
    usage.materials = model?.materials?.length || 0;
    for (const texture of brres.textures.values()) usage.textures += texture.data?.length || texture.size || 0;
  } catch { /* an unreadable model is reported elsewhere */ }
  modelCache.set(node.data, usage);
  return usage;
}

const points = (groups) => groups.reduce((sum, group) => sum + group.points.length, 0);

// reference: the largest original race track. memory: it takes room in the console's memory.
export function trackUsage(doc) {
  const { kmp, kcl, szs } = doc;
  const model = modelUsage(szs);
  const archive = szs ? listFiles(szs).reduce((sum, file) => sum + (file.node.data?.length || 0), 0) : 0;
  return [
    { id: 'archive', label: 'Archive, unpacked', value: archive, reference: 5413228, format: megabytes, memory: true },
    { id: 'model', label: 'Track model file', value: model.file, reference: 3925248, format: megabytes, memory: true },
    { id: 'textures', label: 'Track model textures', value: model.textures, reference: 3370976, format: megabytes, memory: true },
    { id: 'triangles', label: 'Track model triangles', value: model.triangles, reference: 23683, format: count, memory: true },
    { id: 'materials', label: 'Track model materials', value: model.materials, reference: 39, format: count },
    { id: 'collision', label: 'Collision triangles', value: kcl?.count || 0, reference: 10427, limit: 65534, format: count },
    { id: 'objects', label: 'Objects', value: kmp.GOBJ.length, reference: 645, format: count, memory: true },
    { id: 'kinds', label: 'Kinds of object', value: new Set(kmp.GOBJ.map((object) => object.objectId)).size, reference: 25, format: count, memory: true },
    { id: 'enemy', label: 'Enemy route points', value: points(kmp.ENPT), reference: 239, limit: 255, format: count },
    { id: 'item', label: 'Item route points', value: points(kmp.ITPT), reference: 250, limit: 255, format: count },
    { id: 'checkpoints', label: 'Checkpoints', value: points(kmp.CKPT), reference: 101, limit: 255, format: count },
    { id: 'areas', label: 'Areas', value: kmp.AREA.length, reference: 46, format: count },
    { id: 'cameras', label: 'Cameras', value: kmp.CAME.length, reference: 31, format: count },
    { id: 'routes', label: 'Routes', value: kmp.POTI.length, reference: 41, format: count },
  ];
}

export const usageState = (row) => row.limit && row.value > row.limit ? 'over' : row.value > row.reference ? 'high' : 'ok';
export const usageText = (row, value) => row.format(value);

// What the validator says about it. A limit passed is an error it already reports with its own words,
// so only what is above the originals is said here.
export function usageIssues(doc) {
  return trackUsage(doc).filter((row) => usageState(row) === 'high').map((row) => ({
    level: row.memory ? 'warning' : 'info',
    msg: `${row.label}: ${row.format(row.value)}, more than the largest original track (${row.format(row.reference)}).${row.memory ? ' It may not fit in memory, or may slow the game: test it in the game.' : ''}`,
  }));
}
