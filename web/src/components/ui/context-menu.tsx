import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";
import { menuContent, menuItem, menuSeparator, menuShortcut } from "./menu-styles";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuContent = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>>(
  ({ className, ...props }, ref) => (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content ref={ref} className={cn(menuContent, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  ),
);
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Item>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>>(
  ({ className, ...props }, ref) => <ContextMenuPrimitive.Item ref={ref} className={cn(menuItem, className)} {...props} />,
);
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuSeparator = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>>(
  ({ className, ...props }, ref) => <ContextMenuPrimitive.Separator ref={ref} className={cn(menuSeparator, className)} {...props} />,
);
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn(menuShortcut, className)} {...props} />;

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut };
