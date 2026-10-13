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
        actionButton: "!bg-primary !text-primary-foreground",
        cancelButton: "!bg-muted !text-muted-foreground",
      },
    }}
    {...props}
  />
);

export { Toaster };
