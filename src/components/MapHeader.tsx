import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, MapPin, MessageCircle, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadCount } from "@/hooks/useUnreadCount";
import { IconButton } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Spinner";
import { cn, toSearchPattern } from "@/lib/utils";

type Result =
  | { type: "user"; id: string; title: string; subtitle: string | null; avatar: string | null }
  | { type: "happ"; id: string; title: string; subtitle: string | null; avatar: string | null };

function useSearch(query: string) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const pattern = toSearchPattern(query);
    if (!pattern || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const quoted = `"${pattern}"`;
      const [users, happs] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, username, display_name, avatar_url")
          .not("username", "is", null)
          .or(`username.ilike.${quoted},display_name.ilike.${quoted}`)
          .limit(5),
        supabase
          .from("happs")
          .select("id, name, suburb, icon_url")
          .or(`name.ilike.${quoted},suburb.ilike.${quoted}`)
          .order("last_activity_at", { ascending: false })
          .limit(5),
      ]);
      if (cancelled) return;
      setResults([
        ...(users.data ?? []).map<Result>((u) => ({
          type: "user",
          id: u.user_id,
          title: u.display_name || u.username || "User",
          subtitle: u.username ? `@${u.username}` : null,
          avatar: u.avatar_url,
        })),
        ...(happs.data ?? []).map<Result>((h) => ({
          type: "happ",
          id: h.id,
          title: h.name,
          subtitle: h.suburb,
          avatar: h.icon_url,
        })),
      ]);
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, loading };
}

/** Floating header on the map: back, search, messages and profile. */
export function MapHeader({ profileAlert = false }: { profileAlert?: boolean }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const unread = useUnreadCount();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useSearch(query);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const select = (r: Result) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(r.type === "user" ? `/profile/${r.id}` : `/happ/${r.id}`);
  };

  const showResults = open && query.trim().length >= 2;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-safe">
      <div ref={boxRef} className="pointer-events-auto relative">
        <div className="flex items-center gap-2">
          <IconButton label="Home" variant="glass" onClick={() => navigate("/")}>
            <ChevronLeft className="h-5 w-5" />
          </IconButton>

          <div className="relative min-w-0 flex-1">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (results[0]) select(results[0]);
              }}
            >
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Search"
                aria-label="Search happs or people"
                className="glass h-11 w-full rounded-full pl-10 pr-9 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </form>
          </div>

          <IconButton
            label={unread ? `Messages, ${unread} unread` : "Messages"}
            variant="glass"
            onClick={() => navigate("/messages")}
          >
            <MessageCircle className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 animate-pop-in items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground ring-2 ring-background">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </IconButton>

          <button
            type="button"
            aria-label="Your profile"
            onClick={() => navigate("/profile")}
            className={cn(
              "glass shrink-0 rounded-full p-0.5 transition-all duration-300 active:scale-90",
              profileAlert && "ring-[3px] ring-dead",
            )}
          >
            <Avatar src={profile?.avatar_url} name={profile?.display_name || profile?.username} size="h-10 w-10" />
          </button>
        </div>
        {showResults && (
          <div className="absolute inset-x-0 top-full mt-2 animate-fade-up overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
            {loading ? (
              <div className="flex justify-center p-5">
                <Spinner className="h-5 w-5" />
              </div>
            ) : results.length === 0 ? (
              <p className="p-5 text-center text-sm text-muted-foreground">No results for “{query.trim()}”</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1.5">
                {results.map((r) => (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      type="button"
                      onClick={() => select(r)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/70"
                    >
                      {r.type === "user" || r.avatar ? (
                        <Avatar src={r.avatar} name={r.title} size="h-10 w-10" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
                          <MapPin className="h-5 w-5" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.title}</span>
                        {r.subtitle && (
                          <span className="block truncate text-sm text-muted-foreground">{r.subtitle}</span>
                        )}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {r.type === "user" ? "Person" : "Happ"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
