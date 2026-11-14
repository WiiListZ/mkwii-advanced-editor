// The object documentation JSON as a form: its objects in a list, and the chosen one's description,
// status and eight settings with their choices. It edits the same text as the raw JSON view: each
// change is written back to that text (indented), and the same check judges it.

import * as React from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { documentationStatus, STATUS_LABELS } from "../../../js/data/object-documentation.js";

const KEY = /^(?:0x[0-9a-f]+|[0-9]+|[A-Za-z_][A-Za-z0-9_.-]*)$/i;
const SETTINGS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const plain = (value: any) => !!value && typeof value === "object" && !Array.isArray(value);
const fieldClass = "w-full rounded-md border border-input bg-black/20 px-2.5 py-1.5 text-[12px] leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// A copy with the field set, or without it when emptied.
const withField = (entry: any, name: string, value: any) => {
  const next = { ...entry };
  if (value === undefined || value === "") delete next[name]; else next[name] = value;
  return next;
};
// Renamed in place: the other keys keep their order.
const renamed = (object: Record<string, any>, from: string, to: string) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key === from ? to : key, value]));

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={cn("flex min-w-0 flex-col gap-1", wide && "col-span-2")}><span className="text-[11px] font-bold text-muted-foreground">{label}</span>{children}</label>;
}

function ObjectFilter({ label, ariaLabel, value, onChange, options }: { label: string; ariaLabel: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <Field label={label}>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className="h-7 text-[12px]"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent>
    </Select>
  </Field>;
}

function TextField({ label, value, onChange, multiline, wide, placeholder }: { label: string; value: any; onChange: (value: string) => void; multiline?: boolean; wide?: boolean; placeholder?: string }) {
  return <Field label={label} wide={wide}>
    {multiline
      ? <textarea aria-label={label} value={value ?? ""} placeholder={placeholder} rows={2} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={cn(fieldClass, "min-h-[52px] resize-y")} />
      : <Input aria-label={label} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="h-7 text-[12px]" />}
  </Field>;
}

// A whole number, or nothing when emptied; what is not a whole number yet waits in the box.
function NumberField({ label, value, onChange }: { label: string; value: any; onChange: (value: number | undefined) => void }) {
  const [draft, setDraft] = React.useState(value === undefined ? "" : String(value));
  React.useEffect(() => { setDraft(value === undefined ? "" : String(value)); }, [value]);
  return <Field label={label}>
    <Input aria-label={label} inputMode="numeric" value={draft} onKeyDown={(e) => e.stopPropagation()} className="h-7 text-[12px]"
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() === "") onChange(undefined);
        else if (/^-?\d+$/.test(e.target.value.trim())) onChange(Number(e.target.value));
      }} />
  </Field>;
}

// A key edited in a box of its own, used when the box is left: an object's name or ID, a choice's value.
function KeyField({ label, value, valid, taken, onCommit, className }: { label: string; value: string; valid: (key: string) => boolean; taken: (key: string) => boolean; onCommit: (key: string) => void; className?: string }) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => { setDraft(value); }, [value]);
  const bad = draft !== value && (!valid(draft) || taken(draft));
  const commit = () => { if (draft !== value && !bad) onCommit(draft); else setDraft(value); };
  return <Input aria-label={label} value={draft} aria-invalid={bad} title={bad ? (taken(draft) ? "Already used" : "Not a valid key") : undefined}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") setDraft(value); }}
    className={cn("h-7 text-[12px]", bad && "border-destructive", className)} />;
}

