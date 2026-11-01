// Game screens that show a message, rebuilt from the game's own layout files (see menu-screens.js),
// with the message being edited in its text box. The tables below are what the game code decides
// (which button shows which character, cup or course); everything drawn comes from Scene/UI.


// BMG escape sequences as the game shows them: inserted characters (group 1), the controller's
// buttons, and sample values for what the game fills in while playing (names, numbers, courses).
export function gameText(text) {
  return text.replace(/\{1A:([0-9a-f]+)\}/gi, (_, hex) => {
    const group = parseInt(hex.slice(2, 4), 16), type = parseInt(hex.slice(4, 8), 16) || 0;
    const data = hex.slice(8);
    if (group === 1) return String.fromCharCode(parseInt(data.slice(0, 4), 16) || 0x20);
    if (group === 3 && type === 0) return String.fromCharCode(parseInt(data.slice(0, 4), 16) || 0x20); // per controller: first one
    if (group === 2) {
      if (type === 0x17) return ''; // B button
      if (type === 0x13) return 'Luigi Circuit';
      // 0x11 inserts another message chosen by the screen (a BMG reference): nothing to show here.
      if (type === 0x11) return '';
      if (type === 0x10 || type === 0x16) return '1'; // numbers
      return 'Player';
    }
    return '';
  });
}

export function sizedGameText(text) {
  const size = text.match(/^\{1A:0800000000[0-9a-f]{2}\}/i)?.[0] || '';
  return size + gameText(text);
}

const CHAR_ICON = {
  0x2328: 'mario', 0x2329: 'baby_peach', 0x232a: 'waluigi', 0x232b: 'koopa', 0x232c: 'baby_daisy', 0x232d: 'karon',
  0x232e: 'baby_mario', 0x232f: 'luigi', 0x2330: 'kinopio', 0x2331: 'donky', 0x2332: 'yoshi', 0x2333: 'wario',
  0x2334: 'baby_luigi', 0x2335: 'kinopico', 0x2336: 'noko', 0x2337: 'daisy', 0x2338: 'peach', 0x2339: 'catherine',
  0x233a: 'didy', 0x233b: 'teresa', 0x233c: 'koopa_jr', 0x233d: 'hone_koopa', 0x233e: 'funky', 0x233f: 'roseta',
  0x235c: 'mii_suit_a', 0x235d: 'mii_suit_b',
};
// Character selection: rows of four, light to heavy, then the two Mii outfits.
const CHAR_GRID = [
  [0x232e, 0x2334, 0x2329, 0x232c], [0x2330, 0x2335, 0x2336, 0x232d], [0x2328, 0x232f, 0x2338, 0x2337],
  [0x2332, 0x2339, 0x233a, 0x233c], [0x2333, 0x232a, 0x2331, 0x232b], [0x233b, 0x233f, 0x233e, 0x233d],
];
const CHAR_X = [-141, -47, 47, 141], CHAR_Y = [140, 90, 40, -10, -60, -110];

// Vehicles: ID order is (S, M, L) of the standard vehicle, then of vehicles a…e; icons st_<size><letter>_<kind>.
const VEHICLE_LETTERS = ['df', 'a', 'b', 'c', 'd', 'e'];
function vehicleOf(id) {
  for (const [first, kind] of [[0x238c, 'kart'], [0x23be, 'bike']]) {
    const i = id - first;
    if (i >= 0 && i < 18) return { kind, size: 'sml'[i % 3], letter: VEHICLE_LETTERS[Math.floor(i / 3)] };
    if (i >= 18 && i < 24) return { kind, size: 'sml'[(i - 18) % 3], letter: 'df' };
  }
  return null;
}
const vehicleId = (kind, size, letter) => (kind === 'kart' ? 0x238c : 0x23be) + VEHICLE_LETTERS.indexOf(letter) * 3 + 'sml'.indexOf(size);
const ABILITIES = [['Speed', 0xcef], ['Weight', 0xcf0], ['Accel', 0xcf1], ['Handling', 0xcf2], ['Drift', 0xcf3], ['Dirt', 0xcf4], ['Miniturbo', 0xcf5]];

