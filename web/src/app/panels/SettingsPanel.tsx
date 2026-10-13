import { NumberField } from "../number-field";
import * as React from "react";
import { FileCheck2, FolderOpen, RotateCcw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../js/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SETTINGS_HELP } from "../../../js/data/help.js";
import { useEditor } from "../hooks";
import { dialogs } from "../dialogs-store";
import { WorkspaceCard } from "./WorkspaceCard";
import type { Settings } from "../editor";

type SettingKey = keyof Settings;

function SettingRow({ name, children }: { name: SettingKey; children: React.ReactNode }) {
  const help = (SETTINGS_HELP as Record<string, { label: string; help: string }>)[name];
  return <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs font-medium" htmlFor={`setting-${name}`}>{help.label}</label>
      {children}
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">{help.help}</p>
  </div>;
}

function NumberSetting({ name, value, min, max, onSave }: { name: string; value: number; min: number; max: number; onSave: (value: number) => void }) {
  return <NumberField id={`setting-${name}`} aria-label={name} value={value} min={min} max={max} integer commit onValue={onSave} className="h-8 w-24 text-right text-xs" />;
}

export function SettingsPanel() {
  const ed = useEditor("settings", "ui", "doc");
  const s = ed.settings;
  const choices = (name: SettingKey, options: [string, string][], numeric = false) => {
    // Values set elsewhere (e.g. the camera speed from the mouse wheel) stay visible.
    if (!options.some(([value]) => value === String(s[name]))) options = [...options, [String(s[name]), `Custom ×${s[name]}`]];
    return <Select value={String(s[name])} onValueChange={(value) => ed.setSetting(name as any, numeric ? Number(value) : value as any)}>
    <SelectTrigger id={`setting-${name}`} aria-label={(SETTINGS_HELP as any)[name].label} className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
  </Select>;
  };
  const toggle = (name: SettingKey) => <Switch id={`setting-${name}`} aria-label={(SETTINGS_HELP as any)[name].label} checked={!!s[name]} onCheckedChange={async (value) => {
    if (name === "keepBackups" && !value && !(await dialogs.confirm({
      title: "Turn off .bak backups?",
      description: "Future saves will overwrite files without making a new .bak copy. Existing backups stay in place.",
      confirmLabel: "Turn off backups",
    }))) return;
    ed.setSetting(name as any, value);
  }} />;
  const number = (name: SettingKey, min: number, max: number) => <NumberSetting name={name} value={s[name] as number} min={min} max={max} onSave={(value) => ed.setSetting(name as any, value)} />;
  return <div className="h-full overflow-y-auto p-3" data-settings-panel>
    <div className="mb-4 flex items-start gap-2">
      <Settings2 className="mt-0.5 size-4 shrink-0" />
      <div><h2 className="text-sm font-semibold">Settings</h2><p className="text-[11px] text-muted-foreground">Changes are saved automatically for the next launch.</p></div>
    </div>

    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interface</h3>
    <div className="space-y-2">
      <SettingRow name="uiFont">{choices("uiFont", [["default", "Default"], ["game", "Mario Kart Wii"]])}</SettingRow>
    </div>

    <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">3D view</h3>
    <div className="space-y-2">
      <SettingRow name="modelMode">{choices("modelMode", [["real", "Game models"], ["simple", "Simple models"], ["markers", "Markers only"]])}</SettingRow>
      <SettingRow name="displayMode">{choices("displayMode", [["auto", "Automatic"], ["visual", "Track model"], ["collision", "Collision"], ["both", "Both"]])}</SettingRow>
      <SettingRow name="quality">{choices("quality", [["high", "High"], ["medium", "Medium"], ["low", "Low / faster"]])}</SettingRow>
      <SettingRow name="animations">{toggle("animations")}</SettingRow>
      <SettingRow name="showLabels">{toggle("showLabels")}</SettingRow>
      <SettingRow name="selectionBox">{toggle("selectionBox")}</SettingRow>
      <SettingRow name="showAreaVolumes">{toggle("showAreaVolumes")}</SettingRow>
      <SettingRow name="areaOutlinesThroughWalls">{toggle("areaOutlinesThroughWalls")}</SettingRow>
      <SettingRow name="showEffects">{toggle("showEffects")}</SettingRow>
      <SettingRow name="hideGrid">{toggle("hideGrid")}</SettingRow>
      <SettingRow name="modelEditing">{toggle("modelEditing")}</SettingRow>
      <SettingRow name="smartAlignment">{toggle("smartAlignment")}</SettingRow>
      <SettingRow name="iconSize">{number("iconSize", 20, 2000)}</SettingRow>
    </div>

    <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Camera</h3>
    <div className="space-y-2">
      <SettingRow name="flySpeed">{choices("flySpeed", [["0.5", "Slow"], ["1", "Normal"], ["1.5", "Fast"], ["2", "Very fast"]], true)}</SettingRow>
      <SettingRow name="lookSensitivity">{choices("lookSensitivity", [["0.5", "Low"], ["1", "Normal"], ["1.5", "High"], ["2", "Very high"]], true)}</SettingRow>
      <SettingRow name="hideCursorWhileLooking">{toggle("hideCursorWhileLooking")}</SettingRow>
    </div>

    <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Editing</h3>
    <div className="space-y-2">
      <SettingRow name="keepBackups">{toggle("keepBackups")}</SettingRow>
      <SettingRow name="textureBrushSize">{number("textureBrushSize", 1, 128)}</SettingRow>
      <SettingRow name="showDescriptions">{toggle("showDescriptions")}</SettingRow>
      <SettingRow name="confirmModelDrop">{toggle("confirmModelDrop")}</SettingRow>
      <SettingRow name="offerCopyUpdates">{toggle("offerCopyUpdates")}</SettingRow>
      <SettingRow name="autoCheckpointWidth">{toggle("autoCheckpointWidth")}</SettingRow>
      <SettingRow name="checkpointWidth">{number("checkpointWidth", 200, 20000)}</SettingRow>
      <SettingRow name="pathWidth">{number("pathWidth", 1, 500)}</SettingRow>
    </div>

    <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Game files</h3>
    <div className="mb-2"><WorkspaceCard compact /></div>
    <div className="mb-2 space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="text-xs font-medium">Object documentation</div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Descriptions and setting names for game objects. {Object.keys(ed.importedObjectDocumentation).length} custom entries are saved in the editor settings.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void ed.importObjectDocumentation()}><FolderOpen /> Import JSON…</Button>
        {Object.keys(ed.importedObjectDocumentation).length > 0 && <Button size="sm" variant="ghost" onClick={() => void ed.clearImportedObjectDocumentation()}>Remove imported</Button>}
      </div>
    </div>
    <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="text-xs font-medium">Race/Common.szs {ed.assets?.common ? "· Loaded" : "· Not loaded"}</div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Provides shared game objects and their original 3D models.</p>
      <Button size="sm" variant="secondary" onClick={() => ed.loadObjFlow()}><FolderOpen /> Load Common.szs…</Button>
    </div>
    <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2.5">
      <div className="text-xs font-medium">Tracks folder</div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Folder with the game's track .szs files (files\Race\Course). Track model › + › Part from game models lists them to copy their model parts.</p>
      <div className="truncate text-[11px] text-muted-foreground [direction:rtl] text-left" title={ed.partsFolder()}>{ed.partsFolder() || "Not chosen"}</div>
      <Button size="sm" variant="secondary" onClick={() => ed.choosePartsFolder()}><FolderOpen /> Choose folder…</Button>
    </div>
    <FileAssociation />
    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" onClick={async () => {
        if (await dialogs.confirm({ title: "Reset settings?", description: "All the options above go back to their default values. Recent files, favourites and folders are kept.", confirmLabel: "Reset" })) ed.resetSettings();
      }}><RotateCcw /> Reset to defaults</Button>
    </div>
  </div>;
}

