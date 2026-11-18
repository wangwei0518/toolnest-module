import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const [small, setSmall] = useState(
    () => matchMedia("(max-width:767px)").matches,
  );
  useEffect(() => {
    const q = matchMedia("(max-width:767px)");
    const update = () => setSmall(q.matches);
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  if (small)
    return (
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      >
        <SheetContent
          side="bottom"
          className="tn-temporary-transfer max-h-[92svh] rounded-t-xl"
        >
          <SheetHeader className="shrink-0 pr-14">
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          <div className="mx-6 flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto px-1 pt-1 pb-6">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="tn-temporary-transfer tn-transfer-modal max-h-[90svh] max-w-xl">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-1">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
