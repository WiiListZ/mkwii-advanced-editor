// An SZS (or U8) archive without a track: its files are listed for editing, and the ones the editor
// understands open in their own tool (models in Characters and models, game text, course data).
// Nested archives open in another window and are written back into this one.

import * as React from "react";
import { Archive, AudioLines, Box, BrickWall, Download, File, FilePlus2, Film, FolderOpen, Gauge, Image as ImageIcon, Languages, LayoutTemplate, Music, Replace, Route, Save, SlidersHorizontal, Sparkles, Trash2, Type, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, FILTERS, hasBackend } from "../../../js/api.js";
import { buildU8, isU8, listFiles, parseU8, setFilePath } from "../../../js/formats/u8.js";
import { isYaz0, yaz0Compress, yaz0Decompress } from "../../../js/formats/yaz0.js";
import { isBRRES } from "../../../js/formats/brres.js";
import { editor } from "../editor";
import { isParamFile } from "./ParamsDialog";
import { dialogs } from "../dialogs-store";
import type { MenuResourceFormat } from "./MenuResourceDialog";

type Kind = { label: string; icon: LucideIcon; tool?: "model" | "text" | "track" | "archive" | "effect" | "params" | "menu"; format?: MenuResourceFormat };

const magic = (data: Uint8Array) => String.fromCharCode(...data.subarray(0, 8));
function kindOf(path: string, data: Uint8Array): Kind {
  const m = magic(data);
  if (isBRRES(data)) return { label: "Model (BRRES)", icon: Box, tool: "model" };
  if (m === "MESGbmg1") return { label: "Game text (BMG)", icon: Languages, tool: "text" };
  if (m.startsWith("RKMD")) return { label: "Course data (KMP)", icon: Route, tool: "track" };
  if (/\.kcl$/i.test(path)) return { label: "Collision (KCL)", icon: BrickWall, tool: "track" };
  if (isU8(data) || (isYaz0(data) && /\.(szs|arc|carc)$/i.test(path))) return { label: "Archive", icon: Archive, tool: "archive" };
  if (m.startsWith("RLYT")) return { label: "Menu layout (BRLYT)", icon: LayoutTemplate, tool: "menu", format: "brlyt" };
  if (m.startsWith("RLAN")) return { label: "Menu animation (BRLAN)", icon: Film, tool: "menu", format: "brlan" };
  if (m.startsWith("REFF")) return { label: "Effect (BREFF)", icon: Sparkles, tool: "effect" };
  if (m.startsWith("REFT")) return { label: "Effect textures (BREFT)", icon: Sparkles, tool: "effect" };
  if (m.startsWith("RSTM")) return { label: "Music (BRSTM)", icon: Music };
  if (m.startsWith("RSAR") || m.startsWith("RWSD") || m.startsWith("RBNK")) return { label: "Sound", icon: AudioLines };
  if (m.startsWith("RFNT")) return { label: "Font (BRFNT)", icon: Type, tool: "menu", format: "brfnt" };
  if (m.startsWith("RFNA")) return { label: "Font", icon: Type };
  if (data[0] === 0x00 && data[1] === 0x20 && data[2] === 0xaf && data[3] === 0x30) return { label: "Texture (TPL)", icon: ImageIcon, tool: "menu", format: "tpl" };
  if (/[.](tpl|tex0|png)$/i.test(path)) return { label: "Texture", icon: ImageIcon };
  if (/[.]bsp$/i.test(path)) return { label: "Vehicle physics (BSP)", icon: Gauge };
  if (isParamFile(path, data)) return { label: /kartParam/i.test(path) ? "Vehicle stats" : /driverParam/i.test(path) ? "Character stats" : "Item chances", icon: SlidersHorizontal, tool: "params" };
  if (/[.]bin$/i.test(path)) return { label: "Game parameters (BIN)", icon: SlidersHorizontal };
  return { label: (path.match(/\.([^./]+)$/)?.[1] || "file").toUpperCase(), icon: File };
}

const size = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
const cloneTree = (node: any): any => ({ ...node, children: node.children?.map(cloneTree) });

