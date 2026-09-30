import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { motion } from "motion/react";
import { KeyRound, RefreshCw, Search, Store, Table2 } from "lucide-react";
import { toast } from "sonner";
import type { AdminHappRow, AdminSaleRow, AdminUserRow } from "@/integrations/supabase/types";
import { TopBar } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Screen, spring } from "@/components/motion";
import { ColumnChart } from "@/components/dash/ColumnChart";
import {
  claimAdmin,
  compact,
  fetchAdminHapps,
  fetchAdminSales,
  fetchOverview,
  fetchUsers,
  isAdmin,
  USERS_PAGE,
  type Overview,
} from "@/lib/admin";
import { interestLabel } from "@/lib/interests";
import { formatPrice } from "@/lib/tickets";
import { cn, errorMessage, shortTimeAgo } from "@/lib/utils";

type Metric = "signups" | "happs" | "posts";
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: "signups", label: "Sign-ups", unit: "sign-ups" },
  { id: "happs", label: "Happs", unit: "happs" },
  { id: "posts", label: "Posts", unit: "posts" },
];

/** The owner's view of the app: people, activity, happs and money. */
export default function Dash() {
  const [admin, setAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    isAdmin().then(setAdmin);
  }, []);

  if (admin === null) {
    return (
      <Screen>
        <TopBar title="Dashboard" />
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </Screen>
    );
  }
  return admin ? <Dashboard /> : <Claim onClaimed={() => setAdmin(true)} />;
}

function Claim({ onClaimed }: { onClaimed: () => void }) {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      if (!value.trim()) return;
      setBusy(true);
      try {
        if (await claimAdmin(value)) {
          toast.success("Dashboard unlocked");
          setParams({}, { replace: true });
          onClaimed();
        } else {
          toast.error("That code doesn’t work (each code works once)");
        }
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [onClaimed, setParams],
  );

  // A link with ?code=… unlocks in one tap.
  useEffect(() => {
    const fromLink = params.get("code");
    if (fromLink) submit(fromLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <TopBar title="Dashboard" />
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(code);
        }}
        className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-5 px-6 text-center"
      >
        <span className="glitch-bg flex h-16 w-16 items-center justify-center rounded-full text-accent-foreground">
          <KeyRound className="h-8 w-8" />
        </span>
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">Owners only</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">Enter your admin code to unlock the dashboard on this account.</p>
        </div>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Admin code"
          aria-label="Admin code"
          autoComplete="off"
          autoCapitalize="none"
          className="text-center font-mono"
        />
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!code.trim()}>
          Unlock
        </Button>
      </form>
    </Screen>
  );
}

function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [happs, setHapps] = useState<AdminHappRow[] | null>(null);
  const [sales, setSales] = useState<AdminSaleRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, h, s] = await Promise.all([fetchOverview(), fetchAdminHapps(), fetchAdminSales()]);
      setOverview(o);
      setHapps(h);
      setSales(s);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn’t load the dashboard"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen>
      <TopBar
        title="Dashboard"
        subtitle="The Happs"
        right={
          <IconButton label="Refresh" variant="glass" onClick={load}>
            <RefreshCw className={cn("h-5 w-5", loading && "animate-spin")} />
          </IconButton>
        }
      />
      <main className="scroll-area min-h-0 flex-1">
        {!overview ? (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        ) : (
          <div className={cn("mx-auto w-full max-w-6xl space-y-4 px-4 pb-safe sm:px-6", loading && "opacity-70 transition-opacity")}>
            <Headline o={overview} />
            <Activity o={overview} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Money o={overview} />
              <Interests o={overview} />
            </div>
            <Users />
            <div className="grid gap-4 lg:grid-cols-2">
              <RecentHapps happs={happs} />
              <RecentSales sales={sales} />
            </div>
            <div className="h-4" />
          </div>
        )}
      </main>
    </Screen>
  );
}

