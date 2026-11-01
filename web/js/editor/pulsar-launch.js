// Play files for a new cup pack: the original game is started with the Pulsar patch enabled.
// My Stuff stays off, so unrelated CTGP files cannot override the new pack.
import { buildRiivolution, parseRiivolution } from '../formats/riivolution.js';

export function pulsarLaunchPaths(name, folder) {
  const root = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  return {
    sdRoot: /^[A-Za-z]:$/.test(root) ? `${root}/` : root || '/',
    xmlPath: `${root}/riivolution/${name}.xml`,
    instructionsPath: `${root}/${name}/HOW TO PLAY.txt`,
  };
}

export function pulsarInstructions(name, regsMode = 1) {
  return [
    `${name} - Riivolution cup pack`, '',
    regsMode > 0 ? 'The original eight race cups and your custom cups are available together.' : 'This pack shows custom cups only; the original race cups are hidden.',
    regsMode === 1 ? 'The cup selection starts with the original cups; your custom cups follow them.' : regsMode === 2 ? 'The cup selection starts with your custom cups; the original cups are also available.' : '',
    `Keep the ${name} folder and the riivolution folder together in the pack's root folder.`, '',
    `Load riivolution/${name}.xml with Riivolution.`,
    `Under ${name}, set Pack to Enabled and launch Mario Kart Wii.`, '',
    'Opening the original game normally does not load these extra cups.',
  ].join('\r\n') + '\r\n';
}

export function buildPulsarLaunch(template, name, folder, regsMode = 1) {
  const paths = pulsarLaunchPaths(name, folder);
  const mod = parseRiivolution(template.replaceAll('{$pack}', name));
  const options = mod.sections.flatMap((s) => s.options);
  const pack = options.find((o) => o.choices.some((c) => c.patches.some((p) => p.id === `${name}LoadPack`)));
  if (!pack) throw new Error('The Pulsar launch template has no pack option');
  for (const option of options) option.attrs.default = option === pack ? '1' : '0';
  const xml = buildRiivolution(mod);
  const instructions = pulsarInstructions(name, regsMode);
  return { paths, xml, instructions };
}