// Cups and their courses, as the cup buttons list them (the second range of names is 0x3c later).
const CUP_ICONS = ['kinoko', 'flower', 'star', 'oukan', 'koura', 'banana', 'konoha', 'thunder'];
const CUP_COURSES = [
  [0x245c, 0x2455, 0x2456, 0x2458], [0x2454, 0x2459, 0x245a, 0x245b], [0x245d, 0x2463, 0x245f, 0x2457], [0x2462, 0x245e, 0x2460, 0x2461],
  [0x2464, 0x2468, 0x246d, 0x246e], [0x246f, 0x2473, 0x246b, 0x2466], [0x2469, 0x2472, 0x2471, 0x2465], [0x246c, 0x246a, 0x2467, 0x2470],
];
const ARENA_CUPS = [[0x24b9, 0x24b8, 0x24bb, 0x24ba, 0x24bc], [0x24bf, 0x24c0, 0x24c1, 0x24bd, 0x24be]];

export const DISPLAYS = {
  courseSelect: 'Cup and course selection',
  characterSelect: 'Character selection',
  vehicleSelect: 'Vehicle selection',
  battleStageSelect: 'Battle stage selection',
  raceIntro: 'Course introduction (race start)',
  menuButton: 'Menu button',
  instruction: 'Menu instruction bar',
  messageWindow: 'Message window',
  pauseMenu: 'Race pause menu button',
  raceMessage: 'Race message window',
};

// The screen where a message appears, from its file, ID and length.
export function defaultDisplay(file, id, text) {
  if (file === 'Common') {
    if (id >= 0x2328 && id <= 0x2381) return 'characterSelect';
    if (id >= 0x2382 && id <= 0x23ef) return 'vehicleSelect';
    if (id >= 0x23f0 && id <= 0x23f7) return 'courseSelect';
    if ((id >= 0x2454 && id <= 0x2486) || (id >= 0x2490 && id <= 0x24b7)) return 'courseSelect';
    if ((id >= 0x24b8 && id <= 0x24ff) || id === 0x2489 || id === 0x248a) return 'battleStageSelect';
  }
  const plain = gameText(text || '');
  const lines = plain.split('\n').length;
  if (file === 'Race') return lines > 1 || plain.length > 32 ? 'raceMessage' : 'pauseMenu';
  if (file === 'Menu') {
    if (lines > 2 || plain.length > 70) return 'messageWindow';
    if (/[.!?]$/.test(plain.trim())) return 'instruction';
    return plain.length <= 28 && lines === 1 ? 'menuButton' : 'instruction';
  }
  return 'messageWindow';
}

export const DISPLAY_ARCHIVES = { raceIntro: ['Race.szs'], pauseMenu: ['Race.szs'], raceMessage: ['Race.szs'] };
export const archivesFor = (display) => ['Font.szs', ...(DISPLAY_ARCHIVES[display] || ['MenuSingle.szs'])];

const button = (t) => ({ text: t, text_shadow: t, text_light_01: t, text_light_02: t });
const backdropTiles = new WeakMap();

