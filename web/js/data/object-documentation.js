// Object behaviour and setting names are paraphrased from the Custom Mario Kart object table:
// https://mkwiiki.org/wiki/Object . Unknown settings are deliberately left unnamed.
// Keys are ObjFlow.bin internal names; imported records may also use decimal or hex IDs.
const doc = (description, settings = {}, notes = '') => ({ description, settings, ...(notes ? { notes } : {}) });
const field = (label, description = '', options = {}) => ({ label, description, ...options });

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

const ITEM_TYPES = {
  0: 'Default', 1: 'Banana', 2: 'Mushroom', 3: 'Triple Mushrooms', 4: 'Star', 5: 'Triple Green Shells', 6: 'Banana or Mushroom', 7: 'Green Shell',
  8: 'Bob-omb', 9: 'Red Shell', 10: 'Mega Mushroom', 11: 'Thunder Cloud', 12: 'Star or Mushroom', 13: 'Empty (gives a Mushroom)', 14: 'Empty (gives a Mushroom)',
  15: 'Empty (gives a Mushroom)', 16: 'Empty (gives a Mushroom)', 597: 'Default (0x255)',
};
const ITEM_TYPE_LIMIT = 'Other codes are not documented.';
const LOTTERY = { 0: 'Normal roulette, respawn after 150 frames', 2: 'Shorter roulette, respawn after 150 frames', 3: 'Shorter roulette, respawn after 150 frames',
  4: 'Shorter roulette, respawn after 600 frames', 5: 'Normal roulette, respawn after 600 frames', 6: 'Normal roulette, respawn after 900 frames' };
const ROTATION = { signed: true, values: 'Positive: counterclockwise; negative: clockwise; 0: stationary.' };

