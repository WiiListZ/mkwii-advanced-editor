// Riivolution mod editor: the options shown in the Riivolution menu, the patches they turn on and
// the files those patches replace. Opens and saves Riivolution XML, and exports a mod folder ready
// for an SD card (riivolution/<mod>.xml + the files) or for Dolphin (with a .json launcher).

import * as React from "react";
import { FilePlus2, FileText, FolderOpen, FolderPlus, Globe2, Package, Plus, Trash2, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, hasBackend } from "../../../js/api.js";
import {
  ITEM_TAGS, buildRiivolution, checkRiivolution, dolphinLauncher, externalPath, fileItem, folderItem, modSlug, newRiivolutionMod, parseRiivolution,
} from "../../../js/formats/riivolution.js";
import { editor, winPath } from "../editor";
import { dialogs } from "../dialogs-store";
import { cn } from "@/lib/utils";

const XML_FILTER = [{ name: "Riivolution XML", extensions: ["xml"] }];
const JSON_FILTER = [{ name: "Dolphin launcher", extensions: ["json"] }];
const GAME_FILTER = [{ name: "Wii game image", extensions: ["wbfs", "iso", "rvz", "ciso", "gcz", "wia"] }];
const encode = (text: string) => new TextEncoder().encode(text);
const fieldClass = "h-7 text-xs";
const REGIONS = [["P", "Europe (PAL)"], ["E", "Americas (NTSC-U)"], ["J", "Japan (NTSC-J)"], ["K", "Korea (NTSC-K)"]] as const;

// A path inside the workspace as the disc sees it ("/Race/Course/x.szs"), or null when outside.
function discPathOf(path: string) {
  const mapped = editor.riivolutionWorkspace;
  if (mapped) {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    for (const [disc, source] of Object.entries(mapped.files) as [string, string][]) if (norm(path) === norm(source)) return "/" + mapped.discPaths[disc];
    for (const [disc, source] of Object.entries(mapped.folders) as [string, string][]) {
      if (norm(path) === norm(source)) return "/" + (mapped.discPaths[disc] || disc);
      if (norm(path).startsWith(norm(source) + "/")) return "/" + [mapped.discPaths[disc] || disc, path.replace(/\\/g, "/").slice(source.replace(/\\/g, "/").length + 1)].filter(Boolean).join("/");
    }
    return null;
  }
  const root = editor.workspace();
  if (!root) return null;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const r = norm(root), p = path.replace(/\\/g, "/");
  return norm(p).startsWith(r + "/") ? p.slice(r.length) : null;
}

