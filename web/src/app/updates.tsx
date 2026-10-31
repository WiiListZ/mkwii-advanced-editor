import * as React from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../js/api.js";
import packageJson from "../../../package.json" with { type: "json" };
import { editor } from "./editor";
import { Markdown, markdownSummary } from "./markdown";

export const APP_VERSION = packageJson.version;
export const REPO_URL = "https://github.com/WiiListZ/mkwii-advanced-editor";
// The editor's Discord server: help with the editor, questions and news.
export const DISCORD_URL = "https://discord.gg/wrDyU9E7zs";
// Discord's logo (lucide has no brand icons), sized and coloured like the other button icons.
export function DiscordIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}
// A new issue with the version already filled in.
export const newIssueUrl = () => `${REPO_URL}/issues/new?body=${encodeURIComponent(`**What happened**\n\n\n**Steps to reproduce**\n1. \n\n**Editor version:** ${APP_VERSION}\n`)}`;
type Status = { supported?: boolean; available?: boolean; currentVersion?: string; version?: string; title?: string; notes?: string; url?: string };
export type ReleaseNotes = { version: string; title?: string; notes: string; url?: string };
type Updates = { status: Status | null; phase: "checking" | "idle" | "offered" | "downloading" | "ready" | "installing" | "error"; error: string;
  // Share of the executable downloaded so far, 0 to 1.
  progress: number;
  dismissed: boolean; check: () => Promise<void>; accept: () => Promise<void>; dismiss: () => void; restart: () => Promise<void>;
  // Notes of the running version when the in-app updater installed it, and the notes open in the modal.
  installed: ReleaseNotes | null; reading: (ReleaseNotes & { afterUpdate?: boolean }) | null;
  showNotes: (notes: ReleaseNotes) => void; closeNotes: () => void };
const Context = React.createContext<Updates | null>(null);

export function UpdatesProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [phase, setPhase] = React.useState<Updates["phase"]>("checking");
  const [error, setError] = React.useState("");
  const [progress, setProgress] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(false);
  const downloading = React.useRef(false);
  const [installed, setInstalled] = React.useState<ReleaseNotes | null>(null);
  const [reading, setReading] = React.useState<Updates["reading"]>(null);
  // First start after an in-app update: its notes open once, then only from Help › About.
  React.useEffect(() => {
    api.installedReleaseNotes().then((result: any) => {
      if (!result.available) return;
      setInstalled(result);
      if (result.show) setReading({ ...result, afterUpdate: true });
    }).catch((reason: any) => console.warn("Could not read the release notes", reason));
  }, []);
  const showNotes = React.useCallback((notes: ReleaseNotes) => setReading(notes), []);
  const closeNotes = React.useCallback(() => setReading((current) => {
    if (current?.afterUpdate) api.markReleaseNotesShown().catch((reason: any) => console.warn("Could not save the release notes state", reason));
    return null;
  }), []);
  const check = React.useCallback(async () => {
    setPhase("checking"); setError(""); setProgress(0);
    try {
      const result = await api.checkUpdates();
      setStatus(result);
      if (!result.available) { setPhase("idle"); return; }
      setDismissed(false);
      setPhase("offered");
    } catch (reason: any) { setError(reason.message || String(reason)); setPhase("error"); }
  }, []);
  React.useEffect(() => { void check(); }, [check]);
  const restart = React.useCallback(async () => {
    if (!editor.hasWindowControls) { toast.error("Restart the desktop window to install the update"); return; }
    try {
      if (editor.doc.dirty && !(await editor.save())) { setPhase("ready"); return; }
      setPhase("installing");
      await api.applyUpdate();
      await editor.windowAction("close");
    } catch (reason: any) {
      setPhase("ready");
      toast.error("Could not install update", { description: reason.message });
    }
  }, []);
  const accept = React.useCallback(async () => {
    if (downloading.current) return;
    downloading.current = true;
    setDismissed(false);
    setError("");
    setProgress(0);
    setPhase("downloading");
    try {
      // Nothing is downloaded until the user accepts the new version.
      let state = await api.downloadUpdate();
      while (state.phase === "downloading") {
        setProgress(state.total ? state.received / state.total : 0);
        await new Promise((done) => setTimeout(done, 500));
        state = await api.updateProgress();
      }
      if (state.phase !== "ready") throw new Error(state.error || "The download did not finish");
      setProgress(1);
      setPhase("ready");
      await restart();
    } catch (reason: any) { setError(reason.message || String(reason)); setPhase("error"); }
    finally { downloading.current = false; }
  }, [restart]);
  const dismiss = React.useCallback(() => setDismissed(true), []);
  return <Context.Provider value={{ status, phase, error, progress, dismissed, check, accept, dismiss, restart, installed, reading, showNotes, closeNotes }}>{children}</Context.Provider>;
}

