import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: { default: "bg-transparent text-muted-foreground", outline: "border border-input bg-transparent text-muted-foreground shadow-sm" },
      size: { default: "h-8 px-2.5", sm: "h-7 px-2", lg: "h-9 px-3" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => <TogglePrimitive.Root ref={ref} className={cn(toggleVariants({ variant, size, className }))} {...props} />);
Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
