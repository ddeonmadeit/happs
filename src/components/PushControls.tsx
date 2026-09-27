import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellOff, X } from "lucide-react";
import { toast } from "sonner";
import { usePush } from "@/contexts/PushContext";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Spinner } from "@/components/ui/Spinner";
import { spring } from "@/components/motion";

/** Settings row for turning push notifications on/off. */
export function PushToggle() {
  const { isSupported, needsInstall, isSubscribed, permission, isLoading, subscribe, unsubscribe } = usePush();

  let description = "Messages and new happs nearby";
  if (needsInstall) description = "Add The Happs to your Home Screen first";
  else if (!isSupported) description = "Not available here yet";
  else if (permission === "denied") description = "Blocked in your settings";

  const disabled = !isSupported || permission === "denied";

  const toggle = async (next: boolean) => {
    const ok = next ? await subscribe() : await unsubscribe();
    if (!ok && next) toast.error("Couldn't turn on notifications");
  };

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        {disabled ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold">Notifications</p>
        <p className="text-sm text-muted-foreground">
          {description}
          {needsInstall && (
            <>
              {" · "}
              <Link to="/install" className="font-semibold text-accent">
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

/** One-time nudge on the map. */
export function PushBanner() {
  const { isSupported, isSubscribed, permission, isLoading, subscribe } = usePush();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "true";
    } catch {
      return false;
    }
  });

  const show = isSupported && !isSubscribed && permission !== "denied" && !dismissed;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 40, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.9 }}
          transition={spring.bouncy}
          className="glass flex items-center gap-3 rounded-4xl p-2.5 pl-3"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Bell className="h-5 w-5" />
          </span>
          <p className="min-w-0 flex-1 text-sm font-semibold leading-tight">Get pinged about happs near you</p>
          <Button
            size="sm"
            loading={isLoading}
            onClick={async () => {
              if (await subscribe()) toast.success("Notifications on");
            }}
          >
            Turn on
          </Button>
          <button type="button" aria-label="Dismiss" onClick={dismiss} className="p-1.5 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
