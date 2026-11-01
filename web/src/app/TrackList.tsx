// The track files of the tracks folder (the game's Race/Course, or the folder chosen in Settings),
// shown in Cups and tracks under "All tracks" and "Not in a cup": search, version and type filters,
// the cup and position of the game's own tracks, and their preview video behind them. A click opens
// the track in the editor. The folder list does not wait for the model index, so even very large
// mods appear immediately.

import * as React from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trackKind, trackLabel } from "../../js/data/defs.js";
import { CUPS, slotPlace, SLOTS } from "../../js/data/cups.js";
import { THP_LAYOUTS } from "../../js/formats/thp.js";
import { useEditor } from "./hooks";
import { editor } from "./editor";
import { CupIcon, useCupIcons } from "./cup-icons";
import { ThpPart } from "./thp-preview";

// The part of a cup's preview video that shows the track of a cup position, or null.
export function previewOfPlace(place: { cup: number; position: number } | null) {
  if (!place) return null;
  const entry = Object.entries(THP_LAYOUTS).find(([, l]: any) => l.cup === place.cup);
  const path = entry && editor.workspacePath("thp", ...entry[0].split("/"));
  return path ? { path, rect: (entry![1] as any).regions[place.position] } : null;
}

// The cup position of an original track archive ("shopping_course_d.szs" -> Flower Cup 2), or null.
const SLOT_BY_FILE = new Map(SLOTS.map((s: any) => [s.file.toLowerCase(), s.id]));
export function placeOfFile(file: string) {
  const stem = file.replace(/\.(szs|wlz|wbz|wu8)$/i, "").replace(/_d$/i, "").toLowerCase();
  const slot = SLOT_BY_FILE.get(stem);
  return slot === undefined ? null : slotPlace(slot);
}

// section: "all" lists every track file, "other" those that are in no cup of the game (custom
// tracks, demos, the mission arena).
export function TrackList({ section, onOpen }: { section: "all" | "other"; onOpen: (path: string) => void }) {
  const ed = useEditor("settings", "doc");
  const t = ed.trackFiles;
  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState<"solo" | "multi" | "all">("solo");
  const [kind, setKind] = React.useState<"race" | "battle" | "both">("both");
  const [page, setPage] = React.useState(0);
  const icons = useCupIcons();
  // Taller rows with each track's preview video behind it (remembered; off shows the plain list).
  const previews = ed.settings.trackVideoPreviews;
  React.useEffect(() => setPage(0), [section]);
  if (!t?.files.length) {
    return <p className="m-0 p-4 text-center text-xs text-muted-foreground">No track files yet: choose the game folder, or a folder of tracks in Settings › Game files.</p>;
  }
  const q = query.trim().toLowerCase();
  const files = t.files.filter((f) =>
    (mode === "all" || (mode === "multi" ? /_d\.(szs|wlz|wbz|wu8)$/i.test(f) : !/_d\.(szs|wlz|wbz|wu8)$/i.test(f))) &&
    (kind === "both" || trackKind(f) === kind) &&
    (section === "all" || !placeOfFile(f)) &&
    (!q || `${trackLabel(f)} ${f}`.toLowerCase().includes(q)));
  const pageSize = 48, pages = Math.max(1, Math.ceil(files.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const shown = files.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const current = ed.currentTrackFile();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} onKeyDown={(e) => e.stopPropagation()} placeholder="Search by name or file number…" aria-label="Search tracks" className="h-8 pl-8 text-xs" />
        </div>
        <span className="text-[11px] text-muted-foreground">Version</span>
        <Select value={mode} onValueChange={(value) => { setMode(value as typeof mode); setPage(0); }}>
          <SelectTrigger aria-label="Track version" className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="solo">Single player</SelectItem>
            <SelectItem value="multi">Multiplayer</SelectItem>
            <SelectItem value="all">All files</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-1 text-[11px] text-muted-foreground">Type</span>
        <Select value={kind} onValueChange={(value) => { setKind(value as typeof kind); setPage(0); }}>
          <SelectTrigger aria-label="Track type" className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="race">Race tracks</SelectItem>
            <SelectItem value="battle">Battle tracks</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
        <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground" title="Show the track preview videos of the cup selection behind the tracks of the game's cups">
          <Checkbox checked={previews} onCheckedChange={(v) => ed.setSetting("trackVideoPreviews", v === true)} aria-label="Video previews" />
          Video previews
        </label>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{files.length.toLocaleString()} of {t.files.length.toLocaleString()} files</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-1 overflow-y-auto pr-1 sm:grid-cols-2" data-previews={previews || undefined}>
        {shown.map((f) => {
          const label = trackLabel(f), number = f.replace(/\.(szs|wlz|wbz|wu8)$/i, ""), place = placeOfFile(f);
          const preview = previews ? previewOfPlace(place) : null;
          return <button key={f} onClick={() => onOpen(`${t.folder}\\${f}`)} title={`Open ${f} in the editor`}
            className={`group relative flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md border px-2 text-left transition-colors ${previews ? "h-20 py-2" : "py-1.5"} ${f === current ? "border-primary/50 bg-primary/10" : "border-transparent bg-muted/30 hover:border-primary/30 hover:bg-accent"}`}>
            {preview && <>
              <ThpPart path={preview.path} rect={preview.rect} className="absolute inset-0 size-full" />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-card via-card/75 to-card/20" />
            </>}
            {place ? <span className="relative flex size-8 shrink-0 items-center justify-center rounded bg-background"><CupIcon cup={place.cup} icons={icons} className="size-6" /></span>
              : <span className="relative flex size-8 shrink-0 items-center justify-center rounded bg-background font-mono text-[10px] text-muted-foreground">{/^\d+$/.test(number) ? number : f.split(".").pop()!.toUpperCase()}</span>}
            <span className="relative min-w-0 flex-1"><span className="block truncate text-xs font-medium">{/^\d+$/.test(label) ? `Track ${label}` : label}</span><span className="block truncate font-mono text-[10px] text-muted-foreground">{place ? `${CUPS[place.cup].name} ${place.position + 1} · ` : ""}{f}</span></span>
            <ArrowRight className="relative size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>;
        })}
        {!files.length && <p className="col-span-2 m-0 py-8 text-center text-xs text-muted-foreground">No tracks match this search.</p>}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">{files.length ? `${currentPage * pageSize + 1}–${Math.min(files.length, (currentPage + 1) * pageSize)} of ${files.length.toLocaleString()}` : "0 tracks"}</span>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Previous track page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
          <span className="min-w-12 text-center tabular-nums">{currentPage + 1} / {pages}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Next track page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
