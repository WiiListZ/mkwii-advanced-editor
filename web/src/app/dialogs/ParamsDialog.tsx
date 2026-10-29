// Game data files (.bin, .bcp, .bsp) of an archive: vehicle stats (kartParam.bin), character bonuses
// (driverParam.bin) and item probabilities (ItemSlot.bin), each value with a short explanation;
// the object list (ObjFlow.bin), the object reaction tables (GeoHitTable*.bin) and every other
// .bin as a table of values whose layout is read from the data. With mode "lighting" the same
// editor shows the lights (.blight) and light maps (.blmap) instead, by default of the open track,
// whose 3D view follows each change.

import * as React from "react";
import { Lightbulb, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dialogs } from "../dialogs-store";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { findFile, listFiles } from "../../../js/formats/u8.js";
import { ITEMS, STAT_FIELDS, isItemSlot, isStatsFile, parseItemSlot, readStat, statEntries, writeItemSlot, writeStat } from "../../../js/formats/params.js";
import { BIN_LIMITS, BIN_TYPES, binDescription, binTable, objFlowNames, readBinValue, readRgba, writeBinValue, writeRgba } from "../../../js/formats/gamebin.js";
import { editor } from "../editor";
import { ColorInput, NumberInput, TYPE_LIMITS } from "./EffectsDialog";
import { ColumnHandle, useColumnWidths } from "../resizable";
import { HistoryBar, useEditHistory, useHistoryKeys } from "../edit-history";
import { cn } from "@/lib/utils";

export const isParamFile = (path: string, data: Uint8Array) => /\.(bin|bcp|bsp)$/i.test(path) && data.length > 0;
export const isLightingFile = (path: string, data: Uint8Array) => /\.(blight|blmap)$/i.test(path) && data.length > 0;
// Short description of a .bin for file lists.
export const paramFileLabel = (path: string, data: Uint8Array) => isStatsFile(path, data) ? (/driverParam/i.test(path) ? "Character bonuses" : "Vehicle stats")
  : isItemSlot(path, data) ? "Item chances" : binDescription(path, data);
type Layout = { header: number; rowSize: number; type: string };

