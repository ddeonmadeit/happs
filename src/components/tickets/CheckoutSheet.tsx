import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Appearance, Stripe } from "@stripe/stripe-js";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, Check, Lock, TicketIcon } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { spring } from "@/components/motion";
import { TicketQR } from "@/components/tickets/TicketQR";
import {
  fetchTicket,
  formatCode,
  formatPrice,
  REFUND_CUTOFF_HOURS,
  startCheckout,
  STRIPE_PUBLISHABLE_KEY,
  waitForTicket,
  type Checkout,
} from "@/lib/tickets";
import { appUrl, errorMessage, formatStart } from "@/lib/utils";

let stripePromise: Promise<Stripe | null> | null = null;
function loadStripeOnce() {
  stripePromise ??= import("@stripe/stripe-js").then(({ loadStripe }) => loadStripe(STRIPE_PUBLISHABLE_KEY ?? ""));
  return stripePromise;
}

/** Stripe's payment fields, dressed in the app's colours. */
const APPEARANCE: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#eb771e",
    colorBackground: "#272421",
    colorText: "#f4efe6",
    colorTextSecondary: "#a39a8f",
    colorDanger: "#ef4444",
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    borderRadius: "16px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid rgba(255,255,255,0.06)", boxShadow: "none" },
    ".Tab": { border: "1px solid rgba(255,255,255,0.06)" },
  },
};

type HappForCheckout = { id: string; name: string; price_cents: number; currency: string; startsAt: string };

type Props = {
  open: boolean;
  happ: HappForCheckout;
  onClose: () => void;
  /** Called once the ticket is confirmed. */
  onPaid: (ticketId: string) => void;
};

type Stage =
  | { kind: "loading" }
  | { kind: "pay"; checkout: Checkout }
  | { kind: "confirming"; ticketId: string }
  | { kind: "done"; ticketId: string; code: string }
  | { kind: "error"; message: string };

/**
 * Buying a ticket without leaving the app: Apple Pay / Google Pay in one tap,
 * or a card, in a sheet over the happ.
 */
export function CheckoutSheet({ open, happ, onClose, onPaid }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [stripe, setStripe] = useState<Stripe | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStage({ kind: "loading" });
    Promise.all([loadStripeOnce(), startCheckout(happ.id)])
      .then(([s, checkout]) => {
        if (cancelled) return;
        if (!s) throw new Error("Payments couldn't load. Check your connection and try again.");
        setStripe(s);
        setStage({ kind: "pay", checkout });
      })
      .catch((err) => !cancelled && setStage({ kind: "error", message: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [open, happ.id]);

  const confirmed = async (ticketId: string) => {
    setStage({ kind: "confirming", ticketId });
    await waitForTicket(ticketId);
    const ticket = await fetchTicket(ticketId);
    setStage({ kind: "done", ticketId, code: ticket?.code ?? "" });
    onPaid(ticketId);
  };

  const options = useMemo(
    () => (stage.kind === "pay" ? { clientSecret: stage.checkout.client_secret, appearance: APPEARANCE } : null),
    [stage],
  );

  return (
    <Sheet open={open} onClose={onClose} title={stage.kind === "done" ? "You're in!" : "Get a ticket"}>
      <div className="space-y-4 pb-3">
        {stage.kind !== "done" && (
          <div className="flex items-center gap-3 rounded-3xl bg-muted/60 px-4 py-3">
            <TicketIcon className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">{happ.name}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> {formatStart(happ.startsAt)}
              </p>
            </div>
            <span className="text-lg font-extrabold">{formatPrice(happ.price_cents, happ.currency)}</span>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {stage.kind === "loading" && (
            <Fade key="loading" className="flex justify-center py-12">
              <Spinner />
            </Fade>
          )}

          {stage.kind === "error" && (
            <Fade key="error" className="space-y-4 py-4 text-center">
              <p className="text-[15px] text-muted-foreground">{stage.message}</p>
              <Button variant="secondary" className="w-full" onClick={onClose}>
                Close
              </Button>
            </Fade>
          )}

          {stage.kind === "pay" && stripe && options && (
            <Fade key="pay">
              <Elements stripe={stripe} options={options}>
                <PayForm
                  checkout={stage.checkout}
                  onConfirmed={() => confirmed(stage.checkout.ticket_id)}
                />
              </Elements>
            </Fade>
          )}

          {stage.kind === "confirming" && (
            <Fade key="confirming" className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <Spinner />
              <p className="text-sm">Confirming your payment…</p>
            </Fade>
          )}

          {stage.kind === "done" && (
            <Fade key="done" className="space-y-4 text-center">
              <motion.div
                initial={{ scale: 0.4, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={spring.bouncy}
                className="mx-auto w-56"
              >
                {stage.code ? (
                  <TicketQR code={stage.code} />
                ) : (
                  <div className="glitch-bg mx-auto flex h-20 w-20 items-center justify-center rounded-full text-accent-foreground">
                    <Check className="h-10 w-10" strokeWidth={3} />
                  </div>
                )}
              </motion.div>
              {stage.code && <p className="font-mono text-lg font-bold tracking-widest">{formatCode(stage.code)}</p>}
              <p className="text-[15px] text-muted-foreground">
                Your ticket for <span className="font-bold text-foreground">{happ.name}</span> is saved in Tickets.
                Show this code at the door.
              </p>
              <Button className="w-full" onClick={onClose}>
                Done
              </Button>
            </Fade>
          )}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}

function PayForm({ checkout, onConfirmed }: { checkout: Checkout; onConfirmed: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState(false);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: payError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: appUrl(`tickets?ticket=${checkout.ticket_id}`) },
    });
    if (payError) {
      setError(payError.message ?? "Payment didn't go through");
      setBusy(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      onConfirmed();
    } else {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ExpressCheckoutElement
        options={{ buttonHeight: 52, buttonTheme: { applePay: "white", googlePay: "white" } }}
        onReady={({ availablePaymentMethods }) => setWallets(Boolean(availablePaymentMethods))}
        onConfirm={pay}
      />
      {wallets && (
        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or pay by card <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <PaymentElement
        options={{ layout: "tabs", wallets: { applePay: "never", googlePay: "never" } }}
        onLoadError={({ error: loadError }) => setError(loadError.message ?? "Card payments couldn't load. Try again.")}
      />
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
      <Button size="lg" className="w-full" onClick={pay} loading={busy} disabled={!stripe}>
        Pay {formatPrice(checkout.amount_cents, checkout.currency)}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock className="h-3 w-3" /> Secure payment by Stripe · Full refund until {REFUND_CUTOFF_HOURS} hours before
      </p>
    </div>
  );
}

function Fade({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={spring.snappy}
      className={className}
    >
      {children}
    </motion.div>
  );
}
