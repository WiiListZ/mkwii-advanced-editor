// Help center › Object documentation: the JSON format read by parseObjectDocumentation
// (web/js/data/object-documentation.js), with the example file of the repository.
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import example from "../../../../docs/object-documentation.example.json" with { type: "json" };

const EXAMPLE = JSON.stringify(example, null, 2);
const SKELETON = `{
  "version": 1,
  "objects": {
    "<object>": {
      "label": "…",
      "description": "…",
      "notes": "…",
      "settings": {
        "1": { "label": "…", "description": "…", "min": 0, "max": 100, "limits": "…" },
        "2": { "label": "…", "options": { "0": "…", "1": "…" }, "otherValues": true },
        "3": { "label": "…", "signed": true, "values": "…" }
      }
    }
  }
}`;

const Code = ({ children }: { children: string }) => (
  <pre className="m-0 overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed">{children}</pre>
);
const Field = ({ name, rule, children }: { name: string; rule: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 px-3 py-2">
    <div><code className="font-mono text-[12px] text-foreground">{name}</code><div className="text-[11px] text-muted-foreground">{rule}</div></div>
    <div className="text-muted-foreground">{children}</div>
  </div>
);

export function ObjectDocumentationHelp() {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-semibold">What it is</h3>
        <p className="m-0 text-muted-foreground">
          A JSON file that adds or corrects the description of game objects and the names of their eight settings. The editor shows them in the Inspector,
          in the Objects catalogue and in the Add / Change object picker. The built-in documentation stays: imported entries are laid over it, field by field.
        </p>
        <p className="m-0 text-muted-foreground">
          Import it with <b>Import JSON…</b> on the Home screen, in Settings › Game files or in the Objects catalogue. A new import adds its entries to those
          already imported (an entry for the same object replaces the old one); <b>Remove imported</b> deletes them all. Imported entries are saved in the editor settings.
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-semibold">File structure</h3>
        <Code>{SKELETON}</Code>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-semibold">Object keys</h3>
        <div className="flex flex-col divide-y rounded-lg border">
          <Field name="itembox" rule="internal name">The name of the object type in Race/Common.szs › ObjFlow.bin (letters, digits, _ . -).</Field>
          <Field name='"0x0065" or "101"' rule="object ID">The object ID in hexadecimal or decimal, up to 0xFFFF. An ID entry takes priority over a name entry for the same object.</Field>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-semibold">Object fields</h3>
        <div className="flex flex-col divide-y rounded-lg border">
          <Field name="label" rule="up to 120 characters">The name shown for the object.</Field>
          <Field name="description" rule="up to 2000 characters">What the object is and does.</Field>
          <Field name="notes" rule="up to 2000 characters">A remark shown highlighted under the description (requirements, known problems…).</Field>
          <Field name="settings" rule='keys "1" to "8"'>The KMP settings 1 to 8 of the object, each with the fields below.</Field>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-semibold">Setting fields</h3>
        <div className="flex flex-col divide-y rounded-lg border">
          <Field name="label" rule="required, up to 120">The name of the setting in the Inspector.</Field>
          <Field name="description" rule="up to 2000 characters">What the setting changes.</Field>
          <Field name="min" rule="whole number">The smallest value the Inspector accepts: a lower value typed or dragged in the box becomes this one.</Field>
          <Field name="max" rule="whole number">The largest value the Inspector accepts. Without min and max the box takes the whole stored range, 0 to 65535.</Field>
          <Field name="signed" rule="true or false">The value has a sign: the box shows −32768 to 32767 (the file stores −1 as 65535). min and max are then signed too.</Field>
          <Field name="options" rule='{ "value": "label" }, 1 to 256'>The setting becomes a list to choose from in the Inspector instead of a number box. Every value must be inside min–max.</Field>
          <Field name="otherValues" rule="true or false">With options: the list also has "Other value…", which shows the number box to type a value that is not listed.</Field>
          <Field name="values" rule="up to 2000 characters">A note on the values, shown under the setting (for example what a number means when there is no list).</Field>
          <Field name="limits" rule="up to 2000 characters">A note on the limits, shown after the min–max range.</Field>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-semibold">Rules</h3>
        <ul className="m-0 list-disc pl-5 text-muted-foreground">
          <li><code className="font-mono text-[12px]">"version"</code> must be 1.</li>
          <li>From 1 to 1000 objects per file, and the file at most 2 MB.</li>
          <li>Every object needs at least one field; every text must be non-empty.</li>
          <li>min, max and the option values must be whole numbers inside the stored range (0–65535, or −32768–32767 when signed), with min not above max.</li>
          <li>Other fields are ignored. If anything is wrong the whole file is refused and the message says where.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold">Example</h3>
          <Button size="sm" variant="secondary" onClick={() => {
            navigator.clipboard?.writeText(EXAMPLE).then(() => toast.success("Example copied")).catch(() => toast.error("Could not copy the example"));
          }}><Copy /> Copy</Button>
        </div>
        <Code>{EXAMPLE}</Code>
      </section>
    </div>
  );
}
