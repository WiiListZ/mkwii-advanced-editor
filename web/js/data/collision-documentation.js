// Collision documentation: what each surface type does and what its variants mean, in general and on
// a given course. The editor's own is collision-documentation.json; a documentation JSON of the
// person's ("Replace with JSON…", the same file as the objects') can add a "collisions" part, whose
// entries complete or replace these, and a newer default can come with the online object
// documentation. Keys are surface types in hex ("0x18") or decimal; a course is its file name without
// .szs ("water_course").
//
//   "collisions": {
//     "0x18": {
//       "label": "Sound Trigger", "description": "…", "notes": "…",
//       "variants": { "0": { "label": "…", "description": "…" } },
//       "tracks": { "water_course": { "label": "Koopa Cape", "variants": { "3": { "label": "Underwater music" } } } }
//     }
//   }
import DEFAULT_JSON from './collision-documentation.json' with { type: 'json' };

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, where, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${where} must be a nonempty string of at most ${max} characters`);
  return value.trim();
};

function parseVariants(variants, where) {
  if (!plain(variants)) throw new Error(`${where} must be an object such as { "0": { "label": "…" } }`);
  const out = Object.create(null);
  for (const [key, value] of Object.entries(variants)) {
    if (!/^[0-7]$/.test(key)) throw new Error(`${where} keys must be variants 0–7`);
    if (!plain(value)) throw new Error(`${where}.${key} must be { "label": "…" }`);
    out[key] = { label: text(value.label, `${where}.${key}.label`, 120) };
    if (value.description !== undefined) out[key].description = text(value.description, `${where}.${key}.description`);
  }
  return out;
}

// The "collisions" part of a documentation JSON, checked: { [type number]: entry }.
export function parseCollisionDocumentation(collisions) {
  if (!plain(collisions)) throw new Error('"collisions" must be an object such as { "0x18": { … } }');
  const out = Object.create(null);
  for (const [key, value] of Object.entries(collisions)) {
    if (!/^(?:0x[0-9a-f]{1,2}|[0-9]{1,2})$/i.test(key)) throw new Error(`Invalid collision key: ${key} (a surface type such as "0x18")`);
    const type = /^0x/i.test(key) ? Number.parseInt(key, 16) : Number(key);
    if (type > 31) throw new Error(`${key} must be a surface type from 0x00 to 0x1F`);
    if (!plain(value)) throw new Error(`collisions.${key} must be an object`);
    const entry = {};
    if (value.label !== undefined) entry.label = text(value.label, `collisions.${key}.label`, 120);
    if (value.description !== undefined) entry.description = text(value.description, `collisions.${key}.description`);
    if (value.notes !== undefined) entry.notes = text(value.notes, `collisions.${key}.notes`);
    if (value.variants !== undefined) entry.variants = parseVariants(value.variants, `collisions.${key}.variants`);
    if (value.tracks !== undefined) {
      if (!plain(value.tracks)) throw new Error(`collisions.${key}.tracks must be an object such as { "water_course": { … } }`);
      entry.tracks = Object.create(null);
      for (const [course, track] of Object.entries(value.tracks)) {
        if (!/^[A-Za-z0-9_.-]{1,80}$/.test(course)) throw new Error(`collisions.${key}.tracks: invalid course name ${course}`);
        if (!plain(track)) throw new Error(`collisions.${key}.tracks.${course} must be an object`);
        const where = `collisions.${key}.tracks.${course}`, out2 = {};
        if (track.label !== undefined) out2.label = text(track.label, `${where}.label`, 120);
        if (track.notes !== undefined) out2.notes = text(track.notes, `${where}.notes`);
        if (track.variants !== undefined) out2.variants = parseVariants(track.variants, `${where}.variants`);
        entry.tracks[course.toLowerCase()] = out2;
      }
    }
    if (!Object.keys(entry).length) throw new Error(`collisions.${key} has no documentation`);
    out[type] = entry;
  }
  return out;
}

export const BUILTIN_COLLISION_DOCUMENTATION = parseCollisionDocumentation(DEFAULT_JSON.collisions);
export const DEFAULT_COLLISION_DOCUMENTATION_JSON = DEFAULT_JSON.collisions;

// The default in use: the shipped one, or the "collisions" of a newer online documentation.
let defaultCollisions = BUILTIN_COLLISION_DOCUMENTATION, defaultCollisionsJson = DEFAULT_JSON.collisions;
export function useDefaultCollisionDocumentation(json) {
  defaultCollisions = json ? parseCollisionDocumentation(json) : BUILTIN_COLLISION_DOCUMENTATION;
  defaultCollisionsJson = json || DEFAULT_JSON.collisions;
  return defaultCollisions;
}
export const defaultCollisionDocumentation = () => ({ collisions: defaultCollisions, json: defaultCollisionsJson });

// The course a track file stands for: "water_course" for water_course.szs or water_course_d.szs.
export const courseKey = (fileName) => String(fileName || '').split(/[\\/]/).pop().replace(/\.(szs|kcl)$/i, '').replace(/_d$/i, '').toLowerCase();

// What is known of a surface type, on `course` when given: { label, description, notes, track
// (the course's label), trackNotes, variants: { [n]: { label, description, onTrack } } }. A person's
// entry (custom) completes the default one: its fields replace the default's, its variants are added.
export function collisionDocumentation(type, course = '', custom = null) {
  const parts = [defaultCollisions[type], custom?.[type]].filter(Boolean);
  const out = { variants: {} };
  for (const part of parts) {
    for (const field of ['label', 'description', 'notes']) if (part[field]) out[field] = part[field];
    for (const [n, v] of Object.entries(part.variants || {})) out.variants[n] = { ...v, onTrack: false };
  }
  const key = courseKey(course);
  for (const part of parts) {
    const track = key && part.tracks?.[key];
    if (!track) continue;
    if (track.label) out.track = track.label;
    if (track.notes) out.trackNotes = track.notes;
    for (const [n, v] of Object.entries(track.variants || {})) out.variants[n] = { ...v, onTrack: true };
  }
  return out;
}

// The courses that document a type's variants: [{ course, label }], for a hint when the open track has none.
export function documentedCourses(type, custom = null) {
  const seen = new Map();
  for (const part of [defaultCollisions[type], custom?.[type]]) for (const [course, track] of Object.entries(part?.tracks || {})) if (track.variants) seen.set(course, track.label || course);
  return [...seen].map(([course, label]) => ({ course, label }));
}
