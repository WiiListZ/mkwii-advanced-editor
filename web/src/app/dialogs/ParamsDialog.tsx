// Game parameter files (.bin) of an archive: vehicle stats (kartParam.bin), character bonuses
// (driverParam.bin) and item probabilities (ItemSlot.bin). Each value has a short explanation.

import * as React from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dialogs } from "../dialogs-store";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { listFiles } from "../../../js/formats/u8.js";
import { ITEMS, STAT_FIELDS, isItemSlot, isStatsFile, parseItemSlot, readStat, statEntries, writeItemSlot, writeStat } from "../../../js/formats/params.js";
import { NumberInput, TYPE_LIMITS } from "./EffectsDialog";
import { ColumnHandle, useColumnWidths } from "../resizable";
import { HistoryBar, useEditHistory, useHistoryKeys } from "../edit-history";
import { cn } from "@/lib/utils";

export const isParamFile = (path: string, data: Uint8Array) => isStatsFile(path, data) || isItemSlot(path, data);

export function ParamsDialog({ tree, archiveName, initialPath, onChange, onSave, close }: {
  tree: any; archiveName: string; initialPath?: string;
  onChange: (path: string, data: Uint8Array) => void;
  // Saves the archive the files belong to.
  onSave?: () => Promise<boolean> | boolean | void;
  close: (value: any) => void;
}) {
  const [, refresh] = React.useReducer((n: number) => n + 1, 0);
  const files = listFiles(tree).filter((f: any) => isParamFile(f.path, f.node.data));
  const [path, setPath] = React.useState(() => files.find((f: any) => f.path === initialPath)?.path || files[0]?.path || "");
  const file = files.find((f: any) => f.path === path) || files[0];
  const data: Uint8Array | null = file?.node.data || null;
  const stats = !!file && isStatsFile(file.path, data!);
  const [entry, setEntry] = React.useState(0);
  const [table, setTable] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const columns = useColumnWidths("params", [210, 220]);
  const history = useEditHistory((filePath, bytes) => { onChange(filePath, bytes); refresh(); });
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try { if ((await onSave()) !== false) history.saved(); } finally { setSaving(false); }
  };
  useHistoryKeys(history, () => void save());
  const requestClose = async () => {
    if (history.unsaved && !(await dialogs.confirm({ title: "Unsaved parameters", description: `The changes in ${archiveName} have not been saved. Close and discard them?`, confirmLabel: "Discard changes", destructive: true }))) return;
    close(true);
  };
  const attempt = (label: string, fn: () => Uint8Array) => {
    try { history.record(file.path, file.node.data, fn(), label); }
    catch (e: any) { toast.error("Could not change the value", { description: e.message }); }
  };

  const entries = stats ? statEntries(file.path, data!) : [];
  const tables = !stats && data ? parseItemSlot(data) : [];
  const driver = stats && /driverParam/i.test(file.path);
  const q = query.trim().toLowerCase();
  const fields = STAT_FIELDS.filter((f: any) => !q || `${f.label} ${f.help} ${f.group}`.toLowerCase().includes(q));
  const groups = [...new Set(fields.map((f: any) => f.group))];
  const t = tables[table];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3" title="Close" aria-label="Close game parameters" onClick={requestClose}><X /></Button>
      <div className="shrink-0 pr-8">
        <DialogTitle className="flex items-center gap-2 text-sm"><SlidersHorizontal className="size-4" /> Game parameters · {archiveName}</DialogTitle>
        <DialogDescription className="text-xs">
          Vehicle stats, character bonuses and item chances. A value changes when its field loses focus or Enter is pressed; Undo and Redo step through the changes, Save writes {archiveName}.
          {driver && " Character values are added to the vehicle's own stats."}
        </DialogDescription>
      </div>
      {!files.length ? <p className="text-xs text-muted-foreground">This archive has no supported parameter files (kartParam.bin, driverParam.bin, ItemSlot.bin).</p> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:gap-0 sm:[grid-template-columns:var(--columns)]" style={{ "--columns": columns.template } as React.CSSProperties}>
          <div className="flex min-h-0 max-h-40 flex-col border sm:max-h-none">
            <div className="shrink-0 border-b px-2 py-2 text-[11px] text-muted-foreground">Files</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">{files.map((f: any) => (
              <button key={f.path} onClick={() => { setPath(f.path); setEntry(0); setTable(0); }} title={f.path}
                className={cn("block w-full cursor-pointer rounded border border-transparent px-2 py-1.5 text-left text-xs hover:bg-accent", f.path === file.path && "border-primary/60 bg-accent")}>
                <span className="block truncate font-medium">{f.path.split("/").pop()}</span>
                <span className="block truncate text-[10.5px] text-muted-foreground">{isStatsFile(f.path, f.node.data) ? (/driver/i.test(f.path) ? "Character bonuses" : "Vehicle stats") : "Item chances"}</span>
              </button>))}</div>
          </div>
          <ColumnHandle label="Resize the file list" onResize={(d) => columns.resize(0, d)} onReset={columns.reset} />
          <div className="flex min-h-0 max-h-48 flex-col border sm:max-h-none">
            <div className="shrink-0 border-b px-2 py-2 text-[11px] text-muted-foreground">{stats ? `${entries.length} ${driver ? "characters" : "vehicles"}` : `${tables.length} tables`}</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {stats ? entries.map((name: string, i: number) => (
                <button key={i} onClick={() => setEntry(i)} className={cn("block w-full cursor-pointer truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent", i === entry && "bg-accent")}>{name}</button>
              )) : tables.map((x: any) => (
                <button key={x.index} onClick={() => setTable(x.index)} className={cn("block w-full cursor-pointer truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent", x.index === table && "bg-accent")}>{x.label}</button>
              ))}
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
            ) : null}
          </div>
        </div>
      )}
      {!!files.length && <HistoryBar history={history} onSave={() => void save()} saving={saving} saveLabel={`Save ${archiveName}`} />}
    </div>
  );
}
