import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Banknote, CalendarClock, Camera, ChevronRight, Clock, MapPin, Navigation, ScanLine, TicketIcon, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import type { HappRow } from "@/integrations/supabase/types";
import { deleteHapp, fetchHapp, fetchParticipants, happStartsAt, isUpcoming, type Participant } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useImageColor } from "@/hooks/useImageColor";
import { useRealtime } from "@/hooks/useRealtime";
import { useNow } from "@/hooks/useNow";
import { useTicketing } from "@/hooks/useTicketing";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Pressable, spring, Stagger, StaggerItem } from "@/components/motion";
import { TicketSheet } from "@/components/tickets/TicketSheet";
import { draftStore } from "@/lib/draft";
import { directionsUrl } from "@/lib/directions";
import {
  cancelHapp,
  fetchMyTicketFor,
  fetchSales,
  fetchTicket,
  formatPrice,
  payoutsReady,
  ticketsLeft,
  type Sales,
  type TicketWithHapp,
} from "@/lib/tickets";
import { cn, errorMessage, formatStart, shortTimeAgo, startsIn } from "@/lib/utils";

// Stripe's payment fields load only when someone goes to buy.
const loadCheckout = () => import("@/components/tickets/CheckoutSheet");
const CheckoutSheet = lazy(() => loadCheckout().then((m) => ({ default: m.CheckoutSheet })));

type Props = {
  happId: string | null;
  onClose: () => void;
  onLoaded?: (happ: HappRow) => void;
  /** Called after you delete your own happ. */
  onDeleted?: (happId: string) => void;
};