function Choices({ options, onChange }: { options: Record<string, string> | undefined; onChange: (options: Record<string, string> | undefined) => void }) {
  const entries = Object.entries(options || {});
  const set = (next: [string, string][]) => onChange(next.length ? Object.fromEntries(next) : undefined);
  const free = () => { let n = 0; while (entries.some(([key]) => Number(key) === n)) n++; return String(n); };
  return <div className="col-span-2 flex flex-col gap-1">
    <span className="text-[11px] font-bold text-muted-foreground">Choices (value and its name)</span>
    {entries.map(([value, name], i) => <div key={`${i}:${value}`} className="grid grid-cols-[72px_1fr_auto] items-center gap-1.5">
      <KeyField label={`Choice ${i + 1} value`} value={value} valid={(key) => /^-?\d+$/.test(key)} taken={(key) => entries.some(([other], j) => j !== i && Number(other) === Number(key))}
        onCommit={(key) => set(entries.map(([k, v], j) => j === i ? [key, v] : [k, v]))} />
      <Input aria-label={`Choice ${i + 1} name`} value={name} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => set(entries.map(([k, v], j) => j === i ? [k, e.target.value] : [k, v]))} className="h-7 text-[12px]" />
      <Button size="icon-sm" variant="ghost" aria-label={`Remove choice ${value}`} title="Remove this choice" onClick={() => set(entries.filter((_, j) => j !== i))}><Trash2 /></Button>
    </div>)}
    <Button size="sm" variant="ghost" className="h-7 self-start px-2 text-xs" onClick={() => set([...entries, [free(), ""]])}><Plus /> Add a choice</Button>
  </div>;
}

function SettingCard({ index, setting, onChange, onRemove }: { index: string; setting: any; onChange: (setting: any) => void; onRemove: () => void }) {
  const set = (name: string, value: any) => onChange(withField(setting, name, value));
  return <div className="rounded-md border p-2.5" data-doc-setting={index}>
    <div className="mb-2 flex items-center gap-2">
      <div className="text-xs font-medium">Setting {index}</div>
      <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{setting.label}</div>
      <Button size="icon-sm" variant="ghost" aria-label={`Clear setting ${index}`} title="Clear this setting's documentation" onClick={onRemove}><Trash2 /></Button>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <TextField label="Name" value={setting.label} onChange={(v) => onChange({ ...setting, label: v })} wide placeholder="Required" />
      <TextField label="Description" value={setting.description} onChange={(v) => set("description", v)} multiline wide />
      <TextField label="Values" value={setting.values} onChange={(v) => set("values", v)} placeholder="What the numbers mean, in words" />
      <TextField label="Limits" value={setting.limits} onChange={(v) => set("limits", v)} placeholder="What is not known or not allowed" />
      <NumberField label="Lowest value" value={setting.min} onChange={(v) => set("min", v)} />
      <NumberField label="Highest value" value={setting.max} onChange={(v) => set("max", v)} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!setting.signed} onChange={(e) => set("signed", e.target.checked || undefined)} /> Signed (can be below zero)</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!setting.otherValues} onChange={(e) => set("otherValues", e.target.checked || undefined)} /> Other values allowed</label>
      <label className="col-span-2 flex items-center gap-2 text-xs" title="Check reports placed objects that leave this setting at 0"><input type="checkbox" checked={!!setting.required} onChange={(e) => set("required", e.target.checked || undefined)} /> Required (the object does not work with 0)</label>
      <Choices options={setting.options} onChange={(options) => set("options", options)} />
    </div>
  </div>;
}

