import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** "sheet" slides up from the bottom, "dialog" pops in centred. */
  variant?: "sheet" | "dialog";
  className?: string;
  hideClose?: boolean;
};

/** Accessible modal with enter/exit animations, Esc to close and scroll lock. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  variant = "sheet",
  className,
  hideClose,
}: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 250);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      clearTimeout(focusTimer);
      previous?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  const isDialog = variant === "dialog";

  return createPortal(
    <div className={cn("fixed inset-0 z-[100] flex justify-center", isDialog ? "items-center p-6" : "items-end sm:items-center sm:p-6")}>
      <div
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-250",
          visible ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative w-full bg-card text-card-foreground shadow-2xl outline-none transition-all duration-300 ease-smooth",
          isDialog
            ? cn("max-w-sm rounded-3xl p-6", visible ? "scale-100 opacity-100" : "scale-95 opacity-0")
            : cn(
                "max-h-[88dvh] max-w-lg overflow-y-auto rounded-t-[28px] px-5 pb-safe pt-3 sm:rounded-3xl sm:pb-6",
                visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 sm:translate-y-4",
              ),
          className,
        )}
      >
        {!isDialog && <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/25 sm:hidden" />}
        {(title || !hideClose) && (
          <div className={cn("mb-4 flex items-start gap-3", isDialog && "flex-col items-center text-center")}>
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            {!hideClose && !isDialog && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/70 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
