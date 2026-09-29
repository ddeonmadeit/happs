import { useState } from "react";
import { CalendarClock, CheckCircle2, MapPin, Navigation } from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { TicketQR } from "@/components/tickets/TicketQR";
import { happStartsAt } from "@/lib/api";
import { directionsUrl } from "@/lib/directions";
import { formatCode, formatPrice, REFUND_CUTOFF_HOURS, refundOpen, requestRefund, type TicketWithHapp } from "@/lib/tickets";
import { cn, errorMessage, formatStart } from "@/lib/utils";

type Props = {
  ticket: TicketWithHapp | null;
  onClose: () => void;
  /** After a refund. */
  onChanged?: () => void;
};

/** One ticket: the door QR, where and when, and refunds while they're open. */
export function TicketSheet({ ticket, onClose, onChanged }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const happ = ticket?.happs;
  const startsAt = happ ? happStartsAt(happ) : null;
  const cancelled = Boolean(happ?.cancelled_at);
  const canRefund =
    ticket?.status === "valid" && !ticket.checked_in_at && !cancelled && startsAt && refundOpen(startsAt);

  const refund = async () => {
    if (!ticket) return;
    setBusy(true);
    try {
      await requestRefund(ticket.id);
      toast.success(`Refunded ${formatPrice(ticket.amount_cents, ticket.currency)}`);
      setConfirm(false);
      onChanged?.();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn’t refund this ticket"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={Boolean(ticket)} onClose={onClose}>
        {ticket && happ && (
          <div className="space-y-4 pb-3">
            <div className="flex items-center gap-3">
              <Avatar src={happ.icon_url} name={happ.name} size="h-14 w-14" className="rounded-2xl" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-extrabold tracking-tight">{happ.name}</h2>
                {startsAt && (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <CalendarClock className="h-4 w-4" /> {formatStart(startsAt)}
                  </p>
                )}
              </div>
            </div>

            {ticket.status === "valid" && !cancelled ? (
              <div className="relative mx-auto w-full max-w-[18rem]">
                <TicketQR code={ticket.code} className={cn(ticket.checked_in_at && "opacity-40")} />
                {ticket.checked_in_at && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-bold">
                      <CheckCircle2 className="h-4 w-4 text-accent" /> Checked in
                    </span>
                  </span>
                )}
              </div>
            ) : (
              <div className="rounded-3xl bg-muted/60 px-4 py-6 text-center">
                <p className="text-lg font-bold">{cancelled ? "This happ was cancelled" : "Refunded"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(ticket.amount_cents, ticket.currency)} went back to your card.
                </p>
              </div>
            )}

            {ticket.status === "valid" && !cancelled && (
              <p className="text-center font-mono text-lg font-bold tracking-widest">{formatCode(ticket.code)}</p>
            )}

            <a
              href={directionsUrl(happ)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-3xl bg-muted/60 px-4 py-3 active:bg-muted"
            >
              <MapPin className="h-5 w-5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 text-sm font-semibold">{happ.suburb || "Pinned location"}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-accent">
                <Navigation className="h-3.5 w-3.5" strokeWidth={2.6} /> Directions
              </span>
            </a>

            {ticket.status === "valid" && !cancelled && (
              <div className="space-y-2 pt-1">
                {canRefund && (
                  <Button variant="secondary" className="w-full" onClick={() => setConfirm(true)}>
                    Refund ticket
                  </Button>
                )}
                <p className="text-center text-xs text-muted-foreground">
                  {canRefund
                    ? `Full refund until ${REFUND_CUTOFF_HOURS} hours before the happ starts.`
                    : `Refunds closed ${REFUND_CUTOFF_HOURS} hours before the start. Ask the host if you can't make it.`}
                </p>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        variant="dialog"
        title="Refund this ticket?"
        description={ticket ? `${formatPrice(ticket.amount_cents, ticket.currency)} goes back to your card in 5–10 days.` : undefined}
      >
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>
            Keep it
          </Button>
          <Button className="flex-1" loading={busy} onClick={refund}>
            Refund
          </Button>
        </div>
      </Sheet>
    </>
  );
}
