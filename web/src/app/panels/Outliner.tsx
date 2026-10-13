import * as React from "react";
import { Box, ChevronRight, Cloud, Eye, EyeOff, FolderPlus, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CHECKPOINT_TYPE_LABEL, AREA_TYPES, CAMERA_TYPES } from "../../../js/data/defs.js";
import { KIND_HELP } from "../../../js/data/help.js";
import { polygonPieces } from "../../../js/formats/brres.js";
import { mainModel } from "../../../js/editor/brresmodel.js";
import { AREA_TYPE_COLORS } from "../../../js/editor/viewport.js";
import { useEditor } from "../hooks";
import { SECTION_LABEL } from "../editor";
import { Hint, KIND_COLOR, KIND_ICON, ColorDot } from "../common";
import { contextActions } from "../context-actions";
import { cn } from "@/lib/utils";

const ORDER = ["KTPT", "ENPT", "ITPT", "CKPT", "GOBJ", "POTI", "AREA", "CAME", "JGPT", "CNPT", "MSPT"];
const GROUPED = ["ENPT", "ITPT", "CKPT", "POTI"];

export function Outliner() {
  const ed = useEditor("doc", "selection", "ui", "settings");
  const [filter, setFilter] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [menuItems, setMenuItems] = React.useState(contextActions());
  const k = ed.doc.kmp;
  const sel = ed.doc.selection;
  const vp = ed.viewport;
  const brres = ed.doc.szs && ed.assets?.brres(ed.doc.szs, "course_model.brres");
  const model = brres ? mainModel(brres, "course") : null;
  const f = filter.trim().toLowerCase();
  const match = (t: string) => !f || t.toLowerCase().includes(f);
  const toggle = (key: string) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Expand the sections that contain the selection.
  React.useEffect(() => {
    const add: string[] = [];
    for (const info of ed.doc.selectedInfos().slice(0, 50)) {
      if (info.group) add.push(info.kind, String(info.group.uid));
      else if (info.route) add.push("POTI", String(info.route.uid));
      else if (info.kind === "GROUP") add.push(info.section);
      else if (info.kind === "ROUTE") add.push("POTI");
      else if (info.kind !== "STGI") add.push(info.kind);
    }
    if (add.some((a) => !expanded.has(a))) setExpanded((s) => new Set([...s, ...add]));
    requestAnimationFrame(() => document.querySelector("[data-outliner] [data-selected=true]")?.scrollIntoView({ block: "nearest" }));
  }, [sel, ed.version(["selection"])]);

  React.useEffect(() => {
    const selected = ed.geometrySelection;
    if (selected?.type !== "model") return;
    setExpanded((s) => new Set([...s, "VISUAL", ...(selected.pieces || [selected]).map((piece: any) => `MODEL_PART_${piece.partIndex}`)]));
    requestAnimationFrame(() => document.querySelector("[data-outliner] [data-selected=true]")?.scrollIntoView({ block: "nearest" }));
  }, [ed.geometrySelection]);

  const label = (kind: string, item: any, i: number, gi?: number) => {
    switch (kind) {
      case "KTPT": return `Start ${i}${item.playerIndex >= 0 ? ` (player ${item.playerIndex})` : ""}`;
      case "CKPT": return `Checkpoint ${gi}.${i}${item.type !== 0xff ? " · " + CHECKPOINT_TYPE_LABEL(item.type) : ""}`;
      case "GOBJ": return ed.objectLabel(item.objectId);
      case "AREA": return `Area ${i} · ${AREA_TYPES[item.type] || "type " + item.type}`;
      case "CAME": return `Camera ${i} · ${CAMERA_TYPES[item.type] || "type " + item.type}`;
      case "JGPT": return `Respawn ${i}`;
      case "CNPT": return `Cannon ${i}`;
      case "MSPT": return `Battle end ${i}`;
      default: return `Point ${gi}.${i}`;
    }
  };

  const isSelected = (key: string) => sel.has(key) || sel.has(key + ":L") || sel.has(key + ":R");
  const onRowClick = (key: string) => (e: React.MouseEvent) => vp?.selectEntity(key, e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "add" : "replace");

  const Row = ({ k: key, text, depth, color, badge, count, twisty, selected, onPick, onFocus }: { k: string; text: string; depth: number; color?: string; badge?: string; count?: number; twisty?: boolean | null; selected?: boolean; onPick?: (e: React.MouseEvent) => void; onFocus?: () => void }) => (
    <div
      data-key={key}
      data-selected={selected ?? isSelected(key)}
      onClick={onPick ?? onRowClick(key)}
      onDoubleClick={onFocus ?? (() => vp?.focusSelection())}
      onContextMenu={(e) => {
        const modelPiece = key.match(/^MODEL_PART_(\d+)_(\d+)$/);
        if (modelPiece) vp?.selectModelPiece(Number(modelPiece[1]), Number(modelPiece[2]));
        else if (onPick) { e.preventDefault(); e.stopPropagation(); return; }
        else if (!sel.has(key)) ed.doc.select(key);
        setMenuItems(contextActions());
      }}
      className={cn(
        "mx-1 flex h-6 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[12.5px] hover:bg-accent/70",
        (selected ?? isSelected(key)) && "bg-primary/12 text-foreground ring-1 ring-inset ring-primary/20 hover:bg-primary/15",
      )}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {twisty != null ? (
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", twisty && "rotate-90")} onClick={(e) => { e.stopPropagation(); toggle(key); }} />
      ) : <span className="w-3.5 shrink-0" />}
      {color && <ColorDot color={color} />}
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {badge && <span className="font-mono text-[10px] text-muted-foreground">{badge}</span>}
      {count != null && <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find (e.g. itembox, checkpoint 3)" className="pl-7" onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6" data-outliner>
            {model && (
              <div>
                <div className="sticky top-0 z-10 mt-1 flex h-8 items-center gap-1.5 border-y border-border/60 bg-sidebar/95 px-2 backdrop-blur">
                  <ChevronRight className={cn("size-3.5 cursor-pointer text-muted-foreground transition-transform", (expanded.has("VISUAL") || !!f) && "rotate-90")} onClick={() => toggle("VISUAL")} />
                  <Box className="size-3.5 text-amber-400" />
                  <span className="flex-1 cursor-pointer truncate text-[12.5px] font-semibold" onClick={() => toggle("VISUAL")}>Track model</span>
                  <Badge variant="outline" className="tabular-nums">{model.objects.filter((o: any) => o.triangles).length}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-6" title="Add a model object"><Plus /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-80 w-72 overflow-y-auto" align="start">
                      <DropdownMenuItem onSelect={() => ed.cmd("modelParts")}>Part from game models…</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => ed.cmd("importTrackModel")}>Import 3D model…</DropdownMenuItem>
                      {model.objects.map((obj: any, index: number) => {
                        const draw = model.draws.find((d: any) => d.object === index);
                        const name = model.materials[draw?.material]?.name || obj.name;
                        return <DropdownMenuItem key={index} onSelect={() => ed.addModelFromPart(index)}>{name} · {obj.name}</DropdownMenuItem>;
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Hint title={ed.settings.modelEditing ? "Disable model editing" : "Enable model editing"} text="Model objects are selectable directly in the 3D view when editing is enabled.">
                    <Button variant={ed.settings.modelEditing ? "secondary" : "ghost"} size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => ed.setSetting("modelEditing", !ed.settings.modelEditing)}>
                      Edit {ed.settings.modelEditing ? "on" : "off"}
                    </Button>
                  </Hint>
                  <Hint title={vp?.layers.VISUAL !== false ? "Hide model" : "Show model"} text="Show or hide the visual track model in the 3D view.">
                    <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => ed.toggleLayer("VISUAL")}>{vp?.layers.VISUAL !== false ? <Eye /> : <EyeOff className="opacity-50" />}</Button>
                  </Hint>
                </div>
                {(expanded.has("VISUAL") || !!f) && model.objects.map((obj: any, index: number) => {
                  if (!obj.triangles) return null; // deleted (emptied) polygon
                  const groupKey = `MODEL_PART_${index}`;
                  const draw = model.draws.find((d: any) => d.object === index);
                  const material = draw && model.materials[draw.material]?.name;
                  const groupName = /kinoko/i.test(material || "") ? "Mushrooms" : material || obj.name;
                  const text = `${groupName} · ${obj.name}`;
                  const open = expanded.has(groupKey) || !!f;
                  const pieces = open ? polygonPieces(obj).pieces : [];
                  const childName = (i: number) => /kinoko/i.test(material || "") ? `Mushroom ${i + 1}` : `Object ${i + 1}`;
                  const shown = pieces.filter((piece: any) => match(text) || match(childName(piece.index)));
                  if (f && !match(text) && !shown.length) return null;
                  return (
                    <React.Fragment key={groupKey}>
                      <Row k={groupKey} text={text} depth={1} badge={`${obj.triangles} △`} twisty={open} onPick={() => toggle(groupKey)} />
                      {open && shown.map((piece: any) => (
                        <Row key={`${groupKey}_${piece.index}`} k={`${groupKey}_${piece.index}`} text={childName(piece.index)} depth={2} twisty={null}
                          selected={ed.geometrySelection?.type === "model" && (ed.geometrySelection.pieces || [ed.geometrySelection]).some((part: any) => part.partIndex === index && part.pieceIndex === piece.index)}
                          onPick={(e) => vp?.selectModelPiece(index, piece.index, false, e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "add" : "replace")} onFocus={() => vp?.selectModelPiece(index, piece.index, true)} />
                      ))}
                    </React.Fragment>
                  );
                })}
                {(expanded.has("VISUAL") || !!f) && [...brres.chr.values()].filter((animation: any) => match(`Animation ${animation.name}`)).map((animation: any) => (
                  <Hint key={`MODEL_CHR_${animation.name}`} title={`Animation: ${animation.name}`} text="CHR0 bone animation stored in course_model.brres. Click to see it in the Inspector: play, pause, go to a frame, loop or delete it. Saving the SZS keeps it for the game.">
                    <div><Row k={`MODEL_CHR_${animation.name}`} text={`Animation · ${animation.name}`} depth={1} badge={`${animation.frames} frames`}
                      selected={ed.selectedAnimation === animation.name} twisty={null} onPick={() => ed.selectAnimation(animation.name)} /></div>
                  </Hint>
                ))}
              </div>
            )}
            {ed.doc.szs && match("sky vrcorn") && (
              <div className="flex h-8 items-center gap-1.5 border-b border-border/60 px-2 pl-[30px]">
                <Cloud className="size-3.5 text-sky-400" />
                <span className="flex-1 cursor-pointer truncate text-[12.5px] font-semibold" onClick={() => ed.cmd("sky")}>Sky</span>
                <Hint title="Edit sky" text="Paint the sky textures or replace the sky with another track's vrcorn_model.brres.">
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => ed.cmd("sky")}>Edit…</Button>
                </Hint>
                <Hint title={vp?.layers.SKY !== false ? "Hide sky" : "Show sky"} text="Show or hide the sky in the 3D view.">
                  <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => ed.toggleLayer("SKY")}>{vp?.layers.SKY !== false ? <Eye /> : <EyeOff className="opacity-50" />}</Button>
                </Hint>
              </div>
            )}
            {ORDER.map((sec) => {
              const Icon = KIND_ICON[sec];
              const list = k[sec];
              const grouped = GROUPED.includes(sec);
              const total = grouped ? list.reduce((s: number, g: any) => s + g.points.length, 0) : list.length;
              const open = expanded.has(sec) || !!f;
              const visible = vp?.layers[sec] !== false;
              return (
                <div key={sec}>
                  <div className="sticky top-0 z-10 mt-1 flex h-8 items-center gap-1.5 border-y border-border/60 bg-sidebar/95 px-2 backdrop-blur">
                    <ChevronRight className={cn("size-3.5 cursor-pointer text-muted-foreground transition-transform", open && "rotate-90")} onClick={() => toggle(sec)} />
                    <Icon className="size-3.5" style={{ color: KIND_COLOR[sec] }} />
                    <Hint title={(KIND_HELP as any)[sec]?.title} text={(KIND_HELP as any)[sec]?.what} side="right">
                      <span className="flex-1 cursor-pointer truncate text-[12.5px] font-semibold" onClick={() => toggle(sec)}>{SECTION_LABEL[sec]}</span>
                    </Hint>
                    <Badge variant="outline" className="tabular-nums">{total}</Badge>
                    <Hint title={visible ? "Hide" : "Show"} text={`Show or hide ${SECTION_LABEL[sec].toLowerCase()} in the 3D view. They stay in the file.`}>
                      <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => ed.toggleLayer(sec)}>{visible ? <Eye /> : <EyeOff className="opacity-50" />}</Button>
                    </Hint>
                    <Hint title="Add" text={`Add ${(KIND_HELP as any)[sec]?.title.toLowerCase()}: then click on the track in the 3D view.`}>
                      <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => sec === "GOBJ" ? void ed.pickObject(0x65, "add") : ed.startPlacing(sec)}><Plus /></Button>
                    </Hint>
                    {grouped && (
                      <Hint title={sec === "POTI" ? "New route" : "New group"} text={sec === "POTI" ? "Create a new empty route." : "Create a new empty group (a new chain of points, e.g. for a branch)."}>
                        <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => ed.ops.addGroup(sec)}><FolderPlus /></Button>
                      </Hint>
                    )}
                  </div>
                  {open && grouped && list.map((g: any, gi: number) => {
                    const gKey = String(g.uid);
                    const gText = sec === "POTI" ? `Route ${gi}` : `Group ${gi}`;
                    const children = g.points.map((p: any, i: number) => ({ p, text: label(sec, p, i, gi) })).filter((c: any) => match(c.text) || match(gText));
                    if (f && !children.length && !match(gText)) return null;
                    const gOpen = expanded.has(gKey) || !!f;
                    return (
                      <React.Fragment key={gKey}>
                        <Row k={gKey} text={gText} depth={1} count={g.points.length} badge={sec === "POTI" ? undefined : `→ ${g.next.join(", ") || "–"}`} twisty={gOpen} onPick={() => toggle(gKey)} />
                        {gOpen && children.map(({ p, text }: any) => (
                          <Row key={p.uid} k={String(p.uid)} text={text} depth={2} twisty={null}
                            color={sec === "CKPT" ? (p.type === 0 ? "#ff2d55" : p.type !== 0xff ? "#facc15" : undefined) : undefined} />
                        ))}
                      </React.Fragment>
                    );
                  })}
                  {open && !grouped && list.map((e: any, i: number) => {
                    const text = label(sec, e, i);
                    const areaColor = sec === "AREA" && AREA_TYPE_COLORS[e.type] !== undefined ? `#${AREA_TYPE_COLORS[e.type].toString(16).padStart(6, "0")}` : undefined;
                    return match(text) ? <Row key={e.uid} k={String(e.uid)} text={text} depth={1} twisty={null} color={areaColor} badge={sec === "GOBJ" ? `0x${e.objectId.toString(16)}` : undefined} /> : null;
                  })}
                </div>
              );
            })}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          {menuItems.map((a, i) => a.separator ? <ContextMenuSeparator key={i} /> : (
            <ContextMenuItem key={i} onSelect={a.onSelect} disabled={a.disabled}>
              {a.icon && <a.icon />} {a.label}
              {a.shortcut && <ContextMenuShortcut>{a.shortcut}</ContextMenuShortcut>}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
