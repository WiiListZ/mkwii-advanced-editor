import * as React from "react";
import { Box, Cloud, Flag, Info, Milestone, Package, Rocket, Route, Settings2, Spline, Trophy, Video, Waypoints, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<string, LucideIcon> = {
  STGI: Settings2, KTPT: Flag, ENPT: Route, ITPT: Waypoints, CKPT: Milestone, GOBJ: Package, POTI: Spline,
  AREA: Box, CAME: Video, JGPT: Cloud, CNPT: Rocket, MSPT: Trophy, ROUTE: Spline,
};

export const KIND_COLOR: Record<string, string> = {
  KTPT: "#ef4444", ENPT: "#ff6b6b", ITPT: "#4ade80", CKPT: "#3b82f6", GOBJ: "#f59e0b", POTI: "#a855f7",
  AREA: "#22d3ee", CAME: "#e879f9", JGPT: "#60a5fa", CNPT: "#fb7185", MSPT: "#94a3b8", STGI: "#9ca3af",
};

// Wraps any element in a tooltip with a title, an explanation and an optional shortcut.
// `wrap` puts the tooltip on a wrapper span: needed for Radix elements that use their own
// data-state (tabs, toggles), otherwise the tooltip's data-state would replace it.
// Tooltips close on any click. Menus and lists suppress them; inside a dialog, only controls in
// the top dialog can show one (so a tooltip from a covered window cannot appear above it).
const popupOpen = (trigger: Element | null) => {
  if (document.querySelector("[role=listbox], [role=menu]")) return true;
  const dialogs = [...document.querySelectorAll('[role=dialog]:not([data-state="closed"]), [role=alertdialog]:not([data-state="closed"])')];
  const top = dialogs[dialogs.length - 1];
  return !!top && trigger?.closest("[role=dialog], [role=alertdialog]") !== top;
};

export function Hint({ title, text, shortcut, side, wrap, hoverable = true, children }: { title?: string; text?: string; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; wrap?: boolean; hoverable?: boolean; children: React.ReactElement }) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<React.ElementRef<typeof TooltipTrigger>>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const popups = new MutationObserver(() => { if (popupOpen(trigger.current)) close(); });
    popups.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "data-state"] });
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => { popups.disconnect(); window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", close, true); };
  }, [open]);
  if (!title && !text) return children;
  return (
    <Tooltip open={open} disableHoverableContent={!hoverable} onOpenChange={(o) => setOpen(o && !popupOpen(trigger.current))}>
      <TooltipTrigger ref={trigger} asChild>{wrap ? <span className="inline-flex max-w-full">{children}</span> : children}</TooltipTrigger>
      <TooltipContent side={side} style={!hoverable ? { pointerEvents: "none" } : undefined}>
        {title && (
          <div className="mb-0.5 flex items-center justify-between gap-3 font-semibold text-foreground">
            {title}
            {shortcut && <Kbd>{shortcut}</Kbd>}
          </div>
        )}
        {text && <div className="text-muted-foreground">{text}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

export function InfoTip({ title, text, className }: { title?: string; text: string; className?: string }) {
  return (
    <Hint title={title} text={text}>
      <Info className={cn("size-3.5 cursor-help text-muted-foreground/70 hover:text-foreground", className)} />
    </Hint>
  );
}

export function SectionTitle({ children, className, action }: { children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <div className={cn("mb-2 mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0", className)}>
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
