import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    position="bottom-right"
    offset={36}
    // Every notification has an X (top right) to close it before it times out.
    closeButton
    toastOptions={{
      classNames: {
        toast: "group !bg-popover !text-popover-foreground !border-border !shadow-xl !text-[13px] !pr-8",
        description: "!text-muted-foreground",
        // Modal dialogs disable pointer events on body; notification buttons stay clickable.
        actionButton: "!pointer-events-auto !bg-primary !text-primary-foreground",
        cancelButton: "!pointer-events-auto !bg-muted !text-muted-foreground",
        closeButton: "!pointer-events-auto !left-auto !right-1.5 !top-1.5 !size-5 !transform-none !rounded !border-0 !bg-transparent !text-muted-foreground hover:!bg-accent hover:!text-foreground",
      },
    }}
    {...props}
  />
);

export { Toaster };
