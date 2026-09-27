import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { HappsMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Screen, spring } from "@/components/motion";

export default function NotFound() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <Screen className="items-center justify-center gap-5 p-8 text-center">
      <motion.div
        initial={{ rotate: 0 }}
        animate={{ rotate: [0, -12, 10, -6, 45] }}
        transition={{ duration: 1.1, ease: "easeInOut" }}
      >
        <HappsMark className="h-14 w-14 text-muted-foreground/50" />
      </motion.div>
      <div className="space-y-1">
        <motion.p initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy} className="font-brunson text-7xl text-accent">
          404
        </motion.p>
        <p className="text-lg font-extrabold">Nothing happening here</p>
        <p className="max-w-xs break-all text-sm text-muted-foreground">{pathname} doesn’t exist.</p>
      </div>
      <Button onClick={() => navigate("/", { replace: true })}>Go home</Button>
    </Screen>
  );
}