export function ArchiveDialog({ path, name, tree: initialTree, compressed = true, onCommit, initialTool, close }: {
  path: string | null; name: string; tree: any; compressed?: boolean;
  // Opens the first file of that tool right away (Tools › Game parameters).
  initialTool?: "params";
  // Nested archive: the bytes go back into the parent instead of a file.
  onCommit?: (bytes: Uint8Array) => void;
  close: (value: any) => void;
}) {
  const [tree, setTree] = React.useState(() => cloneTree(initialTree));
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [, refresh] = React.useReducer((n: number) => n + 1, 0);
  const files = listFiles(tree).sort((a: any, b: any) => a.path.localeCompare(b.path));
  const changed = () => { setDirty(true); refresh(); };

  const bytes = () => { const u8 = buildU8(tree); return compressed ? yaz0Compress(u8) : u8; };
  const save = async (saveAs = false) => {
    if (onCommit && !saveAs) { onCommit(bytes()); setDirty(false); toast.success(`${name} updated`, { description: "Save the outer archive to keep it." }); return true; }
    let target = path;
    if (saveAs || !target) {
      target = await api.chooseSavePath(target || name, [{ name: "SZS archive", extensions: ["szs", "arc", "carc"] }], "Save archive as");
      if (!target) return false;
    }
    setBusy("Saving…");
    try {
      // Compressed on the backend, like track saves.
      const u8 = buildU8(tree);
      await api.writeFile(target, u8, { backup: editor.settings.keepBackups, edited: true, compress: compressed ? "yaz0" : null });
      setDirty(false);
      toast.success(`${target.split(/[\\/]/).pop()} saved`, { description: editor.settings.keepBackups ? "The original is kept as a .bak file." : undefined });
      return true;
    } catch (e: any) { toast.error("Could not save the archive", { description: e.message }); return false; }
    finally { setBusy(""); }
  };
  // Tools that read the archive from disk need the current changes saved there first.
  const ensureSaved = async () => {
    if (!dirty) return true;
    if (!(await dialogs.confirm({ title: "Save the archive first?", description: "The tool opens the archive file, so your changes here have to be saved first.", confirmLabel: "Save and open" }))) return false;
    return save();
  };
  const reloadFromDisk = async () => {
    if (!path) return;
    try { setTree(parseU8(await api.decodeArchiveBytes((await api.readPath(path)).data, path, editor.commonPath || editor.partsFolder()))); setDirty(false); }
    catch (e: any) { toast.error("Could not reload the archive", { description: e.message }); }
  };

  const open = async (file: any, kind: Kind) => {
    const fileName = file.path.split("/").pop();
    if (kind.tool === "model") {
      if (!path || onCommit) return;
      if (!(await ensureSaved())) return;
      const race = /[\\/]Race[\\/]Kart[\\/]/i.test(path) ? "characters" : /[\\/]Race[\\/]Common\.szs$/i.test(path) ? "objects" : "courses";
      await editor.openAssetEditor({ category: race, archive: path, resource: file.path });
      await reloadFromDisk();
    } else if (kind.tool === "text") {
      if (!path || onCommit) return;
      const lang = name.match(/_([A-Z])\.(szs|arc)$/i)?.[1]?.toUpperCase();
      if (!lang) return toast.info("Game text opens language archives", { description: "Like Race_E.szs in Scene/UI. Extract this BMG to edit it elsewhere, then use Replace." });
      if (!(await ensureSaved())) return;
      await dialogs.open("gameText", { folder: path.replace(/[\\/][^\\/]+$/, ""), language: lang, file: fileName.replace(/\.bmg$/i, "") });
      await reloadFromDisk();
    } else if (kind.tool === "track") {
      close(null);
      await editor.loadFile({ path: null, name: fileName, data: file.node.data });
    } else if (kind.tool === "params") {
      await dialogs.open("params", { tree, archiveName: name, initialPath: file.path, onSave: () => save(),
        onChange: (filePath: string, data: Uint8Array) => { const target = listFiles(tree).find((f: any) => f.path === filePath); if (target) { target.node.data = data; changed(); } } });
    } else if (kind.tool === "effect") {
      await dialogs.open("effects", { tree, archiveName: name, initialPath: file.path, onSave: () => save(),
        onChange: (filePath: string, data: Uint8Array) => { const target = listFiles(tree).find((f: any) => f.path === filePath); if (target) { target.node.data = data; changed(); } } });
    } else if (kind.tool === "archive") {
      const yaz0 = isYaz0(file.node.data);
      try {
        const inner = parseU8(yaz0 ? yaz0Decompress(file.node.data) : file.node.data);
        await dialogs.open("archive", { path: null, name: `${name} › ${file.path}`, tree: inner, compressed: yaz0,
          onCommit: (data: Uint8Array) => { file.node.data = data; changed(); } });
      } catch (e: any) { toast.error(`Could not open ${fileName}`, { description: e.message }); }
    } else if (kind.tool === "menu") {
      await dialogs.open("menuResource", { tree, filePath: file.path, format: kind.format });
    }
  };
  const toolLabel = (kind: Kind) => kind.tool === "model" ? "Characters and models" : kind.tool === "text" ? "Game text" : kind.tool === "track" ? "the track editor" : kind.tool === "effect" ? "the effects editor" : kind.tool === "params" ? "the parameters editor" : kind.tool === "menu" ? "the menu resource preview" : "a new window";
  const toolAvailable = (kind: Kind) => kind.tool === "model" || kind.tool === "text" ? !!path && !onCommit && hasBackend : !!kind.tool;

  React.useEffect(() => {
    if (!initialTool) return;
    const candidates = listFiles(tree).filter((f: any) => kindOf(f.path, f.node.data).tool === initialTool);
    const first = candidates.find((f: any) => /kartParam/i.test(f.path)) || candidates[0];
    if (first) void open(first, kindOf(first.path, first.node.data));
  }, []);

  const requestClose = async () => {
    if (dirty && !(await dialogs.confirm({ title: "Unsaved changes", description: `Close ${name} without saving?`, confirmLabel: "Close without saving", destructive: true }))) return;
    close(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3" title="Close" aria-label="Close archive" onClick={requestClose}><X /></Button>
      <div className="shrink-0 pr-8">
        <DialogTitle className="flex items-center gap-2 text-sm"><Archive className="size-4" /> {name}</DialogTitle>
        <DialogDescription className="text-xs">
          {onCommit ? "An archive inside another one." : "This archive has no track (course.kmp, course.kcl or course_model.brres)."} Open the files the editor can read, or extract, replace, add and remove files, then save.
        </DialogDescription>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-2 py-2 text-[11px] font-medium text-muted-foreground">
          <span className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Name</span>
          <span className="hidden w-36 sm:block">File type</span>
          <span className="w-20 text-right">Size</span>
          <span className="w-20">Actions</span>
          <span className="size-7" aria-hidden />
          <span className="size-7" aria-hidden />
          <span className="size-7" aria-hidden />
        </div>
        {!files.length && <p className="p-3 text-xs text-muted-foreground">The archive is empty.</p>}
        {files.map((f: any) => {
          const kind = kindOf(f.path, f.node.data);
          return (
            <div key={f.path} className="flex items-center gap-2 border-b px-2 py-1 last:border-b-0">
              <kind.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={f.path}>{f.path}</span>
              <span className="hidden w-36 truncate text-[11px] text-muted-foreground sm:block">{kind.label}</span>
              <span className="w-20 text-right text-[11px] tabular-nums text-muted-foreground">{size(f.node.data.length)}</span>
              {kind.tool ? <Button size="sm" variant="secondary" className="w-20" disabled={!toolAvailable(kind) || !!busy}
                title={toolAvailable(kind) ? `Open in ${toolLabel(kind)}` : "Save this archive to a file first"}
                onClick={() => open(f, kind)}><FolderOpen /> Open</Button>
                : <span className="w-20" title="No editor for this file type: extract it, edit it elsewhere and replace it" />}
              <Button size="icon-sm" variant="ghost" title="Extract" aria-label={`Extract ${f.path}`} onClick={() => editor.exportBytes(f.path.split("/").pop(), FILTERS.any, f.node.data, "Extract file")}><Download /></Button>
              <Button size="icon-sm" variant="ghost" title="Replace" aria-label={`Replace ${f.path}`} onClick={async () => {
                const next = await api.openFile(FILTERS.any, `Replace ${f.path}`);
                if (!next) return;
                f.node.data = next.data;
                changed();
              }}><Replace /></Button>
              <Button size="icon-sm" variant="ghost" title="Remove" aria-label={`Remove ${f.path}`} className="text-destructive" onClick={async () => {
                if (!(await dialogs.confirm({ title: "Remove file", description: `Remove ${f.path} from the archive?`, confirmLabel: "Remove", destructive: true }))) return;
                const strip = (node: any) => { if (node.children) { node.children = node.children.filter((c: any) => c !== f.node); node.children.forEach(strip); } };
                strip(tree);
                changed();
              }}><Trash2 /></Button>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={async () => {
          const next = await api.openFile(FILTERS.any, "Add file to the archive");
          if (!next) return;
          setFilePath(tree, next.name, next.data);
          changed();
        }}><FilePlus2 /> Add file…</Button>
        <span className="ml-auto text-[11px] text-muted-foreground">{files.length} files{dirty ? " · unsaved changes" : ""}</span>
        {!onCommit && <Button variant="secondary" disabled={!!busy} onClick={() => save(true)}>Save as…</Button>}
        <Button variant="secondary" disabled={!dirty || !!busy} onClick={() => save()}><Save /> {onCommit ? "Apply" : "Save"}</Button>
        <Button onClick={requestClose}>Done</Button>
      </div>
    </div>
  );
}
