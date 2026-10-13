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
// Tooltips close on any click and never open while a menu, list or dialog is open
// (Radix Select/Menu triggers cancel pointerdown, which would otherwise leave the tooltip on top).
const popupOpen = () => !!document.querySelector("[role=listbox], [role=menu], [role=dialog], [role=alertdialog]");

export function Hint({ title, text, shortcut, side, wrap, children }: { title?: string; text?: string; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; wrap?: boolean; children: React.ReactElement }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", close, true); };
  }, [open]);
  if (!title && !text) return children;
  return (
    <Tooltip open={open} onOpenChange={(o) => setOpen(o && !popupOpen())}>
      <TooltipTrigger asChild>{wrap ? <span className="inline-flex">{children}</span> : children}</TooltipTrigger>
      <TooltipContent side={side}>
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