export function ObjectDocumentationVisual({ text, onChange, onRaw }: { text: string; onChange: (text: string) => void; onRaw: () => void }) {
  const doc = React.useMemo(() => {
    try { const json = JSON.parse(text); return plain(json) && plain(json.objects) ? json : null; } catch { return null; }
  }, [text]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [percentFilter, setPercentFilter] = React.useState("all");
  const [settingsFilter, setSettingsFilter] = React.useState("all");
  const [showFilters, setShowFilters] = React.useState(false);
  const filtersId = React.useId();
  const [newKey, setNewKey] = React.useState("");

  if (!doc) return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-md border bg-muted/20 p-6 text-center text-xs text-muted-foreground" data-doc-visual-unreadable>
    The JSON is not valid, so it cannot be shown as a form. The message below says where.
    <Button size="sm" variant="secondary" onClick={onRaw}>Fix it in Raw JSON</Button>
  </div>;

  const objects: Record<string, any> = doc.objects;
  const keys = Object.keys(objects);
  const current = selected !== null && Object.hasOwn(objects, selected) ? selected : keys[0] ?? null;
  const entry = current !== null && plain(objects[current]) ? objects[current] : null;
  const commit = (next: Record<string, any>) => onChange(JSON.stringify({ ...doc, objects: next }, null, 2));
  const setEntry = (next: any) => current !== null && commit({ ...objects, [current]: next });
  const set = (name: string, value: any) => entry && setEntry(withField(entry, name, value));
  const shown = keys.filter((key) => {
    const words = filter.trim().toLowerCase();
    const object = plain(objects[key]) ? objects[key] : {};
    const { status, percent } = documentationStatus(object);
    const named = SETTINGS.filter((index) => object.settings?.[index]?.label?.trim()).length;
    return (!words || [key, object.label, object.description, object.notes].some((value) => String(value ?? "").toLowerCase().includes(words)))
      && (statusFilter === "all" || status === statusFilter)
      && (percentFilter === "all" || (percentFilter === "zero" ? percent === 0 : percentFilter === "low" ? percent > 0 && percent < 50 : percentFilter === "high" ? percent >= 50 && percent < 100 : percent === 100))
      && (settingsFilter === "all" || (settingsFilter === "none" ? named === 0 : settingsFilter === "partial" ? named > 0 && named < 8 : named === 8));
  });
  const add = () => {
    const key = newKey.trim();
    if (!KEY.test(key)) return;
    if (!Object.hasOwn(objects, key)) commit({ ...objects, [key]: { status: "unknown" } });
    setSelected(key);
    setNewKey("");
  };
  const settings = plain(entry?.settings) ? entry.settings : {};
  const activeFilters = [statusFilter, percentFilter, settingsFilter].filter((value) => value !== "all").length;
  const setSettings = (next: Record<string, any>) => set("settings", Object.keys(next).length ? next : undefined);

  return <div className="grid min-h-0 flex-1 grid-cols-[250px_1fr] overflow-hidden rounded-md border" data-doc-visual>
    <div className="flex min-h-0 flex-col border-r">
      <div className="space-y-1.5 border-b p-2">
        <Field label="Search objects">
          <Input type="search" aria-label="Find an object" placeholder="Name, ID or description…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="h-7 text-[12px]" />
        </Field>
        <Button size="sm" variant={showFilters || activeFilters ? "secondary" : "ghost"} className="h-7 px-2 text-xs" aria-expanded={showFilters} aria-controls={filtersId}
          onClick={() => setShowFilters((value) => !value)}><SlidersHorizontal /> Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}</Button>
        <div id={filtersId} hidden={!showFilters} className="space-y-1.5">
        <ObjectFilter label="Status" ariaLabel="Filter objects by status" value={statusFilter} onChange={setStatusFilter}
          options={[["all", "All statuses"], ["documented", "Documented"], ["partial", "Partially documented"], ["unknown", "Undocumented / unknown"]]} />
        <ObjectFilter label="Documented (%)" ariaLabel="Filter objects by percentage" value={percentFilter} onChange={setPercentFilter}
          options={[["all", "All percentages"], ["zero", "0%"], ["low", "1–49%"], ["high", "50–99%"], ["complete", "100%"]]} />
        <ObjectFilter label="Settings documentation" ariaLabel="Filter objects by settings documentation" value={settingsFilter} onChange={setSettingsFilter}
          options={[["all", "All settings coverage"], ["none", "No settings named"], ["partial", "1–7 settings named"], ["complete", "All 8 settings named"]]} />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span role="status">{shown.length} of {keys.length} objects</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!filter && statusFilter === "all" && percentFilter === "all" && settingsFilter === "all"}
            onClick={() => { setFilter(""); setStatusFilter("all"); setPercentFilter("all"); setSettingsFilter("all"); }}>Reset filters</Button>
        </div>
        <div className="flex gap-1.5">
          <Input aria-label="New object name or ID" placeholder="Name or ID" value={newKey} onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") add(); }} className="h-7 text-[12px]" />
          <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-xs" disabled={!KEY.test(newKey.trim())} title="Add an object by its internal name (as in the game's files) or its ID" onClick={add}><Plus /> Add</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Documented objects">
        {shown.map((key) => {
          const status = documentationStatus(plain(objects[key]) ? objects[key] : {});
          // The chosen one stays in sight, also one just added at the end.
          return <button key={key} type="button" role="option" aria-selected={key === current} onClick={() => setSelected(key)} ref={key === current ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            className={cn("flex w-full cursor-pointer flex-col items-start gap-0.5 border-b px-2.5 py-1.5 text-left last:border-b-0 hover:bg-accent/50", key === current && "bg-accent")}>
            <span className="w-full truncate font-mono text-[12px]">{key}</span>
            <span className="w-full truncate text-[11px] text-muted-foreground">{objects[key]?.label || STATUS_LABELS[status.status as keyof typeof STATUS_LABELS]} · {status.percent}%</span>
          </button>;
        })}
        {!shown.length && <p className="m-0 p-2.5 text-xs text-muted-foreground">No object matches.</p>}
      </div>
    </div>
    <div className="min-h-0 overflow-y-auto p-3">
      {current === null || !entry ? <p className="m-0 text-xs text-muted-foreground">{current === null ? "No objects yet: add one by its name or ID." : "This entry is not an object: fix it in Raw JSON."}</p> : <div className="flex flex-col gap-3" data-doc-object={current}>
        <div className="flex items-end gap-2">
          <Field label="Internal name or ID">
            <KeyField label="Object name or ID" value={current} valid={(key) => KEY.test(key)} taken={(key) => Object.hasOwn(objects, key)} className="font-mono"
              onCommit={(key) => { commit(renamed(objects, current, key)); setSelected(key); }} />
          </Field>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 text-xs" title="Remove this object's documentation" onClick={() => { const { [current]: _, ...rest } = objects; commit(rest); setSelected(null); }}><Trash2 /> Remove object</Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Name shown" value={entry.label} onChange={(v) => set("label", v)} wide placeholder="Optional: in place of the internal name" />
          <TextField label="Description" value={entry.description} onChange={(v) => set("description", v)} multiline wide />
          <TextField label="Notes" value={entry.notes} onChange={(v) => set("notes", v)} multiline wide />
          <ObjectFilter label="Status" ariaLabel="Status" value={entry.status ?? "automatic"} onChange={(value) => set("status", value === "automatic" ? undefined : value)}
            options={[["automatic", "Worked out from what is filled in"], ["documented", "Documented"], ["partial", "Partially documented"], ["unknown", "Unknown"]]} />
          <NumberField label="Documented (%)" value={entry.documented} onChange={(v) => set("documented", v)} />
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-md border p-2.5" data-doc-route>
          <ObjectFilter label="Route" ariaLabel="Route" value={entry.route ? (entry.route.required ? "required" : "none") : "unset"}
            onChange={(value) => set("route", value === "unset" ? undefined : { ...(plain(entry.route) ? entry.route : {}), required: value === "required" })}
            options={[["unset", "Not stated (the editor's list decides)"], ["required", "Required: the game crashes without one"], ["none", "Not needed"]]} />
          {plain(entry.route) && <TextField label="What the route does" value={entry.route.description} onChange={(v) => set("route", withField(entry.route, "description", v))} multiline wide />}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium">Settings</div>
          </div>
          {SETTINGS.map((index) => <SettingCard key={index} index={index} setting={plain(settings[index]) ? settings[index] : {}}
            onChange={(next) => setSettings({ ...settings, [index]: next })}
            onRemove={() => { const { [index]: _, ...rest } = settings; setSettings(rest); }} />)}
        </div>
      </div>}
    </div>
  </div>;
}
