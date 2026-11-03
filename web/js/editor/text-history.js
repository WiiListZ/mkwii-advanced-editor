// Text and formatting share one undo/redo stack. Patches make multi-message operations atomic
// without keeping a full copy of every BMG message on each keystroke.
export class TextEditHistory {
  constructor(limit = 200) { this.limit = limit; this.clear(); }
  clear() { this.past = []; this.future = []; }
  breakGroup() { if (this.past.length) this.past.at(-1).group = null; }
  record(changes, beforeSelection, afterSelection, group = null, now = Date.now()) {
    changes = changes.filter((c) => c.before !== c.after).map((c) => ({ ...c }));
    if (!changes.length) return;
    const last = this.past.at(-1);
    const sameSelection = (a, b) => a?.key === b?.key && a?.start === b?.start && a?.end === b?.end;
    const merge = group && !this.future.length && last?.group === group && now - last.time < 800 && changes.length === 1 && last.changes.length === 1
      && changes[0].key === last.changes[0].key && changes[0].before === last.changes[0].after && sameSelection(last.afterSelection, beforeSelection);
    this.future = [];
    if (merge) {
      last.changes[0].after = changes[0].after;
      last.afterSelection = { ...afterSelection };
      last.time = now;
    } else {
      this.past.push({ changes, beforeSelection: { ...beforeSelection }, afterSelection: { ...afterSelection }, group, time: now });
      if (this.past.length > this.limit) this.past.shift();
    }
  }
  undo() {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(entry);
    entry.group = null;
    return { changes: entry.changes.map((c) => ({ key: c.key, value: c.before })), selection: entry.beforeSelection };
  }
  redo() {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry);
    entry.group = null;
    return { changes: entry.changes.map((c) => ({ key: c.key, value: c.after })), selection: entry.afterSelection };
  }
}