function Card({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-4xl bg-card p-4 sm:p-5", className)}>
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <h3 className="text-[15px] font-extrabold tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Headline({ o }: { o: Overview }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.gentle}
        className="flex flex-col justify-center rounded-4xl bg-card p-5"
      >
        <p className="text-sm font-semibold text-muted-foreground">People on The Happs</p>
        <p className="glitch-text mt-1 text-6xl font-black tracking-tight">{compact(o.users)}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-bold text-foreground">+{o.users_7d}</span> this week · {o.users_today} today
        </p>
      </motion.div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Active this week" value={compact(o.active_7d)} sub="signed in" />
        <Tile label="Brands" value={compact(o.brands)} sub="brand accounts" />
        <Tile label="Live now" value={compact(o.happs_live)} sub={`${o.happs_upcoming} upcoming`} />
        <Tile label="Happs this week" value={compact(o.happs_7d)} sub={`${compact(o.happs)} all time`} />
        <Tile label="Posts this week" value={compact(o.posts_7d)} sub={`${compact(o.posts)} all time`} />
        <Tile label="Messages this week" value={compact(o.messages_7d)} />
        <Tile label="Follows" value={compact(o.follows)} />
        <Tile label="Push notifications" value={compact(o.push_subscribers)} sub="people subscribed" />
      </div>
    </div>
  );
}

