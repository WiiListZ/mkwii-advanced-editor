import * as React from "react";
import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { menuContent, menuItem, menuLabel, menuSeparator, menuShortcut, menuSubTrigger } from "./menu-styles";

const MenubarMenu = MenubarPrimitive.Menu;
const MenubarSub = MenubarPrimitive.Sub;

const Menubar = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Root>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>>(
  ({ className, ...props }, ref) => <MenubarPrimitive.Root ref={ref} className={cn("flex h-8 items-center gap-0.5", className)} {...props} />,
);
Menubar.displayName = MenubarPrimitive.Root.displayName;

const MenubarTrigger = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>>(
  ({ className, ...props }, ref) => (
    <MenubarPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex cursor-pointer select-none items-center rounded-sm px-2.5 py-1 text-[13px] text-foreground/90 outline-none focus:bg-accent data-[state=open]:bg-accent hover:bg-accent",
        className,
      )}
      {...props}
    />
  ),
);
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

const MenubarSubTrigger = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger>>(
  ({ className, children, ...props }, ref) => (
    <MenubarPrimitive.SubTrigger ref={ref} className={cn(menuSubTrigger, className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </MenubarPrimitive.SubTrigger>
  ),
);
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName;

const MenubarSubContent = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.SubContent>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>>(
  ({ className, ...props }, ref) => (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.SubContent ref={ref} className={cn(menuContent, className)} {...props} />
    </MenubarPrimitive.Portal>
  ),
);
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName;

const MenubarContent = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Content>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>>(
  ({ className, align = "start", alignOffset = -4, sideOffset = 6, ...props }, ref) => (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content ref={ref} align={align} alignOffset={alignOffset} sideOffset={sideOffset} className={cn(menuContent, "min-w-56", className)} {...props} />
    </MenubarPrimitive.Portal>
  ),
);
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

const MenubarItem = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Item>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item>>(
  ({ className, ...props }, ref) => <MenubarPrimitive.Item ref={ref} className={cn(menuItem, className)} {...props} />,
);
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

const MenubarCheckboxItem = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>>(
  ({ className, children, checked, ...props }, ref) => (
    <MenubarPrimitive.CheckboxItem ref={ref} className={cn(menuItem, "pl-8", className)} checked={checked} {...props}>
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <MenubarPrimitive.ItemIndicator>
          <Check className="!text-foreground" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  ),
);
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName;

const MenubarLabel = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Label>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label>>(
  ({ className, ...props }, ref) => <MenubarPrimitive.Label ref={ref} className={cn(menuLabel, className)} {...props} />,
);
MenubarLabel.displayName = MenubarPrimitive.Label.displayName;

const MenubarSeparator = React.forwardRef<React.ElementRef<typeof MenubarPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>>(
  ({ className, ...props }, ref) => <MenubarPrimitive.Separator ref={ref} className={cn(menuSeparator, className)} {...props} />,
);
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName;

const MenubarShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn(menuShortcut, className)} {...props} />;

export {
  Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarLabel, MenubarCheckboxItem,
  MenubarSub, MenubarSubTrigger, MenubarSubContent, MenubarShortcut,
};
