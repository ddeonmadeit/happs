import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { usePush } from "@/contexts/PushContext";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Spinner } from "@/components/ui/Spinner";

/** Settings row for turning push notifications on/off. */
export function PushToggle() {
  const { isSupported, needsInstall, isSubscribed, permission, isLoading, subscribe, unsubscribe } = usePush();

  let description = isSubscribed ? "Messages and new happs nearby" : "Get alerts for messages and nearby happs";
  if (needsInstall) description = "Add The Happs to your Home Screen to enable";
  else if (!isSupported) description = "Not available in this browser";
  else if (permission === "denied") description = "Blocked — allow notifications in your browser settings";

  const disabled = !isSupported || permission === "denied";

  const toggle = async (next: boolean) => {
    const ok = next ? await subscribe() : await unsubscribe();
    if (!ok && next) toast.error("Couldn't turn on notifications");
  };

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
        {disabled ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">Notifications</p>
        <p className="text-sm text-muted-foreground">
          {description}
          {needsInstall && (
            <>
              {" · "}
              <Link to="/install" className="font-medium text-accent">
                How?
              </Link>
            </>
          )}
        </p>
      </div>
      {isLoading ? (
        <Spinner className="h-5 w-5" />
      ) : (
        <Switch label="Notifications" checked={isSubscribed} disabled={disabled} onCheckedChange={toggle} />
      )}
    </div>
  );
}

const DISMISS_KEY = "push-banner-dismissed";

/** One-time prompt on the map. */
export function PushBanner() {
  const { isSupported, isSubscribed, permission, isLoading, subscribe } = usePush();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "true";
    } catch {
      return false;
    }
  });

  if (!isSupported || isSubscribed || permission === "denied" || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div className="glass pointer-events-auto flex animate-fade-up items-center gap-3 rounded-3xl p-3 pl-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <Bell className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">Stay in the loop</p>
        <p className="text-xs text-muted-foreground">Get notified about nearby happs</p>
      </div>
      <Button size="sm" variant="ghost" onClick={dismiss} className="px-3 text-muted-foreground">
        Later
      </Button>
      <Button
        size="sm"
        loading={isLoading}
        onClick={async () => {
          if (await subscribe()) toast.success("Notifications on");
        }}
      >
        Enable
      </Button>
    </div>
  );
}