function Activity({ o }: { o: Overview }) {
  const [metric, setMetric] = useState<Metric>("signups");
  const [asTable, setAsTable] = useState(false);
  const m = METRICS.find((x) => x.id === metric)!;
  const columns = useMemo(
    () => o.daily.map((d) => ({ key: d.day, label: format(new Date(d.day), "d MMM"), value: d[metric] })),
    [o.daily, metric],
  );
  const total = columns.reduce((s, c) => s + c.value, 0);

  return (
    <Card
      title={`${m.label} per day · last 30 days`}
      action={
        <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          <Table2 className="h-4 w-4" /> {asTable ? "Chart" : "Table"}
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-full bg-muted p-1" role="radiogroup" aria-label="Metric">
          {METRICS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={metric === x.id}
              onClick={() => setMetric(x.id)}
              className="relative h-8 rounded-full px-3.5 text-sm font-bold"
            >
              {metric === x.id && <motion.span layoutId="metric-pill" transition={spring.bouncy} className="glitch-bg absolute inset-0 rounded-full" />}
              <span className={cn("relative", metric === x.id ? "text-accent-foreground" : "text-muted-foreground")}>{x.label}</span>
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-bold text-foreground">{total.toLocaleString("en-AU")}</span> in 30 days
        </p>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-y-auto rounded-2xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 font-semibold">Day</th>
                <th className="py-2 text-right font-semibold">{m.label}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...columns].reverse().map((c) => (
                <tr key={c.key} className="border-t border-white/[0.05]">
                  <td className="py-1.5">{c.label}</td>
                  <td className="py-1.5 text-right font-semibold">{c.value.toLocaleString("en-AU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ColumnChart columns={columns} unit={m.unit} />
      )}
    </Card>
  );
}

function Money({ o }: { o: Overview }) {
  const rows: [string, string, string?][] = [
    ["Ticket sales", formatPrice(o.gross_cents), `${o.tickets_sold} tickets · ${o.paid_happs} paid happs`],
    ["Your 13%", formatPrice(o.fees_cents), "Stripe’s card fees come out of this"],
    ["Owed to hosts", formatPrice(o.owed_to_hosts_cents), "Paid out 24 hours after each happ starts"],
    ["Paid to hosts", formatPrice(o.paid_to_hosts_cents), `${o.hosts_with_payouts} hosts set up for payouts`],
    ["Refunded", formatPrice(o.refunded_cents), `${o.tickets_refunded} tickets`],
  ];
  return (
    <Card title="Money">
      <dl className="divide-y divide-white/[0.05]">
        {rows.map(([label, value, sub]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="min-w-0">
              <span className="block text-sm font-semibold">{label}</span>
              {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
            </dt>
            <dd className="shrink-0 text-lg font-extrabold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Interests({ o }: { o: Overview }) {
  const rows = Object.entries(o.interests).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;
  return (
    <Card title="What people are into">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nobody has picked interests yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.slice(0, 10).map(([id, n]) => (
            <li key={id} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <span className="truncate font-semibold">{interestLabel(id)}</span>
              <span className="flex items-center gap-2">
                <span className="h-2.5 rounded-r-[4px] bg-accent" style={{ width: `${Math.max(2, (n / max) * 100)}%` }} />
                <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{n}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Users() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const list = await fetchUsers(query);
        if (cancelled) return;
        setRows(list);
        setMore(list.length === USERS_PAGE);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const loadMore = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const next = await fetchUsers(query, rows.length);
      setRows([...rows, ...next]);
      setMore(next.length === USERS_PAGE);
    } finally {
      setBusy(false);
    }
  };

  const total = rows?.[0]?.total ?? 0;
  const open = (u: AdminUserRow) => navigate(`/profile/${u.user_id}`);

  return (
    <Card
      title={`Users${rows ? ` · ${Number(total).toLocaleString("en-AU")}` : ""}`}
      action={
        <label className="relative w-full max-w-[16rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, username or email"
            aria-label="Search users"
            className="h-9 w-full rounded-full bg-muted pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </label>
      }
    >
      {rows === null ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{query ? `Nobody matches “${query}”` : "No users yet."}</p>
      ) : (
        <>
          {/* Phones: a list. */}
          <ul className="divide-y divide-white/[0.05] md:hidden">
            {rows.map((u) => (
              <li key={u.user_id}>
                <button type="button" onClick={() => open(u)} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <Avatar src={u.avatar_url} name={u.display_name || u.username} size="h-11 w-11" />
                  <span className="min-w-0 flex-1">
                    <UserName u={u} />
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                    <span className="block text-xs text-muted-foreground">
                      Joined {format(new Date(u.created_at), "d MMM yyyy")} · {u.posts} posts · {u.followers} followers
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Wider screens: a table. */}
          <div className="-mx-2 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {["Person", "Email", "Joined", "Last seen", "Posts", "Happs", "Followers", "Tickets"].map((h, i) => (
                    <th key={h} className={cn("px-2 py-2 font-semibold", i >= 4 && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.user_id} onClick={() => open(u)} className="cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.03]">
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2.5">
                        <Avatar src={u.avatar_url} name={u.display_name || u.username} size="h-9 w-9" />
                        <span className="min-w-0">
                          <UserName u={u} />
                        </span>
                      </span>
                    </td>
                    <td className="max-w-[14rem] truncate px-2 py-2 text-muted-foreground">{u.email}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{format(new Date(u.created_at), "d MMM yyyy")}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {u.last_sign_in_at ? `${shortTimeAgo(u.last_sign_in_at)} ago` : "—"}
                    </td>
                    {[u.posts, u.happs, u.followers, u.tickets].map((v, i) => (
                      <td key={i} className="px-2 py-2 text-right font-semibold tabular-nums">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more && (
            <Button variant="secondary" className="mt-3 w-full" onClick={loadMore} loading={busy}>
              Show more
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function UserName({ u }: { u: AdminUserRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-bold">{u.display_name || u.username || "No username yet"}</span>
      {u.account_type === "brand" && (
        <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
          <Store className="h-2.5 w-2.5" strokeWidth={3} /> {u.brand_category || "Brand"}
        </span>
      )}
      {u.is_admin && <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold">Admin</span>}
      {u.username && <span className="hidden truncate text-xs text-muted-foreground lg:inline">@{u.username}</span>}
    </span>
  );
}

function happStatus(h: AdminHappRow) {
  if (h.cancelled_at) return { label: "Cancelled", accent: false };
  if (Date.parse(h.starts_at) > Date.now()) return { label: `Starts ${format(new Date(h.starts_at), "d MMM, h:mm a")}`, accent: false };
  const live = h.is_active && Date.parse(h.last_activity_at) > Date.now() - 2 * 3600_000 && Date.parse(h.starts_at) > Date.now() - 24 * 3600_000;
  return live ? { label: "Live", accent: true } : { label: "Ended", accent: false };
}

function RecentHapps({ happs }: { happs: AdminHappRow[] | null }) {
  const navigate = useNavigate();
  return (
    <Card title="Recent happs">
      {!happs?.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No happs yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {happs.map((h) => {
            const status = happStatus(h);
            return (
              <li key={h.id}>
                <button type="button" onClick={() => navigate(`/happ/${h.id}`)} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <Avatar src={h.icon_url} name={h.name} size="h-10 w-10" className="rounded-2xl" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{h.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{h.creator_username ?? "someone"} · {h.participant_count} people · {h.posts} posts
                      {h.price_cents > 0 ? ` · ${h.tickets_sold} sold (${formatPrice(h.gross_cents)})` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold",
                      status.accent ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {status.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentSales({ sales }: { sales: AdminSaleRow[] | null }) {
  return (
    <Card title="Ticket sales">
      {!sales?.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No tickets sold yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {sales.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{t.happ_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  @{t.buyer_username ?? "someone"} · {t.paid_at ? format(new Date(t.paid_at), "d MMM, h:mm a") : "—"}
                  {t.checked_in_at ? " · checked in" : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={cn("block text-sm font-extrabold tabular-nums", t.status === "refunded" && "text-muted-foreground line-through")}>
                  {formatPrice(t.amount_cents, t.currency)}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {t.status === "refunded" ? "Refunded" : `${formatPrice(t.platform_fee_cents, t.currency)} to you`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
