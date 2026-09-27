import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Share } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Button } from "@/components/ui/Button";
import { HappsMark, Wordmark } from "@/components/Logo";
import { spring } from "@/components/motion";

/** First screen for signed-out visitors. Signed-in users go straight to the map. */
export default function Welcome() {
  const navigate = useNavigate();
  const { isInstalled, isIOS } = useInstallPrompt();

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="absolute inset-0 z-40 flex flex-col items-center overflow-hidden bg-background px-6 pb-safe pt-safe"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[36%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.13] blur-3xl"
      />

      <div className="relative flex flex-1 flex-col items-center justify-center">
        <motion.div
          initial={{ scale: 0, rotate: -120 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ ...spring.bouncy, delay: 0.1 }}
        >
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="flex h-28 w-28 items-center justify-center rounded-[34px] bg-accent text-accent-foreground shadow-[0_20px_50px_-12px_hsl(var(--accent)/0.65)]"
          >
            <HappsMark className="h-14 w-14" />
          </motion.div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.gentle, delay: 0.3 }}
          className="mt-10 text-center text-[clamp(3.8rem,18vw,5.5rem)] text-accent"
        >
          <Wordmark />
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.gentle, delay: 0.42 }}
          className="mt-3 max-w-[18rem] text-center text-[17px] font-medium leading-snug text-muted-foreground"
        >
          See what’s happening around you, right now.
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.snappy, delay: 0.55 }}
        className="relative w-full max-w-sm space-y-3 pb-2"
      >
        <Button size="lg" className="w-full text-[17px]" onClick={() => navigate("/auth", { state: { mode: "signup" } })}>
          Get started
        </Button>
        <Button variant="secondary" size="lg" className="w-full" onClick={() => navigate("/auth")}>
          I have an account
        </Button>
        {isIOS && !isInstalled && (
          <button
            type="button"
            onClick={() => navigate("/install")}
            className="flex w-full items-center justify-center gap-1.5 pt-2 text-sm font-medium text-muted-foreground"
          >
            <Share className="h-4 w-4" /> Add to Home Screen for the full app
          </button>
        )}
      </motion.div>
    </motion.main>
  );
}