export const BUILTIN_OBJECT_DOCUMENTATION = {
  itembox: doc('Touching this rotating box starts an item lottery. Its item pools and timing can be changed per placement.', {
    2: field('Player item type', 'Item box item type for human players.', { options: ITEM_TYPES, otherValues: true, limits: ITEM_TYPE_LIMIT }),
    3: field('CPU item type', 'Item box item type for computer players.', { options: ITEM_TYPES, otherValues: true, limits: ITEM_TYPE_LIMIT }),
    4: field('Disable shadow', 'Hides the box shadow when set; any nonzero value hides it.', { options: { 0: 'Shadow visible', 1: 'Shadow hidden' }, otherValues: true }),
    6: field('Lottery timing', 'Changes roulette duration and item-box respawn time. Short roulette does not work online.', { options: LOTTERY, otherValues: true, limits: 'Other codes unverified.' }),
    7: field('Height offset', 'Signed offset from the object position.', { signed: true }),
  }),
  DummyPole: doc('Controls solidity of a pole already present in the course model.', { 1: field('Wall variant', 'KCL wall variant used for the pole.') }),
  kuribo: doc('Goomba that walks along a route and reappears after being hit.', {
    1: field('Respawn time', 'Time before the Goomba reappears after being hit; the game range is not documented.'),
    2: field('Speed', 'Route movement speed. A value of 32 (0x20) is a documented working example.'),
    3: field('Animation speed', 'Movement animation speed; the game range is not documented.'),
  }),
  choropu: doc('Moving Monty Mole from Moo Moo Meadows. Its route determines where it burrows or emerges.', {
    1: field('Speed'), 2: field('Start delay', 'Delay in frames (60 frames = one second).'),
  }, 'Do not use choropu and choropu2 together; they share a model resource.'),
  choropu2: doc('Alternate Monty Mole that appears at a fixed position.', {}, 'Do not use choropu and choropu2 together.'),
  cow: doc('A leader cow follows a route while other cows begin near the object position.', {
    1: field('Following cows', 'Number of cows behind the leader; the supported maximum is not documented.'),
    3: field('Follower delay', 'Start delay of the following cows, in frames (60 frames = one second).'),
    4: field('Leader lead time', 'How much earlier the leader cow starts, in frames.'),
  }),
  dossunc: doc('Thwomp obstacle that stomps in place or uses a route for more complex motion.', {
    1: field('Route speed', 'Set to 0 when no route is assigned.'),
    2: field('Route behaviour', 'Set to 0 when no route is assigned.', { options: { 0: 'No route', 1: 'Stomps at route points', 2: 'Paired Thwomps moving sideways, then down', 3: 'Grounded side-to-side Thwomp' }, otherValues: true, limits: 'Other values unverified.' }),
    3: field('Start delay', 'Frames after countdown starts; 240 (0xF0) starts immediately after GO.'),
    4: field('Sleep time', 'Time asleep after countdown starts, in frames.'),
  }, 'Without a route, settings 1 and 2 should be zero.'),
  pakkun_f: doc('Attacking Piranha Plant, normally paired with its pipe.', {
    1: field('Idle time', 'Frames between attacks in Time Trial and online races.'),
  }),
  pakkun_dokan: doc('Pipe used with the attacking Piranha Plant.'),
  wanwan: doc('Chained Chain Chomp that lunges toward a target area.', {
    1: field('Chain length', 'Chain length in game units.'),
    4: field('Target X', 'Signed target X coordinate divided by 10.', { signed: true }),
    5: field('Target Z', 'Signed target Z coordinate divided by 10.', { signed: true }),
    6: field('Wander time', 'Frames spent wandering. Zero uses about 5 seconds; add about 3.5 seconds for the full cycle.', { values: '0=about 5 seconds; positive values specify frames.' }),
    7: field('Lunge angle', 'Encoded as (wedge width in degrees − 35) / 2; the supported angular range is not documented.'),
  }),
  Hwanwan: doc('Route-following Chain Chomp from DS Peach Gardens.', {
    1: field('Speed'), 2: field('Carried item boxes', 'Number of item boxes carried.'),
  }, 'Use a curved route for this object.'),
  poihana: doc('Cataquack that flings players upward. In races it can seek nearby players.', {
    1: field('Colour', 'PAT0 body colour frame; a custom PAT0 may provide more colours.', { options: { 0: 'Blue', 1: 'Red', 2: 'Violet', 3: 'Green' }, otherValues: true, limits: 'A custom PAT0 may have more frames.' }),
    2: field('Detection distance', 'Distance at which it starts seeking players.'),
  }),
  DKrockGC: doc('Rolling rock from GCN DK Mountain that follows a route.', {
    1: field('Second-rock delay', 'A nonzero value introduces an approximately 1.5-second delay for the second rock.', { options: { 0: 'No extra delay', 1: 'Extra delay' }, otherValues: true, limits: 'Any nonzero value adds the delay.' }),
    2: field('Minimum cycle', 'Minimum cycle time in frames (60 frames = one second).'),
    3: field('Speed'), 4: field('Bounce factor'),
    5: field('Additional flag', 'Only value 1 is documented on GCN DK Mountain.', { values: '1=original-track value.', limits: 'Other values have no documented effect.' }),
  }, 'The route must use back-and-forth motion for the rock to respawn.'),
  sanbo: doc('Pokey from Dry Dry Ruins and DS Desert Hills that follows a route.', { 1: field('Speed', 'Movement speed along the route.') }, 'Route setting 1 controls the pause at each point in frames.'),
  sanbo_big: doc('Large Pokey variant used in a tournament.'),
  hanachan: doc('Wiggler from Maple Treeway that follows a route.', { 1: field('Speed') }, 'Route setting 1 controls pauses. Keep the route at suitable heights.'),
  basabasa: doc('Flying Swoopers that cross the course.'),
  FireSnake: doc('Ground-level fire enemy associated with DS Desert Hills.', {
    1: field('Sun route', 'Route used by the sun that releases it.'),
    2: field('Lifetime', 'Time before disappearing, in frames.'),
  }),
  crab: doc('Crab obstacle from GBA Shy Guy Beach that follows a route.', {
    1: field('Speed', 'Units per frame (60 frames = one second).'),
    2: field('Facing direction', 'Direction of the crab along the route.', { options: { 0: 'Left', 1: 'Right' }, otherValues: true, limits: 'Other values unverified.' }),
  }),
  Crab: doc('Crab obstacle found near beaches.'),
  car_body: doc('Traffic car from Moonview Highway. Its route controls the path and blink direction.', {
    1: field('Route start'), 2: field('Speed mode 0', 'Speed for route setting 2 = 0.'),
    3: field('Speed mode 1', 'Speed for route setting 2 = 1.'),
    4: field('Car colour', 'Original car colour variant.', { options: { 0: 'Blue', 1: 'Red', 2: 'Yellow' }, otherValues: true, limits: 'Other values unverified.' }),
  }),
  kart_truck: doc('Traffic truck from Moonview Highway that follows a route.', {
    1: field('Route start'), 2: field('Speed mode 0'), 3: field('Speed mode 1'),
    4: field('Truck texture', 'Original truck texture variant.', { options: { 0: 'Moo Moo', 1: 'Fruit', 2: 'Factory' }, otherValues: true, limits: 'Other values unverified.' }),
  }),
  CarA2: doc('Moving car from Coconut Mall.', { 1: field('Speed'), 2: field('Acceleration'), 3: field('Pause time') }),
  CarA3: doc('Moving car from Coconut Mall.', { 1: field('Speed'), 2: field('Acceleration'), 3: field('Pause time') }),
  TruckWagon: doc('Mine cart obstacle that moves along the track.'),
  seagull: doc('Seagull that flies along a route.', {
    1: field('Speed', 'Flight speed along the route.'), 2: field('Seagull count', 'Number of birds; the supported maximum is not documented.'),
  }),
  Epropeller: doc('Electric propeller obstacle from Koopa Cape.', {
    1: field('Rotation speed', 'Number of rotations over 12 seconds in the normal game.'),
    2: field('Direction', 'Direction of rotation.', { options: { 0: 'Clockwise', 1: 'Counterclockwise' }, otherValues: true, limits: 'Other values unverified.' }),
    8: field('Extended timing factor', 'Unused in the normal game. With LE-CODE or a compatible cheat, multiplies the period used by setting 1.', { values: '0=normal 12-second period; positive values use 12 × setting 8 seconds.', limits: 'Only meaningful with the compatible extension.' }),
  }),
  WLfirebarGC: doc('Rotating fire-bar obstacle from GCN Waluigi Stadium.', {
    1: field('Fireballs per arm'), 2: field('Rotation speed', 'Rotation speed and direction.', ROTATION),
    3: field('Fireball spacing'), 4: field('Number of arms'),
  }),
  koopaFirebar: doc('Rotating fire-bar obstacle from Bowser’s Castle.', {
    1: field('Fireballs per arm'), 2: field('Rotation speed', 'Rotation speed and direction.', ROTATION),
    3: field('Fireball spacing'), 4: field('Number of arms'),
  }),
  WLfireringGC: doc('Rotating ring of fireballs from GCN Waluigi Stadium.', {
    1: field('Fireball count'), 2: field('Rotation speed', 'Rotation speed and direction.', ROTATION),
    3: field('Pulsation', 'Radius pulsation factor.', { values: '0=no pulsation; setting 3 ≥ setting 4 reverses the pulsation.' }),
    4: field('Radius', 'Ring radius. Zero disables pulsation.', { values: '0=no pulsation; positive values specify radius.' }),
  }),
  begoman_spike: doc('Spiked Topman from Galaxy Colosseum; its rings and appearance times are controlled by settings.', {
    1: field('Topman ID', 'One-based ID used by begoman_manager.', { min: 1, limits: 'The supported count depends on the manager configuration.' }), 2: field('First ring radius'), 3: field('First switch time', 'Frames after race start.'),
    4: field('Second ring radius'), 5: field('Second switch time', 'Frames after race start.'),
    6: field('Third ring radius'), 7: field('Third switch time', 'Frames after race start.'),
    8: field('Fourth ring radius'),
  }),
  sun: doc('Sun and lighting effect used by desert courses.'),
  psea: doc('Animated sea from GCN Peach Beach.'),
  Psea: doc('Animated sea from GCN Peach Beach.'),
  lensFX: doc('Lens flare positioned near the course light source.'),
  venice_nami: doc('Sea level effect from Delfino Pier, with several rising and falling stages.'),
  flagBlend: doc('Animated course flag.'),
  MashBalloonGC: doc('Mushroom balloon decoration.'),
  kinoko_ud: doc('Moving bouncy mushroom from Mushroom Gorge.'),
  puchi_pakkun: doc('Small Piranha Plant obstacle from N64 Mario Raceway.'),
  Press: doc('Moving press obstacle.'),
  airblock: doc('Invisible box used as a barrier in tournaments.'),
  coin: doc('Collectible coin used in battle arenas.'),
};

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
    objects[normalized] = entry;
  }
  return objects;
}

export function objectDocumentation(id, internalName, imported = {}) {
  const built = Object.hasOwn(BUILTIN_OBJECT_DOCUMENTATION, internalName) ? BUILTIN_OBJECT_DOCUMENTATION[internalName] : {};
  const byName = Object.hasOwn(imported, internalName) ? imported[internalName] : {};
  const byId = Object.hasOwn(imported, String(id)) ? imported[String(id)] : {};
  const settings = {};
  for (const source of [built.settings, byName.settings, byId.settings]) {
    for (const [index, setting] of Object.entries(source || {})) settings[index] = { ...settings[index], ...setting };
  }
  return { ...built, ...byName, ...byId, settings };
}
