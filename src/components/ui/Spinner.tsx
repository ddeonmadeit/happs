import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { HappsMark } from "@/components/Logo";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-6 w-6 animate-spin text-muted-foreground", className)} />;
}

/** Brand loader: the Happs mark gently bouncing. */
export function FullScreenLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background">
      <motion.div
        animate={{ y: [0, -14, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <HappsMark className="h-12 w-12 text-accent" />
      </motion.div>
    </div>
  );
}
