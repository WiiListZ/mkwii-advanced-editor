// Shown before a track is saved when the track check finds errors (the game crashes or races break)
// or warnings. Each problem can be fixed here when the check offers a fix; "Save anyway" saves as is.
// Resolves true to save, false to go back to editing.

import * as React from "react";
import { CircleAlert, OctagonX, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEditor } from "../hooks";
import { ISSUE_SECTIONS, issueSummary } from "../panels/CheckPanel";

export function SaveCheckDialog({ close }: { close: (save: boolean) => void }) {
  const ed = useEditor("ui", "settings");
  const shown = ed.issues.filter((issue: any) => issue.level === "error" || (issue.level === "warning" && ed.settings.saveCheckWarnings));
  const errors = shown.filter((issue: any) => issue.level === "error").length, crashes = shown.filter((issue: any) => issue.crash).length;
  const fix = (issue: any) => { issue.fix.run(); ed.runValidate(); };
  // Until the editor is closed: no more stops before saving, errors and warnings included.
  const [skipFromNow, setSkipFromNow] = React.useState(false);
  const save = () => { if (skipFromNow) ed.skipSaveCheck = true; close(true); };

  return (
    <div className="flex min-h-0 flex-col gap-3" data-save-check>
      <div>
        <DialogTitle className="text-base">{crashes ? "This track will crash or freeze the game" : errors ? "This track has errors" : shown.length ? "The track check found problems" : "No problems left"}</DialogTitle>
        <DialogDescription className="text-xs">
          {shown.length ? <>
            {issueSummary(shown)}.
            {" "}{crashes ? "The first ones crash or freeze the game; errors break races, warnings may cause problems." : "None of them crashes the game: errors break races, warnings may cause problems."} Fix them here, or save anyway.
          </> : "The track can be saved."}
        </DialogDescription>
      </div>
      <div className="flex max-h-[50vh] min-h-0 flex-col gap-1 overflow-y-auto">
        {ISSUE_SECTIONS.map((section) => ({ section, list: shown.filter(section.test) })).filter(({ list }) => list.length).map(({ section, list }) => <React.Fragment key={section.id}>
          <h3 className="mb-0 mt-2 text-xs font-medium text-muted-foreground first:mt-0">{section.title} ({list.length})</h3>
        {list.map((issue: any, i: number) => {
          const Icon = issue.crash ? OctagonX : issue.level === "error" ? CircleAlert : TriangleAlert;
          return (
            <div key={i} className={cn("flex gap-2.5 rounded-md border border-l-2 bg-card p-2.5", issue.level === "error" ? "border-l-destructive" : "border-l-warning")} data-save-issue={issue.crash ? "crash" : issue.level}>
              <Icon className={cn("mt-0.5 size-4 shrink-0", issue.level === "error" ? "text-destructive" : "text-warning")} />
              <div className="flex min-w-0 flex-col items-start gap-2 text-[12.5px] leading-snug">
                {issue.msg}
                {issue.fix && <Button size="sm" variant="secondary" onClick={() => fix(issue)}><Wrench /> {issue.fix.label}</Button>}
              </div>
            </div>
          );
        })}
        </React.Fragment>)}
        {!shown.length && <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" /> Everything that was found is fixed.</p>}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={ed.settings.saveCheckWarnings} onChange={(e) => ed.setSetting("saveCheckWarnings", e.target.checked)} />
        Also stop for warnings when saving (errors always stop)
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={skipFromNow} onChange={(e) => setSkipFromNow(e.target.checked)} data-skip-save-check />
        Don't show this again until the editor is closed: save even with errors and warnings
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { ed.setTab("validate"); close(false); }}>Show in Check panel</Button>
        <Button size="sm" variant="outline" onClick={() => close(false)}>Cancel</Button>
        <Button size="sm" variant={errors ? "destructive" : "default"} onClick={save}>{shown.length ? "Save anyway" : "Save"}</Button>
      </div>
    </div>
  );
}
