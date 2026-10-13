// Riivolution patch XML (<wiidisc>): the options a player chooses in the Riivolution menu and the
// patches they apply (files and folders replaced on the disc, memory patches). Parsed into a small
// model the editor can change and written back; elements the editor does not know are kept as they
// were, so opening and saving an existing XML does not lose anything.
// Format: https://riivolution.github.io/wiki/Patch_Format/

// ---- Minimal XML ----------------------------------------------------------------------------
// Riivolution files are plain XML (elements, attributes, comments); no DOM is needed.
const decode = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'amp') return '&';
  return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parseXML(text) {
  const root = { name: '#root', attrs: {}, children: [] }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) {
      const name = m[1];
      while (stack.length > 1 && stack[stack.length - 1].name !== name) stack.pop(); // tolerate unclosed tags
      if (stack.length > 1) stack.pop();
    } else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const el = { name: m[2], attrs, children: [] };
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  return root;
}

function writeElement(el, indent, out) {
  const attrs = Object.entries(el.attrs || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
  if (!el.children?.length) { out.push(`${indent}<${el.name}${attrs} />`); return; }
  out.push(`${indent}<${el.name}${attrs}>`);
  for (const child of el.children) writeElement(child, indent + '\t', out);
  out.push(`${indent}</${el.name}>`);
}

// ---- Model ----------------------------------------------------------------------------------
// mod = { attrs (of <wiidisc>), game, regions[], sections[{ name, attrs, options[{ attrs, choices[{ attrs, patches[{ id, params[], attrs }] }] }] }],
//         patches[{ attrs (id, root…), items[{ tag, attrs, source? }] }], extra[] (other elements of <wiidisc>) }
// `source` of an item is the file or folder on this computer copied by "Export mod folder"; it is
// not written to the XML.
export const ITEM_TAGS = ['file', 'folder', 'memory', 'savegame'];

export function parseRiivolution(text) {
  const wiidisc = parseXML(text).children.find((c) => c.name === 'wiidisc');
  if (!wiidisc) throw new Error('This is not a Riivolution XML (no <wiidisc> element)');
  const mod = { attrs: { ...wiidisc.attrs }, game: '', regions: [], idAttrs: {}, sections: [], patches: [], extra: [] };
  for (const el of wiidisc.children) {
    if (el.name === 'id') {
      const { game = '', ...rest } = el.attrs;
      mod.game = game; mod.idAttrs = rest;
      mod.regions = el.children.filter((c) => c.name === 'region').map((c) => c.attrs.type).filter(Boolean);
    } else if (el.name === 'options') {
      for (const s of el.children) {
        if (s.name !== 'section') { mod.extra.push({ where: 'options', el: s }); continue; }
        const { name = '', ...sectionAttrs } = s.attrs;
        mod.sections.push({
          name, attrs: sectionAttrs,
          options: s.children.filter((o) => o.name === 'option').map((o) => ({
            attrs: { ...o.attrs },
            choices: o.children.filter((c) => c.name === 'choice').map((c) => ({
              attrs: { ...c.attrs },
              patches: c.children.filter((p) => p.name === 'patch').map((p) => ({
                id: p.attrs.id || '', attrs: Object.fromEntries(Object.entries(p.attrs).filter(([k]) => k !== 'id')),
                params: p.children.filter((x) => x.name === 'param').map((x) => ({ ...x.attrs })),
              })),
            })),
          })),
        });
      }
    } else if (el.name === 'patch') {
      mod.patches.push({ attrs: { ...el.attrs }, items: el.children.map((c) => ({ tag: c.name, attrs: { ...c.attrs }, children: c.children })) });
    } else mod.extra.push({ where: 'wiidisc', el });
  }
  return mod;
}

export function buildRiivolution(mod) {
  const children = [];
  const id = { name: 'id', attrs: { game: mod.game, ...(mod.idAttrs || {}) }, children: (mod.regions || []).map((type) => ({ name: 'region', attrs: { type }, children: [] })) };
  if (mod.game || id.children.length) children.push(id);
  const optionsExtra = (mod.extra || []).filter((x) => x.where === 'options').map((x) => x.el);
  if (mod.sections.length || optionsExtra.length) children.push({
    name: 'options', attrs: {},
    children: [...optionsExtra, ...mod.sections.map((s) => ({
      name: 'section', attrs: { name: s.name, ...(s.attrs || {}) },
      children: s.options.map((o) => ({
        name: 'option', attrs: o.attrs,
        children: o.choices.map((c) => ({
          name: 'choice', attrs: c.attrs,
          children: c.patches.map((p) => ({ name: 'patch', attrs: { id: p.id, ...(p.attrs || {}) }, children: (p.params || []).map((a) => ({ name: 'param', attrs: a, children: [] })) })),
        })),
      })),
    }))],
  });
  for (const p of mod.patches) children.push({ name: 'patch', attrs: p.attrs, children: p.items.map((i) => ({ name: i.tag, attrs: i.attrs, children: i.children || [] })) });
  for (const x of (mod.extra || []).filter((x) => x.where === 'wiidisc')) children.push(x.el);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  writeElement({ name: 'wiidisc', attrs: { version: '1', ...mod.attrs }, children }, '', out);
  return out.join('\n') + '\n';
}

// A safe folder / id name from a mod name ("Red Item Box!" -> "RedItemBox").
export const modSlug = (name) => (String(name).replace(/[^A-Za-z0-9_-]+/g, '') || 'MyMod').slice(0, 40);

// A new mod: one section with one option that turns every listed file on.
// `files`: [{ disc: "/Race/Course/beginner_course.szs", source: "C:\\…\\beginner_course.szs" }]
export function newRiivolutionMod(name, files = [], game = 'RMC') {
  const slug = modSlug(name);
  return {
    attrs: {}, game, regions: [], idAttrs: {}, extra: [],
    sections: [{ name, attrs: {}, options: [{ attrs: { name: 'Enabled', id: `${slug}Enabled`, default: '1' }, choices: [{ attrs: { name: 'Enabled' }, patches: [{ id: slug, attrs: {}, params: [] }] }] }] }],
    patches: [{ attrs: { id: slug, root: `/${slug}` }, items: files.map((f) => fileItem(f.disc, f.source)) }],
  };
}

// A file replaced on the disc: stored in the mod folder under the same path as on the disc.
export function fileItem(disc, source = '') {
  const path = '/' + String(disc).replace(/\\/g, '/').replace(/^\/+/, '');
  return { tag: 'file', attrs: { disc: path, external: path.slice(1) }, source };
}
export function folderItem(disc, source = '') {
  const path = '/' + String(disc).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return { tag: 'folder', attrs: { disc: path, external: path.slice(1) || '.', create: 'true' }, source };
}

// Where an item's `external` lives inside an exported mod folder (relative to the SD card root).
export function externalPath(patch, item) {
  const ext = String(item.attrs.external || '').replace(/\\/g, '/');
  if (ext.startsWith('/')) return ext.slice(1);
  const root = String(patch.attrs.root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return (root ? root + '/' : '') + ext.replace(/^\.\/?/, '');
}

// Problems that stop a mod from loading or working, as messages.
export function checkRiivolution(mod) {
  const problems = [];
  const ids = new Set(mod.patches.map((p) => p.attrs.id));
  if (!mod.game) problems.push('Set the game ID (RMC for Mario Kart Wii).');
  if (!mod.sections.length) problems.push('Add a section with at least one option, or the mod cannot be turned on.');
  mod.patches.forEach((p, i) => {
    if (!p.attrs.id) problems.push(`Patch ${i + 1} has no ID.`);
    if (mod.patches.findIndex((q) => q.attrs.id === p.attrs.id) !== i) problems.push(`Two patches use the ID "${p.attrs.id}".`);
    for (const item of p.items) {
      if ((item.tag === 'file' || item.tag === 'folder') && !item.attrs.external) problems.push(`A ${item.tag} of "${p.attrs.id}" has no path in the mod folder.`);
      if (item.tag === 'file' && !item.attrs.disc && !item.attrs.offset) problems.push(`A file of "${p.attrs.id}" has no disc path.`);
      if (item.tag === 'memory' && !item.attrs.offset) problems.push(`A memory patch of "${p.attrs.id}" has no offset.`);
    }
  });
  for (const s of mod.sections) for (const o of s.options) {
    if (!o.attrs.name) problems.push(`An option of "${s.name}" has no name.`);
    for (const c of o.choices) for (const p of c.patches) if (!ids.has(p.id)) problems.push(`Option "${o.attrs.name}" uses the missing patch "${p.id}".`);
  }
  return [...new Set(problems)];
}

// Dolphin's launcher for a Riivolution mod (the .json files Dolphin lists as games): every option
// is set to its first choice.
export function dolphinLauncher(mod, { name, baseFile, sdRoot, xmlPath }) {
  return {
    'base-file': baseFile,
    'display-name': name,
    riivolution: {
      patches: [{
        options: mod.sections.flatMap((s) => s.options.map((o) => ({ choice: 1, 'option-name': o.attrs.name, 'section-name': s.name }))),
        root: sdRoot,
        xml: xmlPath,
      }],
    },
    type: 'dolphin-game-mod-descriptor',
    version: 1,
  };
}
