import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { spring } from "@/components/motion";
import { cn } from "@/lib/utils";

type Variant = "accent" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  accent: "bg-accent text-accent-foreground shadow-[0_6px_20px_-6px_hsl(var(--accent)/0.6)]",
  secondary: "bg-muted text-foreground",
  ghost: "bg-transparent text-foreground",
  destructive: "bg-destructive text-destructive-foreground shadow-[0_6px_20px_-6px_hsl(var(--destructive)/0.55)]",
};

const sizes: Record<Size, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-12 px-6 text-[15px]",
  lg: "h-14 px-7 text-base",
};

export type ButtonProps = Omit<ComponentProps<typeof motion.button>, "children"> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: ReactNode;
};

/** Pill button with a springy press. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "accent", size = "md", loading, disabled, children, type = "button", ...props }, ref) => (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      whileTap={{ scale: 0.95 }}
      transition={spring.bouncy}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-full font-bold tracking-tight transition-[opacity,background-color] duration-200 disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : children}
    </motion.button>
  ),
);
Button.displayName = "Button";

type IconButtonProps = Omit<ComponentProps<typeof motion.button>, "children"> & {
  label: string;
  variant?: "glass" | "muted" | "ghost" | "accent";
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
};

/** Round icon-only button. `label` is required for screen readers. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, variant = "muted", size = "md", type = "button", children, ...props }, ref) => (
    <motion.button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.84 }}
      transition={spring.bouncy}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center rounded-full text-foreground disabled:opacity-40",
        size === "sm" && "h-9 w-9",
        size === "md" && "h-11 w-11",
        size === "lg" && "h-14 w-14",
        variant === "glass" && "glass",
        variant === "muted" && "bg-muted",
        variant === "accent" && "bg-accent text-accent-foreground shadow-[0_6px_20px_-6px_hsl(var(--accent)/0.6)]",
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  ),
);
IconButton.displayName = "IconButton";