// Double-click a track, archive, model, text, effect or music file in Explorer to open it here.
function FileAssociation() {
  const [state, setState] = React.useState<{ available: boolean; registered: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { api.fileAssociation().then(setState).catch(() => setState({ available: false, registered: false })); }, []);
  const change = async (register: boolean) => {
    setBusy(true);
    try {
      setState(await api.setFileAssociation(register));
      if (register) toast.success("Mario Kart Wii files open with MKWii Advanced Editor", { description: "Double-click a .szs, .kmp, .kcl, .brres, .bmg, .breff, .breft, .brstm or .brsar. If Windows still opens another program, right-click the file › Open with › MKWii Advanced Editor › Always." });
      else toast.success("File association removed");
    } catch (e: any) { toast.error("Could not change the file association", { description: e.message }); }
    setBusy(false);
  };
  return <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2.5">
    <div className="text-xs font-medium">Open Mario Kart Wii files with this editor {state?.registered ? "· On" : ""}</div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      {state && !state.available ? "Available in the installed MKWiiAdvancedEditor.exe." : "Double-click a track or archive (.szs, .wlz, .wbz, .wu8, .kmp, .kcl), a model (.brres), game text (.bmg), an effect (.breff, .breft) or music (.brstm, .brsar) in Explorer to open it here. It also adds the editor to the “Open with” menu. Only for your Windows user."}
    </p>
    <Button size="sm" variant="secondary" disabled={!state?.available || busy} onClick={() => change(!state?.registered)}>
      <FileCheck2 /> {state?.registered ? "Remove association" : "Associate Mario Kart Wii files"}
    </Button>
  </div>;
}
