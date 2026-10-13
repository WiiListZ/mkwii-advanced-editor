import * as React from "react";
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup className={cn("flex size-full data-[panel-group-direction=vertical]:flex-col", className)} {...props} />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle>) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-primary/60 data-[resize-handle-state=drag]:bg-primary focus-visible:outline-none",
      className,
    )}
    {...props}
  />
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