export function ParamsDialog({ tree: archiveTree, archiveName: givenName, initialPath, onChange, onSave, mode = "data", close }: {
  // Without a tree: the open track, changed through the document (its 3D view and Undo follow).
  tree?: any; archiveName?: string; initialPath?: string;
  onChange?: (path: string, data: Uint8Array) => void;
  // Saves the archive the files belong to.
  onSave?: () => Promise<boolean> | boolean | void;
  mode?: "data" | "lighting";
  close: (value: any) => void;
}) {
  const [, refresh] = React.useReducer((n: number) => n + 1, 0);
  const tree = archiveTree || editor.doc.szs;
  const archiveName = givenName || editor.doc.fileName || "the track";
  const lighting = mode === "lighting";
  const files = tree ? listFiles(tree).filter((f: any) => (lighting ? isLightingFile : isParamFile)(f.path, f.node.data)) : [];
  const [path, setPath] = React.useState(() => files.find((f: any) => f.path === initialPath)?.path || files[0]?.path || "");
  const file = files.find((f: any) => f.path === path) || files[0];
  const data: Uint8Array | null = file?.node.data || null;
  const stats = !!file && isStatsFile(file.path, data!);
  const items = !!file && !stats && isItemSlot(file.path, data!);
  const [entry, setEntry] = React.useState(0);
  const [table, setTable] = React.useState(0);
  const [query, setQuery] = React.useState("");
  // Other .bin files: the selected row, the row filter and the layouts chosen by hand.
  const [row, setRow] = React.useState(0);
  const [rowQuery, setRowQuery] = React.useState("");
  const [layouts, setLayouts] = React.useState<Record<string, Layout>>({});
  const objectNames = React.useMemo(() => objFlowNames(findFile(tree, "ObjFlow.bin")?.data), [tree]);
  const bin = file && !stats && !items ? binTable(file.path, data!, { objectNames, override: layouts[file.path] }) : null;
  const rq = rowQuery.trim().toLowerCase();
  const binRows = bin ? bin.rows.map((r: any, i: number) => ({ ...r, index: i })).filter((r: any) => !rq || `${r.label} ${r.sub}`.toLowerCase().includes(rq)) : [];
  const binRow = bin?.rows[Math.min(row, Math.max(0, bin.rows.length - 1))];
  const setLayout = (patch: Partial<Layout>) => {
    if (!bin?.layout) return;
    setLayouts((all) => ({ ...all, [file.path]: { header: bin.layout.header, rowSize: bin.layout.rowSize, type: bin.layout.type, ...patch } }));
    setRow(0);
  };
  const columns = useColumnWidths("params", [210, 220]);
  const history = useEditHistory((filePath, bytes) => {
    if (archiveTree) onChange?.(filePath, bytes);
    else editor.doc.changeArchiveFile(`Edit ${filePath.split("/").pop()}`, filePath, bytes);
    refresh();
  });
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    if (saving || (archiveTree && !onSave)) return;
    setSaving(true);
    try { if ((await (archiveTree ? onSave!() : editor.save())) !== false) history.saved(); } finally { setSaving(false); }
  };
  useHistoryKeys(history, () => void save());
  const requestClose = async () => {
    if (history.unsaved && !(await dialogs.confirm({ title: lighting ? "Unsaved lighting" : "Unsaved game data", description: `The changes in ${archiveName} have not been saved. Close and discard them?`, confirmLabel: "Discard changes", destructive: true }))) return;
    close(true);
  };
  const attempt = (label: string, fn: () => Uint8Array) => {
    try { history.record(file.path, file.node.data, fn(), label); }
    catch (e: any) { toast.error("Could not change the value", { description: e.message }); }
  };

  const entries = stats ? statEntries(file.path, data!) : [];
  const tables = items ? parseItemSlot(data!) : [];
  const driver = stats && /driverParam/i.test(file.path);
  const q = query.trim().toLowerCase();
  const fields = STAT_FIELDS.filter((f: any) => !q || `${f.label} ${f.help} ${f.group}`.toLowerCase().includes(q));
  const groups = [...new Set(fields.map((f: any) => f.group))];
  const t = tables[table];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3" title="Close" aria-label={lighting ? "Close lighting" : "Close game data"} onClick={requestClose}><X /></Button>
      <div className="shrink-0 pr-8">
        <DialogTitle className="flex items-center gap-2 text-sm">{lighting ? <Lightbulb className="size-4" /> : <SlidersHorizontal className="size-4" />} {lighting ? "Lighting" : "Game data"} · {archiveName}</DialogTitle>
        <DialogDescription className="text-xs">
          {lighting
            ? `The lights (.blight) and light maps (.blmap) of the posteffect folder, which light characters, karts, objects and shiny surfaces.${archiveTree ? "" : " The track's 3D view updates with each change."}`
            : "Game data files: .bin (stats, item chances, objects, CPU drivers, vehicle parts, cameras, menus), .bcp (camera before the countdown) and .bsp (vehicle physics)."}
          {" "}A value changes when its field loses focus or Enter is pressed; Undo and Redo step through the changes, Save writes {archiveName}.
          {driver && " Character values are added to the vehicle's own stats."}
        </DialogDescription>
      </div>
      {!files.length ? <p className="text-xs text-muted-foreground">{lighting
        ? "This archive has no lighting files. A track without posteffect/posteffect.blight and .blmap uses lightset/default.blight and default.blmap of Race/Common.szs."
        : "This archive has no game data files (.bin, .bcp, .bsp)."}</p> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:gap-0 sm:[grid-template-columns:var(--columns)]" style={{ "--columns": columns.template } as React.CSSProperties}>
          <div className="flex min-h-0 max-h-40 flex-col border sm:max-h-none">
            <div className="shrink-0 border-b px-2 py-2 text-[11px] text-muted-foreground">Files</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">{files.map((f: any) => (
              <button key={f.path} onClick={() => { setPath(f.path); setEntry(0); setTable(0); setRow(0); setRowQuery(""); }} title={f.path}
                className={cn("block w-full cursor-pointer rounded border border-transparent px-2 py-1.5 text-left text-xs hover:bg-accent", f.path === file.path && "border-primary/60 bg-accent")}>
                <span className="block truncate font-medium">{f.path.split("/").pop()}</span>
                <span className="block truncate text-[10.5px] text-muted-foreground">{paramFileLabel(f.path, f.node.data)}</span>
              </button>))}</div>
          </div>
          <ColumnHandle label="Resize the file list" onResize={(d) => columns.resize(0, d)} onReset={columns.reset} />
          <div className="flex min-h-0 max-h-48 flex-col border sm:max-h-none">
            <div className="shrink-0 border-b px-2 py-2 text-[11px] text-muted-foreground">{stats ? `${entries.length} ${driver ? "characters" : "vehicles"}` : items ? `${tables.length} tables` : `${bin!.rows.length.toLocaleString()} ${bin!.rowsLabel}`}</div>
            {bin && bin.rows.length > 12 && (
              <div className="relative shrink-0 border-b p-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label={`Find ${bin.rowsLabel}`} value={rowQuery} onChange={(e) => setRowQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={`Find ${bin.rowsLabel}`} className="h-7 pl-7 text-xs" />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {stats ? entries.map((name: string, i: number) => (
                <button key={i} onClick={() => setEntry(i)} className={cn("block w-full cursor-pointer truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent", i === entry && "bg-accent")}>{name}</button>
              )) : items ? tables.map((x: any) => (
                <button key={x.index} onClick={() => setTable(x.index)} className={cn("block w-full cursor-pointer truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent", x.index === table && "bg-accent")}>{x.label}</button>
              )) : binRows.map((r: any) => (
                <button key={r.index} onClick={() => setRow(r.index)} className={cn("block w-full cursor-pointer rounded px-2 py-1 text-left text-xs hover:bg-accent", r.index === row && "bg-accent")}>
                  <span className="block truncate">{r.label}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{r.sub}</span>
                </button>
              ))}
              {bin && !bin.rows.length && <p className="m-0 p-2 text-[11px] text-muted-foreground">Nothing to list.</p>}
              {bin && !!bin.rows.length && !binRows.length && <p className="m-0 p-2 text-[11px] text-muted-foreground">No {bin.rowsLabel} match.</p>}
            </div>
          </div>
          <ColumnHandle label="Resize the list" onResize={(d) => columns.resize(1, d)} onReset={columns.reset} />
          <div className="min-h-0 overflow-y-auto sm:pl-2">
            {stats ? (
              <div className="space-y-4 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entries[entry]}</span>
                  <div className="relative ml-auto w-56"><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input aria-label="Find a parameter" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Find a parameter" className="h-7 pl-7 text-xs" /></div>
                </div>
                {groups.map((group) => (
                  <section key={group} className="space-y-2">
                    <h3 className="text-[11px] font-semibold text-muted-foreground">{group}</h3>
                    {fields.filter((f: any) => f.group === group).map((f: any) => {
                      const value = readStat(data!, entry, f);
                      return (
                        <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-x-3 gap-y-0.5 border-b pb-2 last:border-b-0">
                          <div className="min-w-0">
                            <div className="text-xs">{f.label} <span className="font-mono text-[10px] text-muted-foreground">0x{f.at.toString(16).toUpperCase()}</span></div>
                            <p className="m-0 text-[11px] leading-snug text-muted-foreground">{f.help}</p>
                          </div>
                          {f.options ? (
                            <select aria-label={f.label} value={value} onChange={(e) => attempt(`${entries[entry]}: ${f.label}`, () => writeStat(data!, entry, f, Number(e.target.value)))}
                              className="h-7 rounded-md border bg-background px-1.5 text-xs">
                              {!f.options.some(([v]: any) => v === value) && <option value={value}>{value}</option>}
                              {f.options.map(([v, label]: any) => <option key={v} value={v}>{label}</option>)}
                            </select>
                          ) : <NumberInput label={f.label} value={value} integer={f.type === "u32"} min={TYPE_LIMITS[f.type]?.[0]} max={TYPE_LIMITS[f.type]?.[1]} onCommit={(n) => attempt(`${entries[entry]}: ${f.label}`, () => writeStat(data!, entry, f, n))} />}
                        </div>
                      );
                    })}
                  </section>
                ))}
                {!fields.length && <p className="text-muted-foreground">No parameter matches “{query}”.</p>}
              </div>
            ) : t ? (
              <div className="space-y-2 text-xs">
                <div className="font-medium">{t.label}</div>
                <p className="m-0 text-[11px] text-muted-foreground">{t.help} Each box takes 0 to 255.</p>
                <div className="overflow-x-auto">
                  <table className="border-collapse text-[11px]">
                    <thead><tr><th className="sticky left-0 bg-card px-2 py-1 text-left font-medium">Item</th>{t.columnLabels.map((c: string) => <th key={c} className="px-1 py-1 font-medium text-muted-foreground">{c}</th>)}</tr></thead>
                    <tbody>{t.values.map((row: number[], r: number) => (
                      <tr key={r} className="border-t">
                        <td className="sticky left-0 whitespace-nowrap bg-card px-2 py-0.5">{ITEMS[r] || `Item ${r}`}</td>
                        {row.map((v: number, c: number) => (
                          <td key={c} className="px-0.5 py-0.5"><div className="w-12"><NumberInput label={`${ITEMS[r]} ${t.columnLabels[c]}`} integer min={0} max={255} value={v}
                            onCommit={(n) => attempt(`${t.label}: ${ITEMS[r]} ${t.columnLabels[c]}`, () => writeItemSlot(data!, t.index, r, c, n))} /></div></td>
                        ))}
                      </tr>))}</tbody>
                  </table>
                </div>
              </div>
            ) : bin ? (
              <div className="space-y-3 text-xs">
                <div className="font-medium">{bin.title}{binRow && ` · ${binRow.label}`}</div>
                <p className="m-0 border-b pb-3 text-[11px] leading-snug text-muted-foreground">{bin.help}</p>
                {bin.layout && (
                  <div className="flex flex-wrap items-end gap-2 border-y py-2">
                    <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">Read as
                      <select aria-label="Value type" value={bin.layout.type} onChange={(e) => setLayout({ type: e.target.value })} className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground">
                        <option value="auto">Automatic</option>
                        <option value="f32">Decimal (f32)</option>
                        <option value="s32">Whole, signed (s32)</option>
                        <option value="u32">Whole (u32)</option>
                        <option value="s16">Whole, signed (s16)</option>
                        <option value="u16">Whole (u16)</option>
                        <option value="u8">Byte (u8)</option>
                      </select>
                    </label>
                    <label className="flex w-24 flex-col gap-0.5 text-[11px] text-muted-foreground">Header bytes
                      <NumberInput label="Header bytes" integer min={0} max={data!.length} value={bin.layout.header} onCommit={(n) => setLayout({ header: n })} />
                    </label>
                    <label className="flex w-24 flex-col gap-0.5 text-[11px] text-muted-foreground">Row bytes
                      <NumberInput label="Row bytes" integer min={1} max={Math.max(1, data!.length)} value={bin.layout.rowSize} onCommit={(n) => setLayout({ rowSize: n })} />
                    </label>
                    {layouts[file.path] && <Button size="sm" variant="ghost" onClick={() => { setLayouts(({ [file.path]: _, ...rest }) => rest); setRow(0); }}><RotateCcw /> Detected layout</Button>}
                  </div>
                )}
                {binRow?.fields.map((f: any, i: number) => (
                  <div key={i} className={cn("grid items-start gap-x-3 gap-y-0.5 border-b pb-2 last:border-b-0", f.options || f.bits || f.type === "rgba" ? "grid-cols-[minmax(0,1fr)_18rem]" : "grid-cols-[minmax(0,1fr)_9rem]")}>
                    <div className="min-w-0">
                      <div className="text-xs">{f.label} {f.offset !== undefined && <span className="font-mono text-[10px] text-muted-foreground">+0x{f.offset.toString(16).toUpperCase()} · {f.type}</span>}</div>
                      {f.help && <p className="m-0 text-[11px] leading-snug text-muted-foreground">{f.help}</p>}
                    </div>
                    {f.text !== undefined
                      ? <div className="min-w-0 break-all py-1 font-mono text-[11px]">{f.text}</div>
                      : f.type === "rgba" ? (() => {
                        const { hex, alpha } = readRgba(data!, f.at);
                        const label = `${binRow.label}: ${f.label}`;
                        return <div className="flex items-center gap-1.5">
                          <ColorInput label={label} value={hex} onCommit={(next) => attempt(label, () => writeRgba(data!, f.at, next, alpha))} />
                          <span className="font-mono text-[10.5px] text-muted-foreground">{hex.toUpperCase()}</span>
                          <div className="w-14" title="Alpha (0–255)"><NumberInput label={`${label} alpha`} integer min={0} max={255} value={alpha} onCommit={(n) => attempt(label, () => writeRgba(data!, f.at, hex, n))} /></div>
                        </div>;
                      })()
                      : f.bits ? (() => {
                        const value = readBinValue(data!, f.at, f.type);
                        return <div className="flex flex-col gap-1">
                          {f.bits.map(([bit, text]: any) => (
                            <label key={bit} className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                              <input type="checkbox" className="accent-primary" checked={!!(value & (1 << bit))} aria-label={`${binRow.label}: ${text}`}
                                onChange={(e) => attempt(`${binRow.label}: ${text}`, () => writeBinValue(data!, f.at, f.type, e.target.checked ? (value | (1 << bit)) >>> 0 : (value & ~(1 << bit)) >>> 0))} />
                              {text}
                            </label>
                          ))}
                          <span className="font-mono text-[10px] text-muted-foreground">0x{value.toString(16).toUpperCase().padStart(f.type === "u32" ? 8 : 4, "0")}</span>
                        </div>;
                      })()
                      : f.options ? (() => {
                        const value = readBinValue(data!, f.at, f.type);
                        return <select aria-label={`${binRow.label}: ${f.label}`} value={value} title={f.options.find(([v]: any) => v === value)?.[1]}
                          onChange={(e) => attempt(`${binRow.label}: ${f.label}`, () => writeBinValue(data!, f.at, f.type as keyof typeof BIN_TYPES, Number(e.target.value)))}
                          className="h-7 w-full min-w-0 rounded-md border bg-background px-1.5 text-xs">
                          {!f.options.some(([v]: any) => v === value) && <option value={value}>{value}</option>}
                          {f.options.map(([v, label]: any) => <option key={v} value={v}>{label}</option>)}
                        </select>;
                      })()
                      : <NumberInput label={`${binRow.label}: ${f.label}`} value={readBinValue(data!, f.at, f.type)} integer={f.type !== "f32"}
                          min={(BIN_LIMITS as any)[f.type]?.[0]} max={(BIN_LIMITS as any)[f.type]?.[1]}
                          onCommit={(n) => attempt(`${binRow.label}: ${f.label}`, () => writeBinValue(data!, f.at, f.type as keyof typeof BIN_TYPES, n))} />}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
      {!!files.length && <HistoryBar history={history} onSave={() => void save()} saving={saving} saveLabel={`Save ${archiveName}`} />}
    </div>
  );
}
