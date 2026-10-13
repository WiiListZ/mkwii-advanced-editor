// Shared class names for dropdown, menubar and context menus (shadcn styles).
export const menuContent =
  "z-50 min-w-48 animate-in overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-xl";
export const menuItem =
  "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
export const menuSubTrigger =
  "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground";
export const menuSeparator = "-mx-1 my-1 h-px bg-border";
export const menuLabel = "px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
export const menuShortcut = "ml-auto pl-6 text-[11px] tracking-wide text-muted-foreground";