function menuBackdrop(assets, ctx) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#1d1e24';
  ctx.fillRect(0, 0, width, height);
  let tile = backdropTiles.get(assets);
  if (!tile) {
    const texture = assets.texture('tt_pattern_chek_bokashi_32x32.tpl');
    if (texture) {
      tile = document.createElement('canvas');
      tile.width = texture.width; tile.height = texture.height;
      tile.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(texture.rgba), texture.width, texture.height), 0, 0);
      backdropTiles.set(assets, tile);
    }
  }
  if (tile) {
    ctx.save();
    ctx.globalAlpha = .16;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

// Draws `display` on the canvas. `text` is the message being edited (ID `id` of `file`), `lookup`
// gives the other messages shown on the same screen (current edits included).
export function drawDisplay(assets, ctx, display, { file, id, text, lookup }) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const shown = sizedGameText(text);
  const name = (msgId) => (msgId === id && file === 'Common' ? shown : gameText(lookup('Common', msgId) ?? ''));
  const menu = () => {
    menuBackdrop(assets, ctx);
    assets.drawControl(ctx, 'bg', 'MenuObiTop', 'MenuObiTop');
    assets.drawControl(ctx, 'bg', 'MenuObiBottom', 'MenuObiBottom');
  };
  const back = () => assets.drawControl(ctx, 'button', 'Back', 'ButtonBack', { anims: ['free'], text: button(gameText(lookup('Menu', 0x7d1) ?? '')) });
  const raceBackdrop = () => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2b3a4a'); g.addColorStop(1, '#10161d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };

  if (display === 'courseSelect') {
    menu();
    let cup = 0, course = -1, offset = 0;
    if (file === 'Common' && id >= 0x23f0 && id <= 0x23f7) cup = id - 0x23f0;
    else if (file === 'Common') {
      offset = id >= 0x2490 ? 0x3c : 0;
      CUP_COURSES.forEach((list, c) => { const at = list.indexOf(id - offset); if (at >= 0) { cup = c; course = at; } });
    }
    const cupAt = assets.place('control', 'CupSelectNULL', 'CupSelectCupNULL');
    const courseAt = assets.place('control', 'CupSelectNULL', 'CupSelectCourseNULL');
    const cupButton = (i) => assets.drawControl(ctx, 'control', 'CourseSelectCup', `Button${i}`, {
      at: cupAt, anims: [i === cup ? 'select@end' : 'free'], text: button(name(0x23f0 + i)), texture: { icon: `tt_cup_icon_${CUP_ICONS[i]}_00.tpl` },
    });
    // The selected cup is drawn last: its name overlaps the next icons.
    for (let i = 0; i < 8; i++) if (i !== cup) cupButton(i);
    cupButton(cup);
    CUP_COURSES[cup].forEach((courseId, row) => assets.drawControl(ctx, 'button', 'CourseSelectCourse', `Button${row}`, {
      at: courseAt, anims: [row === Math.max(0, course) ? 'select@end' : 'free'], text: button(name(courseId + offset)),
    }));
    back();
    return;
  }

  if (display === 'characterSelect') {
    menu();
    const at = assets.place('control', 'CharacterSelectNULL', 'CharacterSelectNULL');
    const focus = file === 'Common' && CHAR_ICON[id] ? id : 0x2328;
    const cell = (charId, x, y) => assets.drawControl(ctx, 'button', 'CharacterSelect4_0', null, {
      at: { x: at.x + x, y: at.y + y, scale: at.scale }, anims: [charId === focus ? 'select@end' : 'free'],
      texture: { 'tt_baby_luigi_64x64.tpl': `tt_${CHAR_ICON[charId]}_64x64.tpl` }, hide: ['ok_null'],
    });
    CHAR_GRID.forEach((row, r) => row.forEach((charId, c) => cell(charId, CHAR_X[c], CHAR_Y[r])));
    [0x235c, 0x235d].forEach((charId, i) => cell(charId, CHAR_X[2 + i], -160));
    const label = name(focus);
    assets.drawControl(ctx, 'control', 'CharacterSelectName', 'CharacterSelectName', { text: { mii_name: label, shadow: label } });
    back();
    return;
  }

  if (display === 'vehicleSelect') {
    menu();
    const v = (file === 'Common' && vehicleOf(id)) || { kind: 'kart', size: 'm', letter: 'df' };
    const base = assets.place('control', 'MachineSelectNULL6', 'MachineSelectNULL');
    ['kart', 'bike'].forEach((kind, col) => VEHICLE_LETTERS.forEach((letter, row) => {
      const rowAt = assets.place('control', 'MachineSelectNULL6', `MachineSelectNULL${row}`);
      const selected = kind === v.kind && letter === v.letter;
      assets.drawControl(ctx, 'button', 'MachineSelect2_6', `Button${col}`, {
        at: { x: base.x + rowAt.x, y: base.y + rowAt.y, scale: 1 }, anims: [selected ? 'select@end' : 'free'],
        texture: { 'tt_ma_kart.tpl': `st_${v.size}${letter}_${kind}.tpl`, 'tt_hatena_64x64.tpl': `st_${v.size}${letter}_${kind}.tpl` },
      });
    }));
    const abilityAt = assets.place('control', 'MachineAbilityNULL', 'MachineAbilityNULL');
    for (const [variant, msgId] of ABILITIES) {
      assets.drawControl(ctx, 'control', 'MachineAbility', variant, { at: abilityAt, text: { ability_text: gameText(lookup('Menu', msgId) ?? '') } });
    }
    const label = file === 'Common' && vehicleOf(id) ? shown : name(vehicleId(v.kind, v.size, v.letter));
    assets.drawControl(ctx, 'control', 'MachineSelectName', 'MachineSelectName', { text: { mii_name: label, shadow: label } });
    back();
    return;
  }

  if (display === 'battleStageSelect') {
    menu();
    let cup = 0, stage = 0, offset = 0;
    if (file === 'Common' && (id === 0x2489 || id === 0x248a)) cup = id - 0x2489;
    else if (file === 'Common') {
      for (offset = 0; offset <= 0x50 && !ARENA_CUPS.flat().includes(id - offset); offset += 0x14);
      ARENA_CUPS.forEach((list, c) => { const at = list.indexOf(id - offset); if (at >= 0) { cup = c; stage = at; } });
      if (offset > 0x50) offset = 0;
    }
    const cupAt = assets.place('control', 'BattleCupSelectNULL', 'CupSelectCupNULL');
    const stageAt = assets.place('control', 'BattleCupSelectNULL', 'CupSelectCourseNULL');
    const cupButton = (i) => assets.drawControl(ctx, 'control', 'BattleStageSelectCup', `Button${i}`, {
      at: cupAt, anims: [i === cup ? 'select@end' : 'free'], text: button(name(0x2489 + i)),
    });
    cupButton(1 - cup);
    cupButton(cup);
    ARENA_CUPS[cup].forEach((arenaId, row) => assets.drawControl(ctx, 'button', 'BattleStageSelectStage', `Button${row}`, {
      at: stageAt, anims: [row === stage ? 'select@end' : 'free'], text: button(name(arenaId + offset)),
    }));
    back();
    return;
  }

  if (display === 'raceIntro') {
    raceBackdrop();
    const isCup = file === 'Common' && id >= 0x23f0 && id <= 0x23f7;
    let courseName = shown, cupIndex = 0;
    if (isCup) { cupIndex = id - 0x23f0; courseName = name(CUP_COURSES[cupIndex][0]); }
    else CUP_COURSES.forEach((list, c) => { if (list.includes(id) || list.includes(id - 0x3c)) cupIndex = c; });
    const cupLine = isCup ? shown : name(0x23f0 + cupIndex);
    assets.drawControl(ctx, 'demo', 'cup_name', 'cup_name', { text: { cup_name: cupLine }, texture: { cup_icon: `tt_cup_icon_${CUP_ICONS[cupIndex]}_00.tpl` } });
    assets.drawControl(ctx, 'demo', 'course_name', 'course_name', { text: { course_name: courseName, shadow: courseName } });
    return;
  }

  if (display === 'menuButton') {
    menu();
    if (file === 'Menu' && id === 0x7d1) {
      assets.drawControl(ctx, 'button', 'Back', 'ButtonBack', { anims: ['free'], text: button(shown) });
      return;
    }
    assets.drawControl(ctx, 'message_window', 'YesNoButton', 'Option0', { anims: ['select@end'], text: { text: shown, text_light_01: shown } });
    back();
    return;
  }

  if (display === 'instruction') {
    menu();
    assets.drawControl(ctx, 'bg', 'MenuObiInstructionText', 'MenuObiInstructionText', { text: { text: shown } });
    back();
    return;
  }

  if (display === 'messageWindow') {
    menu();
    // The usual placement (error and menu messages); SystemMessageWindow sits 20 units higher.
    assets.drawControl(ctx, 'message_window', 'MessageWindow', 'MessageWindow', { text: { text: shown } });
    return;
  }

  if (display === 'pauseMenu') {
    raceBackdrop();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    assets.drawControl(ctx, 'button', 'PauseMenuGrandPrix', 'ButtonContinue', { anims: ['select@end'], text: { text: shown, text_light_01: shown } });
    return;
  }

  if (display === 'raceMessage') {
    raceBackdrop();
    assets.drawControl(ctx, 'game_image', 'RaceMessageWindow', 'MessageWindow', { text: { text: shown } });
  }
}


