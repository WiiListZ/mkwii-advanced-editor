// Game screens that show a message, rebuilt from the game's own layout files (see menu-screens.js),
// with the message being edited in its text box. The tables below are what the game code decides
// (which button shows which character, cup or course); everything drawn comes from Scene/UI.
import { isBmgStyle } from '../formats/bmg-style.js';


// BMG escape sequences as the game shows them: inserted characters (group 1), the controller's
// buttons, and sample values for what the game fills in while playing (names, numbers, courses).
export function gameText(text, { buttonIcon = '' } = {}) {
  return text.replace(/\{1A:([0-9a-f]+)\}/gi, (_, hex) => {
    const group = parseInt(hex.slice(2, 4), 16), type = parseInt(hex.slice(4, 8), 16) || 0;
    const data = hex.slice(8);
    if (group === 1) return String.fromCharCode(parseInt(data.slice(0, 4), 16) || 0x20);
    if (group === 3 && type === 0) return String.fromCharCode(parseInt(data.slice(0, 4), 16) || 0x20); // per controller: first one
    if (group === 2) {
      if (type === 0x17) return buttonIcon; // B button when passed by the control (Back)
      if (type === 0x13) return 'Luigi Circuit';
      // 0x11 inserts another message chosen by the screen (a BMG reference): nothing to show here.
      if (type === 0x11) return '';
      if (type === 0x10 || type === 0x16) return '1'; // numbers
      return 'Player';
    }
    return '';
  });
}

