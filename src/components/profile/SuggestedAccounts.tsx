import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Store, X } from "lucide-react";
import { toast } from "sonner";
import type { AccountType } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { spring } from "@/components/motion";
import { sharedReason } from "@/lib/interests";
import { dismissSuggestion, fetchSuggestions, follow, unfollow, type Suggestion } from "@/lib/social";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  /** Only people, or only brands. */
  kind?: AccountType;
  /** Rank by similarity to this profile instead of to you. */
  like?: string;
  /** Called when a card opens a profile (e.g. to close a sheet first). */
  onOpen?: () => void;
  className?: string;
  /** Lets the row scroll to the screen edge; matches the parent's side padding. */
  bleed?: string;
};

/** Instagram-style "Suggested for you": a row of cards with Follow buttons. */
export function SuggestedAccounts({ title, kind, like, onOpen, className, bleed = "-mx-5 px-5" }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    fetchSuggestions({ kind, like, limit: 15 }).then((list) => !cancelled && setItems(list));
    return () => {
      cancelled = true;
    };
  }, [kind, like]);

  if (items && items.length === 0) return null;

  const toggle = async (s: Suggestion) => {
    if (!user) return;
    const next = !following.has(s.user_id);
    setFollowing((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(s.user_id);
      else copy.delete(s.user_id);
      return copy;
    });
    try {
      await (next ? follow(user.id, s.user_id) : unfollow(user.id, s.user_id));
    } catch {
      toast.error("Something went wrong");
      setFollowing((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(s.user_id);
        else copy.add(s.user_id);
        return copy;
      });
    }
  };

  const dismiss = (s: Suggestion) => {
    dismissSuggestion(s.user_id);
    setItems((list) => list?.filter((x) => x.user_id !== s.user_id) ?? null);
  };

  return (
    <section className={className}>
      <h3 className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className={cn("no-scrollbar flex gap-2.5 overflow-x-auto pb-1", bleed)}>
        {items === null
          ? Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[212px] w-[150px] shrink-0 animate-pulse rounded-3xl bg-muted/60" />)
          : null}
        <AnimatePresence initial={false}>
          {items?.map((s) => {
            const name = s.display_name || s.username;
            const brand = s.account_type === "brand";
            const reason = s.reason === "shared" ? sharedReason(s.shared_interests) : s.reason;
            const isFollowing = following.has(s.user_id);
            return (
              <motion.div
                key={s.user_id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8, width: 0, marginRight: -10 }}
                transition={spring.snappy}
                className="relative flex w-[150px] shrink-0 flex-col items-center rounded-3xl bg-muted/60 px-3 pb-3 pt-5 text-center"
              >
                <button
                  type="button"
                  aria-label={`Hide ${name}`}
                  onClick={() => dismiss(s)}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground active:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpen?.();
                    navigate(`/profile/${s.user_id}`);
                  }}
                  className="flex w-full flex-col items-center"
                >
                  <span className="relative block">
                    <Avatar src={s.avatar_url} name={name} size="h-[68px] w-[68px]" className="text-2xl" />
                    {brand && (
                      <span className="glitch-bg absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full text-accent-foreground ring-[3px] ring-card">
                        <Store className="h-3 w-3" strokeWidth={2.6} />
                      </span>
                    )}
                  </span>
                  <span className="mt-2.5 w-full truncate text-[14px] font-bold">{name}</span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {brand ? s.brand_category || "Brand" : `@${s.username}`}
                  </span>
                  <span className="mt-1 line-clamp-2 h-8 w-full text-[11px] leading-4 text-muted-foreground/90">{reason}</span>
                </button>
                <Button
                  size="sm"
                  variant={isFollowing ? "secondary" : "accent"}
                  className="mt-2.5 h-9 w-full"
                  onClick={() => toggle(s)}
                >
                  {isFollowing ? "Following" : s.follows_you ? "Follow back" : "Follow"}
                </Button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
