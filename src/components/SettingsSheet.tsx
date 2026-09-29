import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { Banknote, ChevronRight, LogOut, Smartphone, TicketIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useTicketing } from "@/hooks/useTicketing";
import { Sheet } from "@/components/ui/Sheet";
import { PushToggle } from "@/components/PushControls";
import { Pressable } from "@/components/motion";

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { isInstalled } = useInstallPrompt();
  const ticketing = useTicketing();
  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-3 pb-3 pt-2">
        <div className="rounded-3xl bg-muted/60 p-3">
          <PushToggle />
        </div>

        {ticketing && (
          <>
            <Row icon={<TicketIcon className="h-5 w-5" />} title="Tickets" text="Tickets you’ve bought" onClick={() => go("/tickets")} />
            <Row icon={<Banknote className="h-5 w-5" />} title="Payouts" text="Get paid for your happs" onClick={() => go("/payouts")} />
          </>
        )}

        {!isInstalled && (
          <Row
            icon={<Smartphone className="h-5 w-5" />}
            title="Add to Home Screen"
            text="Full-screen, like a real app"
            onClick={() => go("/install")}
          />
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

function Row({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <Pressable pressScale={0.97} onClick={onClick} className="flex w-full items-center gap-3 rounded-3xl bg-muted/60 p-3 text-left">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">{icon}</span>
      <span className="flex-1">
        <span className="block text-[15px] font-bold">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </Pressable>
  );
}
