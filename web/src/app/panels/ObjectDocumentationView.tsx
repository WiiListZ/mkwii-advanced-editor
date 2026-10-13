import * as React from "react";
import { settingGuidance } from "../../../js/data/object-documentation.js";
import { hex } from "../editor";

export function ObjectDocumentationView({ id, label, name, documentation }: { id: number; label: string; name: string; documentation: any }) {
  const settings = documentation?.settings || {};
  return <div data-object-documentation className="space-y-2 rounded-md border bg-muted/20 p-2.5 text-xs leading-relaxed">
    <div className="font-semibold">{label} <span className="font-mono font-normal text-muted-foreground">{hex(id)} · {name}</span></div>
    <p className="text-muted-foreground">{documentation?.description || "Behaviour not documented yet. Import JSON documentation to describe this object."}</p>
    {documentation?.notes && <p className="border-l-2 border-amber-400/70 pl-2 text-muted-foreground">{documentation.notes}</p>}
    <div className="space-y-1.5 border-t pt-2" data-object-setting-guide>
      <div className="font-medium">Settings 1–8</div>
      {Array.from({ length: 8 }, (_, index) => {
        const setting = settings[index + 1];
        const guidance = settingGuidance(setting);
        return <div key={index} className="rounded border bg-background/40 px-2 py-1.5">
          <div className="font-medium">{index + 1}. {setting?.label || `Setting ${index + 1}`}</div>
          {setting?.description && <p className="text-muted-foreground">{setting.description}</p>}
          {guidance.values && <p className="text-muted-foreground"><span className="text-foreground">Values:</span> {guidance.values}</p>}
          <p className="text-muted-foreground"><span className="text-foreground">Limits:</span> {guidance.limits}</p>
        </div>;
      })}
    </div>
  </div>;
}