export function useUpdates() {
  const value = React.useContext(Context);
  if (!value) throw new Error("UpdatesProvider is missing");
  return value;
}

export function ReleaseNotesDialog() {
  const { reading, closeNotes } = useUpdates();
  // The last notes stay rendered while the dialog closes.
  const [shown, setShown] = React.useState(reading);
  React.useEffect(() => { if (reading) setShown(reading); }, [reading]);
  const title = shown?.title && shown.title.replace(/^v/i, "") !== shown.version ? shown.title : "";
  return <Dialog open={!!reading} onOpenChange={(open) => { if (!open) closeNotes(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>What's new in version {shown?.version}</DialogTitle>
        <DialogDescription>{shown?.afterUpdate ? `MKWii Advanced Editor was updated to version ${shown.version}.` : title || "Release notes from GitHub."}</DialogDescription>
      </DialogHeader>
      <div className="-mr-2 min-h-0 overflow-y-auto pr-2"><Markdown text={shown?.notes || "No release notes provided."} /></div>
      <DialogFooter>
        {shown?.url && <Button variant="secondary" onClick={() => void api.openUrl(shown.url)}><ExternalLink /> View on GitHub</Button>}
        <Button onClick={closeNotes}>Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function UpdateNotice() {
  const { status, phase, error, progress, dismissed, accept, dismiss, restart, reading, showNotes } = useUpdates();
  if (!status?.available) return <ReleaseNotesDialog />;
  const notes = { version: status.version || "", title: status.title, notes: status.notes || "", url: status.url };
  return <>
    <ReleaseNotesDialog />
    <AlertDialog open={phase === "offered" && !dismissed && !reading} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Update to version {status.version}?</AlertDialogTitle>
          <AlertDialogDescription>The editor will download and verify the update, then save any unsaved track changes and restart to install it.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-72 min-h-0 overflow-y-auto rounded-md border p-3"><Markdown text={status.notes || "No release notes provided."} /></div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss}>Later</AlertDialogCancel>
          <AlertDialogAction onClick={() => void accept()}>Update now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {phase !== "offered" && <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs">
    <Download className="size-4 shrink-0 text-primary" />
    <div className="min-w-0 flex-1">
      <div className="font-semibold">Update {status.version} {phase === "downloading" ? `· downloading ${Math.floor(progress * 100)}%` : phase === "installing" ? "· installing" : phase === "ready" ? "· ready to install" : phase === "error" ? "· download failed" : "available"}</div>
      {phase === "error"
        ? <p className="m-0 line-clamp-2 text-destructive">{error}</p>
        : <p className="m-0 line-clamp-1 text-muted-foreground">{markdownSummary(status.notes || "")}</p>}
    </div>
    <Button size="sm" variant="ghost" className="shrink-0" onClick={() => showNotes(notes)}>Release notes</Button>
    {phase === "error"
      ? <Button size="sm" variant="secondary" onClick={() => void accept()}><RefreshCw /> Retry</Button>
      : phase === "ready" ? <Button size="sm" onClick={() => void restart()}><RefreshCw /> Restart & update</Button> : null}
  </div>}
  </>;
}
