import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowUp, ChevronLeft } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { motion } from "motion/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { MessageRow, ProfileRow } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime } from "@/hooks/useRealtime";
import { useGoBack } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { FullScreenLoader } from "@/components/ui/Spinner";
import { requestPush } from "@/lib/push";
import { afterMessageSent, fetchProfiles, markConversationRead } from "@/lib/api";
import { Screen, spring } from "@/components/motion";
import { cn } from "@/lib/utils";

type ChatMessage = MessageRow & { pending?: boolean; failed?: boolean };

function dayLabel(date: Date) {
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return `Yesterday ${format(date, "h:mm a")}`;
  return format(date, "EEE d MMM, h:mm a");
}

export default function Chat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack("/messages");
  const { user } = useAuth();
  const [other, setOther] = useState<Pick<ProfileRow, "user_id" | "username" | "display_name" | "avatar_url"> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useCallback(() => {
    if (conversationId && user) markConversationRead(conversationId, user.id).catch(() => undefined);
  }, [conversationId, user]);

  useEffect(() => {
    if (!conversationId || !user) return;
    let cancelled = false;
    (async () => {
      const { data: convo } = await supabase
        .from("conversations")
        .select("participant_1, participant_2")
        .eq("id", conversationId)
        .maybeSingle();
      if (cancelled) return;
      if (!convo) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const otherId = convo.participant_1 === user.id ? convo.participant_2 : convo.participant_1;
      const [profiles, messagesRes] = await Promise.all([
        fetchProfiles([otherId]),
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (cancelled) return;
      setOther(profiles.get(otherId) ?? null);
      setMessages(((messagesRes.data as ChatMessage[]) ?? []).reverse());
      setLoading(false);
      markRead();
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, user, markRead]);

  useRealtime(
    conversationId
      ? [
          { table: "messages", event: "INSERT", filter: `conversation_id=eq.${conversationId}` },
          { table: "messages", event: "UPDATE", filter: `conversation_id=eq.${conversationId}` },
        ]
      : null,
    (payload) => {
      const msg = payload.new as unknown as MessageRow;
      if (payload.eventType === "UPDATE") {
        // Read receipts.
        setMessages((list) => list.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
        return;
      }
      setMessages((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg]));
      if (msg.sender_id !== user?.id) markRead();
    },
  );

  // Keep the newest message in view (the old chat never scrolled down).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const send = async (content: string, retryId?: string) => {
    if (!user || !conversationId) return;
    const tempId = retryId ?? `temp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      is_read: false,
      created_at: new Date().toISOString(),
      pending: true,
    };
    stickToBottom.current = true;
    setMessages((list) => (retryId ? list.map((m) => (m.id === retryId ? optimistic : m)) : [...list, optimistic]));

    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: user.id, content })
      .select("*")
      .single();

    if (error || !data) {
      setMessages((list) => list.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      toast.error("Message not sent");
      return;
    }
    setMessages((list) => {
      const withoutTemp = list.filter((m) => m.id !== tempId);
      return withoutTemp.some((m) => m.id === data.id) ? withoutTemp : [...withoutTemp, data];
    });
    afterMessageSent(conversationId);
    requestPush({ type: "message", message_id: data.id });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setText("");
    send(content);
  };

  if (loading) return <FullScreenLoader />;

  if (notFound) {
    return (
      <Screen className="items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-bold">Conversation not found</p>
        <Button variant="secondary" onClick={() => navigate("/messages", { replace: true })}>
          Back to messages
        </Button>
      </Screen>
    );
  }

  const name = other?.display_name || other?.username || "User";

  return (
    <Screen>
      <header className="z-10 flex shrink-0 items-center gap-2 px-3 pb-2 pt-safe">
        <IconButton label="Back" onClick={goBack}>
          <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
        </IconButton>
        <Link to={other ? `/profile/${other.user_id}` : "#"} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar src={other?.avatar_url} name={name} size="h-9 w-9" />
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-extrabold leading-tight">{name}</span>
            {other?.username && <span className="block truncate text-xs text-muted-foreground">@{other.username}</span>}
          </span>
        </Link>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="scroll-area min-h-0 flex-1 px-3 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Avatar src={other?.avatar_url} name={name} size="h-20 w-20" className="text-2xl" />
            <p className="font-semibold">{name}</p>
            <p className="text-sm text-muted-foreground">Send a message to start chatting.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-0.5">
            {messages.map((m, i) => {
              const mine = m.sender_id === user?.id;
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const time = new Date(m.created_at);
              const showTime = !prev || time.getTime() - new Date(prev.created_at).getTime() > 15 * 60 * 1000;
              const groupedWithNext =
                next && next.sender_id === m.sender_id && new Date(next.created_at).getTime() - time.getTime() < 60 * 1000;
              return (
                <motion.li
                  key={m.id}
                  layout="position"
                  initial={{ opacity: 0, y: 16, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={spring.bouncy}
                  style={{ originX: mine ? 1 : 0 }}
                  className="flex flex-col"
                >
                  {showTime && <span className="my-3 text-center text-[11px] font-medium text-muted-foreground">{dayLabel(time)}</span>}
                  <div className={cn("flex", mine ? "justify-end" : "justify-start", !groupedWithNext && "mb-1.5")}>
                    <button
                      type="button"
                      disabled={!m.failed}
                      onClick={() => m.failed && send(m.content, m.id)}
                      className={cn(
                        "max-w-[78%] whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-left text-[15px] leading-snug transition-opacity",
                        mine ? "glitch-bg font-medium text-accent-foreground" : "bg-muted text-foreground",
                        mine && !groupedWithNext && "rounded-br-md",
                        !mine && !groupedWithNext && "rounded-bl-md",
                        m.pending && "opacity-60",
                        m.failed && "bg-destructive text-destructive-foreground",
                      )}
                    >
                      {m.content}
                    </button>
                  </div>
                  {m.failed && <span className="mb-1.5 text-right text-[11px] text-destructive">Not sent · tap to retry</span>}
                  {mine && !next && !m.pending && !m.failed && (
                    <span className="mb-1 mr-1 text-right text-[11px] text-muted-foreground">{m.is_read ? "Seen" : "Sent"}</span>
                  )}
                </motion.li>
              );
            })}
          </ol>
        )}
      </div>

      <form onSubmit={submit} className="flex shrink-0 items-end gap-2 px-3 pb-safe pt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="Message…"
          aria-label="Message"
          enterKeyHint="send"
          className="h-12 flex-1 rounded-full border-2 border-transparent bg-muted px-5 text-[16px] placeholder:text-muted-foreground/70 focus:border-accent/70 focus:outline-none"
        />
        <IconButton type="submit" label="Send" variant="accent" disabled={!text.trim()} className="h-12 w-12">
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
        </IconButton>
      </form>
    </Screen>
  );
}
