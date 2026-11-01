import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    position="bottom-right"
    offset={36}
    toastOptions={{
      classNames: {
        toast: "group !bg-popover !text-popover-foreground !border-border !shadow-xl !text-[13px]",
        description: "!text-muted-foreground",
        // Modal dialogs disable pointer events on body; notification buttons stay clickable.
        actionButton: "!pointer-events-auto !bg-primary !text-primary-foreground",
        cancelButton: "!pointer-events-auto !bg-muted !text-muted-foreground",
        closeButton: "!pointer-events-auto",
      },
    }}
    {...props}
  />
);

export { Toaster };
