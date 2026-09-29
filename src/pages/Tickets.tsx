import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, TicketIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Spinner";
import { Pressable, Screen, Stagger, StaggerItem } from "@/components/motion";
import { TicketSheet } from "@/components/tickets/TicketSheet";
import { happStartsAt } from "@/lib/api";
import { fetchMyTickets, fetchTicket, waitForTicket, type TicketWithHapp } from "@/lib/tickets";
import { cn, formatStart } from "@/lib/utils";

/** Your tickets: upcoming first, then past and refunded. */
export default function Tickets() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tickets, setTickets] = useState<TicketWithHapp[] | null>(null);
  const [open, setOpen] = useState<TicketWithHapp | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (user) setTickets(await fetchMyTickets(user.id));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back from a payment that needed a redirect: show that ticket.
  useEffect(() => {
    const id = params.get("ticket");
    if (!id) return;
    let cancelled = false;
    setConfirming(true);
    waitForTicket(id).then(async () => {
      const t = await fetchTicket(id);
      if (cancelled) return;
      setConfirming(false);
      if (t) setOpen(t);
      setParams({}, { replace: true });
      load();
    });
    return () => {
      cancelled = true;
    };
  }, [params, setParams, load]);

  const now = Date.now();
  const upcoming = (tickets ?? []).filter(
    (t) => t.status === "valid" && !t.happs?.cancelled_at && Date.parse(happStartsAt(t.happs ?? { created_at: t.created_at })) > now - 12 * 3600_000,
  );
  const past = (tickets ?? []).filter((t) => !upcoming.includes(t));

  return (
    <Screen>
      <TopBar title="Tickets" />
      <main className="scroll-area mx-auto w-full max-w-lg flex-1 px-4 pb-safe">
        {confirming && (
          <div className="mb-3 flex items-center justify-center gap-2 rounded-3xl bg-muted/60 py-3 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Confirming your payment…
          </div>
        )}
        {tickets === null ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-8 py-20 text-center text-muted-foreground">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
              <TicketIcon className="h-8 w-8" />
            </span>
            <p>Tickets you buy for happs show up here.</p>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && <Section title="Upcoming" list={upcoming} onOpen={setOpen} />}
            {past.length > 0 && <Section title="Past" list={past} onOpen={setOpen} muted />}
          </>
        )}
      </main>
      <TicketSheet ticket={open} onClose={() => setOpen(null)} onChanged={load} />
    </Screen>
  );
}

function Section({
  title,
  list,
  onOpen,
  muted,
}: {
  title: string;
  list: TicketWithHapp[];
  onOpen: (t: TicketWithHapp) => void;
  muted?: boolean;
}) {
  return (
    <section className="pb-4">
      <h3 className="mb-2 mt-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <Stagger className="space-y-2">
        {list.map((t) => {
          const happ = t.happs;
          const status =
            t.status === "refunded" ? "Refunded" : happ?.cancelled_at ? "Cancelled" : t.checked_in_at ? "Checked in" : null;
          return (
            <StaggerItem key={t.id}>
              <Pressable
                pressScale={0.97}
                onClick={() => onOpen(t)}
                className={cn("flex w-full items-center gap-3 rounded-3xl bg-muted/60 p-3 text-left", muted && "opacity-70")}
              >
                <Avatar src={happ?.icon_url} name={happ?.name} size="h-12 w-12" className="rounded-2xl" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{happ?.name ?? "Happ"}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {happ ? formatStart(happStartsAt(happ)) : ""}
                  </span>
                </span>
                {status ? (
                  <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-muted-foreground">{status}</span>
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
              </Pressable>
            </StaggerItem>
          );
        })}
      </Stagger>
    </section>
  );
}
