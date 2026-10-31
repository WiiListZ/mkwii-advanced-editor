import * as React from "react";
import { documentationStatus, settingGuidance, STATUS_LABELS } from "../../../js/data/object-documentation.js";
import { hex } from "../editor";
import { cn } from "@/lib/utils";

// How well an object is documented: Documented, Partially documented or Unknown, with the percentage
// ("status" and "documented" of the JSON entry, or estimated from what the entry describes).
export function DocumentationStatus({ documentation, className }: { documentation: any; className?: string }) {
  const { status, percent, estimated } = documentationStatus(documentation);
  const label = (STATUS_LABELS as Record<string, string>)[status];
  return <span data-documentation-status={status} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-normal text-muted-foreground", className)}
    title={estimated ? `${label}, about ${percent}%: estimated from the description and the named settings. A JSON entry can give "status" and "documented" (a percentage).` : `${label}, ${percent}% (from the documentation JSON)`}>
    <span className="relative h-1 w-8 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 bg-foreground/50" style={{ width: `${percent}%` }} /></span>
    {label} · {estimated ? "~" : ""}{percent}%
  </span>;
}

export function ObjectDocumentationView({ id, label, name, documentation }: { id: number; label: string; name: string; documentation: any }) {
  const settings = documentation?.settings || {};
  return <div data-object-documentation className="space-y-2 rounded-md border bg-muted/20 p-2.5 text-xs leading-relaxed">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold">{label} <span className="font-mono font-normal text-muted-foreground">{hex(id)} · {name}</span></span>
      <DocumentationStatus documentation={documentation} className="ml-auto" />
    </div>
    <p className="text-muted-foreground">{documentation?.description || "Behaviour not documented yet. Describe it in a documentation JSON and choose it with Replace with JSON…"}</p>
    {documentation?.notes && <p className="border-l-2 border-amber-400/70 pl-2 text-muted-foreground">{documentation.notes}</p>}
    <div className="space-y-1.5 border-t pt-2" data-object-setting-guide>
      <div className="font-medium">Settings 1–8</div>
      {Array.from({ length: 8 }, (_, index) => {
        const setting = settings[index + 1];
        const guidance = settingGuidance(setting);
        return <div key={index} className="rounded border bg-background/40 px-2 py-1.5">
          <div className="font-medium">{index + 1}. {setting?.label || `Setting ${index + 1}`}</div>
          {setting?.description && <p className="text-muted-foreground">{setting.description}</p>}
          {guidance.options.length > 0 && <p className="text-muted-foreground"><span className="text-foreground">Choices:</span> {guidance.options.map(([v, label]: any) => `${v} = ${label}`).join(" · ")}{guidance.otherValues ? " · other values allowed" : ""}</p>}
          {guidance.values && <p className="text-muted-foreground"><span className="text-foreground">Values:</span> {guidance.values}</p>}
          <p className="text-muted-foreground"><span className="text-foreground">Limits:</span> {guidance.limits}</p>
        </div>;
      })}
    </div>
  </div>;
}
