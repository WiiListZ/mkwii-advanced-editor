// Appearance is independent of the drawing and collision: changing a style
// keeps the layout, driving surface types and race settings intact.
export const SURFACES = {
  asphalt: { label: 'Asphalt', color: [.36, .37, .4] },
  grass: { label: 'Grass', color: [.3, .6, .22] },
  dirt: { label: 'Dirt', color: [.49, .32, .18] },
  sand: { label: 'Sand', color: [.78, .64, .39] },
  snow: { label: 'Snow', color: [.89, .93, .97] },
  stone: { label: 'Stone blocks', color: [.5, .45, .37] },
  barrier: { label: 'Concrete', color: [.7, .7, .68] },
  curb: { label: 'Red and white kerb', color: [.9, .9, .85] },
  checker: { label: 'Start line', color: [.95, .95, .95] },
  boost: { label: 'Boost arrows', color: [1, .6, 0] },
};
export const MATERIAL_ROLES = {
  road: { label: 'Road', surface: 'asphalt' },
  offroad: { label: 'Off-road', surface: 'grass' },
  wall: { label: 'Walls', surface: 'barrier' },
  curb: { label: 'Kerbs', surface: 'curb' },
  foundation: { label: 'Track sides and underside', surface: 'stone' },
  support: { label: 'Pillars', surface: 'barrier' },
  terrain: { label: 'Ground below the track', surface: 'grass' },
  startline: { label: 'Start line', surface: 'checker' },
  boost: { label: 'Boost panels', surface: 'boost' },
};
export const TRACK_STYLES = {
  circuit: { label: 'Asphalt circuit', description: 'Asphalt, grass verges, red and white kerbs and concrete walls.', surfaces: {}, colors: ['#45464a', '#477329', '#b8b9b2'] },
  rally: { label: 'Dirt rally', description: 'A dirt road through grass, with stone walls.', surfaces: { road: 'dirt', wall: 'stone', curb: 'dirt' }, colors: ['#80542e', '#477329', '#86745d'] },
  desert: { label: 'Desert', description: 'Sand on the road, verges and surrounding ground.', surfaces: { road: 'sand', offroad: 'sand', terrain: 'sand', curb: 'stone', wall: 'stone' }, colors: ['#c8aa6d', '#ddc28c', '#86745d'] },
  snow: { label: 'Snow', description: 'A snowy road and landscape with concrete barriers.', surfaces: { road: 'snow', offroad: 'snow', terrain: 'snow', curb: 'snow' }, colors: ['#dce5ec', '#f1f5fa', '#b8b9b2'] },
  castle: { label: 'Stone castle', description: 'Stone paving and masonry, surrounded by grass.', surfaces: { road: 'stone', wall: 'stone', curb: 'stone', support: 'stone' }, colors: ['#86745d', '#477329', '#766854'] },
};
export function trackMaterials(params = {}) {
  const style = TRACK_STYLES[params.style] || TRACK_STYLES.circuit;
  return Object.fromEntries(Object.entries(MATERIAL_ROLES).map(([role, defaults]) => {
    const override = params.textures?.[role], surface = override?.surface || style.surfaces[role] || defaults.surface;
    return [role, { color: SURFACES[surface]?.color || SURFACES[defaults.surface].color, surface,
      gameTexture: !override?.image && (surface === 'boost' || (params.textureSource !== 'builtin' && !override?.surface)),
      ...(override?.image ? { image: override.image } : {}), repeat: override?.repeat ?? 1 }];
  }));
}
