import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        // On: blue track with a white knob. Off: dark track with a visible border and a grey knob.
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border shadow-inner transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-sky-400 data-[state=checked]:bg-sky-500 data-[state=unchecked]:border-white/20 data-[state=unchecked]:bg-zinc-800 hover:data-[state=unchecked]:border-white/35",
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb className="pointer-events-none block size-3.5 rounded-full shadow-md ring-0 transition-all data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-white data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-zinc-400" />
    </SwitchPrimitives.Root>
  ),
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