/** Details for a happ, sliding up over the map (like a place card in Waze). */
export function HappSheet({ happId, onClose, onLoaded, onDeleted }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [happ, setHapp] = useState<HappRow | null>(null);
  const [people, setPeople] = useState<Participant[] | null>(null);
  const [missing, setMissing] = useState(false);

  // Tickets (paid happs only): yours if you're going, sales if you're hosting.
  const ticketing = useTicketing();
  const [myTicketId, setMyTicketId] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [sales, setSales] = useState<Sales | null>(null);
  const [payoutsOk, setPayoutsOk] = useState(true);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [ticket, setTicket] = useState<TicketWithHapp | null>(null);

  const load = useCallback(async () => {
    if (!happId) return;
    const [h, p] = await Promise.all([fetchHapp(happId), fetchParticipants(happId)]);
    setMissing(!h);
    setHapp(h);
    setPeople(p);
    if (h) onLoaded?.(h);
  }, [happId, onLoaded]);

  const paid = ticketing && (happ?.price_cents ?? 0) > 0;
  const isMine = Boolean(happ && user && happ.creator_id === user.id);

  const loadTickets = useCallback(async () => {
    if (!happ || !user || !paid) return;
    if (isMine) {
      const [s, ok] = await Promise.all([fetchSales(happ.id), payoutsReady(user.id)]);
      setSales(s);
      setPayoutsOk(ok);
    } else {
      setMyTicketId((await fetchMyTicketFor(happ.id, user.id))?.id ?? null);
    }
    setLeft(await ticketsLeft(happ));
  }, [happ, user, paid, isMine]);

  useEffect(() => {
    setHapp(null);
    setPeople(null);
    setMissing(false);
    setMyTicketId(null);
    setSales(null);
    setLeft(null);
    load();
  }, [load]);

  useEffect(() => {
    loadTickets();
    if (paid && !isMine) void loadCheckout();
  }, [loadTickets, paid, isMine]);

  useRealtime(happId ? [{ table: "happ_participants", filter: `happ_id=eq.${happId}` }] : null, load);
  useRealtime(happId && paid ? [{ table: "tickets", filter: `happ_id=eq.${happId}` }] : null, loadTickets);

  const now = useNow();
  const storytellers = (people ?? []).filter((p) => p.hasPosts);
  const startsAt = happ ? happStartsAt(happ) : null;
  const upcoming = startsAt ? isUpcoming(startsAt, now) : false;

  const color = useImageColor(happ?.icon_url);
  const soldOut = left === 0;
  const sold = sales?.sold ?? 0;

  const remove = async () => {
    if (!happ || !user) return;
    setDeleting(true);
    try {
      if (paid) {
        // Paid happs are cancelled server-side so every ticket is refunded.
        const { refunded } = await cancelHapp(happ.id);
        toast.success(refunded ? `${happ.name} cancelled · ${refunded} refunded` : `${happ.name} deleted`);
      } else {
        await deleteHapp(happ.id, user.id);
        toast.success(`${happ.name} deleted`);
      }
      setConfirmDelete(false);
      onDeleted?.(happ.id);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn’t delete this happ"));
    } finally {
      setDeleting(false);
    }
  };

  const joinAndPost = () => {
    if (!happ) return;
    draftStore.setTarget({ kind: "existing", happId: happ.id, happName: happ.name });
    navigate("/camera");
  };

  const openTicket = async () => {
    if (!myTicketId) return;
    const t = await fetchTicket(myTicketId);
    if (t) setTicket(t);
  };

  return (
    <>
      <Sheet open={Boolean(happId)} onClose={onClose} dim="light">
        {missing ? (
          <div className="py-10 text-center">
            <p className="text-lg font-bold">This happ has ended</p>
            <p className="mt-1 text-muted-foreground">It’s no longer on the map.</p>
            <Button variant="secondary" className="mt-6" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : !happ ? (
          <div className="space-y-4 pb-4 pt-2">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 animate-pulse rounded-3xl bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-2/3 animate-pulse rounded-full bg-muted" />
                <div className="h-4 w-1/3 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
            <div className="h-14 animate-pulse rounded-full bg-muted" />
          </div>
        ) : (
          <div className="space-y-5 pb-3 pt-1">
            <div className="flex items-center gap-4">
              <motion.div
                initial={{ scale: 0.5, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={spring.bouncy}
              >
                <Avatar
                  src={happ.icon_url}
                  name={happ.name}
                  size="h-16 w-16"
                  className={cn(
                    "rounded-3xl text-2xl ring-[3px]",
                    happ.is_active || upcoming ? "ring-[hsl(var(--happ-color,var(--accent)))]" : "ring-dead",
                  )}
                  style={color ? ({ "--happ-color": color } as CSSProperties) : undefined}
                />
              </motion.div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-[22px] font-extrabold leading-tight tracking-tight">
                    {happ.name}
                  </h2>
                  {isMine && (
                    <IconButton
                      label="Delete this happ"
                      size="sm"
                      onClick={() => setConfirmDelete(true)}
                      className="-mt-0.5 text-muted-foreground"
                    >
                      <Trash2 className="h-[18px] w-[18px]" strokeWidth={2.2} />
                    </IconButton>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  {upcoming ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/10 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-cream">
                      <Clock className="h-3 w-3" strokeWidth={3} />
                      Upcoming
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide",
                        happ.is_active ? "bg-accent/15 text-accent" : "bg-dead/15 text-dead",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          happ.is_active ? "animate-pulse bg-accent" : "bg-dead",
                        )}
                      />
                      {happ.is_active ? "Live" : "Dead"}
                    </span>
                  )}
                  {paid && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-bold text-foreground">
                      <TicketIcon className="h-3 w-3 text-accent" strokeWidth={2.6} />
                      {formatPrice(happ.price_cents ?? 0, happ.currency)}
                    </span>
                  )}
                  {paid && left !== null && (
                    <span className={cn("text-xs font-semibold", left <= 10 ? "text-accent" : "text-muted-foreground")}>
                      {soldOut ? "Sold out" : `${left} left`}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {happ.description && <p className="text-[15px] leading-relaxed text-foreground/80">{happ.description}</p>}

            {/* Where it is, with directions in the phone's maps app. */}
            <a
              href={directionsUrl(happ)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-3xl bg-muted/60 px-4 py-3 active:bg-muted"
            >
              <MapPin className="h-5 w-5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{happ.suburb || "Pinned location"}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-accent">
                <Navigation className="h-3.5 w-3.5" strokeWidth={2.6} /> Directions
              </span>
            </a>

            {upcoming && startsAt && (
              <div className="flex items-center gap-3 rounded-3xl bg-muted/60 px-4 py-3">
                <CalendarClock className="h-5 w-5 shrink-0 text-accent" />
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-bold">Goes live {formatStart(startsAt)}</span>
                  <span className="text-muted-foreground"> · {startsIn(startsAt)}</span>
                </p>
              </div>
            )}

            {paid && isMine && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 rounded-3xl bg-muted/60 py-2.5 pl-4 pr-2.5">
                  <TicketIcon className="h-5 w-5 shrink-0 text-accent" />
                  <p className="min-w-0 flex-1 text-sm leading-snug">
                    <span className="font-bold">
                      {sold} {sold === 1 ? "ticket" : "tickets"} sold
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatPrice(sales?.earningsCents ?? 0, happ.currency)} to you
                      {sales?.checkedIn ? ` · ${sales.checkedIn} checked in` : ""}
                    </span>
                  </p>
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/happ/${happ.id}/check-in`)}>
                    <ScanLine className="h-4 w-4" strokeWidth={2.4} /> Check in
                  </Button>
                </div>
                {!payoutsOk && (
                  <Pressable
                    pressScale={0.98}
                    onClick={() => navigate("/payouts")}
                    className="flex w-full items-center gap-3 rounded-3xl border border-accent/25 bg-accent/10 px-4 py-3 text-left"
                  >
                    <Banknote className="h-5 w-5 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 text-sm leading-snug">
                      <span className="font-bold">Set up payouts</span>
                      <span className="block text-xs text-muted-foreground">2 minutes, so ticket money reaches your bank</span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-accent" />
                  </Pressable>
                )}
              </div>
            )}

            {storytellers.length > 0 && (
              <section>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Stories</h3>
                <Stagger as="div" className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 pb-1">
                  {storytellers.map((p) => (
                    <StaggerItem as="div" key={p.id}>
                      <Pressable
                        onClick={() => navigate(`/happ/${happ.id}/story/${p.user_id}`)}
                        className="flex w-[68px] flex-col items-center gap-1.5"
                      >
                        <span className="glitch-bg rounded-full p-[3px]">
                          <Avatar
                            src={p.profile?.avatar_url}
                            name={p.profile?.display_name || p.profile?.username}
                            size="h-[58px] w-[58px]"
                            className="ring-[3px] ring-card"
                          />
                        </span>
                        <span className="w-full truncate text-center text-xs font-medium">
                          {p.profile?.username ?? "someone"}
                        </span>
                      </Pressable>
                    </StaggerItem>
                  ))}
                </Stagger>
              </section>
            )}

            <div className="flex items-center gap-3 rounded-3xl bg-muted/60 px-4 py-3">
              <div className="flex -space-x-2.5">
                {(people ?? []).slice(0, 5).map((p) => (
                  <Avatar
                    key={p.id}
                    src={p.profile?.avatar_url}
                    name={p.profile?.display_name || p.profile?.username}
                    size="h-8 w-8"
                    className="text-xs ring-2 ring-card"
                  />
                ))}
                {(people?.length ?? 0) === 0 && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </span>
                )}
              </div>
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-bold">{people?.length ?? 0}</span>{" "}
                <span className="text-muted-foreground">
                  {people?.length === 1 ? "person" : "people"} {upcoming ? "going" : "here"}
                </span>
              </p>
              {!upcoming && (
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                  {shortTimeAgo(happ.last_activity_at)} ago
                </span>
              )}
            </div>

            {paid && !isMine && !myTicketId ? (
              <Button
                size="lg"
                className="w-full"
                disabled={soldOut || (!upcoming && !happ.is_active)}
                onClick={() => setCheckoutOpen(true)}
              >
                <TicketIcon className="h-5 w-5" strokeWidth={2.5} />
                {soldOut ? "Sold out" : `Get ticket · ${formatPrice(happ.price_cents ?? 0, happ.currency)}`}
              </Button>
            ) : upcoming && startsAt ? (
              myTicketId ? (
                <Button size="lg" className="w-full" onClick={openTicket}>
                  <TicketIcon className="h-5 w-5" strokeWidth={2.5} /> Your ticket
                </Button>
              ) : (
                <div className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-muted text-base font-bold text-muted-foreground">
                  <Clock className="h-5 w-5" strokeWidth={2.5} /> Stories open {startsIn(startsAt)}
                </div>
              )
            ) : (
              <div className="flex gap-3">
                <Button size="lg" className="min-w-0 flex-1" onClick={joinAndPost}>
                  <Camera className="h-5 w-5" strokeWidth={2.5} /> Join & post
                </Button>
                {myTicketId && (
                  <IconButton label="Your ticket" size="lg" onClick={openTicket}>
                    <TicketIcon className="h-6 w-6" />
                  </IconButton>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={confirmDelete && Boolean(happId)}
        onClose={() => setConfirmDelete(false)}
        variant="dialog"
        title={`${paid && sold ? "Cancel" : "Delete"} ${happ?.name ?? "this happ"}?`}
        description={
          paid && sold
            ? `Everyone with a ticket gets a full refund (${sold} ${sold === 1 ? "ticket" : "tickets"}), and it comes off the map. This can’t be undone.`
            : "It comes off the map for everyone, along with its stories. This can’t be undone."
        }
      >
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
            {paid && sold ? "Keep it" : "Cancel"}
          </Button>
          <Button variant="destructive" className="flex-1" loading={deleting} onClick={remove}>
            {paid && sold ? "Cancel happ" : "Delete"}
          </Button>
        </div>
      </Sheet>

      {happ && paid && !isMine && (
        <Suspense fallback={null}>
          <CheckoutSheet
            open={checkoutOpen}
            happ={{
              id: happ.id,
              name: happ.name,
              price_cents: happ.price_cents ?? 0,
              currency: happ.currency ?? "aud",
              startsAt: happStartsAt(happ),
            }}
            onClose={() => setCheckoutOpen(false)}
            onPaid={(ticketId) => {
              setMyTicketId(ticketId);
              loadTickets();
            }}
          />
        </Suspense>
      )}
      <TicketSheet ticket={ticket} onClose={() => setTicket(null)} onChanged={loadTickets} />
    </>
  );
}
