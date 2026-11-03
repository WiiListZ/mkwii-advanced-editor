// NW4R's txt1 text buffer includes a UTF-16 terminator. Use the actual game's layouts,
// rather than the original translation's length or an invented limit for every BMG.
import { messageTextLength } from '../formats/bmg.js';
import { messagePlacement } from './text-displays.js';
import { findPane } from '../formats/brlyt.js';

export function messageTextLimit(assets, file, id, originalText) {
  if (!assets || !['Common', 'Menu', 'Race'].includes(file)) return null;
  const placement = messagePlacement(file, id);
  if (!placement) return null;
  const [folder, name, paneName] = placement.control;
  const ctrl = assets.ctrl(`${folder}/ctrl/${name}.brctr`);
  const layout = ctrl && assets.layout(`${folder}/blyt/${ctrl.layout}.brlyt`);
  const pane = layout && findPane(layout, paneName);
  if (!pane || !Number.isFinite(pane.textCapacity)) return null;
  return { capacity: pane.textCapacity, singleLine: placement.singleLine, source: `${folder}/blyt/${ctrl.layout}.brlyt`, pane: paneName };
}

export function messageTextError(text, rule) {
  if (text.includes('\0')) return 'A message cannot contain a null character.';
  if (!rule) return '';
  if (rule.singleLine && /[\r\n]/.test(text)) return 'This name or button label must stay on one line.';
  if (messageTextLength(text) > rule.capacity) return `This text box holds at most ${rule.capacity} characters, including game codes. Shorten the text before adding more.`;
  return '';
}
