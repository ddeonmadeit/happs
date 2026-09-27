import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Heart, MessageCircle, Send, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { PostRow } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useGoBack } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { FullScreenLoader, Spinner } from "@/components/ui/Spinner";
import { cn, shortTimeAgo } from "@/lib/utils";

type ProfileLite = { username: string | null; display_name: string | null; avatar_url: string | null };

type StoryPost = PostRow & {
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
};

type Comment = { id: string; content: string; created_at: string; user_id: string; profile: ProfileLite | null };

export default function Story() {
  const { id: happId, storyId: authorId } = useParams<{ id: string; storyId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const goBack = useGoBack(happId ? `/happ/${happId}` : "/map");
  const { user } = useAuth();

  const [posts, setPosts] = useState<StoryPost[]>([]);
  const [author, setAuthor] = useState<ProfileLite | null>(null);
  const [happName, setHappName] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const liking = useRef(false);

  useEffect(() => {
    if (!happId || !authorId) return;
    let cancelled = false;
    (async () => {
      // Counts come back embedded, instead of 3 extra queries per post.
      const [postsRes, authorRes, happRes] = await Promise.all([
        supabase
          .from("posts")
          .select("*, post_likes(count), comments(count)")
          .eq("happ_id", happId)
          .eq("user_id", authorId)
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("username, display_name, avatar_url").eq("user_id", authorId).maybeSingle(),
        supabase.from("happs").select("name").eq("id", happId).maybeSingle(),
      ]);
      if (cancelled) return;

      type Raw = PostRow & { post_likes: { count: number }[]; comments: { count: number }[] };
      const raw = (postsRes.data as unknown as Raw[]) ?? [];
      let liked = new Set<string>();
      if (user && raw.length) {
        const { data } = await supabase
          .from("post_likes")
          .select("post_id")
          .eq("user_id", user.id)
          .in(
            "post_id",
            raw.map((p) => p.id),
          );
        liked = new Set((data ?? []).map((l) => l.post_id));
      }
      if (cancelled) return;

      const list = raw.map(({ post_likes, comments, ...p }) => ({
        ...p,
        likesCount: post_likes?.[0]?.count ?? 0,
        commentsCount: comments?.[0]?.count ?? 0,
        isLiked: liked.has(p.id),
      }));
      setPosts(list);
      setAuthor(authorRes.data);
      setHappName(happRes.data?.name ?? null);
      // Open on the post that was tapped (the old viewer always started at the newest).
      const start = list.findIndex((p) => p.id === params.get("post"));
      setIndex(start >= 0 ? start : 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [happId, authorId, user, params]);

  const post = posts[index];

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(posts.length - 1, 0))),
    [posts.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (commentsOpen) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "Escape") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goBack, commentsOpen]);

  const toggleLike = async () => {
    if (!user || !post || liking.current) return;
    liking.current = true;
    const wasLiked = post.isLiked;
    const patch = (liked: boolean) =>
      setPosts((list) =>
        list.map((p) =>
          p.id === post.id ? { ...p, isLiked: liked, likesCount: Math.max(0, p.likesCount + (liked ? 1 : -1)) } : p,
        ),
      );
    patch(!wasLiked);
    const { error } = wasLiked
      ? await supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", user.id)
      : await supabase.from("post_likes").insert({ post_id: post.id, user_id: user.id });
    if (error && error.code !== "23505") {
      patch(wasLiked);
      toast.error("Couldn't update like");
    }
    liking.current = false;
  };

  if (loading) return <FullScreenLoader />;

  if (!post) {
    return (
      <div className="flex h-dvh-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <p className="font-medium">No posts here yet</p>
        <Button variant="secondary" onClick={goBack}>
          Go back
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      {/* Media */}
      <div className="absolute inset-0 flex items-center justify-center">
        {post.media_type === "video" ? (
          <video
            key={post.id}
            src={post.media_url}
            className="h-full w-full object-contain"
            autoPlay
            playsInline
            loop
            muted={muted}
          />
        ) : (
          <img key={post.id} src={post.media_url} alt={post.caption ?? "Post"} className="h-full w-full animate-fade-up object-contain" />
        )}
      </div>

      {/* Tap zones */}
      <button type="button" aria-label="Previous" className="absolute inset-y-0 left-0 z-10 w-1/3" onClick={() => go(-1)} />
      <button type="button" aria-label="Next" className="absolute inset-y-0 right-0 z-10 w-1/3" onClick={() => go(1)} />

      {/* Top */}
      <div className="relative z-20 bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 pt-safe">
        <div className="flex gap-1">
          {posts.map((p, i) => (
            <span key={p.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <span className={cn("block h-full bg-white transition-all duration-300", i <= index ? "w-full" : "w-0")} />
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Link to={`/profile/${post.user_id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar src={author?.avatar_url} name={author?.display_name || author?.username} size="h-9 w-9" className="ring-2 ring-white/20" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{author?.username ? `@${author.username}` : "User"}</span>
              <span className="block truncate text-xs text-white/70">
                {happName ? `${happName} · ` : ""}
                {shortTimeAgo(post.created_at)}
              </span>
            </span>
          </Link>
          {post.media_type === "video" && (
            <IconButton label={muted ? "Unmute" : "Mute"} variant="ghost" className="text-white hover:bg-white/10" onClick={() => setMuted((m) => !m)}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </IconButton>
          )}
          <IconButton label="Close" variant="ghost" className="text-white hover:bg-white/10" onClick={goBack}>
            <X className="h-6 w-6" />
          </IconButton>
        </div>
      </div>

      <div className="flex-1" />

      {/* Bottom */}
      <div className="relative z-20 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-4 pb-safe pt-16">
        {post.caption && <p className="mb-4 text-[15px] leading-relaxed">{post.caption}</p>}
        <div className="flex items-center gap-2 pb-1">
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={post.isLiked}
            aria-label={post.isLiked ? "Unlike" : "Like"}
            className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 backdrop-blur-md transition-transform active:scale-90"
          >
            <Heart className={cn("h-5 w-5 transition-all duration-200", post.isLiked && "scale-110 fill-red-500 text-red-500")} />
            <span className="text-sm font-semibold tabular-nums">{post.likesCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setCommentsOpen(true)}
            className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 backdrop-blur-md transition-transform active:scale-90"
          >
            <MessageCircle className="h-5 w-5" />
            <span className="text-sm font-semibold tabular-nums">{post.commentsCount}</span>
          </button>
          <span className="ml-auto text-xs tabular-nums text-white/60">
            {index + 1} / {posts.length}
          </span>
        </div>
      </div>

      <CommentsSheet
        postId={post.id}
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        onAdded={() =>
          setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, commentsCount: p.commentsCount + 1 } : p)))
        }
        onProfile={(uid) => navigate(`/profile/${uid}`)}
      />
    </div>
  );
}

function CommentsSheet({
  postId,
  open,
  onClose,
  onAdded,
  onProfile,
}: {
  postId: string;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  onProfile: (userId: string) => void;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setComments(null);
    supabase
      .from("comments")
      .select("id, content, created_at, user_id, profile:profiles(username, display_name, avatar_url)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setComments((data as unknown as Comment[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open, postId]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [comments]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || !user) return;
    setSending(true);
    const { data, error } = await supabase
      .from("comments")
      .insert({ post_id: postId, user_id: user.id, content })
      .select("id, content, created_at, user_id, profile:profiles(username, display_name, avatar_url)")
      .single();
    setSending(false);
    if (error || !data) {
      toast.error("Couldn't post your comment");
      return;
    }
    setText("");
    setComments((list) => [...(list ?? []), data as unknown as Comment]);
    onAdded();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Comments">
      <div className="-mx-1 max-h-[45dvh] min-h-[8rem] overflow-y-auto px-1">
        {comments === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : comments.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No comments yet. Say something nice.</p>
        ) : (
          <ul className="space-y-4 pb-2">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <button type="button" onClick={() => onProfile(c.user_id)} aria-label="View profile">
                  <Avatar src={c.profile?.avatar_url} name={c.profile?.display_name || c.profile?.username} size="h-8 w-8" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-semibold">{c.profile?.username ?? "user"}</span>{" "}
                    <span className="text-xs text-muted-foreground">{shortTimeAgo(c.created_at)}</span>
                  </p>
                  <p className="break-words text-[15px] leading-snug">{c.content}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={listEnd} />
      </div>
      <form onSubmit={submit} className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          className="h-11 flex-1 rounded-full bg-muted/70 px-4 text-[16px] placeholder:text-muted-foreground/70 focus:outline-none"
        />
        <IconButton type="submit" label="Send" variant="accent" disabled={!text.trim() || sending}>
          {sending ? <Spinner className="h-4 w-4 text-accent-foreground" /> : <Send className="h-4 w-4" />}
        </IconButton>
      </form>
    </Sheet>
  );
}
