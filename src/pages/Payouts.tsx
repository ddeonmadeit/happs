import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { BadgeCheck, Banknote, Clock, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Screen, spring } from "@/components/motion";
import { openPayoutDashboard, payoutStatus, startPayoutSetup, type PayoutStatus } from "@/lib/tickets";
import { errorMessage } from "@/lib/utils";

/**
 * Getting paid for tickets. One button to Stripe's secure setup (bank
 * details and ID, about two minutes); Stripe sends hosts back here after.
 */
export default function Payouts() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await payoutStatus());
    } catch (err) {
      toast.error(errorMessage(err, "Couldn’t check your payouts"));
      setStatus({ connected: false, payouts_enabled: false, details_submitted: false, due: 0 });
    }
  }, []);

  const setup = useCallback(async () => {
    setBusy(true);
    try {
      await startPayoutSetup();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn’t open payout setup"));
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Stripe's setup link expired: make a fresh one and carry on.
    if (params.get("refresh")) {
      setParams({}, { replace: true });
      setup();
      return;
    }
    if (params.get("done")) setParams({}, { replace: true });
    refresh();
  }, [params, setParams, refresh, setup]);

  const dashboard = async () => {
    setBusy(true);
    try {
      await openPayoutDashboard();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  const state = !status
    ? "loading"
    : !status.connected
      ? "new"
      : status.payouts_enabled
        ? "ready"
        : status.due > 0 || !status.details_submitted
          ? "more"
          : "checking";

  return (
    <Screen>
      <TopBar title="Payouts" />
      <main className="scroll-area mx-auto flex w-full max-w-md flex-1 flex-col px-6 pb-safe">
        {state === "loading" ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <motion.div
            key={state}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.gentle}
            className="flex flex-1 flex-col items-center justify-center gap-5 text-center"
          >
            <span className="glitch-bg flex h-20 w-20 items-center justify-center rounded-full text-accent-foreground">
              {state === "ready" ? (
                <BadgeCheck className="h-10 w-10" />
              ) : state === "checking" ? (
                <Clock className="h-10 w-10" />
              ) : (
                <Banknote className="h-10 w-10" />
              )}
            </span>

            {state === "new" && (
              <>
                <h2 className="text-2xl font-extrabold tracking-tight">Get paid for tickets</h2>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  Stripe sends your ticket money straight to your bank. Setup takes about 2 minutes. Have your bank
                  details handy, and Stripe may ask for ID.
                </p>
                <Button size="lg" className="w-full" onClick={setup} loading={busy}>
                  Set up payouts
                </Button>
              </>
            )}

            {state === "more" && (
              <>
                <h2 className="text-2xl font-extrabold tracking-tight">Almost there</h2>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  Stripe needs a couple more details before it can pay you.
                </p>
                <Button size="lg" className="w-full" onClick={setup} loading={busy}>
                  Finish setup
                </Button>
              </>
            )}

            {state === "checking" && (
              <>
                <h2 className="text-2xl font-extrabold tracking-tight">Stripe is checking your details</h2>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  This usually takes a few minutes. You can keep selling tickets in the meantime.
                </p>
                <Button variant="secondary" size="lg" className="w-full" onClick={refresh}>
                  <RefreshCw className="h-4 w-4" /> Check again
                </Button>
              </>
            )}

            {state === "ready" && (
              <>
                <h2 className="text-2xl font-extrabold tracking-tight">You’re all set</h2>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  You’re paid for each happ 24 hours after it starts, straight to your bank.
                </p>
                <Button size="lg" className="w-full" onClick={() => navigate("/map")}>
                  Back to the map
                </Button>
                <Button variant="ghost" className="w-full" onClick={dashboard} loading={busy}>
                  <ExternalLink className="h-4 w-4" /> Stripe dashboard
                </Button>
              </>
            )}

            <p className="text-xs leading-relaxed text-muted-foreground/80">
              The Happs keeps 13% of each ticket, with card fees included. Buyers get a full refund until 24 hours
              before your happ; you’re paid 24 hours after it starts.
            </p>
          </motion.div>
        )}
      </main>
    </Screen>
  );
}
