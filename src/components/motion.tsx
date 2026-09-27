import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { motion, type Transition, type Variants } from "motion/react";
import { cn } from "@/lib/utils";

/** Springs used everywhere, so the whole app moves with the same personality. */
export const spring = {
  /** Playful overshoot — buttons, pops, markers. */
  bouncy: { type: "spring", stiffness: 520, damping: 20, mass: 0.8 } satisfies Transition,
  /** Quick settle with a hint of bounce — sheets, cards. */
  snappy: { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } satisfies Transition,
  /** Soft — screen entrances. */
  gentle: { type: "spring", stiffness: 260, damping: 28 } satisfies Transition,
};

type PressableProps = ComponentProps<typeof motion.button> & { pressScale?: number };

/** A button that squishes when pressed and springs back. */
export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(
  ({ pressScale = 0.9, type = "button", className, ...props }, ref) => (
    <motion.button
      ref={ref}
      type={type}
      whileTap={{ scale: pressScale }}
      transition={spring.bouncy}
      className={cn("select-none", className)}
      {...props}
    />
  ),
);
Pressable.displayName = "Pressable";

/**
 * Full-screen page. Springs up over the map when it opens and drops away
 * when it closes.
 */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 36, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 48, scale: 0.97, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
      transition={spring.gentle}
      className={cn("absolute inset-0 z-40 flex flex-col overflow-hidden bg-background", className)}
    >
      {children}
    </motion.div>
  );
}

/** Children pop in one after another. Use with <StaggerItem>. */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring.snappy },
};

export function Stagger({ children, className, as = "ul" }: { children: ReactNode; className?: string; as?: "ul" | "div" }) {
  const Comp = as === "ul" ? motion.ul : motion.div;
  return (
    <Comp variants={staggerParent} initial="hidden" animate="show" className={className}>
      {children}
    </Comp>
  );
}

export function StaggerItem({ children, className, as = "li" }: { children: ReactNode; className?: string; as?: "li" | "div" }) {
  const Comp = as === "li" ? motion.li : motion.div;
  return (
    <Comp variants={staggerChild} className={className}>
      {children}
    </Comp>
  );
}