export function sizedGameText(text, options) {
  return text.replace(/\{1A:([0-9a-f]+)\}/gi, (tag, hex) => {
    if (isBmgStyle(hex)) return tag;
    return gameText(tag, options);
  });
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
const BATTLE_CUP_ICONS = ['tt_wii_icon_128.tpl', 'tt_classic_icon_sphere_128.tpl'];
const cupTexture = (texture) => ({ icon: texture, icon_light_01: texture, icon_light_02: texture });
const CUP_COURSES = [
  [0x245c, 0x2455, 0x2456, 0x2458], [0x2454, 0x2459, 0x245a, 0x245b], [0x245d, 0x2463, 0x245f, 0x2457], [0x2462, 0x245e, 0x2460, 0x2461],
  [0x2464, 0x2468, 0x246d, 0x246e], [0x246f, 0x2473, 0x246b, 0x2466], [0x2469, 0x2472, 0x2471, 0x2465], [0x246c, 0x246a, 0x2467, 0x2470],
];
const ARENA_CUPS = [[0x24b9, 0x24b8, 0x24bb, 0x24ba, 0x24bc], [0x24bf, 0x24c0, 0x24c1, 0x24bd, 0x24be]];

export const DISPLAYS = {
  mainMenu: 'Main menu',
  modeSelect: 'Single-player mode selection',
  classSelect: 'Engine class selection',
  driftSelect: 'Drift mode selection',
  battleType: 'Battle type selection',
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
  menuTitle: 'Menu title',
  afterRaceMenu: 'After-race menu button',
  raceCountdown: 'Race countdown and finish banner',
  raceStatus: 'Race status message',
  resultPosition: 'Race results position',
  controllerHelp: 'Controller help',
  pressStart: 'Title screen prompt',
  controllerMessage: 'Controller connection message',
  ghostMessage: 'Ghost data save message',
  liveMessage: 'Online race and spectator message',
  awardMessage: 'Award ceremony message',
  channelInstall: 'Mario Kart Channel installation',
  genericWindow: 'Message window (generic preview)',
  genericRaceWindow: 'Race message window (generic preview)',
};

export const CONTROLLER_PREVIEWS = {
  han_con: 'Wii Wheel / Wii Remote', nun_con: 'Wii Remote + Nunchuk', cla_con: 'Classic Controller', gc_con: 'GameCube Controller',
};

// One ID-based binding supplies both the automatic preview and its real txt1 capacity.
// Names/variants/panes are from the original Scene/UI BRCTR/BRLYT files; IDs are checked
// against the original BMGs, with call sites cross-checked where available in MKW-SP:
// https://github.com/mkw-sp/mkw-sp/tree/d2511168b4f102ac871bf0b6e9c089f0f8bfeeb0/payload/game/ui
// Text length and punctuation cannot identify a control: they vary between translations/mods.
export const MESSAGE_PLACEMENTS = new Map();
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function bind(file, ids, display, control, options = {}) {
  for (const id of ids) MESSAGE_PLACEMENTS.set(`${file}:${id}`, { file, id, display, control, singleLine: true, ...options });
}
const title = ['bg', 'MenuObiTitleText', 'text'];
bind('Common', [...Object.keys(CHAR_ICON).map(Number), 0x2340, 0x235a, 0x235b], 'characterSelect', ['control', 'CharacterSelectName', 'mii_name']);
bind('Common', range(0x238c, 0x23d5).filter((id) => vehicleOf(id)), 'vehicleSelect', ['control', 'MachineSelectName', 'mii_name']);
bind('Common', range(0x23f0, 0x23f7), 'courseSelect', ['control', 'CourseSelectCup', 'text']);
bind('Common', CUP_COURSES.flatMap((ids) => ids.flatMap((id) => [id, id + 0x3c])), 'courseSelect', ['button', 'CourseSelectCourse', 'text']);
bind('Common', [...ARENA_CUPS.flat(), ...ARENA_CUPS.flat().map((id) => id + 0x14), ...range(0x24ea, 0x24ee)], 'battleStageSelect', ['button', 'BattleStageSelectStage', 'text']);
bind('Common', [0x2489, 0x248a], 'battleStageSelect', ['control', 'BattleStageSelectCup', 'text']);
bind('Common', [0x2487, 0x2488], 'battleType', ['button', 'BattleSelect', 'text']);
bind('Menu', [0x7d0], 'menuButton', ['message_window', 'ConfirmOK', 'text'], { variant: 'OK' });
bind('Menu', [0x7d1], 'menuButton', ['button', 'Back', 'text'], { variant: 'ButtonBack' });
bind('Menu', [0x7d2, 0x7d3], 'menuButton', ['message_window', 'YesNoButton', 'text'], { variant: 'Option0' });
for (const [ids, name] of [[[0x7db], 'TopMenuSingleWaku'], [[0x7dc, 0x7ee, 0x7ef, 0x7f0], 'TopMenuMultiWaku'], [[0x7dd, 0x7f1, 0x7f2], 'TopMenuWifiWaku'], [[0x7de], 'TopMenuChannelWaku']])
  bind('Menu', ids, 'mainMenu', ['button', name, 'text'], { variant: name });
bind('Menu', [0x7e2], 'mainMenu', title);
bind('Menu', [0x838, 0x84b, 0xc1c, 0xc80, 0xd48, 0xd4f, 0xd50, 0xd51, 0xdac, 0xfa4], 'menuTitle', title);
for (const [id, display] of [[0xd49, 'classSelect'], [0xd4a, 'characterSelect'], [0xd4b, 'vehicleSelect'], [0xd4c, 'courseSelect'], [0xd4d, 'courseSelect'], [0xd4e, 'battleStageSelect'], [0xce9, 'driftSelect']]) bind('Menu', [id], display, title);
bind('Menu', range(0xbb8, 0xbbb), 'modeSelect', ['button', 'SingleTop', 'text']);
bind('Menu', range(0xbbe, 0xbc3), 'classSelect', ['button', 'ClassSelect2', 'text'], { singleLine: false });
bind('Menu', [0xc81, 0xc82], 'battleType', ['button', 'BattleSelect', 'text']);
bind('Menu', [0xcea, 0xceb], 'driftSelect', ['button', 'PadEasy', 'text']);
bind('Menu', [0xcec], 'driftSelect', ['button', 'DriftHelp', 'text'], { variant: 'DriftHelp' });
bind('Menu', range(0xcef, 0xcf5), 'vehicleSelect', ['control', 'MachineAbility', 'ability_text']);
bind('Menu', [...range(0x7e4, 0x7eb), 0x849, 0x84a, 0x850, ...range(0xbea, 0xbef), ...range(0xbf4, 0xbf9), 0xcb2, 0xcb3, 0xcee, 0xd16, 0xd17, ...range(0xd57, 0xd5a), ...range(0xd61, 0xd64), ...range(0xd6a, 0xd6f), ...range(0xd74, 0xd79), ...range(0xd89, 0xd8c), ...range(0xd90, 0xd93), ...range(0xd9d, 0xda0), 0xdb0], 'instruction', ['bg', 'MenuObiInstructionText', 'text'], { singleLine: false });
bind('Menu', [0xced, 0x157f], 'messageWindow', ['message_window', 'MessageWindow', 'text'], { singleLine: false });
bind('Race', [0x3e9, 0x3ea, 0x454, 0x455], 'menuButton', ['message_window', 'YesNoButton', 'text'], { variant: 'Option0' });
bind('Race', [0x44f], 'menuButton', ['message_window', 'ConfirmOK', 'text'], { variant: 'OK' });
bind('Race', [...range(0x3eb, 0x3ef), 0x3f5, 0x3f6, 0x3fd], 'pauseMenu', ['button', 'PauseMenuTimeAttack', 'text']);
bind('Race', [0x3f0, ...range(0x3f1, 0x3f4), 0x3f7, 0x3f8, 0x3fa, 0x3fc, ...range(0x3fe, 0x400), ...range(0x402, 0x406), 0x408, 0x452, 0x453], 'afterRaceMenu', ['button', 'AfterMenuTimeAttack', 'text']);
bind('Race', [0x401], 'raceMessage', ['game_image', 'RaceMessageWindow', 'text'], { singleLine: false });
bind('Race', [0x407], 'raceStatus', ['control', 'WifiConnectNum', 'TextBox_00'], { variant: 'ConnectNum', singleLine: false });
for (const [i, variant] of ['Count3', 'Count2', 'Count1', 'CountGO', 'CountFinish'].entries()) bind('Race', [0x4b1 + i], 'raceCountdown', ['game_image', 'count', 'text_00'], { variant, anims: ['fade_in@10'], panes: ['text_00', 'text_01', 'text_light'] });
bind('Race', [0x4b6, 0x4b7], 'raceCountdown', ['game_image', 'BattleWin', 'text_00'], { variant: 'BattleWin', panes: ['text_00', 'text_light'] });
bind('Race', [0x4bb], 'raceCountdown', ['game_image', 'newrecord', 'text_00'], { variant: 'NewRecord', panes: ['text_00', 'text_light'] });
bind('Race', range(0x515, 0x520), 'resultPosition', ['result', 'ResultGP', 'position']);
bind('Race', [0x539], 'raceStatus', ['game_image', 'Live', 'menu_text'], { variant: 'Live' });
bind('Race', range(0x581, 0x588), 'raceIntro', ['demo', 'cup_name', 'cup_name'], { part: 'cup', singleLine: false });
for (const [id, pane] of [[0x5dc, 'item'], [0x5dd, 'handle'], [0x5de, 'accel'], [0x5df, 'brake'], [0x5e0, 'brake']]) bind('Race', [id], 'controllerHelp', ['game_image', 'PadInfoCore', pane], { variant: 'PadInfoCore' });
bind('Menu', [0x7e1], 'pressStart', ['press_start', 'PressStart', 'text_00'], { variant: 'press_start', panes: ['text_00', 'text_light'], anims: ['fade_in@end', 'wait'] });
bind('Common', range(0x26ac, 0x26b0), 'controllerMessage', ['pad_recognize', 'RecognizePadWindow', 'text'], { variant: 'RecognizePadWindow', singleLine: false });
bind('Race', [0x45b, 0x45c], 'ghostMessage', ['game_image', 'GhostMessage', 'TextBox_00'], { variant: 'GhostMessage', singleLine: false });
bind('Race', [0x53a, 0x53b], 'liveMessage', ['game_image', 'LiveMessage', 'TextBox_00'], { variant: 'LiveMessage', singleLine: false });
bind('Race', [0x53c, 0x53d, 0x53e], 'liveMessage', ['game_image', 'WifiMessage', 'TextBox_00'], { variant: 'FinishMessage_1_0', singleLine: false });
for (const [ids, name] of [[[0x4c2], 'AwardCongratulationsDraw'], [[0x4c3, 0x4c4, 0x4c5], 'AwardCongratulationsWin'], [[0x4c6, 0x4c7, 0x4c8, 0x4c9, 0x4ca], 'AwardCongratulationsLose']])
  bind('Race', ids, 'awardMessage', ['award', name, 'text_00'], { variant: 'Congratulations', panes: ['text_00', 'text_light'], anims: ['fade_in@end', 'wait'], singleLine: false });
bind('Menu', [0xa28], 'channelInstall', ['message_window', 'MessageWindowHalf', 'text'], { variant: 'MessageWindowHalf', singleLine: false });
bind('Menu', [0xa29, 0xa2a], 'channelInstall', ['message_window', 'YesNoButton', 'text']);
bind('Menu', [0xa2f], 'channelInstall', title);

export const messagePlacement = (file, id) => MESSAGE_PLACEMENTS.get(`${file}:${id}`) || null;
export const defaultDisplay = (file, id, _text) => messagePlacement(file, id)?.display || (file === 'Race' ? 'genericRaceWindow' : 'genericWindow');

export const DISPLAY_ARCHIVES = { mainMenu: ['Title.szs'], pressStart: ['Title.szs'], awardMessage: ['Award.szs'], ghostMessage: ['Race.szs'], liveMessage: ['Race.szs'], genericRaceWindow: ['Race.szs'], raceIntro: ['Race.szs'], pauseMenu: ['Race.szs'], afterRaceMenu: ['Race.szs'], raceMessage: ['Race.szs'], raceCountdown: ['Race.szs'], raceStatus: ['Race.szs'], resultPosition: ['Race.szs'], controllerHelp: ['Race.szs'] };
export const archivesFor = (display) => display === 'font' ? ['Font.szs'] : ['Font.szs', ...(DISPLAY_ARCHIVES[display] || ['MenuSingle.szs'])];

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
// gives the other messages shown on the same screen (current edits included). `previewText`
// puts this message in the focused text box when manually trying a different screen layout.
export function drawDisplay(assets, ctx, display, { file, id, text, lookup, previewText = false, controller = 'han_con' }) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const placement = messagePlacement(file, id);
  const binding = placement?.display === display ? placement : null;
  const isTitle = binding?.control[1] === 'MenuObiTitleText';
  // Message windows (such as the drift help 0x0ced) pass no button icon to group 2 tag 0x17; Back does.
  const noButtonIcon = (file === 'Menu' && id === 0xced) || ['messageWindow', 'raceMessage', 'genericWindow', 'genericRaceWindow', 'channelInstall'].includes(display);
  const shown = sizedGameText(text, { buttonIcon: noButtonIcon ? '' : '' });
  const name = (msgId) => (msgId === id && file === 'Common' ? shown : sizedGameText(lookup('Common', msgId) ?? ''));
  const menu = () => {
    menuBackdrop(assets, ctx);
    assets.drawControl(ctx, 'bg', 'MenuObiTop', 'MenuObiTop');
    assets.drawControl(ctx, 'bg', 'MenuObiBottom', 'MenuObiBottom');
    const titleId = ({ mainMenu: 0x7e2, modeSelect: 0x7db, classSelect: 0xd49, driftSelect: 0xce9, characterSelect: 0xd4a, vehicleSelect: 0xd4b, courseSelect: 0xd4d, battleStageSelect: 0xd4e, battleType: 0xc80, channelInstall: 0xa2f })[display];
    const label = isTitle ? shown : titleId ? sizedGameText(lookup('Menu', titleId) ?? '') : '';
    if (label) assets.drawControl(ctx, 'bg', 'MenuObiTitleText', 'MenuObiTitleText', { text: { text: label } });
  };
  const back = () => assets.drawControl(ctx, 'button', 'Back', 'ButtonBack', { anims: ['free'], text: button(sizedGameText(lookup('Menu', 0x7d1) ?? '')) });
  const raceBackdrop = () => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2b3a4a'); g.addColorStop(1, '#10161d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };

  const menuName = (msgId) => file === 'Menu' && id === msgId ? shown : sizedGameText(lookup('Menu', msgId) ?? '');
  if (['modeSelect', 'classSelect', 'driftSelect', 'battleType', 'mainMenu'].includes(display)) {
    menu();
    let rows;
    if (display === 'modeSelect') rows = [[0xbb8, 'SingleTop', 'ButtonGP'], [0xbb9, 'SingleTop', 'ButtonTA'], [0xbba, 'SingleTop', 'ButtonVS'], [0xbbb, 'SingleTop', 'ButtonBT']];
    if (display === 'classSelect') rows = [[0xbbe, 'ClassSelect2', 'Button50cc'], [0xbbf, 'ClassSelect2', 'Button100cc'], [0xbc0, 'ClassSelect2', 'Button150cc'], [0xbc1, 'ClassSelect2', 'ButtonMirror']];
    if (display === 'driftSelect') rows = [[0xcea, 'PadEasy', 'ButtonEasy'], [0xceb, 'PadEasy', 'ButtonNormal'], [0xcec, 'DriftHelp', 'DriftHelp']];
    if (display === 'battleType') rows = [[0xc81, 'BattleSelect', 'ButtonBalloon'], [0xc82, 'BattleSelect', 'ButtonCoin']];
    if (display === 'mainMenu') rows = [[0x7db, 'TopMenuSingleWaku', 'TopMenuSingleWaku'], [0x7dc, 'TopMenuMultiWaku', 'TopMenuMultiWaku'], [0x7dd, 'TopMenuWifiWaku', 'TopMenuWifiWaku'], [0x7de, 'TopMenuChannelWaku', 'TopMenuChannelWaku']];
    let focus = rows.findIndex(([msg]) => file === 'Menu' && msg === id);
    if (display === 'classSelect' && id >= 0xbc2 && id <= 0xbc3) focus = id - 0xbc2;
    if (display === 'battleType' && file === 'Common') focus = id - 0x2487;
    if (display === 'mainMenu' && binding && !isTitle) focus = rows.findIndex(([, ctrl]) => ctrl === binding.control[1]);
    if (focus < 0) focus = 0;
    rows.forEach(([msg, ctrl, variant], row) => {
      const selected = row === focus;
      const showEdited = !isTitle && selected && (binding || previewText);
      const label = showEdited ? shown : menuName(msg);
      assets.drawControl(ctx, 'button', ctrl, selected && binding?.variant ? binding.variant : variant, {
        anims: [selected ? 'select@end' : 'free'], text: display === 'mainMenu' ? { text_sha: label, text: label, text_light: label, text_00: label } : button(label),
        ...(display === 'classSelect' ? { texture: { 'tt_class_kinoko_m.tpl': `tt_class_kinoko_${['1', '2', '3', 'm'][row]}.tpl` } } : {}),
      });
    });
    back(); return;
  }

  if (display === 'channelInstall') {
    menu();
    assets.drawControl(ctx, 'message_window', 'MessageWindowHalf', 'MessageWindowHalf', { text: { text: previewText && !binding ? shown : menuName(0xa28) } });
    [0xa29, 0xa2a].forEach((msg, row) => assets.drawControl(ctx, 'message_window', 'YesNoButton', `Option${row}`, {
      anims: [file === 'Menu' && id === msg || row === 0 && ![0xa29, 0xa2a].includes(id) ? 'select@end' : 'free'], text: button(menuName(msg)),
    }));
    return;
  }

  if (display === 'menuTitle') {
    menu();
    if (!isTitle) assets.drawControl(ctx, 'bg', 'MenuObiTitleText', 'MenuObiTitleText', { text: { text: shown } });
    back(); return;
  }

  if (display === 'controllerMessage') {
    // RecognizePad is a system overlay: BlackBackControlForMessage, the window, then a
    // separate PadControl attached at icon_set_null. The empty window alone is incomplete.
    ctx.fillStyle = '#202228'; ctx.fillRect(0, 0, W, H);
    assets.drawControl(ctx, 'message_window', 'BlackBack', null, { anims: ['fade_in@end'] });
    assets.drawControl(ctx, 'pad_recognize', 'RecognizePadWindow', 'RecognizePadWindow', { text: { text: shown } });
    const at = assets.panePlacement?.('pad_recognize', 'RecognizePadWindow', 'RecognizePadWindow', 'icon_set_null') || { x: 0, y: -42, scale: 1 };
    const kind = Object.hasOwn(CONTROLLER_PREVIEWS, controller) ? controller : 'han_con';
    const disconnected = file === 'Common' && [0x26ac, 0x26ae, 0x26af].includes(id);
    assets.drawControl(ctx, 'pad_recognize', 'RecognizePad', 'RecognizePad', {
      at, anims: [kind, 'blue', disconnected ? 'disconnect@end' : 'connect@end', 'entry_light_stop'],
      text: { text_set_p: sizedGameText(lookup('Common', 0x254e) || 'P1') },
    });
    return;
  }

  if (['raceCountdown', 'raceStatus', 'resultPosition', 'controllerHelp', 'afterRaceMenu', 'pressStart', 'ghostMessage', 'liveMessage', 'awardMessage'].includes(display)) {
    if (display === 'pressStart') menu(); else raceBackdrop();
    const sample = binding || [...MESSAGE_PLACEMENTS.values()].find((p) => p.display === display);
    const [folder, ctrl, pane] = sample.control;
    let variant = sample.variant || null;
    if (display === 'resultPosition') variant = `rank${Math.max(1, Math.min(12, id - 0x514))}`;
    if (display === 'afterRaceMenu') variant = ({ 0x3f1: 'ButtonNext', 0x3f2: 'ButtonNext', 0x3f4: 'ButtonReplay', 0x3f7: 'ButtonRanking', 0x3fc: 'ButtonQuit', 0x3fe: 'ButtonNext' })[id] || 'ButtonNext';
    const text = Object.fromEntries((sample.panes || [pane]).map((name) => [name, shown]));
    if (pane === 'text') Object.assign(text, button(shown));
    if (display === 'controllerHelp') {
      for (const [msg, name] of [[0x5dc, 'item'], [0x5dd, 'handle'], [0x5de, 'accel'], [0x5df, 'brake']]) if (name !== pane) text[name] = sizedGameText(lookup('Race', msg) ?? '');
    }
    assets.drawControl(ctx, folder, ctrl, variant, { anims: sample.anims || ['free', 'select@end'], text });
    return;
  }

  if (display === 'courseSelect') {
    menu();
    let cup = 0, course = -1, offset = 0;
    const isCup = file === 'Common' && id >= 0x23f0 && id <= 0x23f7;
    if (isCup) cup = id - 0x23f0;
    else if (file === 'Common') {
      offset = id >= 0x2490 ? 0x3c : 0;
      CUP_COURSES.forEach((list, c) => { const at = list.indexOf(id - offset); if (at >= 0) { cup = c; course = at; } });
    }
    const cupAt = assets.place('control', 'CupSelectNULL', 'CupSelectCupNULL');
    const courseAt = assets.place('control', 'CupSelectNULL', 'CupSelectCourseNULL');
    const cupButton = (i) => assets.drawControl(ctx, 'control', 'CourseSelectCup', `Button${i}`, {
      at: cupAt, anims: [i === cup ? 'select@end' : 'free'], text: button(name(0x23f0 + i)), texture: cupTexture(`tt_cup_icon_${CUP_ICONS[i]}_00.tpl`),
    });
    // The selected cup is drawn last: its name overlaps the next icons.
    for (let i = 0; i < 8; i++) if (i !== cup) cupButton(i);
    cupButton(cup);
    CUP_COURSES[cup].forEach((courseId, row) => assets.drawControl(ctx, 'button', 'CourseSelectCourse', `Button${row}`, {
      at: courseAt, anims: [row === Math.max(0, course) ? 'select@end' : 'free'], text: button(previewText && !isTitle && !isCup && row === Math.max(0, course) ? shown : name(courseId + offset)),
    }));
    back();
    return;
  }

  if (display === 'characterSelect') {
    menu();
    const at = assets.place('control', 'CharacterSelectNULL', 'CharacterSelectNULL');
    const focus = file === 'Common' ? CHAR_ICON[id] ? id : ({ 0x2340: 0x235c, 0x235a: 0x235c, 0x235b: 0x235d })[id] || 0x2328 : 0x2328;
    const cell = (charId, x, y) => assets.drawControl(ctx, 'button', 'CharacterSelect4_0', null, {
      at: { x: at.x + x, y: at.y + y, scale: at.scale }, anims: [charId === focus ? 'select@end' : 'free'],
      texture: { 'tt_baby_luigi_64x64.tpl': `tt_${CHAR_ICON[charId]}_64x64.tpl` }, hide: ['ok_null'],
    });
    CHAR_GRID.forEach((row, r) => row.forEach((charId, c) => cell(charId, CHAR_X[c], CHAR_Y[r])));
    [0x235c, 0x235d].forEach((charId, i) => cell(charId, CHAR_X[2 + i], -160));
    const label = !isTitle && (previewText || binding) ? shown : name(focus);
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
      assets.drawControl(ctx, 'control', 'MachineAbility', variant, { at: abilityAt, text: { ability_text: file === 'Menu' && id === msgId ? shown : sizedGameText(lookup('Menu', msgId) ?? '') } });
    }
    const label = !isTitle && binding?.control[1] !== 'MachineAbility' && (previewText || (file === 'Common' && vehicleOf(id))) ? shown : name(vehicleId(v.kind, v.size, v.letter));
    assets.drawControl(ctx, 'control', 'MachineSelectName', 'MachineSelectName', { text: { mii_name: label, shadow: label } });
    back();
    return;
  }

  if (display === 'battleStageSelect') {
    menu();
    let cup = 0, stage = 0, offset = 0;
    const isCup = file === 'Common' && (id === 0x2489 || id === 0x248a);
    if (isCup) cup = id - 0x2489;
    else if (file === 'Common') {
      offset = id >= 0x24ea && id <= 0x24ee ? 0x2d : id >= 0x24cc && id <= 0x24d5 ? 0x14 : 0;
      ARENA_CUPS.forEach((list, c) => { const at = list.indexOf(id - offset); if (at >= 0) { cup = c; stage = at; } });
    }
    const cupAt = assets.place('control', 'BattleCupSelectNULL', 'CupSelectCupNULL');
    const stageAt = assets.place('control', 'BattleCupSelectNULL', 'CupSelectCourseNULL');
    const cupButton = (i) => assets.drawControl(ctx, 'control', 'BattleStageSelectCup', `Button${i}`, {
      at: cupAt, anims: [i === cup ? 'select@end' : 'free'], text: button(name(0x2489 + i)), texture: cupTexture(BATTLE_CUP_ICONS[i]),
    });
    cupButton(1 - cup);
    cupButton(cup);
    ARENA_CUPS[cup].forEach((arenaId, row) => assets.drawControl(ctx, 'button', 'BattleStageSelectStage', `Button${row}`, {
      at: stageAt, anims: [row === stage ? 'select@end' : 'free'], text: button(previewText && !isTitle && !isCup && row === stage ? shown : name(arenaId + offset)),
    }));
    back();
    return;
  }

  if (display === 'raceIntro') {
    raceBackdrop();
    const isCup = file === 'Common' && id >= 0x23f0 && id <= 0x23f7;
    let courseName = binding?.part === 'cup' ? name(CUP_COURSES[0][0]) : shown, cupIndex = 0;
    if (isCup) { cupIndex = id - 0x23f0; courseName = name(CUP_COURSES[cupIndex][0]); }
    else CUP_COURSES.forEach((list, c) => { if (list.includes(id) || list.includes(id - 0x3c)) cupIndex = c; });
    const cupLine = isCup || binding?.part === 'cup' ? shown : name(0x23f0 + cupIndex);
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
    const [folder, control] = binding?.control || ['message_window', 'YesNoButton'];
    assets.drawControl(ctx, folder, control, binding?.variant || 'Option0', { anims: ['select@end'], text: button(shown) });
    back();
    return;
  }

  if (display === 'instruction') {
    menu();
    assets.drawControl(ctx, 'bg', 'MenuObiInstructionText', 'MenuObiInstructionText', { text: { text: shown } });
    back();
    return;
  }

  if (display === 'messageWindow' || display === 'genericWindow') {
    menu();
    // The usual placement (error and menu messages); SystemMessageWindow sits 20 units higher.
    assets.drawControl(ctx, 'message_window', 'MessageWindow', 'MessageWindow', { text: { text: shown }, unlimitedText: display === 'genericWindow' });
    return;
  }

  if (display === 'pauseMenu') {
    raceBackdrop();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    assets.drawControl(ctx, 'button', 'PauseMenuGrandPrix', 'ButtonContinue', { anims: ['select@end'], text: { text: shown, text_light_01: shown } });
    return;
  }

  if (display === 'raceMessage' || display === 'genericRaceWindow') {
    raceBackdrop();
    assets.drawControl(ctx, 'game_image', 'RaceMessageWindow', 'MessageWindow', { text: { text: shown }, unlimitedText: display === 'genericRaceWindow' });
  }
}


