import { useNavigate } from "react-router-dom";
import { ChevronRight, LogOut, Smartphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Sheet } from "@/components/ui/Sheet";
import { PushToggle } from "@/components/PushControls";
import { Pressable } from "@/components/motion";

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { isInstalled } = useInstallPrompt();

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-3 pb-3 pt-2">
        <div className="rounded-3xl bg-muted/60 p-3">
          <PushToggle />
        </div>

        {!isInstalled && (
          <Pressable
            pressScale={0.97}
            onClick={() => {
              onClose();
              navigate("/install");
            }}
            className="flex w-full items-center gap-3 rounded-3xl bg-muted/60 p-3 text-left"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Smartphone className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-bold">Add to Home Screen</span>
              <span className="block text-sm text-muted-foreground">Full-screen, like a real app</span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </Pressable>
        )}

        <Pressable
          pressScale={0.97}
          onClick={async () => {
            onClose();
            await signOut();
            navigate("/", { replace: true });
          }}
          className="flex w-full items-center gap-3 rounded-3xl bg-muted/60 p-3 text-left text-destructive"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/15">
            <LogOut className="h-5 w-5" />
          </span>
          <span className="flex-1 text-[15px] font-bold">Sign out</span>
        </Pressable>
      </div>
    </Sheet>
  );
}
