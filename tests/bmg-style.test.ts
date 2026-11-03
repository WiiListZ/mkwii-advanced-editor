import { expect, test } from 'bun:test';
import { bmgColourAt, bmgColourCode, bmgStyleRuns, colourBmgSelection, stripBmgColours } from '../web/js/formats/bmg-style.js';
import { buildBMG, createBMG, fontSizePercent, messageTextLength, parseBMG, plainText, setFontSizePercent } from '../web/js/formats/bmg.js';
import { messageTextError } from '../web/js/editor/text-limits.js';
import { sizedGameText } from '../web/js/editor/text-displays.js';

test('whole-message colour is native, replaceable and removable without changing its text', () => {
  const red = colourBmgSelection('Luigi Circuit', 0, 0, 0x32);
  expect(red.text).toBe(bmgColourCode(0x32) + 'Luigi Circuit');
  const blue = colourBmgSelection(red.text, red.start, red.end, 0x31);
  expect(blue.text).toBe(bmgColourCode(0x31) + 'Luigi Circuit');
  expect(blue.text.length).toBe(red.text.length);
  expect(colourBmgSelection(blue.text, 0, 0, 0).text).toBe('Luigi Circuit');
  expect(plainText(red.text)).toBe('Luigi Circuit');
});

test('selected text preserves and restores the surrounding colour, even when recoloured', () => {
  const original = bmgColourCode(0x21) + 'Blue word rest';
  const start = original.indexOf('word');
  const red = colourBmgSelection(original, start, start + 4, 0x32);
  expect(bmgStyleRuns(red.text).map((r) => [r.text, r.colour])).toEqual([['Blue ', 0x21], ['word', 0x32], [' rest', 0x21]]);
  const green = colourBmgSelection(red.text, red.start, red.end, 0x33);
  expect(green.text.length).toBe(red.text.length);
  expect(bmgColourAt(green.text, green.end + bmgColourCode(0x21).length)).toBe(0x21);
  expect(stripBmgColours(green.text)).toBe('Blue word rest');
  const defaults = colourBmgSelection(green.text, green.start, green.end, 0);
  expect(bmgStyleRuns(defaults.text).map((r) => [r.text, r.colour])).toEqual([['Blue ', 0x21], ['word', 0], [' rest', 0x21]]);
});

test('colour selection never cuts a native escape or a UTF-16 character and retains size codes', () => {
  const icon = '{1A:080100002460}', body = 'A' + icon + '😀B';
  const edit = colourBmgSelection(body, 5, body.length - 2, 0x30);
  expect(edit.text).toContain(icon);
  expect(edit.text).toContain('😀');
  expect(stripBmgColours(edit.text)).toBe(body);
  const sized = setFontSizePercent(edit.text, 80);
  expect(fontSizePercent(sized)).toBe(80);
  expect(sizedGameText(sized)).toContain(bmgColourCode(0x30));
  expect(bmgStyleRuns(sizedGameText(sized)).some((r) => r.scale === 0.8 && r.colour === 0x30)).toBe(true);
});

test('native colour codes count against the actual message buffer and round-trip through BMG', () => {
  const rule = { capacity: 32, singleLine: true };
  const full = colourBmgSelection('A'.repeat(28), 0, 0, 0x32).text;
  expect(messageTextLength(full)).toBe(32);
  expect(messageTextError(full, rule)).toBe('');
  expect(messageTextError(full + 'A', rule)).toContain('32');
  const icon = '{1A:080100002460}', text = setFontSizePercent(bmgColourCode(0x32) + icon + 'Road', 80);
  const original = parseBMG(createBMG([[0x245c, 'Luigi Circuit'], [0x2455, 'Moo Moo Meadows']]));
  const saved = parseBMG(buildBMG(original, { [0x245c]: text }));
  expect(saved.messages[0].text).toBe(text);
  expect(saved.messages[0].attributes).toEqual(original.messages[0].attributes);
  expect(saved.messages[1].text).toBe(original.messages[1].text);
});
