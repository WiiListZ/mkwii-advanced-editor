import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Overlay data-modal-overlay className={cn("fixed inset-0 z-50 bg-black/60 animate-[fade-in_150ms_ease-out] data-[state=closed]:animate-[fade-out_140ms_ease-in_forwards] data-[state=closed]:pointer-events-none!", className)} {...props} ref={ref} />,
);
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>>(
  ({ className, ...props }, ref) => (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn("fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 animate-in data-[state=closed]:animate-out data-[state=closed]:pointer-events-none! gap-4 rounded-xl border bg-card p-5 shadow-2xl", className)}
        {...props}
        // The title bar stays usable above the dialog (move, minimize, close the window).
        onFocusOutside={(event) => {
          if ((event.target as Element | null)?.closest?.("[data-window-chrome]")) event.preventDefault();
          props.onFocusOutside?.(event);
        }}
      />
    </AlertDialogPortal>
  ),
);
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-2", className)} {...props} />;
const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex justify-end gap-2", className)} {...props} />;

const AlertDialogTitle = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Title ref={ref} className={cn("text-base font-semibold", className)} {...props} />,
);
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Description ref={ref} className={cn("text-[13px] leading-relaxed text-muted-foreground", className)} {...props} />,
);
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants({ variant: destructive ? "destructive" : "default" }), className)} {...props} />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Cancel>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>>(
  ({ className, ...props }, ref) => <AlertDialogPrimitive.Cancel ref={ref} className={cn(buttonVariants({ variant: "outline" }), className)} {...props} />,
);
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel };
