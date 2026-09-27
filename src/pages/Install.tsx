import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Download, MoreVertical, PlusSquare, Share } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Button } from "@/components/ui/Button";
import { HappsMark, Wordmark } from "@/components/Logo";
import { Screen, Stagger, StaggerItem, spring } from "@/components/motion";
import { motion } from "motion/react";

function Step({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <StaggerItem className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">{icon}</span>
      <span>
        <span className="block text-[15px] font-bold">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
    </StaggerItem>
  );
}

export default function Install() {
  const navigate = useNavigate();
  const { isInstallable, isInstalled, isIOS, promptInstall } = useInstallPrompt();

  return (
    <Screen className="items-center justify-center px-6 pb-safe pt-safe">
      <div className="scroll-area w-full max-w-sm space-y-8 text-center">
        <div className="space-y-4">
          <motion.span
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={spring.bouncy}
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-[30px] bg-accent text-accent-foreground shadow-[0_16px_40px_-10px_hsl(var(--accent)/0.6)]"
          >
            <HappsMark className="h-12 w-12" />
          </motion.span>
          <Wordmark className="block text-5xl text-accent" />
        </div>

        {isInstalled ? (
          <div className="space-y-3">
            <CheckCircle2 className="mx-auto h-10 w-10 text-accent" />
            <h1 className="text-2xl font-extrabold tracking-tight">You’re all set</h1>
            <p className="text-muted-foreground">The Happs is installed. Open it from your home screen any time.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-extrabold tracking-tight">Add to your Home Screen</h1>
              <p className="text-muted-foreground">Opens full-screen like a real app, and you’ll get notifications on iPhone.</p>
            </div>

            {isIOS ? (
              <Stagger className="space-y-4 rounded-4xl bg-card p-5 text-left">
                <Step icon={<Share className="h-5 w-5" />} title="1. Tap Share" text="The square-and-arrow button in Safari" />
                <Step icon={<PlusSquare className="h-5 w-5" />} title="2. Add to Home Screen" text="Scroll down the share sheet" />
                <Step icon={<CheckCircle2 className="h-5 w-5" />} title="3. Tap Add" text="Then open The Happs from your home screen" />
              </Stagger>
            ) : isInstallable ? (
              <div className="space-y-2">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={async () => {
                    if (await promptInstall()) navigate("/map");
                  }}
                >
                  <Download className="h-5 w-5" /> Install app
                </Button>
                <p className="text-xs text-muted-foreground">Free · no app store needed</p>
              </div>
            ) : (
              <Stagger className="space-y-4 rounded-4xl bg-card p-5 text-left">
                <Step icon={<MoreVertical className="h-5 w-5" />} title="1. Open the menu" text="The ⋮ button in your browser" />
                <Step icon={<Download className="h-5 w-5" />} title="2. Install app" text="Or “Add to Home screen”" />
              </Stagger>
            )}
          </>
        )}

        <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => navigate("/map")}>
          {isInstalled ? "Continue" : "Continue in browser"}
        </Button>
      </div>
    </Screen>
  );
}
