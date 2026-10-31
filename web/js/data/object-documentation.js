// Object documentation: what each object does and what its eight settings mean. The editor's own
// documentation is the JSON file object-documentation.json, in the same format a person can write;
// a JSON chosen with "Replace with JSON…" is used instead of it, until "Restore default".
// Object behaviour and setting names are paraphrased from the Custom Mario Kart object table:
// https://mkwiiki.org/wiki/Object . Unknown settings are deliberately left unnamed.
// Keys are ObjFlow.bin internal names, decimal IDs or hex IDs.
import DEFAULT_JSON from './object-documentation.json' with { type: 'json' };

// KMP stores every GOBJ setting as an unsigned 16-bit integer. This is the file
// limit, not a promise that the game's object logic accepts every such value.
export const OBJECT_SETTING_STORAGE_LIMIT = '0–65535 in the KMP file';

// A setting's real range: min / max of its documentation, inside the 16-bit storage, read as signed
// (−32768–32767) when the setting is signed.
export function settingRange(setting) {
  const signed = !!setting?.signed;
  const lo = signed ? -32768 : 0, hi = signed ? 32767 : 65535;
  return { signed, min: Math.max(lo, setting?.min ?? lo), max: Math.min(hi, setting?.max ?? hi) };
}
// The stored 16-bit value as shown in the editor, and back.
export const settingDisplayValue = (raw, setting) => (setting?.signed && raw > 32767 ? raw - 65536 : raw);
export const settingStoredValue = (value) => ((Math.round(value) % 65536) + 65536) % 65536;
// The documented choices of a setting, as [value, label] pairs sorted by value.
export const settingOptions = (setting) => (setting?.options
  ? Object.entries(setting.options).map(([value, label]) => [Number(value), label]).sort((a, b) => a[0] - b[0]) : []);

export function settingGuidance(setting) {
  const range = settingRange(setting);
  const ranged = !!setting && (setting.min !== undefined || setting.max !== undefined || !!setting.signed);
  const options = settingOptions(setting);
  return {
    values: setting?.values || (setting ? '' : 'Meaning not documented for this object.'),
    limits: ranged ? `${range.min}–${range.max}${range.signed ? ' (signed)' : ''}${setting.limits ? `. ${setting.limits}` : ''}`
      : setting?.limits || `${OBJECT_SETTING_STORAGE_LIMIT}; game-specific limit not documented.`,
    ...range, options, otherValues: !!setting?.otherValues,
  };
}


