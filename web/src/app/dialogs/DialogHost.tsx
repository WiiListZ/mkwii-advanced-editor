import * as React from "react";
import {
  BookOpen, BrickWall, CircleCheck, Download, FileJson, FilePlus2, FolderOpen, GraduationCap, Keyboard, Package, Puzzle, Replace, Rocket, Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { KCL_TYPES, categorizeObject } from "../../../js/data/defs.js";
import { KIND_HELP, KCL_HELP, SETTINGS_HELP } from "../../../js/data/help.js";
import { TUTORIALS } from "../../../js/data/tutorials.js";
import { guessFlag } from "../../../js/formats/obj.js";
import { listFiles, setFile, findFile, newSzsTree } from "../../../js/formats/u8.js";
import { parseKMP } from "../../../js/formats/kmp.js";
import { parseKCL } from "../../../js/formats/kcl.js";
import { api, FILTERS } from "../../../js/api.js";
import { dialogs, useDialogStack, type DialogEntry, type FormOptions } from "../dialogs-store";
import { editor, hex, DEFAULT_SETTINGS } from "../editor";
import { KIND_ICON, SectionTitle } from "../common";
import { TrackGeneratorDialog } from "./TrackGeneratorDialog";
import { ModelPartsDialog } from "./ModelPartsDialog";
import { GameObjectsDialog } from "./GameObjectsDialog";
import { GameTextDialog } from "./GameTextDialog";
import { AudioDialog } from "./AudioDialog";
import { AssetEditorDialog, AssetTextureEditorDialog } from "./AssetEditorDialog";
import { RiivolutionDialog } from "./RiivolutionDialog";
import { WorkspaceCard } from "../panels/WorkspaceCard";
import { ObjectDocumentationHelp } from "../panels/ObjectDocumentationHelp";
import { SettingsPanel } from "../panels/SettingsPanel";
import { TextureEditorDialog, TrackSettingsEditor } from "../panels/Inspector";
import { ObjectPreview } from "../panels/ObjectPreview";
import { ObjectDocumentationView } from "../panels/ObjectDocumentationView";
import { ObjectAppearanceDialog, ObjectTextureEditorDialog } from "../panels/ObjectAppearance";
import { SkyDialog } from "./SkyDialog";
import { ArchiveDialog } from "./ArchiveDialog";
import { MenuResourceDialog } from "./MenuResourceDialog";
import { EffectsDialog } from "./EffectsDialog";
import { ParamsDialog } from "./ParamsDialog";
import { SkeletonEditorDialog } from "./SkeletonEditorDialog";
import { NumberField } from "../number-field";
import { APP_VERSION, useUpdates } from "../updates";

// Windows that can hold unsaved work: they close only through their own buttons, which ask first.
const GUARDED = ["gameText", "audio", "assetEditor", "assetTextureEditor", "riivolution", "archive", "textureEditor", "objectTextureEditor", "sky", "effects", "params", "skeletonEditor"];

export function DialogHost() {
  const stack = useDialogStack();
  return <>{stack.map((d) => <DialogSwitch key={d.id} entry={d} />)}</>;
}

function DialogSwitch({ entry }: { entry: DialogEntry }) {
  const close = (v: any = null) => dialogs.close(entry.id, v);
  const p = entry.props;
  if (entry.kind === "confirm" || entry.kind === "alert") {
    return (
      <AlertDialog open={!entry.closing} onOpenChange={(o) => !o && close(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{p.title}</AlertDialogTitle>
            {p.description && <AlertDialogDescription>{p.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            {entry.kind === "confirm" && <AlertDialogCancel onClick={() => close(false)}>{p.cancelLabel || "Cancel"}</AlertDialogCancel>}
            <AlertDialogAction destructive={p.destructive} onClick={() => close(true)}>{p.confirmLabel || "OK"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
  const sizes: Record<string, string> = {
    generator: "max-w-[1100px]", help: "max-w-[920px]", preferences: "max-w-[760px]", szs: "max-w-[760px]", modelParts: "max-w-[1180px]", gameObjects: "max-w-[1180px]", settings: "max-w-[620px] p-0 gap-0", trackSettings: "max-w-[520px]", importDrop: "max-w-[480px]", gameText: "flex h-[min(1100px,95vh)] max-w-[min(1640px,97vw)] flex-col overflow-hidden", riivolution: "flex h-[min(1000px,94vh)] max-w-[min(1400px,96vw)] flex-col overflow-hidden", audio: "flex h-[min(900px,92vh)] max-w-[min(1100px,95vw)] flex-col overflow-hidden", assetEditor: "flex h-[min(1100px,95vh)] max-w-[min(1640px,97vw)] flex-col overflow-hidden", assetTextureEditor: "flex h-[min(900px,92vh)] max-w-[min(1200px,94vw)] flex-col overflow-hidden", workspace: "max-w-[560px]", textureEditor: "flex h-[min(900px,92vh)] max-w-[min(1200px,94vw)] flex-col overflow-hidden", objectTextureEditor: "flex h-[min(900px,92vh)] max-w-[min(1200px,94vw)] flex-col overflow-hidden", objectAppearance: "max-w-[860px]", archive: "flex h-[min(820px,90vh)] max-w-[min(1000px,94vw)] flex-col overflow-hidden", menuResource: "flex h-[min(800px,92vh)] max-w-[min(1150px,96vw)] flex-col overflow-hidden", effects: "flex h-[min(900px,92vh)] max-w-[min(1300px,96vw)] flex-col overflow-hidden", params: "flex h-[min(900px,92vh)] max-w-[min(1300px,96vw)] flex-col overflow-hidden", skeletonEditor: "flex h-[min(900px,92vh)] max-w-[min(1200px,94vw)] flex-col overflow-hidden", sky: "flex h-[min(900px,92vh)] max-w-[min(1300px,95vw)] flex-col overflow-hidden", animationChoice: "max-w-[480px]", importObj: "max-w-[680px]", objectPicker: "max-w-[820px] p-0 gap-0",
  };
  const body = (() => {
    switch (entry.kind) {
      case "form": return <FormDialog opts={p} close={close} />;
      case "generator": return <TrackGeneratorDialog hasSzs={p.hasSzs} close={close} />;
      case "preferences": return <PreferencesDialog close={close} />;
      case "help": return <HelpDialog tab={p.tab} tutorial={p.tutorial} close={close} />;
      case "about": return <AboutDialog />;
      case "objectPicker": return <ObjectPicker current={p.current} purpose={p.purpose} close={close} />;
      case "importObj": return <ImportObjDialog groups={p.groups} close={close} />;
      case "szs": return <SzsDialog close={close} />;
      case "modelParts": return <ModelPartsDialog close={close} />;
      case "gameObjects": return <GameObjectsDialog close={close} />;
      case "gameText": return <GameTextDialog search={p.search} folder={p.folder} language={p.language} file={p.file} loose={p.loose} close={close} />;
      case "audio": return <AudioDialog file={p.file} loose={p.loose} close={close} />;
      case "riivolution": return <RiivolutionDialog initialFile={p.initialFile} close={close} />;
      case "assetEditor": return <AssetEditorDialog {...p} close={close} />;
      case "assetTextureEditor": return <AssetTextureEditorDialog {...p} close={close} />;
      case "workspace": return (
        <>
          <DialogHeader>
            <DialogTitle>Workspace</DialogTitle>
            <DialogDescription>The extracted game's files folder. Objects, tracks, model parts, menus, game text, music and sound effects are all taken from it.</DialogDescription>
          </DialogHeader>
          <WorkspaceCard />
          <DialogFooter><Button onClick={() => close(true)}>Done</Button></DialogFooter>
        </>
      );
      case "textureEditor": return <><DialogTitle className="sr-only">Texture editor</DialogTitle><DialogDescription className="sr-only">Paint on the texture of the selected model part.</DialogDescription><TextureEditorDialog name={p.name} close={close} /></>;
      case "objectTextureEditor": return <><DialogTitle className="sr-only">Object texture editor</DialogTitle><DialogDescription className="sr-only">Paint on this object's texture in the open track.</DialogDescription><ObjectTextureEditorDialog objectId={p.objectId} resourceName={p.resourceName} name={p.name} close={close} /></>;
      case "objectAppearance": return <ObjectAppearanceDialog objectId={p.objectId} close={close} />;
      case "sky": return <SkyDialog close={close} />;
      case "archive": return <ArchiveDialog {...p} close={close} />;
      case "menuResource": return <MenuResourceDialog {...p} close={close} />;
      case "effects": return <EffectsDialog {...p} close={close} />;
      case "params": return <ParamsDialog {...p} close={close} />;
      case "skeletonEditor": return <SkeletonEditorDialog {...p} close={close} />;
      case "importDrop": return <ImportDropDialog names={p.names} extra={p.extra} close={close} />;
      case "animationChoice": return <AnimationChoiceDialog file={p.file} animations={p.animations} purpose={p.purpose} close={close} />;
      case "trackSettings": return (
        <>
          <DialogHeader>
            <DialogTitle>Track settings</DialogTitle>
            <DialogDescription>{(KIND_HELP as any).STGI?.what || "Laps, starting grid, lens flare and speed of this track."} Changes apply immediately and can be undone.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] min-h-0 overflow-y-auto pr-1"><TrackSettingsEditor /></div>
          <DialogFooter><Button onClick={() => close(true)}>Done</Button></DialogFooter>
        </>
      );
      case "settings": return <><DialogTitle className="sr-only">Settings</DialogTitle><DialogDescription className="sr-only">Editor settings, saved automatically.</DialogDescription><div className="h-[78vh] min-h-0"><SettingsPanel /></div></>;
      case "trackCreated": return <TrackCreatedDialog {...p} close={close} />;
      default: return null;
    }
  })();
  return (
    <Dialog open={!entry.closing} onOpenChange={(o) => !o && !GUARDED.includes(entry.kind) && close(null)}>
      <DialogContent className={sizes[entry.kind]} onEscapeKeyDown={GUARDED.includes(entry.kind) ? (e) => e.preventDefault() : undefined} onPointerDownOutside={GUARDED.includes(entry.kind) ? (e) => e.preventDefault() : undefined} hideClose={["objectPicker", "textureEditor", "objectTextureEditor", "archive", "menuResource", "skeletonEditor", "sky", "effects", "params", "gameText", "audio", "assetEditor", "assetTextureEditor", "riivolution"].includes(entry.kind)}>{body}</DialogContent>
    </Dialog>
  );
}

// ---- Dropped 3D models ----------------------------------------------------------------------
function ImportDropDialog({ names, extra, close }: { names: string[]; extra: number; close: (v: any) => void }) {
  const [dontAsk, setDontAsk] = React.useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import {names.length > 1 ? `${names.length} 3D models` : "3D model"} into the track?</DialogTitle>
        <DialogDescription>They are added to course_model.brres at the centre of the 3D view, with their textures and animation. You can move them afterwards and undo the import.</DialogDescription>
      </DialogHeader>
      <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
        {names.map((n) => <li key={n} className="truncate">{n}</li>)}
      </ul>
      {extra > 0 && <p className="m-0 text-xs text-muted-foreground">{extra} other dropped file{extra > 1 ? "s" : ""} (textures, .bin, .mtl) will be used by the models.</p>}
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <Checkbox checked={dontAsk} onCheckedChange={(v) => setDontAsk(!!v)} /> Don't show this again
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button onClick={() => close({ dontAsk })}>Import</Button>
      </DialogFooter>
    </>
  );
}

function AnimationChoiceDialog({ file, animations, purpose, close }: { file: string; animations: { name: string; frames: number; objects: number }[]; purpose?: "convert"; close: (v: any) => void }) {
  // A standalone BRRES can hold every animation as its own CHR0 ("*"); a track model plays only one.
  const all = purpose === "convert" && animations.length > 1;
  const [choice, setChoice] = React.useState(all ? "*" : purpose === "convert" ? "-" : animations[0]?.name ?? "-");
  const option = (value: string, title: string, detail: string) => (
    <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${choice === value ? "border-primary bg-primary/10" : "hover:bg-accent/60"}`}>
      <input type="radio" name="animation" className="accent-primary" checked={choice === value} onChange={() => setChoice(value)} />
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{title}</span><span className="block text-xs text-muted-foreground">{detail}</span></span>
    </label>
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{purpose === "convert" ? "Convert model and skeleton" : "Choose the animation"}</DialogTitle>
        <DialogDescription>{purpose === "convert" ? `${file} has ${animations.length} animation${animations.length === 1 ? "" : "s"}. Choose which animations the BRRES should include as CHR0; the model and skeleton are kept either way.` : `${file} has ${animations.length} animations. Mario Kart Wii plays one animation per imported model, looping, as a CHR0 in course_model.brres.`}</DialogDescription>
      </DialogHeader>
      <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
        {all && option("*", `All animations (${animations.length})`, "One CHR0 per animation of the armature")}
        {purpose === "convert" && option("-", "Model and skeleton only", "Keep the rig without creating a CHR0 animation")}
        {animations.map((a) => option(a.name, a.name, `${a.frames} frames · ${(a.frames / 60).toFixed(2)} s · ${a.objects} object${a.objects > 1 ? "s" : ""}`))}
        {purpose !== "convert" && option("-", "No animation", "Import the model in its rest pose")}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button onClick={() => close(choice)}>{purpose === "convert" ? "Convert" : "Import"}</Button>
      </DialogFooter>
    </>
  );
}

// ---- Generic form ----------------------------------------------------------------------------
function FormDialog({ opts, close }: { opts: FormOptions; close: (v: any) => void }) {
  const [values, setValues] = React.useState<Record<string, any>>(() => Object.fromEntries(opts.fields.map((f) => [f.key, f.value])));
  const set = (k: string, v: any) => setValues((s) => ({ ...s, [k]: v }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); close(values); }} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{opts.title}</DialogTitle>
        {opts.description && <DialogDescription>{opts.description}</DialogDescription>}
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {opts.fields.filter((f) => !f.visible || f.visible(values)).map((f) => (
          <div key={f.key} className="grid grid-cols-1 items-center gap-x-4 gap-y-1 sm:grid-cols-[1fr_160px]">
            <Label className="text-[13px] text-foreground">{f.label}</Label>
            {f.type === "switch" ? <Switch checked={!!values[f.key]} onCheckedChange={(v) => set(f.key, v)} className="justify-self-end" />
              : f.type === "select" ? (
                <Select value={String(values[f.key])} onValueChange={(v) => set(f.key, v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{f.options!.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              ) : f.type === "number"
                ? <NumberField aria-label={f.label} value={Number(values[f.key]) || 0} min={f.min} max={f.max} step={f.step ?? 1} onValue={(n) => set(f.key, n)} />
                : <Input type="text" value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />}
            {f.hint && <p className="col-span-2 m-0 text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button type="submit">{opts.confirmLabel || "OK"}</Button>
      </DialogFooter>
    </form>
  );
}

// ---- Preferences -----------------------------------------------------------------------------
function PreferencesDialog({ close }: { close: (v: any) => void }) {
  const s = editor.settings;
  const [draft, setDraft] = React.useState<any>({ ...s });
  const set = (k: string, v: any) => setDraft((d: any) => ({ ...d, [k]: v }));
  const row = (key: string, control: React.ReactNode) => (
    <div key={key} className="grid grid-cols-[1fr_210px] items-center gap-6 rounded-lg border bg-muted/20 px-4 py-3">
      <div>
        <div className="text-[13px] font-medium">{(SETTINGS_HELP as any)[key].label}</div>
        <p className="m-0 mt-0.5 text-xs leading-relaxed text-muted-foreground">{(SETTINGS_HELP as any)[key].help}</p>
      </div>
      <div className="flex justify-end">{control}</div>
    </div>
  );
  const select = (key: string, options: [string, string][]) => (
    <Select value={draft[key]} onValueChange={(v) => set(key, v)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
  const sw = (key: string) => <Switch checked={!!draft[key]} onCheckedChange={async (v) => {
    if (key === "keepBackups" && !v && !(await dialogs.confirm({ title: "Turn off .bak backups?", description: "Future saves will overwrite files without making a new .bak copy. Existing backups stay in place.", confirmLabel: "Turn off backups" }))) return;
    set(key, v);
  }} />;
  const num = (key: string, min: number, max: number) => <NumberField aria-label={key} value={Number(draft[key]) || 0} min={min} max={max} onValue={(n) => set(key, n)} />;
  const common = !!editor.assets?.common;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Preferences</DialogTitle>
        <DialogDescription>Every option is explained next to its control. Changes are saved for next time.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        <SectionTitle className="mt-0">Display</SectionTitle>
        {row("uiFont", select("uiFont", [["default", "Default"], ["game", "Mario Kart Wii"]]))}
        {row("modelMode", select("modelMode", [["real", "Real game models"], ["simple", "Simple models"], ["markers", "Markers only"]]))}
        {row("displayMode", select("displayMode", [["auto", "Automatic"], ["visual", "Track model"], ["collision", "Collision"], ["both", "Both"]]))}
        {row("animations", sw("animations"))}
        {row("showLabels", sw("showLabels"))}
        {row("iconSize", num("iconSize", 20, 2000))}
        {row("quality", select("quality", [["high", "High"], ["medium", "Medium"], ["low", "Low (fastest)"]]))}
        <SectionTitle>Editing</SectionTitle>
        {row("keepBackups", sw("keepBackups"))}
        {row("showDescriptions", sw("showDescriptions"))}
        {row("autoCheckpointWidth", sw("autoCheckpointWidth"))}
        {row("checkpointWidth", num("checkpointWidth", 200, 20000))}
        {row("pathWidth", num("pathWidth", 1, 500))}
        <SectionTitle>Game files</SectionTitle>
        <div className="grid grid-cols-[1fr_210px] items-center gap-6 rounded-lg border bg-muted/20 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-medium">Race/Common.szs {common ? <Badge variant="success"><CircleCheck /> Loaded</Badge> : <Badge variant="outline">Not loaded</Badge>}</div>
            <p className="m-0 mt-0.5 text-xs leading-relaxed text-muted-foreground">Shared game file with the official object list and the models used by every track (item boxes, shells…).</p>
          </div>
          <div className="flex justify-end"><Button variant="secondary" onClick={() => editor.loadObjFlow()}><FolderOpen /> Load…</Button></div>
        </div>
        <div className="grid grid-cols-[1fr_210px] items-center gap-6 rounded-lg border bg-muted/20 px-4 py-3">
          <div>
            <div className="text-[13px] font-medium">Guided tour</div>
            <p className="m-0 mt-0.5 text-xs leading-relaxed text-muted-foreground">Show again the short introduction to the parts of the editor.</p>
          </div>
          <div className="flex justify-end"><Button variant="secondary" onClick={() => { close(null); editor.cmd("tour"); }}>Start tour</Button></div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" className="mr-auto" onClick={() => setDraft((d: any) => ({ ...d, ...DEFAULT_SETTINGS }))}>Reset to defaults</Button>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button onClick={() => { const { viewCenter, recent, ...rest } = draft; editor.setSettings(rest); close(true); }}>Save</Button>
      </DialogFooter>
    </>
  );
}

// ---- Help center ------------------------------------------------------------------------------
const KEYS: [string, string][] = [
  ["Right mouse drag", "Look around (orbit)"], ["Middle mouse drag", "Pan"], ["Mouse wheel", "Zoom towards the cursor"],
  ["Hold right mouse + W A S D / Q E", "Fly (Shift = faster)"], ["Alt + left drag", "Orbit (laptops)"],
  ["Left click", "Select"], ["Shift / Ctrl + click", "Add to / toggle selection"], ["Left drag on empty space", "Box selection"],
  ["W / E / R", "Move / Rotate / Scale"], ["G", "Snap selection to the ground"], ["F / double-click", "Focus selection"],
  ["Home", "Frame the whole track"], ["T", "Top view"], ["Ctrl+D", "Duplicate"], ["Ctrl+X / Del", "Delete"], ["Ctrl+A", "Select all of the same kind"],
  ["A", "Add a point after the selected one"], ["Esc", "Cancel tool / clear selection"], ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
  ["Ctrl+O / Ctrl+S / Ctrl+Shift+S", "Open / Save / Save as"], ["Ctrl+N", "Create a new track"], ["Ctrl+,", "Settings"], ["F1", "Help"],
  ["K", "Cameras tab: add / update the intro keyframe at the playhead from the view"], ["Space", "Cameras tab: play / stop the intro"],
  [", / .", "Cameras tab: previous / next keyframe"], ["← / →", "Cameras tab: move the playhead one frame (Shift: one second)"],
];

// Help center › Tutorials: list on the left, the chosen tutorial's steps on the right.
function Tutorials({ initial }: { initial?: string }) {
  const [id, setId] = React.useState(initial && TUTORIALS.some((t) => t.id === initial) ? initial : TUTORIALS[0].id);
  const t = TUTORIALS.find((x) => x.id === id)!;
  return (
    <div className="grid grid-cols-[190px_1fr] gap-4">
      <nav className="flex flex-col gap-0.5" aria-label="Tutorials">
        {TUTORIALS.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === id} onClick={() => setId(x.id)}
            className={`cursor-pointer rounded-md px-2 py-1.5 text-left text-xs ${x.id === id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}>
            {x.title}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        <h3 className="m-0 text-sm font-semibold">{t.title}</h3>
        <p className="mb-3 mt-1 text-muted-foreground">{t.summary}</p>
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5">{t.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        {t.tips && <ul className="m-0 mt-3 list-disc border-t pl-5 pt-3 text-xs text-muted-foreground">{t.tips.map((tip, i) => <li key={i} className="mb-1">{tip}</li>)}</ul>}
      </div>
    </div>
  );
}

function HelpDialog({ tab = "start", tutorial, close }: { tab?: string; tutorial?: string; close: (v: any) => void }) {
  return (
    <>
      <DialogHeader><DialogTitle>Help center</DialogTitle></DialogHeader>
      <Tabs defaultValue={tab} orientation="vertical" className="grid h-[62vh] min-h-0 grid-cols-[200px_1fr] gap-5">
        <TabsList className="h-auto flex-col items-stretch justify-start gap-1 bg-transparent p-0">
          {[["start", Rocket, "Getting started"], ["tutorials", GraduationCap, "Tutorials"], ["elements", Puzzle, "Track elements"], ["collision", BrickWall, "Collision types"], ["objectDocs", FileJson, "Object documentation"], ["keys", Keyboard, "Mouse & keyboard"]].map(([id, Icon, label]: any) => (
            <TabsTrigger key={id} value={id} className="flex-none justify-start px-3 py-2 data-[state=active]:bg-accent"><Icon /> {label}</TabsTrigger>
          ))}
        </TabsList>
        <div className="min-h-0 overflow-y-auto pr-2 text-[13px] leading-relaxed">
          <TabsContent value="start" className="mt-0 flex flex-col gap-3">
            <ol className="m-0 flex list-decimal flex-col gap-2 pl-5">
              <li><b>Open a track:</b> File › Open, then a .szs from your extracted game (Race/Course/…). The real track model, objects and routes appear in 3D.</li>
              <li><b>Load Race/Common.szs once</b> in Settings to get every object name and the shared models such as item boxes.</li>
              <li><b>Select</b> anything by clicking it in the 3D view or in the Track list. The Inspector shows and explains all its settings.</li>
              <li><b>Move, rotate, scale</b> with the coloured handles (W / E / R) or by typing numbers. Drag the X / Y / Z labels to change values quickly.</li>
              <li><b>Add</b> new elements with Add or the + next to each section, then click on the track. The + beside Objects opens the catalogue with previews and categories.</li>
              <li><b>Check</b> the track before saving: the Check tab lists problems that crash the game and fixes many of them with one click.</li>
              <li><b>Save</b> with Ctrl+S. With backups enabled in Settings, the first save keeps a .bak copy of the original file.</li>
            </ol>
            <div className="rounded-lg border bg-muted/20 p-3">
              <b>Make a new track.</b> File › Create new track lets you draw the layout from above. The editor builds the road, walls, collision, checkpoints, CPU and item routes, respawns and item boxes. Export the model as OBJ and turn it into course_model.brres with BrawlCrate.
            </div>
            <Button variant="secondary" className="self-start" onClick={() => { close(null); editor.cmd("tour"); }}><BookOpen /> Start the guided tour</Button>
          </TabsContent>
          <TabsContent value="tutorials" className="mt-0"><Tutorials initial={tutorial} /></TabsContent>
          <TabsContent value="elements" className="mt-0 flex flex-col gap-2">
            {Object.entries(KIND_HELP).filter(([k]) => k !== "ROUTE").map(([k, v]: any) => {
              const Icon = KIND_ICON[k] || Package;
              return (
                <div key={k} className="rounded-lg border bg-muted/20 p-3">
                  <div className="mb-1 flex items-center gap-2 font-semibold text-primary"><Icon className="size-4" /> {v.title}</div>
                  <p className="m-0 text-muted-foreground">{v.what}</p>
                  {v.tips && <ul className="m-0 mt-1.5 list-disc pl-5 text-xs text-muted-foreground">{v.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>}
                </div>
              );
            })}
          </TabsContent>
          <TabsContent value="collision" className="mt-0">
            <p className="mt-0 text-muted-foreground">Every triangle of course.kcl has a type that decides how karts react. Variant and shadow fine-tune sounds, effects and lighting.</p>
            <div className="flex flex-col divide-y rounded-lg border">
              {KCL_TYPES.map((t: any) => (
                <div key={t.id} className="flex items-start gap-3 p-2.5">
                  <span className="mt-0.5 size-4 shrink-0 rounded-sm border border-black/30" style={{ background: t.color }} />
                  <div className="flex-1"><b>{t.name}</b> <span className="font-mono text-[11px] text-muted-foreground">{hex(t.id, 2)}</span><div className="text-xs text-muted-foreground">{(KCL_HELP as any)[t.id]}</div></div>
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="objectDocs" className="mt-0"><ObjectDocumentationHelp /></TabsContent>
          <TabsContent value="keys" className="mt-0">
            <div className="flex flex-col divide-y rounded-lg border">
              {KEYS.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 px-3 py-2">
                  <span className="flex flex-wrap gap-1">{k.split(" / ").map((x) => <Kbd key={x} className="h-6 px-1.5 text-[11px] text-foreground">{x}</Kbd>)}</span>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

function AboutDialog() {
  const updates = useUpdates();
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3"><img src="icon.png" className="size-10 select-none" alt="" draggable={false} /><DialogTitle>MKWii Advanced Editor {APP_VERSION}</DialogTitle></div>
        <DialogDescription>A visual track editor for Mario Kart Wii.</DialogDescription>
      </DialogHeader>
      <p className="m-0 text-[13px] text-muted-foreground">Reads and writes SZS (Yaz0 + U8), KMP, KCL and BRRES models natively. Built with Bun, React, shadcn/ui, Three.js and WebView2.</p>
      <p className="m-0 text-[13px]"><span className="font-semibold">Credits</span> · WiiListZ</p>
      <div className="space-y-2 rounded-md border p-3 text-xs">
        <div className="flex items-center justify-between gap-2"><span className="font-semibold">Updates from GitHub Releases</span><Button size="sm" variant="secondary" onClick={() => updates.check()} disabled={updates.phase === "checking" || updates.phase === "downloading" || updates.phase === "installing"}>Check now</Button></div>
        {updates.phase === "checking" ? <p className="m-0 text-muted-foreground">Checking for updates…</p>
          : updates.phase === "downloading" ? <p className="m-0 text-muted-foreground">Downloading update {updates.status?.version}… {Math.floor(updates.progress * 100)}%</p>
          : updates.phase === "installing" ? <p className="m-0 text-muted-foreground">Installing update {updates.status?.version}…</p>
          : updates.status?.available ? <><p className="m-0">Version {updates.status.version} {updates.phase === "ready" ? "is ready to install." : "is available."}</p>{updates.phase === "error" && <p className="m-0 text-destructive">Download failed: {updates.error}</p>}<div className="flex gap-2"><Button size="sm" onClick={() => void (updates.phase === "ready" ? updates.restart() : updates.accept())}>{updates.phase === "ready" ? "Restart & update" : updates.phase === "error" ? "Retry update" : "Update now"}</Button><Button size="sm" variant="secondary" onClick={() => updates.showNotes({ version: updates.status?.version || "", title: updates.status?.title, notes: updates.status?.notes || "", url: updates.status?.url })}>Release notes</Button></div></>
          : updates.phase === "error" ? <p className="m-0 text-muted-foreground">Could not check: {updates.error}</p>
          : <p className="m-0 text-muted-foreground">{updates.status?.supported ? "You have the latest release." : "Updates are available in the built Windows executable."}</p>}
        {updates.installed && <Button size="sm" variant="secondary" onClick={() => updates.showNotes(updates.installed!)}>What's new in {updates.installed.version}</Button>}
      </div>
      <p className="m-0 text-[13px] text-muted-foreground">Not affiliated with Nintendo. Use your own legally dumped game files.</p>
    </>
  );
}

// ---- Object picker (cmdk) ---------------------------------------------------------------------
function ObjectPicker({ current, purpose, close }: { current: number; purpose?: "add" | "change"; close: (v: any) => void }) {
  const entries = [...new Set([
    ...Object.keys(editor.objectNames),
    ...Object.keys(editor.importedObjectDocumentation).filter((key) => /^\d+$/.test(key)),
  ])].map((key) => {
    const id = Number(key), name = editor.objectNames[id] || `object_${id.toString(16)}`;
    return { id, name, label: editor.objectLabel(id), cat: categorizeObject(name), description: editor.getObjectDocumentation(id).description || "" };
  });
  const cats = ["All", ...new Set(entries.map((e) => e.cat))].sort((a, b) => a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b));
  const [category, setCategory] = React.useState("All");
  const [selected, setSelected] = React.useState<number | null>(null);
  const [query, setQuery] = React.useState("");
  const add = () => {
    if (selected === null) return;
    editor.startPlacing("GOBJ", { objectId: selected });
    close(null);
  };
  return (
    <div className="grid h-[min(700px,82vh)] grid-cols-[minmax(0,1fr)_320px]">
    <DialogTitle className="sr-only">Choose a game object</DialogTitle>
    <DialogDescription className="sr-only">Select an object to see its model, then add it to the track.</DialogDescription>
    <Command className="min-h-0 rounded-r-none">
      <CommandInput placeholder="Search objects by name or hex ID…" value={query} onValueChange={(value) => { setQuery(value); setSelected(null); }} autoFocus />
      <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)]">
      <nav className="min-h-0 overflow-y-auto border-r bg-muted/20 p-2" aria-label="Object categories">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Categories</div>
        {cats.map((cat) => <button key={cat} type="button" aria-pressed={category === cat}
          onClick={() => { setCategory(cat); setSelected(null); }}
          className={`mb-0.5 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs ${category === cat ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
          <span className="truncate">{cat === "All" ? "All objects" : cat}</span>
          <span className={`shrink-0 text-[10px] ${category === cat ? "text-primary-foreground/80" : "text-muted-foreground/70"}`}>{cat === "All" ? entries.length : entries.filter((e) => e.cat === cat).length}</span>
        </button>)}
      </nav>
      <CommandList className="max-h-none min-h-0">
        <CommandEmpty>No objects found. Load Race/Common.szs to get the full list.</CommandEmpty>
        {cats.filter((c) => c !== "All" && (category === "All" || category === c)).map((c) => (
          <CommandGroup key={c} heading={category === "All" ? c : undefined}>
            {entries.filter((e) => e.cat === c).sort((a, b) => a.id - b.id).map((e) => (
              <CommandItem key={e.id} value={`${e.label} ${e.name} ${hex(e.id)} ${e.description}`} onSelect={() => setSelected(e.id)}
                aria-selected={selected === e.id} className={e.id === selected ? "border border-primary/60 bg-primary/10" : e.id === current ? "text-primary" : ""}>
                <Package className="text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block truncate">{e.label}{e.label !== e.name && <span className="ml-2 text-xs text-muted-foreground">{e.name}</span>}</span>
                  {e.description && <span className="block truncate text-[11px] text-muted-foreground">{e.description}</span>}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{hex(e.id)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      </div>
    </Command>
    <div className="flex min-h-0 flex-col gap-2 border-l p-3">
      {selected === null ? <div className="flex h-44 shrink-0 items-center justify-center rounded-md border p-4 text-center text-xs text-muted-foreground">Click an object in the list to see its preview and settings.</div>
        : <ObjectPreview objectId={selected} className="h-44 shrink-0" />}
      {selected !== null && <>
        <div className="min-h-0 flex-1 overflow-y-auto"><ObjectPreviewInfo id={selected} /></div>
        <Button className="w-full shrink-0" onClick={add}>Add to track · {editor.objectLabel(selected)}</Button>
        {purpose === "change" && <Button variant="secondary" className="w-full" onClick={() => close(selected)}>Change selected object</Button>}
      </>}
      {purpose === "add" && <Button variant="ghost" size="sm" className="mt-auto w-full shrink-0 text-muted-foreground" onClick={() => { close(null); editor.cmd("gameObjects"); }}>
        From another track or my 3D model…
      </Button>}
    </div>
    </div>
  );
}

function ObjectPreviewInfo({ id }: { id: number }) {
  return <ObjectDocumentationView id={id} label={editor.objectLabel(id)} name={editor.objectNames[id] || "unknown"} documentation={editor.getObjectDocumentation(id)} />;
}

// ---- OBJ collision import ----------------------------------------------------------------------
function ImportObjDialog({ groups, close }: { groups: any[]; close: (v: any) => void }) {
  const [types, setTypes] = React.useState<Record<string, number>>(() => Object.fromEntries(groups.map((g) => [g.material, guessFlag(g.material) & 0x1f])));
  const [scale, setScale] = React.useState(1);
  const [zUp, setZUp] = React.useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Import OBJ as collision</DialogTitle>
        <DialogDescription>Choose the collision type of every material. Names like "road", "grass", "wall", "boost" or a hex flag ("0x000C") are recognised automatically.</DialogDescription>
      </DialogHeader>
      <div className="max-h-[40vh] overflow-y-auto rounded-lg border">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground"><tr><th className="p-2">Material</th><th className="p-2">Triangles</th><th className="p-2">Collision type</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.material} className="border-t">
                <td className="p-2">{g.material}</td>
                <td className="p-2 tabular-nums text-muted-foreground">{(g.verts.length / 9).toLocaleString()}</td>
                <td className="p-2">
                  <Select value={String(types[g.material])} onValueChange={(v) => setTypes({ ...types, [g.material]: Number(v) })}>
                    <SelectTrigger className="h-7"><SelectValue /></SelectTrigger>
                    <SelectContent>{KCL_TYPES.map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-[1fr_140px] items-center gap-x-4 gap-y-2">
        <div><Label className="text-[13px] text-foreground">Scale</Label><p className="m-0 text-xs text-muted-foreground">Tracks are large: 1 Blender meter is often exported as 100 or more.</p></div>
        <Input type="number" step="any" value={scale} onChange={(e) => setScale(Number(e.target.value) || 1)} onKeyDown={(e) => e.stopPropagation()} />
        <Label className="text-[13px] text-foreground">Model is Z-up</Label>
        <Switch checked={zUp} onCheckedChange={setZUp} className="justify-self-end" />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => close(null)}>Cancel</Button>
        <Button onClick={() => {
          const flags = Object.fromEntries(groups.map((g) => { const raw = guessFlag(g.material); const t = types[g.material]; return [g.material, (raw & 0x1f) === t ? raw : t]; }));
          close({ flags, scale, zUp });
        }}>Import</Button>
      </DialogFooter>
    </>
  );
}

// ---- SZS contents ------------------------------------------------------------------------------
function SzsDialog({ close }: { close: (v: any) => void }) {
  const d = editor.doc;
  const [, refresh] = React.useReducer((x) => x + 1, 0);
  if (!d.szs) d.szs = newSzsTree();
  const files = listFiles(d.szs).sort((a: any, b: any) => a.path.localeCompare(b.path));
  const dirty = () => { d.dirty = true; editor.bump("doc"); refresh(); };
  return (
    <>
      <DialogHeader>
        <DialogTitle>SZS contents</DialogTitle>
        <DialogDescription>Files inside the archive. course.kmp and course.kcl are rewritten from the editor when you save.</DialogDescription>
      </DialogHeader>
      <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
        {files.map((f: any) => (
          <div key={f.path} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
            <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{(f.node.data.length / 1024).toFixed(1)} KB</span>
            <Button size="icon-sm" variant="ghost" title="Extract" onClick={() => editor.exportBytes(f.path.split("/").pop(), FILTERS.any, f.node.data, "Extract file")}><Download /></Button>
            <Button size="icon-sm" variant="ghost" title="Replace" onClick={async () => {
              const nf = await api.openFile(FILTERS.any, `Replace ${f.path}`);
              if (!nf) return;
              f.node.data = nf.data;
              if (/course\.kmp$/i.test(f.path)) { d.kmp = parseKMP(nf.data); d.loaded(); }
              if (/course\.kcl$/i.test(f.path)) d.setKCL(parseKCL(nf.data), false);
              if (/\.brres$/i.test(f.path)) editor.loadTrackAssets();
              dirty();
            }}><Replace /></Button>
            <Button size="icon-sm" variant="ghost" title="Remove" className="text-destructive" onClick={async () => {
              if (!(await dialogs.confirm({ title: "Remove file", description: `Remove ${f.path} from the archive?`, confirmLabel: "Remove", destructive: true }))) return;
              const strip = (node: any) => { if (node.children) { node.children = node.children.filter((c: any) => c !== f.node); node.children.forEach(strip); } };
              strip(d.szs);
              dirty();
            }}><Trash2 /></Button>
          </div>
        ))}
      </div>
      <DialogFooter className="justify-between">
        <Button variant="secondary" onClick={async () => {
          const nf = await api.openFile(FILTERS.any, "Add file to the archive");
          if (!nf) return;
          setFile(d.szs, nf.name, nf.data);
          if (/\.brres$/i.test(nf.name)) editor.loadTrackAssets();
          dirty();
        }}><FilePlus2 /> Add file…</Button>
        <Button onClick={() => close(true)}>Close</Button>
      </DialogFooter>
    </>
  );
}

function TrackCreatedDialog({ length, tris, keptSzs, close }: { length: number; tris: number; keptSzs: boolean; close: (v: any) => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><CircleCheck className="size-5 text-success" /> Track created</DialogTitle>
        <DialogDescription>Length {(length / 1000).toFixed(1)}k units · {tris.toLocaleString()} collision triangles. Checkpoints, CPU and item routes, respawns, start, cameras and item boxes are ready.</DialogDescription>
      </DialogHeader>
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed">
        <li>Adjust anything you like: move objects, add item boxes, paint collision (boost, off-road…).</li>
        <li>File › Export › Track model (OBJ), then turn it into course_model.brres with BrawlCrate.</li>
        <li>{keptSzs ? "Save: the other files of the original SZS were kept." : "Add course_model.brres and vrcorn_model.brres with File › SZS contents (copy them from any track), then save as .szs."}</li>
      </ol>
      <DialogFooter><Button onClick={() => close(true)}>Start editing</Button></DialogFooter>
    </>
  );
}

export { findFile };
