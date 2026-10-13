// Object behaviour and setting names are paraphrased from the Custom Mario Kart object table:
// https://mkwiiki.org/wiki/Object . Unknown settings are deliberately left unnamed.
// Keys are ObjFlow.bin internal names; imported records may also use decimal or hex IDs.
const doc = (description, settings = {}, notes = '') => ({ description, settings, ...(notes ? { notes } : {}) });
const field = (label, description = '', options = {}) => ({ label, description, ...options });

// KMP stores every GOBJ setting as an unsigned 16-bit integer. This is the file
// limit, not a promise that the game's object logic accepts every such value.
export const OBJECT_SETTING_STORAGE_LIMIT = '0–65535 in the KMP file';
export function settingGuidance(setting) {
  return {
    values: setting?.values || (setting ? '' : 'Meaning not documented for this object.'),
    limits: setting?.limits || `${OBJECT_SETTING_STORAGE_LIMIT}; game-specific limit not documented.`,
  };
}

const ITEM_TYPES = '0=default; 1=Banana; 2=Mushroom; 3=Triple Mushrooms; 4=Star; 5=Triple Green Shells; 6=Banana/Mushroom; 7=Green Shell; 8=Bob-omb; 9=Red Shell; 10=Mega Mushroom; 11=Thunder Cloud; 12=Star/Mushroom; 13–16=empty (grants Mushroom); 597 (0x255)=default.';
const ITEM_TYPE_LIMIT = 'Known original-game codes: 0–16 and 597. Other codes are not documented.';
const SIGNED_LIMIT = 'Signed −32768–32767; enter its 16-bit raw value (for example −1 = 65535).';
const LOTTERY_VALUES = '0=normal roulette, 150-frame respawn; 2–3=shorter roulette, 150-frame respawn; 4=shorter, 600-frame respawn; 5=normal, 600-frame respawn; 6=normal, 900-frame respawn.';

