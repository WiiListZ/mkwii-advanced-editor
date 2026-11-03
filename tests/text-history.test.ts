import { expect, test } from 'bun:test';
import { TextEditHistory } from '../web/js/editor/text-history.js';
import { bmgColourCode, bmgSelectionRange } from '../web/js/formats/bmg-style.js';

const select = (start: number, end = start, key = 'Common:9308') => ({ key, start, end });

test('text, native colours and cuts undo/redo in order with their selections', () => {
  const history = new TextEditHistory();
  const key = 'Common:9308', text = 'Luigi Circuit', red = bmgColourCode(0x32) + text;
  const offset = bmgColourCode(0x32).length;
  history.record([{ key, before: text, after: red }], select(0), select(offset, red.length));
  history.record([{ key, before: red, after: red.replace('Luigi', '') }], select(offset, offset + 5), select(offset));
  expect(history.undo()?.changes[0].value).toBe(red);
  const uncolour = history.undo()!;
  expect(uncolour.changes[0].value).toBe(text);
  expect(uncolour.selection).toEqual(select(0));
  expect(history.redo()?.changes[0].value).toBe(red);
  expect(history.redo()?.changes[0].value).toBe(red.replace('Luigi', ''));
  expect(history.redo()).toBeNull();
});

test('consecutive typing is grouped, while new edits invalidate redo and cut is atomic', () => {
  const history = new TextEditHistory(), key = 'Common:9308';
  history.record([{ key, before: '', after: 'A' }], select(0), select(1), 'insertText', 1000);
  history.record([{ key, before: 'A', after: 'AB' }], select(1), select(2), 'insertText', 1100);
  history.record([{ key, before: 'AB', after: 'ABC' }], select(2), select(3), 'insertText', 1200);
  expect(history.undo()?.changes[0].value).toBe('');
  expect(history.redo()?.changes[0].value).toBe('ABC');
  history.record([{ key, before: 'ABC', after: 'AC' }], select(1, 2), select(1));
  expect(history.undo()?.changes[0].value).toBe('ABC');
  history.record([{ key, before: 'ABC', after: 'ABCD' }], select(3), select(4), 'insertText', 1300);
  expect(history.redo()).toBeNull();
});

test('applying to related messages remains one atomic operation and no-ops keep redo', () => {
  const history = new TextEditHistory();
  const changes = [{ key: 'Common:9308', before: 'A', after: 'New name' }, { key: 'Common:9368', before: 'B', after: 'New name' }];
  history.record(changes, select(0), select(8));
  expect(history.undo()?.changes).toEqual(changes.map((c) => ({ key: c.key, value: c.before })));
  history.record([{ key: 'Common:9308', before: 'A', after: 'A' }], select(0), select(0));
  expect(history.redo()?.changes).toEqual(changes.map((c) => ({ key: c.key, value: c.after })));
});

test('cut ranges include complete BMG codes and complete UTF-16 characters', () => {
  const text = 'A' + bmgColourCode(0x32) + '😀B';
  const range = bmgSelectionRange(text, 4, text.length - 2);
  expect(text.slice(range.start, range.end)).toBe(bmgColourCode(0x32) + '😀');
  expect(text.slice(0, range.start) + text.slice(range.end)).toBe('AB');
});
