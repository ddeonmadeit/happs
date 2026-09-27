import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { spring } from "@/components/motion";
import { cn } from "@/lib/utils";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** "sheet" springs up from the bottom and can be swiped down; "dialog" pops in centred. */
  variant?: "sheet" | "dialog";
  /** Lighter backdrop, e.g. when the map should stay visible behind. */
  dim?: "strong" | "light";
  className?: string;
};

/**
 * Bottom sheet / dialog. Springs in, swipe down (or tap outside, or Esc) to
 * close. Dragging starts from the grab handle and header only, so scrolling
 * the content never fights the gesture.
 */
export function Sheet({ open, onClose, title, description, children, variant = "sheet", dim = "strong", className }: SheetProps) {
  const controls = useDragControls();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose();
  };

  const isDialog = variant === "dialog";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cn("fixed inset-0 z-[100] flex justify-center", isDialog ? "items-center p-6" : "items-end")}>
          <motion.div
            className={cn("absolute inset-0", dim === "light" ? "bg-black/25" : "bg-black/55")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          {isDialog ? (
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.7, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }}
              transition={spring.bouncy}
              className={cn("relative w-full max-w-sm rounded-4xl bg-card p-6 text-center shadow-2xl", className)}
            >
              {title && <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>}
              {description && <p className="mt-2 text-[15px] text-muted-foreground">{description}</p>}
              <div className={cn((title || description) && "mt-6")}>{children}</div>
            </motion.div>
          ) : (
            <motion.div
              role="dialog"
              aria-modal="true"
              drag="y"
              dragControls={controls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.04, bottom: 0.7 }}
              onDragEnd={onDragEnd}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%", transition: { type: "spring", stiffness: 420, damping: 40 } }}
              transition={spring.snappy}
              className={cn(
                "relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-4xl bg-card text-card-foreground shadow-[0_-10px_40px_rgb(0_0_0/0.4)]",
                className,
              )}
            >
              <div
                onPointerDown={(e) => controls.start(e)}
                className="shrink-0 cursor-grab touch-none px-6 pb-2 pt-3 active:cursor-grabbing"
              >
                <div className="mx-auto h-1.5 w-11 rounded-full bg-muted-foreground/30" />
                {title && <h2 className="mt-4 text-xl font-extrabold tracking-tight">{title}</h2>}
                {description && <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>}
              </div>
              <div className="scroll-area min-h-0 flex-1 px-6 pb-safe pt-2">{children}</div>
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
