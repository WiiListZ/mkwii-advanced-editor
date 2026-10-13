import * as React from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "../../js/api.js";
import packageJson from "../../../package.json" with { type: "json" };
import { editor } from "./editor";

export const APP_VERSION = packageJson.version;
export const REPO_URL = "https://github.com/WiiListZ/mkwii-advanced-editor";
// A new issue with the version already filled in.
export const newIssueUrl = () => `${REPO_URL}/issues/new?body=${encodeURIComponent(`**What happened**\n\n\n**Steps to reproduce**\n1. \n\n**Editor version:** ${APP_VERSION}\n`)}`;
type Status = { supported?: boolean; available?: boolean; currentVersion?: string; version?: string; title?: string; notes?: string; url?: string };
type Updates = { status: Status | null; phase: "checking" | "idle" | "downloading" | "ready" | "error"; error: string;
  // Share of the executable downloaded so far, 0 to 1.
  progress: number;
  check: () => Promise<void>; restart: () => Promise<void> };
const Context = React.createContext<Updates | null>(null);

export function UpdatesProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [phase, setPhase] = React.useState<Updates["phase"]>("checking");
  const [error, setError] = React.useState("");
  const [progress, setProgress] = React.useState(0);
  const check = React.useCallback(async () => {
    setPhase("checking"); setError(""); setProgress(0);
    try {
      const result = await api.checkUpdates();
      setStatus(result);
      if (!result.available) { setPhase("idle"); return; }
      setPhase("downloading");
      // The backend downloads in the background; follow it until it is verified or fails.
      let state = await api.downloadUpdate();
      while (state.phase === "downloading") {
        setProgress(state.total ? state.received / state.total : 0);
        await new Promise((done) => setTimeout(done, 500));
        state = await api.updateProgress();
      }
      if (state.phase !== "ready") throw new Error(state.error || "The download did not finish");
      setProgress(1);
      setPhase("ready");
    } catch (reason: any) { setError(reason.message || String(reason)); setPhase("error"); }
  }, []);
  React.useEffect(() => { void check(); }, [check]);
  const restart = React.useCallback(async () => {
    if (!editor.hasWindowControls) return toast.error("Restart the desktop window to install the update");
    try {
      if (editor.doc.dirty && !(await editor.save())) return;
      await api.applyUpdate();
      await editor.windowAction("close");
    } catch (reason: any) { toast.error("Could not install update", { description: reason.message }); }
  }, []);
  return <Context.Provider value={{ status, phase, error, progress, check, restart }}>{children}</Context.Provider>;
}

export function useUpdates() {
  const value = React.useContext(Context);
  if (!value) throw new Error("UpdatesProvider is missing");
  return value;
}

export function UpdateNotice() {
  const { status, phase, error, progress, check, restart } = useUpdates();
  if (!status?.available) return null;
  return <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs">
    <Download className="size-4 shrink-0 text-primary" />
    <div className="min-w-0 flex-1">
      <div className="font-semibold">Update {status.version} available {phase === "downloading" ? `· downloading ${Math.floor(progress * 100)}%` : phase === "ready" ? "· ready to install" : phase === "error" ? "· download failed" : ""}</div>
      {phase === "error"
        ? <p className="m-0 line-clamp-2 text-destructive">{error}</p>
        : <p className="m-0 line-clamp-2 whitespace-pre-line text-muted-foreground">{status.notes}</p>}
    </div>
    {status.url && <a className="shrink-0 text-primary underline" href={status.url} target="_blank" rel="noreferrer">Release notes</a>}
    {phase === "error"
      ? <Button size="sm" variant="secondary" onClick={() => void check()}><RefreshCw /> Retry</Button>
      : <Button size="sm" disabled={phase !== "ready"} onClick={restart}><RefreshCw /> Restart & update</Button>}
  </div>;
}
