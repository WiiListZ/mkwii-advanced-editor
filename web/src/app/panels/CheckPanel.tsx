import * as React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditor } from "../hooks";
import { cn } from "@/lib/utils";

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const TONE = { error: "text-destructive", warning: "text-warning", info: "text-sky-400" } as const;
const BORDER = { error: "border-l-destructive", warning: "border-l-warning", info: "border-l-sky-400" } as const;

export function CheckPanel() {
  const ed = useEditor("ui");
  const issues = ed.issues;
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Automatic check of the track. Errors crash the game or break races, warnings may cause problems, notes are suggestions.
        Click a problem to jump to it; the wrench fixes it for you.
      </p>
      <div className={cn(
        "flex items-center gap-2 rounded-lg border p-3 text-[13px] font-medium",
        errors ? "border-destructive/40 bg-destructive/10 text-destructive" : warnings ? "border-warning/40 bg-warning/10 text-warning" : "border-success/40 bg-success/10 text-success",
      )}>
        {errors ? <CircleAlert className="size-4" /> : warnings ? <TriangleAlert className="size-4" /> : <CircleCheck className="size-4" />}
        {errors ? `${errors} error${errors > 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""}` : warnings ? `No errors, ${warnings} warning${warnings > 1 ? "s" : ""}` : "No problems found"}
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((it, i) => {
          const Icon = ICON[it.level as keyof typeof ICON];
          return (
            <div
              key={i}
              onClick={() => { if (it.key) { ed.doc.select(it.key); ed.viewport.focusSelection(); } }}
              className={cn("flex cursor-pointer gap-2.5 rounded-md border border-l-2 bg-card p-2.5 hover:bg-accent/50", BORDER[it.level as keyof typeof BORDER])}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[it.level as keyof typeof TONE])} />
              <div className="flex min-w-0 flex-col items-start gap-2 text-[12.5px] leading-snug">
                {it.msg}
                {it.fix && (
                  <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); it.fix.run(); }}>
                    <Wrench /> {it.fix.label}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