// initialFile: an XML opened from File › Open or Explorer.
export function RiivolutionDialog({ initialFile, close }: { initialFile?: { path: string | null; name: string; data: Uint8Array }; close: (v: any) => void }) {
  const [name, setName] = React.useState("My Mario Kart Wii mod");
  const [mod, setMod] = React.useState<any>(() => newRiivolutionMod("My Mario Kart Wii mod"));
  const [patchIndex, setPatchIndex] = React.useState(0);
  const [xmlPath, setXmlPath] = React.useState("");
  const [launcher, setLauncher] = React.useState(false);
  const [baseFile, setBaseFile] = React.useState(() => { try { return localStorage.getItem("mkwii-riivolution-base") || ""; } catch { return ""; } });
  const [busy, setBusy] = React.useState("");
  // Changes not yet saved as XML or exported (the edited files added at start do not count).
  const [unsaved, setUnsaved] = React.useState(false);
  // Every change goes through here: the model is plain data, copied on write.
  const update = (fn: (m: any) => void, touch = true) => { setMod((m: any) => { const next = structuredClone(m); fn(next); return next; }); if (touch) setUnsaved(true); };
  const requestClose = async () => {
    if (unsaved && !(await dialogs.confirm({ title: "Close the Riivolution editor?", description: "The mod has changes that were not saved as XML or exported.", confirmLabel: "Close without saving", destructive: true }))) return;
    close(null);
  };
  const patch = mod.patches[patchIndex] || null;
  const problems = checkRiivolution(mod);
  const regions: string[] = mod.regions || [];
  const regionChoices: [string, string][] = [...REGIONS.map(([code, label]) => [code, label] as [string, string]),
    ...regions.filter((code) => !REGIONS.some(([known]) => known === code)).map((code) => [code, `${code} (from XML)`] as [string, string])];

  // A new mod starts with the files edited in the workspace.
  const addEditedFiles = async (silent = false) => {
    const root = editor.workspace();
    if (!root) { if (!silent) toast.error("Choose the game's workspace folder first", { description: "Home › Workspace" }); return; }
    const xmlWorkspace = editor.riivolutionWorkspace;
    const files: { disc: string; source: string }[] = [];
    if (xmlWorkspace) {
      const editedSources = new Set((await api.modifiedFiles(xmlWorkspace.sdRoot)).map((rel: string) => winPath(xmlWorkspace.sdRoot, ...rel.split("/")).toLowerCase()));
      for (const [disc, source] of Object.entries(xmlWorkspace.files) as [string, string][]) {
        if (editedSources.has(source.toLowerCase())) files.push({ disc: "/" + xmlWorkspace.discPaths[disc], source });
      }
      for (const [disc, source] of Object.entries(xmlWorkspace.explicitFolders) as [string, string][]) {
        const edited: string[] = await api.modifiedFiles(source).catch(() => []);
        for (const rel of edited) files.push({ disc: "/" + [xmlWorkspace.discPaths[disc], rel].filter(Boolean).join("/"), source: winPath(source, ...rel.split("/")) });
      }
    } else {
      const edited: string[] = await api.modifiedFiles(root).catch(() => []);
      for (const rel of edited) files.push({ disc: "/" + rel, source: winPath(root, ...rel.split("/")) });
    }
    if (!files.length) { if (!silent) toast.info("No edited files in the workspace", { description: "No files saved by the editor were found in this workspace." }); return; }
    let added = 0;
    update((m) => {
      if (!m.patches.length) m.patches.push({ attrs: { id: modSlug(name), root: `/${modSlug(name)}` }, items: [] });
      const target = m.patches[Math.min(patchIndex, m.patches.length - 1)];
      for (const { disc, source } of files) {
        if (target.items.some((i: any) => i.attrs.disc?.toLowerCase() === disc.toLowerCase())) continue;
        target.items.push(fileItem(disc, source));
        added++;
      }
    });
    if (!silent) toast.success(added ? `${added} edited file${added === 1 ? "" : "s"} added` : "The edited files are already in the mod");
  };
  React.useEffect(() => { void (initialFile ? loadXML(initialFile) : addEditedFiles(true).then(() => setUnsaved(false))); }, []);

  const renameMod = (value: string) => {
    const before = modSlug(name), after = modSlug(value);
    setName(value);
    // Keep the generated ids and folder in step with the name while they still follow it.
    update((m) => {
      for (const p of m.patches) {
        if (p.attrs.root === `/${before}`) p.attrs.root = `/${after}`;
        if (p.attrs.id === before) {
          p.attrs.id = after;
          for (const s of m.sections) for (const o of s.options) for (const c of o.choices) for (const ref of c.patches) if (ref.id === before) ref.id = after;
        }
      }
      for (const s of m.sections) {
        if (s.name === name) s.name = value;
        for (const o of s.options) if (o.attrs.id === `${before}Enabled`) o.attrs.id = `${after}Enabled`;
      }
    });
  };

  const startNew = async () => {
    if (!(await dialogs.confirm({ title: "New mod", description: "Start again from an empty mod with the files edited in the workspace?", confirmLabel: "New mod" }))) return;
    setName("My Mario Kart Wii mod"); setMod(newRiivolutionMod("My Mario Kart Wii mod")); setPatchIndex(0); setXmlPath("");
    setTimeout(() => void addEditedFiles(true).then(() => setUnsaved(false)), 0);
  };

  const openXML = async () => {
    const file = await api.openFile(XML_FILTER, "Open a Riivolution XML");
    if (file) await loadXML(file);
  };
  const loadXML = async (file: { path: string | null; name: string; data: Uint8Array }) => {
    try {
      const next = parseRiivolution(new TextDecoder().decode(file.data));
      // A mod folder keeps its XML in <SD root>/riivolution/: the files are found from that root.
      const sdRoot = file.path ? file.path.replace(/[\\/][^\\/]+$/, "").replace(/[\\/]riivolution$/i, "") : "";
      if (sdRoot) for (const p of next.patches) for (const item of p.items) {
        if (item.tag !== "file" && item.tag !== "folder") continue;
        const local = winPath(sdRoot, ...externalPath(p, item).split("/").filter(Boolean));
        if (await api.exists(local)) item.source = local;
      }
      setMod(next); setPatchIndex(0); setXmlPath(file.path || ""); setUnsaved(false);
      setName(file.name.replace(/\.xml$/i, ""));
      toast.success(`Opened ${file.name}`, { description: `${next.sections.length} section${next.sections.length === 1 ? "" : "s"} · ${next.patches.length} patch${next.patches.length === 1 ? "" : "es"}` });
    } catch (error: any) { toast.error("Could not open the XML", { description: error.message }); }
  };

  // An XML opened from a file is written back there; Save as (or a new mod) asks where.
  const saveXML = async (saveAs = false) => {
    const path = xmlPath && !saveAs ? xmlPath : await api.chooseSavePath(xmlPath || `${modSlug(name)}.xml`, XML_FILTER, "Save Riivolution XML");
    if (!path) return;
    await api.writeFile(path, encode(buildRiivolution(mod)), { backup: editor.settings.keepBackups, edited: true });
    setXmlPath(path); setUnsaved(false);
    toast.success("Riivolution XML saved", { description: path });
  };

  // riivolution/<mod>.xml and every file and folder with a source on this computer, placed where
  // the XML looks for them; optionally a Dolphin launcher.
  const exportFolder = async () => {
    if (problems.length && !(await dialogs.confirm({ title: "The mod has problems", description: problems.slice(0, 5).join(" "), confirmLabel: "Export anyway" }))) return;
    if (!hasBackend) return toast.error("Exporting a mod folder requires the desktop app");
    const dest = await api.chooseFolder("Choose the SD card or a folder for the mod", "");
    if (!dest) return;
    const slug = modSlug(name);
    const xml = winPath(dest, "riivolution", `${slug}.xml`);
    setBusy("Exporting…");
    try {
      await api.writeFile(xml, encode(buildRiivolution(mod)));
      let copied = 0, missing = 0;
      const items = mod.patches.flatMap((p: any) => p.items.filter((i: any) => i.tag === "file" || i.tag === "folder").map((i: any) => [p, i]));
      for (const [i, [p, item]] of items.entries()) {
        setBusy(`Copying ${i + 1}/${items.length}…`);
        if (!item.source) { missing++; continue; }
        await api.copyPath(item.source, winPath(dest, ...externalPath(p, item).split("/").filter(Boolean)));
        copied++;
      }
      let json = "";
      if (launcher) {
        if (!baseFile) throw new Error("Choose the game image (WBFS / ISO) for the Dolphin launcher");
        json = await api.chooseSavePath(winPath(dest, `${slug}.json`), JSON_FILTER, "Save the Dolphin launcher");
        if (json) await api.writeFile(json, encode(JSON.stringify(dolphinLauncher(mod, { name, baseFile: baseFile.replace(/\\/g, "/"), sdRoot: dest.replace(/\\/g, "/"), xmlPath: xml.replace(/\\/g, "/") }), null, 2)));
      }
      setUnsaved(false);
      toast.success("Mod folder exported", {
        description: `${xml}\n${copied} file${copied === 1 ? "" : "s"} copied${missing ? ` · ${missing} without a file on this computer (not copied)` : ""}${json ? ` · Dolphin launcher: ${json}` : ""}`,
        action: { label: "Show", onClick: () => api.reveal(xml) }, duration: 12000,
      });
    } catch (error: any) { toast.error("Could not export the mod", { description: error.message }); }
    finally { setBusy(""); }
  };

  const addFile = async () => {
    if (!patch) return;
    const file = await api.openFile([], "Choose a file for the mod");
    if (!file?.path) return;
    let disc = discPathOf(file.path);
    if (!disc) {
      const values = await dialogs.form({ title: "Where on the disc?", description: `The game file ${file.name} replaces.`, fields: [{ key: "disc", label: "Disc path", type: "text", value: `/${file.name}` }], confirmLabel: "Add" });
      if (!values) return;
      disc = values.disc;
    }
    update((m) => { m.patches[patchIndex].items.push(fileItem(disc!, file.path)); });
  };
  const addFolder = async () => {
    if (!patch) return;
    const folder = await api.chooseFolder("Choose a folder for the mod", editor.workspace());
    if (!folder) return;
    let disc = discPathOf(folder);
    if (!disc) {
      const values = await dialogs.form({ title: "Where on the disc?", description: "The disc folder whose files this folder replaces.", fields: [{ key: "disc", label: "Disc folder", type: "text", value: "/" }], confirmLabel: "Add" });
      if (!values) return;
      disc = values.disc;
    }
    update((m) => { m.patches[patchIndex].items.push(folderItem(disc!, folder)); });
  };
  const browseSource = async (index: number, tag: string) => {
    const path = tag === "folder" ? await api.chooseFolder("Choose the folder", editor.workspace()) : (await api.openFile([], "Choose the file"))?.path;
    if (path) update((m) => { m.patches[patchIndex].items[index].source = path; });
  };

  const setAttr = (target: any, key: string, value: string) => { if (value === "") delete target.attrs[key]; else target.attrs[key] = value; };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <DialogTitle>Riivolution mod</DialogTitle>
          <DialogDescription>Options shown in the Riivolution menu, the patches they turn on and the files those patches replace. Export a folder ready for the SD card or for Dolphin.</DialogDescription>
        </div>
        <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close Riivolution editor" onClick={requestClose}><X /></Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-[11px] text-muted-foreground">Mod name
          <Input value={name} onChange={(e) => renameMod(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="h-8 text-xs" />
        </label>
        <label className="flex w-28 flex-col gap-1 text-[11px] text-muted-foreground" title="RMC = Mario Kart Wii. Choose one or more regions next to this field.">Game ID
          <Input value={mod.game} onChange={(e) => update((m) => { m.game = e.target.value.toUpperCase(); })} onKeyDown={(e) => e.stopPropagation()} className="h-8 font-mono text-xs" />
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="secondary" aria-label="Choose Riivolution regions"><Globe2 /> Regions: {regions.length ? regions.join(", ") : "All"}</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 space-y-2 p-3 text-xs">
            <div className="font-medium">Game regions</div>
            <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">Choose where this XML applies. Select All to omit region limits.</p>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent">
              <input type="checkbox" checked={!regions.length} onChange={() => update((m) => { m.regions = []; })} className="size-3.5 accent-primary" /> All regions
            </label>
            <div className="border-t pt-1.5">
              {regionChoices.map(([code, label]) => <label key={code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent">
                <input type="checkbox" aria-label={`${label} region`} checked={regions.includes(code)} onChange={(e) => update((m) => {
                  m.regions = e.target.checked ? [...new Set([...(m.regions || []), code])] : (m.regions || []).filter((region: string) => region !== code);
                })} className="size-3.5 accent-primary" /> {label}
              </label>)}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="ghost" onClick={startNew}><FilePlus2 /> New</Button>
        <Button size="sm" variant="secondary" onClick={openXML}><FolderOpen /> Open XML…</Button>
        <Button size="sm" variant="secondary" onClick={() => saveXML()} title={xmlPath || undefined}><FileText /> {xmlPath ? "Save XML" : "Save XML…"}</Button>
        {xmlPath && <Button size="sm" variant="ghost" onClick={() => saveXML(true)}>Save as…</Button>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Menu options */}
        <div className="flex min-h-0 flex-col rounded-md border">
          <div className="flex items-center gap-2 border-b px-2.5 py-1.5 text-[11px]">
            <span className="flex-1 font-medium">Riivolution menu</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => update((m) => { m.sections.push({ name: "New section", attrs: {}, options: [] }); })}><Plus /> Section</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2 text-xs">
            {mod.sections.map((s: any, si: number) => (
              <div key={si} className="space-y-2 rounded border p-2">
                <div className="flex items-center gap-1.5">
                  <Input aria-label="Section name" value={s.name} onChange={(e) => update((m) => { m.sections[si].name = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} className={cn(fieldClass, "font-medium")} />
                  <Button size="icon-sm" variant="ghost" title="Remove section" onClick={() => update((m) => { m.sections.splice(si, 1); })}><Trash2 /></Button>
                </div>
                {s.options.map((o: any, oi: number) => (
                  <div key={oi} className="space-y-1.5 border-l-2 pl-2">
                    <div className="flex items-center gap-1.5">
                      <Input aria-label="Option name" value={o.attrs.name || ""} onChange={(e) => update((m) => setAttr(m.sections[si].options[oi], "name", e.target.value))} onKeyDown={(e) => e.stopPropagation()} className={fieldClass} placeholder="Option name" />
                      <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title="On when the player has not chosen yet">
                        <Switch checked={Number(o.attrs.default || 0) > 0} onCheckedChange={(on) => update((m) => setAttr(m.sections[si].options[oi], "default", on ? "1" : ""))} /> On
                      </label>
                      <Button size="icon-sm" variant="ghost" title="Remove option" onClick={() => update((m) => { m.sections[si].options.splice(oi, 1); })}><Trash2 /></Button>
                    </div>
                    {o.choices.map((c: any, ci: number) => (
                      <div key={ci} className="flex flex-wrap items-center gap-1.5 pl-2">
                        <Input aria-label="Choice name" value={c.attrs.name || ""} onChange={(e) => update((m) => setAttr(m.sections[si].options[oi].choices[ci], "name", e.target.value))} onKeyDown={(e) => e.stopPropagation()} className={cn(fieldClass, "w-32")} placeholder="Choice" />
                        <span className="text-[11px] text-muted-foreground">applies</span>
                        {mod.patches.map((p: any, pi: number) => {
                          const on = c.patches.some((r: any) => r.id === p.attrs.id);
                          return <label key={pi} className="inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[10.5px] hover:bg-accent">
                            <input type="checkbox" aria-label={`Apply patch ${p.attrs.id || pi + 1}`} checked={on} onChange={() => update((m) => {
                            const refs = m.sections[si].options[oi].choices[ci].patches;
                            const at = refs.findIndex((r: any) => r.id === p.attrs.id);
                            if (at >= 0) refs.splice(at, 1); else refs.push({ id: p.attrs.id, attrs: {}, params: [] });
                          })} className="size-3.5 accent-primary" />
                            <span className="font-mono">{p.attrs.id || "(no id)"}</span>
                          </label>;
                        })}
                        {o.choices.length > 1 && <Button size="icon-sm" variant="ghost" title="Remove choice" onClick={() => update((m) => { m.sections[si].options[oi].choices.splice(ci, 1); })}><Trash2 /></Button>}
                      </div>
                    ))}
                    <Button size="sm" variant="ghost" className="ml-2 h-6 px-2 text-[11px]" onClick={() => update((m) => { m.sections[si].options[oi].choices.push({ attrs: { name: `Choice ${o.choices.length + 1}` }, patches: [] }); })}><Plus /> Choice</Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => update((m) => { m.sections[si].options.push({ attrs: { name: "New option" }, choices: [{ attrs: { name: "Enabled" }, patches: [] }] }); })}><Plus /> Option</Button>
              </div>
            ))}
            {!mod.sections.length && <p className="m-0 text-muted-foreground">No section: Riivolution shows nothing to turn on. Add a section and an option.</p>}
          </div>
        </div>

        {/* Patches and their files */}
        <div className="flex min-h-0 flex-col rounded-md border">
          <div className="flex flex-wrap items-center gap-1.5 border-b px-2.5 py-1.5 text-[11px]">
            <span className="font-medium">Patch</span>
            <Select value={String(patchIndex)} onValueChange={(v) => setPatchIndex(Number(v))}>
              <SelectTrigger className="h-7 w-44 text-xs" aria-label="Patch"><SelectValue placeholder="No patch" /></SelectTrigger>
              <SelectContent>{mod.patches.map((p: any, i: number) => <SelectItem key={i} value={String(i)}>{p.attrs.id || `(patch ${i + 1})`} · {p.items.length}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => { update((m) => { m.patches.push({ attrs: { id: `patch${m.patches.length + 1}`, root: `/${modSlug(name)}` }, items: [] }); }); setPatchIndex(mod.patches.length); }}><Plus /> Patch</Button>
            {patch && <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive" onClick={() => { update((m) => { m.patches.splice(patchIndex, 1); }); setPatchIndex(0); }}><Trash2 /> Remove patch</Button>}
          </div>
          {patch ? <>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 border-b p-2 text-[11px] text-muted-foreground">
              <span>ID</span>
              <Input value={patch.attrs.id || ""} onChange={(e) => {
                const old = patch.attrs.id, value = e.target.value;
                update((m) => {
                  m.patches[patchIndex].attrs.id = value;
                  for (const s of m.sections) for (const o of s.options) for (const c of o.choices) for (const r of c.patches) if (r.id === old) r.id = value;
                });
              }} onKeyDown={(e) => e.stopPropagation()} className={cn(fieldClass, "font-mono")} />
              <span title="Folder on the SD card that the paths below start from">Mod folder</span>
              <Input value={patch.attrs.root || ""} onChange={(e) => update((m) => setAttr(m.patches[patchIndex], "root", e.target.value))} onKeyDown={(e) => e.stopPropagation()} className={cn(fieldClass, "font-mono")} placeholder="/MyMod" />
            </div>
            <div className="flex flex-wrap gap-1.5 border-b p-2">
              <Button size="sm" variant="secondary" onClick={() => addEditedFiles()}><Wand2 /> Add edited workspace files</Button>
              <Button size="sm" variant="secondary" onClick={addFile}><FilePlus2 /> Add file…</Button>
              <Button size="sm" variant="secondary" onClick={addFolder}><FolderPlus /> Add folder…</Button>
              <Button size="sm" variant="ghost" onClick={() => update((m) => { m.patches[patchIndex].items.push({ tag: "memory", attrs: { offset: "0x80000000", value: "00000000" } }); })}><Plus /> Memory patch</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {patch.items.map((item: any, ii: number) => {
                const known = ITEM_TAGS.includes(item.tag);
                const attr = (key: string, label: string, placeholder = "", mono = true) => (
                  <label className="flex min-w-0 flex-1 basis-36 flex-col gap-0.5 text-[10.5px] text-muted-foreground">{label}
                    <Input value={item.attrs[key] || ""} placeholder={placeholder} onChange={(e) => update((m) => setAttr(m.patches[patchIndex].items[ii], key, e.target.value))} onKeyDown={(e) => e.stopPropagation()} className={cn(fieldClass, mono && "font-mono")} />
                  </label>
                );
                return (
                  <div key={ii} className="flex flex-wrap items-end gap-2 border-b p-2">
                    <Select value={item.tag} onValueChange={(v) => update((m) => { m.patches[patchIndex].items[ii].tag = v; })} disabled={!known}>
                      <SelectTrigger className="h-7 w-24 text-xs" aria-label="Kind"><SelectValue /></SelectTrigger>
                      <SelectContent>{(known ? ITEM_TAGS : [item.tag]).map((t: string) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                    {item.tag === "memory" ? <>{attr("offset", "Address", "0x80000000")}{attr("value", "New value (hex)")}{attr("original", "Only if it was (hex)")}</>
                      : item.tag === "file" || item.tag === "folder" ? <>
                        {attr("disc", item.tag === "file" ? "Disc file" : "Disc folder", "/Race/Course/…")}
                        {attr("external", "In the mod folder", "Race/Course/…")}
                        <div className="flex min-w-0 flex-[2] basis-56 flex-col gap-0.5 text-[10.5px] text-muted-foreground">On this computer (copied on export)
                          <div className="flex gap-1">
                            <Input value={item.source || ""} placeholder="Not set: the file is not copied" onChange={(e) => update((m) => { m.patches[patchIndex].items[ii].source = e.target.value; })} onKeyDown={(e) => e.stopPropagation()} className={cn(fieldClass, "font-mono")} />
                            <Button size="sm" variant="secondary" className="h-7 px-2" onClick={() => browseSource(ii, item.tag)}>…</Button>
                          </div>
                        </div>
                      </>
                      : <span className="flex-1 font-mono text-[11px] text-muted-foreground">{Object.entries(item.attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}</span>}
                    <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => update((m) => { m.patches[patchIndex].items.splice(ii, 1); })}><Trash2 /></Button>
                  </div>
                );
              })}
              {!patch.items.length && <p className="m-0 p-3 text-xs text-muted-foreground">No files yet. Add the files you edited in the workspace, or any file or folder.</p>}
            </div>
          </> : <p className="m-0 p-3 text-xs text-muted-foreground">No patch. Add one to list the files of the mod.</p>}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t pt-2 text-[11px]">
        <div className="min-w-0 flex-1">
          {problems.length ? <span className="text-destructive">{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}</span>
            : <span className="text-muted-foreground">Ready. Export writes riivolution/{modSlug(name)}.xml and the files under {mod.patches[0]?.attrs.root || "/"}.</span>}
        </div>
        <label className="flex items-center gap-1.5 text-muted-foreground" title="Dolphin lists a .json launcher like a game and starts the mod with Riivolution">
          <Switch checked={launcher} onCheckedChange={setLauncher} /> Dolphin launcher
        </label>
        {launcher && <div className="flex min-w-0 items-center gap-1">
          <Input value={baseFile} placeholder="Game image (WBFS / ISO)" onChange={(e) => { setBaseFile(e.target.value); try { localStorage.setItem("mkwii-riivolution-base", e.target.value); } catch {} }} onKeyDown={(e) => e.stopPropagation()} className="h-7 w-64 font-mono text-[11px]" />
          <Button size="sm" variant="secondary" className="h-7 px-2" onClick={async () => { const f = await api.choosePath(GAME_FILTER, "Choose the Mario Kart Wii game image"); if (f) { setBaseFile(f); try { localStorage.setItem("mkwii-riivolution-base", f); } catch {} } }}>…</Button>
        </div>}
        <Button size="sm" variant="ghost" onClick={requestClose}>Close</Button>
        <Button size="sm" disabled={!!busy} onClick={exportFolder}>{busy ? <span>{busy}</span> : <><Package /> Export mod folder…</>}</Button>
      </div>
    </div>
  );
}

