import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { api, hasBackend } from "../../js/api.js";
import { trackLabel } from "../../js/data/defs.js";
import { editor } from "./editor";
import { useEditor } from "./hooks";
import { Hint } from "./common";
import { DiscordIcon } from "./updates";
import { useDialogStack } from "./dialogs-store";

// What a window is busy with, for the Discord activity. A part of the interface that knows more
// than the open window (music playing, for example) says it with useActivityNote; the newest wins.
const notes = new Map<number, string>(), noteListeners = new Set<() => void>();
let nextNote = 0, noteVersion = 0;
const subscribeNotes = (fn: () => void) => { noteListeners.add(fn); return () => { noteListeners.delete(fn); }; };
const latestNote = () => [...notes.values()].at(-1) || "";
export function useActivityNote(text: string | null) {
  React.useEffect(() => {
    if (!text) return;
    const id = nextNote++;
    notes.set(id, text); noteVersion++; noteListeners.forEach((fn) => fn());
    return () => { notes.delete(id); noteVersion++; noteListeners.forEach((fn) => fn()); };
  }, [text]);
}
const DIALOG_ACTIVITY: Record<string, string> = {
  audio: "Editing music and sounds", effects: "Editing effects", params: "Editing game parameters", minimap: "Editing the minimap",
  gameText: "Editing the game's text", cups: "Arranging cups and tracks", cupsApply: "Arranging cups and tracks", thp: "Editing preview videos",
  generator: "Creating a new track", sky: "Editing the sky", fog: "Editing the fog", materials: "Editing materials",
  textureEditor: "Editing textures", objectTextureEditor: "Editing textures", assetTextureEditor: "Editing textures", objectAppearance: "Editing an object's look",
  skeletonEditor: "Editing a skeleton", sculpt: "Sculpting the track", primitive: "Adding shapes", ghosts: "Working with ghosts",
  ghostRecord: "Recording a ghost", ghostReplay: "Watching a ghost replay", trackGhosts: "Working with ghosts", assetEditor: "Editing characters and models",
  riivolution: "Setting up a Riivolution mod", objectDocsEditor: "Documenting game objects", modelParts: "Adding model parts", gameObjects: "Browsing game objects",
  archive: "Browsing an archive", menuResource: "Editing menus", szs: "Editing SZS contents", importObj: "Importing a model", versions: "Comparing versions",
  trackCompare: "Comparing versions", copyCollision: "Copying collision", saveCheck: "Saving a track",
};
const TAB_ACTIVITY: Record<string, string> = { collision: "Editing collision", objects: "Placing objects", cameras: "Editing cameras", routes: "Editing routes", validate: "Checking the track" };

type Status = "disabled" | "unconfigured" | "connecting" | "waiting" | "connected" | "error" | "unavailable";
const ActivityContext = React.createContext<Status>("connecting");
const activityWindow = crypto.randomUUID();
const labels: Record<Status, string> = {
  disabled: "Off", unconfigured: "Discord setup required", connecting: "Connecting to Discord…",
  waiting: "Waiting for Discord", connected: "Connected to Discord", error: "Discord could not show the activity", unavailable: "Discord connection unavailable",
};

export function DiscordActivityProvider({ children }: { children: React.ReactNode }) {
  const ed = useEditor("settings", "doc", "ui", "intro");
  const stack = useDialogStack();
  React.useSyncExternalStore(subscribeNotes, () => noteVersion);
  const [status, setStatus] = React.useState<Status>(hasBackend ? "connecting" : "unavailable");
  const current = React.useRef({ mode: "home" as "home" | "editing", file: "", detail: "" });
  const home = ed.homeVisible || ed.isEmpty;
  const dialog = [...stack].reverse().find((entry) => !entry.closing && DIALOG_ACTIVITY[entry.kind]);
  const tool = ed.tool?.type;
  const detail = latestNote() || (dialog && DIALOG_ACTIVITY[dialog.kind])
    || (ed.ghostView ? "Watching a ghost replay" : home ? "" : ed.intro ? "Watching the intro"
      : tool === "paint" ? "Painting collision" : ed.map2D ? "Editing in the 2D map" : TAB_ACTIVITY[ed.tab] || "Editing a track");
  current.current = { mode: home ? "home" : "editing", file: home ? "" : trackLabel(ed.doc.fileName || "New track"), detail };
  const report = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    if (!hasBackend) return;
    let disposed = false, sequence = 0;
    const send = async () => {
      const request = ++sequence, enabled = editor.settings.discordActivity;
      // A switch change is persisted before the heartbeat reads the server's
      // authoritative preference, including changes made in another window.
      await editor.flushSettings();
      try {
        const response = await api.discordActivity({ id: activityWindow, ...current.current, focused: document.hasFocus() });
        if (disposed || request !== sequence) return;
        setStatus(response.status);
        if (editor.settings.discordActivity === enabled && enabled !== response.enabled) {
          editor.settings.discordActivity = response.enabled; editor.bump("settings");
        }
      } catch { if (!disposed && request === sequence) setStatus("unavailable"); }
    };
    report.current = () => { void send(); };
    const onFocus = () => report.current();
    const onClose = () => api.closeDiscordActivity(activityWindow);
    const timer = setInterval(() => report.current(), 10000);
    window.addEventListener("focus", onFocus); window.addEventListener("pagehide", onClose);
    report.current();
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("pagehide", onClose); onClose(); report.current = () => {}; };
  }, []);
  React.useEffect(() => { report.current(); }, [home, ed.doc.fileName, detail, ed.settings.discordActivity]);
  return <ActivityContext.Provider value={status}>{children}</ActivityContext.Provider>;
}

export function DiscordActivityControl() {
  const ed = useEditor("settings"), status = React.useContext(ActivityContext);
  const id = React.useId(), enabled = ed.settings.discordActivity;
  return <Hint title="Discord activity Status" text="Show what you are doing in MKWii Advanced Editor on your Discord profile, including the track you are editing and elapsed time. Turn off to clear the activity. Your choice is remembered.">
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
      <DiscordIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] font-medium">Discord activity Status</span>
        <span role="status" className="block text-[10px] leading-tight text-muted-foreground">{!hasBackend ? "Desktop app required" : enabled ? labels[status] : "Off"}</span>
      </span>
      <Switch id={id} aria-label="Discord activity Status" checked={enabled} disabled={!hasBackend} onCheckedChange={(value) => ed.setSetting("discordActivity", value)} />
    </label>
  </Hint>;
}