export const BUILTIN_OBJECT_DOCUMENTATION = {
  itembox: doc('Touching this rotating box starts an item lottery. Its item pools and timing can be changed per placement.', {
    2: field('Player item type', 'Item box item type for human players.', { values: ITEM_TYPES, limits: ITEM_TYPE_LIMIT }),
    3: field('CPU item type', 'Item box item type for computer players.', { values: ITEM_TYPES, limits: ITEM_TYPE_LIMIT }),
    4: field('Disable shadow', 'Hides the box shadow when set.', { values: '0=shadow visible; any nonzero value=shadow hidden.', limits: OBJECT_SETTING_STORAGE_LIMIT }),
    6: field('Lottery timing', 'Changes roulette duration and item-box respawn time. Short roulette does not work online.', { values: LOTTERY_VALUES, limits: 'Documented codes: 0, 2, 3, 4, 5, 6; other codes unverified.' }),
    7: field('Height offset', 'Signed offset from the object position.', { limits: SIGNED_LIMIT }),
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
    2: field('Route behaviour', 'Set to 0 when no route is assigned.', { values: '0=no route; 1=stomp at route points; 2=paired Thwomps moving sideways then down; 3=grounded side-to-side Thwomp.', limits: 'Known modes: 0–3; other values unverified.' }),
    3: field('Start delay', 'Frames after countdown starts; 240 (0xF0) starts immediately after GO.'),
    4: field('Sleep time', 'Time asleep after countdown starts, in frames.'),
  }, 'Without a route, settings 1 and 2 should be zero.'),
  pakkun_f: doc('Attacking Piranha Plant, normally paired with its pipe.', {
    1: field('Idle time', 'Frames between attacks in Time Trial and online races.'),
  }),
  pakkun_dokan: doc('Pipe used with the attacking Piranha Plant.'),
  wanwan: doc('Chained Chain Chomp that lunges toward a target area.', {
    1: field('Chain length', 'Chain length in game units.'),
    4: field('Target X', 'Signed target X coordinate divided by 10.', { limits: SIGNED_LIMIT }),
    5: field('Target Z', 'Signed target Z coordinate divided by 10.', { limits: SIGNED_LIMIT }),
    6: field('Wander time', 'Frames spent wandering. Zero uses about 5 seconds; add about 3.5 seconds for the full cycle.', { values: '0=about 5 seconds; positive values specify frames.' }),
    7: field('Lunge angle', 'Encoded as (wedge width in degrees − 35) / 2; the supported angular range is not documented.'),
  }),
  Hwanwan: doc('Route-following Chain Chomp from DS Peach Gardens.', {
    1: field('Speed'), 2: field('Carried item boxes', 'Number of item boxes carried.'),
  }, 'Use a curved route for this object.'),
  poihana: doc('Cataquack that flings players upward. In races it can seek nearby players.', {
    1: field('Colour', 'PAT0 body colour frame; a custom PAT0 may provide more colours.', { values: '0=Blue; 1=Red; 2=Violet; 3=Green.', limits: 'Original-game variants: 0–3; custom PAT0 range depends on its frames.' }),
    2: field('Detection distance', 'Distance at which it starts seeking players.'),
  }),
  DKrockGC: doc('Rolling rock from GCN DK Mountain that follows a route.', {
    1: field('Second-rock delay', 'A nonzero value introduces an approximately 1.5-second delay for the second rock.', { values: '0=no extra delay; nonzero=extra delay.', limits: OBJECT_SETTING_STORAGE_LIMIT }),
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
    2: field('Facing direction', 'Direction of the crab along the route.', { values: '0=Left; 1=Right.', limits: 'Known values: 0–1; other values unverified.' }),
  }),
  Crab: doc('Crab obstacle found near beaches.'),
  car_body: doc('Traffic car from Moonview Highway. Its route controls the path and blink direction.', {
    1: field('Route start'), 2: field('Speed mode 0', 'Speed for route setting 2 = 0.'),
    3: field('Speed mode 1', 'Speed for route setting 2 = 1.'),
    4: field('Car colour', 'Original car colour variant.', { values: '0=Blue; 1=Red; 2=Yellow.', limits: 'Known variants: 0–2; other values unverified.' }),
  }),
  kart_truck: doc('Traffic truck from Moonview Highway that follows a route.', {
    1: field('Route start'), 2: field('Speed mode 0'), 3: field('Speed mode 1'),
    4: field('Truck texture', 'Original truck texture variant.', { values: '0=Moo Moo; 1=Fruit; 2=Factory.', limits: 'Known variants: 0–2; other values unverified.' }),
  }),
  CarA2: doc('Moving car from Coconut Mall.', { 1: field('Speed'), 2: field('Acceleration'), 3: field('Pause time') }),
  CarA3: doc('Moving car from Coconut Mall.', { 1: field('Speed'), 2: field('Acceleration'), 3: field('Pause time') }),
  TruckWagon: doc('Mine cart obstacle that moves along the track.'),
  seagull: doc('Seagull that flies along a route.', {
    1: field('Speed', 'Flight speed along the route.'), 2: field('Seagull count', 'Number of birds; the supported maximum is not documented.'),
  }),
  Epropeller: doc('Electric propeller obstacle from Koopa Cape.', {
    1: field('Rotation speed', 'Number of rotations over 12 seconds in the normal game.'),
    2: field('Direction', 'Direction of rotation.', { values: '0=Clockwise; 1=Counterclockwise.', limits: 'Known values: 0–1; other values unverified.' }),
    8: field('Extended timing factor', 'Unused in the normal game. With LE-CODE or a compatible cheat, multiplies the period used by setting 1.', { values: '0=normal 12-second period; positive values use 12 × setting 8 seconds.', limits: 'Only meaningful with the compatible extension.' }),
  }),
  WLfirebarGC: doc('Rotating fire-bar obstacle from GCN Waluigi Stadium.', {
    1: field('Fireballs per arm'), 2: field('Rotation speed', 'Counterclockwise uses X; clockwise uses 65536 − X.', { values: '0=stationary; X=counterclockwise; 65536 − X=clockwise.', limits: OBJECT_SETTING_STORAGE_LIMIT }),
    3: field('Fireball spacing'), 4: field('Number of arms'),
  }),
  koopaFirebar: doc('Rotating fire-bar obstacle from Bowser’s Castle.', {
    1: field('Fireballs per arm'), 2: field('Rotation speed', 'Counterclockwise uses X; clockwise uses 65536 − X.', { values: '0=stationary; X=counterclockwise; 65536 − X=clockwise.', limits: OBJECT_SETTING_STORAGE_LIMIT }),
    3: field('Fireball spacing'), 4: field('Number of arms'),
  }),
  WLfireringGC: doc('Rotating ring of fireballs from GCN Waluigi Stadium.', {
    1: field('Fireball count'), 2: field('Rotation speed', 'Counterclockwise uses X; clockwise uses 65536 − X.', { values: '0=stationary; X=counterclockwise; 65536 − X=clockwise.', limits: OBJECT_SETTING_STORAGE_LIMIT }),
    3: field('Pulsation', 'Radius pulsation factor.', { values: '0=no pulsation; setting 3 ≥ setting 4 reverses the pulsation.' }),
    4: field('Radius', 'Ring radius. Zero disables pulsation.', { values: '0=no pulsation; positive values specify radius.' }),
  }),
  begoman_spike: doc('Spiked Topman from Galaxy Colosseum; its rings and appearance times are controlled by settings.', {
    1: field('Topman ID', 'One-based ID used by begoman_manager.', { limits: '1–65535 stored; supported count depends on the manager configuration.' }), 2: field('First ring radius'), 3: field('First switch time', 'Frames after race start.'),
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
