import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { MapHapp } from "@/lib/api";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Spinner";
import { Pressable, Stagger, StaggerItem } from "@/components/motion";
import { cn, distanceMeters, toSearchPattern } from "@/lib/utils";

type Result = { type: "user" | "happ"; id: string; title: string; subtitle: string | null; avatar: string | null; live?: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Happs currently on the map, shown when the search box is empty. */
  happs: MapHapp[];
  location: { latitude: number; longitude: number } | null;
};

function formatDistance(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function SearchSheet({ open, onClose, happs, location }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
    setQuery("");
  }, [open]);

  useEffect(() => {
    const pattern = toSearchPattern(query);
    if (!pattern || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const quoted = `"${pattern}"`;
      const [users, found] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, username, display_name, avatar_url")
          .not("username", "is", null)
          .or(`username.ilike.${quoted},display_name.ilike.${quoted}`)
          .limit(6),
        supabase
          .from("happs")
          .select("id, name, suburb, icon_url, is_active")
          .or(`name.ilike.${quoted},suburb.ilike.${quoted}`)
          .order("last_activity_at", { ascending: false })
          .limit(6),
      ]);
      if (cancelled) return;
      setResults([
        ...(found.data ?? []).map<Result>((h) => ({
          type: "happ",
          id: h.id,
          title: h.name,
          subtitle: h.suburb,
          avatar: h.icon_url,
          live: h.is_active,
        })),
        ...(users.data ?? []).map<Result>((u) => ({
          type: "user",
          id: u.user_id,
          title: u.display_name || u.username || "User",
          subtitle: u.username ? `@${u.username}` : null,
          avatar: u.avatar_url,
        })),
      ]);
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // Empty state: what's on right now, nearest first.
  const happeningNow = useMemo(() => {
    const list = happs.map((h) => ({
      ...h,
      distance: location ? distanceMeters(location.latitude, location.longitude, h.latitude, h.longitude) : null,
    }));
    return list.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)).slice(0, 8);
  }, [happs, location]);

  const go = (r: { type: "user" | "happ"; id: string }) => {
    onClose();
    navigate(r.type === "user" ? `/profile/${r.id}` : `/happ/${r.id}`);
  };

  const searching = query.trim().length >= 2;

  return (
    <Sheet open={open} onClose={onClose} className="h-[88dvh]">
      <div className="sticky top-0 z-10 -mx-1 bg-card px-1 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search happs or people"
            aria-label="Search happs or people"
            enterKeyHint="search"
            className="h-[52px] w-full rounded-full border-2 border-transparent bg-muted pl-12 pr-11 text-[16px] font-medium placeholder:text-muted-foreground/70 focus:border-accent/70 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/25"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {searching ? (
        loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">Nothing found for “{query.trim()}”</p>
        ) : (
          <Stagger key={query} className="space-y-1 pb-4">
            {results.map((r) => (
              <StaggerItem key={`${r.type}-${r.id}`}>
                <Row
                  onClick={() => go(r)}
                  avatar={r.avatar}
                  title={r.title}
                  subtitle={r.subtitle}
                  badge={r.type === "user" ? "Person" : r.live ? "Live" : "Ended"}
                  accent={r.type === "happ" && r.live}
                  round={r.type === "user"}
                />
              </StaggerItem>
            ))}
          </Stagger>
        )
      ) : (
        <>
          <h3 className="mb-2 mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Happening now</h3>
          {happeningNow.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
              <MapPin className="h-8 w-8" />
              <p>Nothing on right now. Start something!</p>
            </div>
          ) : (
            <Stagger className="space-y-1 pb-4">
              {happeningNow.map((h) => (
                <StaggerItem key={h.id}>
                  <Row
                    onClick={() => go({ type: "happ", id: h.id })}
                    avatar={h.iconUrl}
                    title={h.name}
                    subtitle={[h.suburb, h.distance != null ? formatDistance(h.distance) : null].filter(Boolean).join(" · ")}
                    badge={`${h.participantCount} here`}
                    accent={h.isActive}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </>
      )}
    </Sheet>
  );
}

function Row({
  onClick,
  avatar,
  title,
  subtitle,
  badge,
  accent,
  round,
}: {
  onClick: () => void;
  avatar: string | null;
  title: string;
  subtitle: string | null;
  badge: string;
  accent?: boolean;
  round?: boolean;
}) {
  return (
    <Pressable pressScale={0.97} onClick={onClick} className="flex w-full items-center gap-3 rounded-3xl p-2.5 text-left">
      <Avatar src={avatar} name={title} size="h-12 w-12" className={cn(!round && "rounded-2xl")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{title}</span>
        {subtitle && <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold",
          accent ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground",
        )}
      >
        {badge}
      </span>
    </Pressable>
  );
}