const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, where, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${where} must be a nonempty string of at most ${max} characters`);
  return value.trim();
};

// The input fields of a setting: signed, min, max (real limits of the value box), options (a list to
// choose from, { "value": "label" }) and otherValues (the list also allows typing another number).
function parseSettingInput(setting, where) {
  const out = {};
  for (const flag of ['signed', 'otherValues']) {
    if (setting[flag] === undefined) continue;
    if (typeof setting[flag] !== 'boolean') throw new Error(`${where}.${flag} must be true or false`);
    out[flag] = setting[flag];
  }
  const lo = out.signed ? -32768 : 0, hi = out.signed ? 32767 : 65535;
  const integer = (value, name) => {
    if (!Number.isInteger(value) || value < lo || value > hi) throw new Error(`${where}.${name} must be a whole number from ${lo} to ${hi}`);
    return value;
  };
  if (setting.min !== undefined) out.min = integer(setting.min, 'min');
  if (setting.max !== undefined) out.max = integer(setting.max, 'max');
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) throw new Error(`${where}.min must not be above max`);
  if (setting.options !== undefined) {
    if (!plain(setting.options)) throw new Error(`${where}.options must be an object such as { "0": "Off", "1": "On" }`);
    const entries = Object.entries(setting.options);
    if (!entries.length || entries.length > 256) throw new Error(`${where}.options must have 1 to 256 choices`);
    out.options = Object.create(null);
    for (const [value, label] of entries) {
      if (!/^-?[0-9]+$/.test(value)) throw new Error(`${where}.options key ${value} must be a whole number`);
      const n = integer(Number(value), `options key ${value}`);
      if ((out.min !== undefined && n < out.min) || (out.max !== undefined && n > out.max)) throw new Error(`${where}.options key ${value} is outside min–max`);
      out.options[n] = clean(label, `${where}.options.${value}`, 120);
    }
  }
  return out;
}

export function parseObjectDocumentation(input) {
  if (!plain(input) || input.version !== 1 || !plain(input.objects)) throw new Error('Expected { "version": 1, "objects": { ... } }');
  const entries = Object.entries(input.objects);
  if (!entries.length || entries.length > 1000) throw new Error('Provide 1 to 1000 object entries');
  const objects = Object.create(null);
  for (const [key, value] of entries) {
    if (!/^(?:0x[0-9a-f]+|[0-9]+|[A-Za-z_][A-Za-z0-9_.-]*)$/i.test(key)) throw new Error(`Invalid object key: ${key}`);
    const numeric = /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(key);
    const normalized = numeric ? String(/^0x/i.test(key) ? Number.parseInt(key, 16) : Number(key)) : key;
    if (numeric && (!Number.isSafeInteger(Number(normalized)) || Number(normalized) > 65535)) throw new Error(`${key} must be a 16-bit object ID`);
    if (!plain(value)) throw new Error(`${key} must be an object`);
    const entry = {};
    if (value.label !== undefined) entry.label = clean(value.label, `${key}.label`, 120);
    if (value.description !== undefined) entry.description = clean(value.description, `${key}.description`);
    if (value.notes !== undefined) entry.notes = clean(value.notes, `${key}.notes`);
    if (value.status !== undefined) {
      if (!STATUSES.includes(value.status)) throw new Error(`${key}.status must be "documented", "partial" or "unknown"`);
      entry.status = value.status;
    }
    if (value.documented !== undefined) {
      if (!Number.isInteger(value.documented) || value.documented < 0 || value.documented > 100) throw new Error(`${key}.documented must be a whole number from 0 to 100 (a percentage)`);
      entry.documented = value.documented;
    }
    if (value.settings !== undefined) {
      if (!plain(value.settings)) throw new Error(`${key}.settings must be an object`);
      entry.settings = Object.create(null);
      for (const [index, setting] of Object.entries(value.settings)) {
        if (!/^[1-8]$/.test(index)) throw new Error(`${key}.settings index must be 1–8`);
        if (!plain(setting)) throw new Error(`${key}.settings.${index} must have a label`);
        entry.settings[index] = { label: clean(setting.label, `${key}.settings.${index}.label`, 120) };
        if (setting.description !== undefined) entry.settings[index].description = clean(setting.description, `${key}.settings.${index}.description`);
        if (setting.values !== undefined) entry.settings[index].values = clean(setting.values, `${key}.settings.${index}.values`);
        if (setting.limits !== undefined) entry.settings[index].limits = clean(setting.limits, `${key}.settings.${index}.limits`);
        Object.assign(entry.settings[index], parseSettingInput(setting, `${key}.settings.${index}`));
      }
    }
    if (!Object.keys(entry).length) throw new Error(`${key} has no documentation`);
    if (entry.status === 'documented' && entry.documented !== undefined && entry.documented < 100) throw new Error(`${key}: "documented" needs 100%, use "partial" below that`);
    objects[normalized] = entry;
  }
  return objects;
}

const STATUSES = ['documented', 'partial', 'unknown'];

// The documentation of an object: from `custom` (a JSON chosen by the person, which replaces the
// default one) or else from the default JSON. An entry by ID completes the one by name.
export function objectDocumentation(id, internalName, custom = null) {
  const source = custom && Object.keys(custom).length ? custom : defaultObjects;
  const byName = Object.hasOwn(source, internalName) ? source[internalName] : {};
  const byId = Object.hasOwn(source, String(id)) ? source[String(id)] : {};
  const settings = {};
  for (const part of [byName.settings, byId.settings]) {
    for (const [index, setting] of Object.entries(part || {})) settings[index] = { ...settings[index], ...setting };
  }
  return { ...byName, ...byId, settings };
}

// How well an object is documented: { status: 'documented' | 'partial' | 'unknown', percent,
// estimated }. "status" and "documented" (a percentage) in the JSON are used when given; otherwise
// both are estimated from what the entry holds: half for a description, half for its eight settings.
export function documentationStatus(documentation) {
  const { status: given, documented } = documentation || {};
  const named = Object.values(documentation?.settings || {}).filter((s) => s?.label).length;
  const estimate = Math.round((documentation?.description ? 50 : 0) + named / 8 * 50);
  let percent = documented ?? (given === 'documented' ? 100 : given === 'unknown' ? 0 : estimate);
  if (given === 'partial' && documented === undefined) percent = Math.min(99, Math.max(1, percent));
  const status = given ?? (percent >= 100 ? 'documented' : percent <= 0 ? 'unknown' : 'partial');
  return { status, percent, estimated: given === undefined && documented === undefined };
}
export const STATUS_LABELS = { documented: 'Documented', partial: 'Partially documented', unknown: 'Unknown' };

// The default documentation, as shipped with the editor (also offered for export, to start a JSON from).
export const DEFAULT_OBJECT_DOCUMENTATION_JSON = DEFAULT_JSON;
export const BUILTIN_OBJECT_DOCUMENTATION = parseObjectDocumentation(DEFAULT_JSON);

// The latest default documentation is published in data/objects.json of this repository; the editor
// downloads it at start and uses it in place of the copy it was shipped with (useDefaultDocumentation).
export const OBJECT_INFO_REPO = 'https://github.com/WiiListZ/mkwii-advanced-editor-object-info';
export const OBJECT_INFO_URL = 'https://raw.githubusercontent.com/WiiListZ/mkwii-advanced-editor-object-info/main/data/objects.json';

// The default documentation in use: the shipped copy, or a newer one from OBJECT_INFO_URL.
// source: { kind: 'built-in' } or { kind: 'online', fetched: ISO date }.
let defaultObjects = BUILTIN_OBJECT_DOCUMENTATION, defaultJson = DEFAULT_JSON, defaultSource = { kind: 'built-in' };
export function useDefaultDocumentation(json, source) {
  const objects = json ? parseObjectDocumentation(json) : BUILTIN_OBJECT_DOCUMENTATION;
  defaultObjects = objects;
  defaultJson = json || DEFAULT_JSON;
  defaultSource = json ? source : { kind: 'built-in' };
  return objects;
}
export const defaultDocumentation = () => ({ objects: defaultObjects, json: defaultJson, source: defaultSource });

// A newer default documentation brought into the person's own documentation without touching their
// work. `custom` is their documentation, `base` the default it started from, `next` the newer default
// (all parsed). Object by object:
// - an entry they did not change (the same as in `base`) takes the newer one, or goes if it was removed;
// - an entry they changed, added or removed stays as they left it;
// - an object new in `next` (not in `base`) is added, unless they already have their own.
// Returns { objects, updated, added, removed, kept } (kept: their entries that differ from `next`).
export function mergeDocumentationUpdate(custom, base, next) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const has = (o, k) => Object.hasOwn(o, k);
  const objects = Object.create(null);
  let updated = 0, added = 0, removed = 0, kept = 0;
  for (const key of Object.keys(custom)) {
    const mine = custom[key];
    if (has(base, key) && same(mine, base[key])) {
      if (has(next, key)) { objects[key] = next[key]; if (!same(mine, next[key])) updated++; }
      else removed++;
    } else {
      objects[key] = mine;
      if (!has(next, key) || !same(mine, next[key])) kept++;
    }
  }
  for (const key of Object.keys(next)) {
    if (has(custom, key) || has(base, key)) continue; // theirs, or removed by them
    objects[key] = next[key];
    added++;
  }
  return { objects, updated, added, removed, kept };
}
