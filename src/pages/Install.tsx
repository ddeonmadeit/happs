import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Download, MoreVertical, PlusSquare, Share } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Button } from "@/components/ui/Button";
import { HappsMark, Wordmark } from "@/components/Logo";

function Step({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">{icon}</span>
      <span>
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
    </li>
  );
}

export default function Install() {
  const navigate = useNavigate();
  const { isInstallable, isInstalled, isIOS, promptInstall } = useInstallPrompt();

  return (
    <div className="flex min-h-dvh-screen items-center justify-center bg-background px-6 pb-safe pt-safe">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-4">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-[22px] bg-accent text-accent-foreground shadow-xl shadow-accent/25">
            <HappsMark className="h-11 w-11" />
          </span>
          <Wordmark className="block text-5xl text-accent" />
        </div>

        {isInstalled ? (
          <div className="space-y-3">
            <CheckCircle2 className="mx-auto h-10 w-10 text-live" />
            <h1 className="text-2xl font-bold tracking-tight">You’re all set</h1>
            <p className="text-muted-foreground">The Happs is installed. Open it from your home screen any time.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">Install The Happs</h1>
              <p className="text-muted-foreground">Full-screen, quicker to open, and needed for notifications on iPhone.</p>
            </div>

            {isIOS ? (
              <ol className="space-y-4 rounded-3xl bg-card p-5 text-left shadow-sm">
                <Step icon={<Share className="h-5 w-5" />} title="1. Tap Share" text="In Safari’s toolbar" />
                <Step icon={<PlusSquare className="h-5 w-5" />} title="2. Add to Home Screen" text="Scroll down the share sheet" />
                <Step icon={<CheckCircle2 className="h-5 w-5" />} title="3. Tap Add" text="The Happs appears on your home screen" />
              </ol>
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
              <ol className="space-y-4 rounded-3xl bg-card p-5 text-left shadow-sm">
                <Step icon={<MoreVertical className="h-5 w-5" />} title="1. Open the menu" text="The ⋮ button in your browser" />
                <Step icon={<Download className="h-5 w-5" />} title="2. Install app" text="Or “Add to Home screen”" />
              </ol>
            )}
          </>
        )}

        <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => navigate("/map")}>
          {isInstalled ? "Continue" : "Continue in browser"}
        </Button>
      </div>
    </div>
  );
}
