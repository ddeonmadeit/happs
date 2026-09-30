import { motion } from "motion/react";
import { toast } from "sonner";
import { spring } from "@/components/motion";
import { INTERESTS, MAX_INTERESTS } from "@/lib/interests";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
};

/** Tap the things you're into (up to 10). */
export function InterestPicker({ value, onChange, className }: Props) {
  const selected = new Set(value);
  const full = value.length >= MAX_INTERESTS;

  const toggle = (id: string) => {
    if (selected.has(id)) onChange(value.filter((v) => v !== id));
    else if (full) toast(`Pick up to ${MAX_INTERESTS}`);
    else onChange([...value, id]);
  };

  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label="Interests">
      {INTERESTS.map(({ id, label, icon: Icon }) => {
        const on = selected.has(id);
        return (
          <motion.button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(id)}
            whileTap={{ scale: 0.9 }}
            transition={spring.bouncy}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition-colors",
              on ? "glitch-bg text-accent-foreground" : "bg-muted text-foreground/80",
              !on && full && "opacity-50",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2.4} />
            {label}
          </motion.button>
        );
      })}
    </div>
  );
}

/** Read-only chips for a profile. */
export function InterestChips({ ids, className }: { ids: string[]; className?: string }) {
  if (!ids.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {ids.map((id) => {
        const item = INTERESTS.find((i) => i.id === id);
        if (!item) return null;
        const Icon = item.icon;
        return (
          <span key={id} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground/80">
            <Icon className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} />
            {item.label}
          </span>
        );
      })}
    </div>
  );
}
