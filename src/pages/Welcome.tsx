import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { HappsMark, Wordmark } from "@/components/Logo";
import { spring } from "@/components/motion";
import { Radar } from "@/components/Radar";

/** First screen for signed-out visitors. Signed-in users go straight to the map. */
export default function Welcome() {
  const navigate = useNavigate();
  const markRef = useRef<HTMLDivElement>(null);

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="absolute inset-0 z-40 flex flex-col items-center overflow-hidden bg-app px-6 pb-safe pt-safe"
    >
      {/* A radar sweep turning around the logo. */}
      <Radar anchor={markRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      <div className="relative flex flex-1 flex-col items-center justify-center">
        <motion.div
          initial={{ scale: 0, rotate: -120 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ ...spring.bouncy, delay: 0.1 }}
          className="relative"
        >
          {/* A faint warm glow behind the logo, drawn as a gradient: a blurred
              element here got clipped into a hard band on iPhone. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,hsl(var(--accent)/0.1),hsl(var(--accent)/0.035)_55%,transparent)]"
          />
          <motion.div
            ref={markRef}
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="relative"
          >
            <HappsMark glitch className="h-24 w-24" />
          </motion.div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.gentle, delay: 0.3 }}
          className="mt-1 text-center text-[clamp(3.8rem,18vw,5.5rem)] leading-none"
        >
          <Wordmark />
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.gentle, delay: 0.42 }}
          className="mt-1.5 whitespace-nowrap text-center text-[clamp(1rem,4.6vw,1.2rem)] font-semibold text-cream"
        >
          What’s happening in Sydney?
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
      </motion.div>
    </motion.main>
  );
}
