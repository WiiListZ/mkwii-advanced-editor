// NW4R's txt1 text buffer includes a UTF-16 terminator. Use the actual game's layouts,
// rather than the original translation's length or an invented limit for every BMG.
import { messageScene, messageTextLength } from '../formats/bmg.js';
import { defaultDisplay } from './text-displays.js';
import { findPane } from '../formats/brlyt.js';

const CONTROLS = {
  characterSelect: ['control', 'CharacterSelectName', 'mii_name'],
  vehicleSelect: ['control', 'MachineSelectName', 'mii_name'],
  menuButton: ['message_window', 'YesNoButton', 'text'],
  instruction: ['bg', 'MenuObiInstructionText', 'text'],
  messageWindow: ['message_window', 'MessageWindow', 'text'],
  pauseMenu: ['button', 'PauseMenuGrandPrix', 'text'],
  raceMessage: ['game_image', 'RaceMessageWindow', 'text'],
};

export function messageTextLimit(assets, file, id, originalText) {
  if (!assets || !['Common', 'Menu', 'Race'].includes(file)) return null;
  const scene = messageScene(file, id);
  const display = defaultDisplay(file, id, originalText);
  let control = CONTROLS[display];
  if (file === 'Menu' && id === 0x7d1) control = ['button', 'Back', 'text'];
  else if (scene === 'cup') control = ['button', 'CupSelectCup', 'text'];
  else if (scene === 'track') control = ['button', 'CourseSelectCourse', 'text'];
  else if (scene === 'arena') control = ['button', 'BattleStageSelectStage', 'text'];
  else if (display === 'battleStageSelect') control = ['control', 'BattleStageSelectCup', 'text'];
  if (!control) return null;
  const [folder, name, paneName] = control;
  const ctrl = assets.ctrl(`${folder}/ctrl/${name}.brctr`);
  const layout = ctrl && assets.layout(`${folder}/blyt/${ctrl.layout}.brlyt`);
  const pane = layout && findPane(layout, paneName);
  if (!pane || !Number.isFinite(pane.textCapacity)) return null;
  return { capacity: pane.textCapacity, singleLine: !!scene || ['menuButton', 'pauseMenu', 'battleStageSelect'].includes(display), source: `${folder}/blyt/${ctrl.layout}.brlyt`, pane: paneName };
}

export function messageTextError(text, rule) {
  if (text.includes('\0')) return 'A message cannot contain a null character.';
  if (!rule) return '';
  if (rule.singleLine && /[\r\n]/.test(text)) return 'This name or button label must stay on one line.';
  if (messageTextLength(text) > rule.capacity) return `This text box holds at most ${rule.capacity} characters, including game codes. Shorten the text before adding more.`;
  return '';
}
