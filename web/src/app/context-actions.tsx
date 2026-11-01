import { ArrowDownToLine, Box, BrickWall, ClipboardPaste, Compass, Copy, Crosshair, Flag, ListChecks, Plus, Repeat, Trash2, type LucideIcon } from "lucide-react";
import { editor, PATH_KINDS } from "./editor";

export interface Action { label?: string; icon?: LucideIcon; shortcut?: string; onSelect?: () => void; disabled?: boolean; separator?: boolean }

// Actions for the right-click menus (3D view and track list).
export function contextActions(): Action[] {
  const ed = editor, d = ed.doc, p = d.primary;
  if (ed.geometrySelection?.type === "model") return [
    { label: "Edit model resource…", icon: Box, onSelect: () => ed.openSelectedAssetEditor() },
    { label: "Generate collision…", icon: BrickWall, onSelect: () => ed.generateCollisionForSelection(), disabled: !d.szs },
    { label: "Remove all collision…", icon: Trash2, onSelect: () => ed.removeCollisionForSelection(), disabled: !d.szs || !d.kcl?.count },
    { label: "Copy model object", icon: Copy, shortcut: "Ctrl+C", onSelect: () => ed.cmd("copy") },
    { label: "Paste model object", icon: ClipboardPaste, shortcut: "Ctrl+V", onSelect: () => ed.cmd("paste"), disabled: !ed.modelClipboard },
    { label: "Duplicate model object", icon: Plus, shortcut: "Ctrl+D", onSelect: () => ed.cmd("duplicate") },
    { label: "Delete model object", icon: Trash2, shortcut: "Ctrl+X", onSelect: () => ed.cmd("delete") },
    { label: "Focus", icon: Crosshair, shortcut: "F", onSelect: () => ed.viewport.focusSelection() },
  ];
  if (ed.geometrySelection?.type === "collision") return [
    { label: "Duplicate triangle", icon: Copy, shortcut: "Ctrl+D", onSelect: () => ed.cmd("duplicate") },
    { label: "Delete triangle", icon: Trash2, shortcut: "Ctrl+X", onSelect: () => ed.cmd("delete") },
  ];
  const items: Action[] = [];
  if (p && PATH_KINDS.includes(p.kind)) items.push({ label: "Add point after this one", icon: Plus, shortcut: "A", onSelect: () => ed.startPlacing(p.kind) });
  if (p?.kind === "CKPT") {
    items.push({ label: "Make lap checkpoint", icon: Flag, onSelect: () => d.change("Lap checkpoint", () => { p.item.type = 0; }) });
    items.push({ label: "Swap left / right", icon: Repeat, onSelect: () => ed.ops.swapCheckpointSides(true) });
  }
  if (p?.kind === "GOBJ") {
    items.push({ label: "Edit object resource…", icon: Box, onSelect: () => ed.openSelectedAssetEditor() });
    items.push({ label: "Generate collision…", icon: BrickWall, onSelect: () => ed.generateCollisionForSelection(), disabled: !d.szs });
    items.push({ label: "Remove all collision…", icon: Trash2, onSelect: () => ed.removeCollisionForSelection(), disabled: !d.szs || !d.kcl?.count });
    items.push({ label: `Select all "${ed.objectLabel(p.item.objectId)}"`, icon: ListChecks, onSelect: () => ed.selectObjectsById(p.item.objectId) });
  }
  if (items.length) items.push({ separator: true });
  items.push(
    { label: "Copy", icon: Copy, shortcut: "Ctrl+C", onSelect: () => ed.cmd("copy"), disabled: !p },
    { label: "Paste", icon: ClipboardPaste, shortcut: "Ctrl+V", onSelect: () => ed.cmd("paste"), disabled: !ed.kmpClipboard && !ed.modelClipboard },
    { label: "Duplicate", icon: Plus, shortcut: "Ctrl+D", onSelect: () => ed.cmd("duplicate"), disabled: !p },
    { label: "Snap to ground", icon: ArrowDownToLine, shortcut: "G", onSelect: () => ed.cmd("snapGround"), disabled: !p },
    { label: "Align to route", icon: Compass, onSelect: () => ed.cmd("alignRoute"), disabled: !p?.item?.rot },
    { label: "Focus", icon: Crosshair, shortcut: "F", onSelect: () => ed.viewport.focusSelection(), disabled: !p },
    { label: "Select all of this kind", icon: ListChecks, shortcut: "Ctrl+A", onSelect: () => ed.selectAllSimilar(), disabled: !p },
    { separator: true },
    { label: "Delete", icon: Trash2, shortcut: "Ctrl+X", onSelect: () => ed.cmd("delete"), disabled: !p },
  );
  return items;
}
