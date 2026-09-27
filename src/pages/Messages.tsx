import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageCircle, PenSquare, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ConversationSummaryRow } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounced, useRealtime } from "@/hooks/useRealtime";
import { TopBar } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { Pressable, Screen, Stagger, StaggerItem } from "@/components/motion";
import { fetchConversations, getOrCreateConversation } from "@/lib/api";
import { cn, errorMessage, shortTimeAgo, toSearchPattern } from "@/lib/utils";

type UserResult = { user_id: string; username: string | null; display_name: string | null; avatar_url: string | null };

export default function Messages() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummaryRow[] | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  // One RPC for the whole inbox (the old list ran 3 queries per conversation).
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setConversations(await fetchConversations(user.id));
    } catch (err) {
      console.error("Error loading conversations:", err);
      setConversations([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useDebounced(load, 400);
  useRealtime(user ? [{ table: "messages" }, { table: "conversations" }] : null, reload);

  return (
    <Screen>
      <TopBar
        title="Messages"
        right={
          <IconButton label="New message" variant="ghost" onClick={() => setComposeOpen(true)}>
            <PenSquare className="h-5 w-5" />
          </IconButton>
        }
      />

      <main className="scroll-area mx-auto min-h-0 w-full max-w-lg flex-1 pb-safe">
        {conversations === null ? (
          <ul className="space-y-1 px-3 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl p-3">
                <span className="h-12 w-12 animate-pulse rounded-full bg-muted" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3.5 w-1/3 animate-pulse rounded bg-muted" />
                  <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
                </span>
              </li>
            ))}
          </ul>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-8 pt-24 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-accent/10 text-accent">
              <MessageCircle className="h-11 w-11" />
            </span>
            <div>
              <p className="text-lg font-extrabold">No messages yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Say hi to someone you met at a happ.</p>
            </div>
            <Button onClick={() => setComposeOpen(true)}>Start a conversation</Button>
          </div>
        ) : (
          <Stagger className="px-2 pt-1">
            {conversations.map((c) => {
              const name = c.other_display_name || c.other_username || "User";
              const unread = Number(c.unread_count) > 0;
              const preview = c.last_message
                ? `${c.last_message_sender === user?.id ? "You: " : ""}${c.last_message}`
                : "Say hi 👋";
              return (
                <StaggerItem key={c.id}>
                  <Link
                    to={`/messages/${c.id}`}
                    className="flex items-center gap-3 rounded-3xl p-3 transition-colors active:bg-muted"
                  >
                    <Avatar src={c.other_avatar_url} name={name} size="h-12 w-12" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[15px]", unread ? "font-extrabold" : "font-bold")}>{name}</span>
                        <span className={cn("shrink-0 text-xs", unread ? "font-semibold text-accent" : "text-muted-foreground")}>
                          {shortTimeAgo(c.last_message_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={cn("flex-1 truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>
                          {preview}
                        </span>
                        {unread && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">
                            {Number(c.unread_count) > 9 ? "9+" : c.unread_count}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </main>

      <ComposeSheet open={composeOpen} onClose={() => setComposeOpen(false)} />
    </Screen>
  );
}

function ComposeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    } else {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    const pattern = toSearchPattern(query);
    if (!pattern || query.trim().length < 2 || !user) {
      setResults([]);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const quoted = `"${pattern}"`;
      const { data } = await supabase
        .from("profiles")
        .select("user_id, username, display_name, avatar_url")
        .neq("user_id", user.id)
        .not("username", "is", null)
        .or(`username.ilike.${quoted},display_name.ilike.${quoted}`)
        .limit(10);
      if (!cancelled) {
        setResults(data ?? []);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, user]);

  const openConversation = async (otherId: string) => {
    if (!user) return;
    setOpening(otherId);
    try {
      const id = await getOrCreateConversation(user.id, otherId);
      onClose();
      navigate(`/messages/${id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start the conversation"));
    } finally {
      setOpening(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New message">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="h-[52px] w-full rounded-full border-2 border-transparent bg-muted pl-11 pr-4 text-[16px] placeholder:text-muted-foreground/70 focus:border-accent/70 focus:outline-none"
        />
      </div>
      <div className="mt-3 min-h-[12rem]">
        {searching ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query.trim().length < 2 ? "Type a name or username" : "No one found"}
          </p>
        ) : (
          <ul className="-mx-2">
            {results.map((r) => (
              <li key={r.user_id}>
                <Pressable
                  pressScale={0.97}
                  onClick={() => openConversation(r.user_id)}
                  disabled={opening !== null}
                  className="flex w-full items-center gap-3 rounded-3xl p-2.5 text-left"
                >
                  <Avatar src={r.avatar_url} name={r.display_name || r.username} size="h-11 w-11" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.display_name || r.username}</span>
                    {r.username && <span className="block truncate text-sm text-muted-foreground">@{r.username}</span>}
                  </span>
                  {opening === r.user_id && <Spinner className="h-4 w-4" />}
                </Pressable>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
