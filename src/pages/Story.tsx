import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { Heart, MessageCircle, Send, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useGoBack } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { FullScreenLoader, Spinner } from "@/components/ui/Spinner";
import { Stagger, StaggerItem, spring } from "@/components/motion";
import {
  addComment,
  fetchComments,
  fetchHapp,
  fetchProfiles,
  fetchStory,
  isVideoPost,
  setLike,
  type CommentWithProfile,
  type ProfileLite,
  type StoryPost,
} from "@/lib/api";
import { cn, shortTimeAgo } from "@/lib/utils";

export default function Story() {
  const { id: happId, storyId: authorId } = useParams<{ id: string; storyId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const close = useGoBack(happId ? `/happ/${happId}` : "/map");
  const { user } = useAuth();

  const [posts, setPosts] = useState<StoryPost[]>([]);
  const [author, setAuthor] = useState<ProfileLite | undefined>();
  const [happName, setHappName] = useState<string | null>(null);
  const [[index, direction], setPage] = useState<[number, number]>([0, 0]);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [heartBurst, setHeartBurst] = useState(0);
  const liking = useRef(false);

  useEffect(() => {
    if (!happId || !authorId) return;
    let cancelled = false;
    (async () => {
      const [list, profiles, happ] = await Promise.all([
        fetchStory(happId, authorId, user?.id),
        fetchProfiles([authorId]),
        fetchHapp(happId),
      ]);
      if (cancelled) return;
      setPosts(list);
      setAuthor(profiles.get(authorId));
      setHappName(happ?.name ?? null);
      // Open on the post that was tapped.
      const start = list.findIndex((p) => p.id === params.get("post"));
      setPage([start >= 0 ? start : 0, 0]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [happId, authorId, user, params]);

  const post = posts[index];

  const go = useCallback(
    (delta: number) =>
      setPage(([i]) => {
        const next = Math.min(Math.max(i + delta, 0), Math.max(posts.length - 1, 0));
        return [next, delta];
      }),
    [posts.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (commentsOpen) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, close, commentsOpen]);

  const toggleLike = async () => {
    if (!user || !post || liking.current) return;
    liking.current = true;
    const liked = !post.isLiked;
    const patch = (value: boolean) =>
      setPosts((list) =>
        list.map((p) =>
          p.id === post.id ? { ...p, isLiked: value, likesCount: Math.max(0, p.likesCount + (value ? 1 : -1)) } : p,
        ),
      );
    patch(liked);
    if (liked) setHeartBurst((n) => n + 1);
    try {
      await setLike(post.id, user.id, liked);
    } catch {
      patch(!liked);
      toast.error("Couldn't update like");
    }
    liking.current = false;
  };

  // Swipe: down closes, left/right changes post.
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.y > 120 || velocity.y > 800) close();
    else if (offset.x < -80 || velocity.x < -600) go(1);
    else if (offset.x > 80 || velocity.x > 600) go(-1);
  };

  if (loading) return <FullScreenLoader />;

  if (!post) {
    return (
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-app p-8 text-center">
        <p className="text-lg font-bold">No posts here yet</p>
        <Button variant="secondary" onClick={close}>
          Go back
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={spring.snappy}
      className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-black text-white"
    >
      {/* Media: drag to navigate / dismiss */}
      <motion.div
        className="absolute inset-0"
        drag
        dragSnapToOrigin
        dragElastic={{ top: 0.1, bottom: 0.6, left: 0.3, right: 0.3 }}
        dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
        onDragEnd={onDragEnd}
      >
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={post.id}
            custom={direction}
            variants={{
              enter: (d: number) => ({ x: d > 0 ? "100%" : d < 0 ? "-100%" : 0, opacity: d === 0 ? 0 : 1, scale: 0.96 }),
              center: { x: 0, opacity: 1, scale: 1 },
              exit: (d: number) => ({ x: d > 0 ? "-35%" : "35%", opacity: 0, scale: 0.9 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring.snappy}
            className="absolute inset-0 flex items-center justify-center"
            onDoubleClick={() => !post.isLiked && toggleLike()}
          >
            {isVideoPost(post) ? (
              <video src={post.media_url} className="h-full w-full object-contain" autoPlay playsInline loop muted={muted} />
            ) : (
              <img src={post.media_url} alt={post.caption ?? "Post"} className="h-full w-full object-contain" draggable={false} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Tap zones */}
        <button type="button" aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3" onClick={() => go(-1)} />
        <button type="button" aria-label="Next" className="absolute inset-y-0 right-0 w-1/3" onClick={() => go(1)} />

        <AnimatePresence>
          {heartBurst > 0 && (
            <motion.div
              key={heartBurst}
              initial={{ scale: 0, opacity: 1 }}
              animate={{ scale: [0, 1.3, 1], opacity: [1, 1, 0] }}
              transition={{ duration: 0.8, times: [0, 0.4, 1] }}
              onAnimationComplete={() => setHeartBurst(0)}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <Heart className="h-28 w-28 fill-accent text-accent drop-shadow-2xl" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Top */}
      <div className="pointer-events-none relative z-20 bg-gradient-to-b from-black/70 to-transparent px-3 pb-10 pt-safe">
        <div className="flex gap-1">
          {posts.map((p, i) => (
            <span key={p.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
              <motion.span
                className="block h-full rounded-full bg-white"
                initial={false}
                animate={{ width: i <= index ? "100%" : "0%" }}
                transition={spring.snappy}
              />
            </span>
          ))}
        </div>
        <div className="pointer-events-auto mt-3 flex items-center gap-3">
          <Link to={`/profile/${post.user_id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar src={author?.avatar_url} name={author?.display_name || author?.username} size="h-10 w-10" className="ring-2 ring-accent" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold">{author?.username ? `@${author.username}` : "User"}</span>
              <span className="block truncate text-xs text-white/70">
                {happName ? `${happName} · ` : ""}
                {shortTimeAgo(post.created_at)}
              </span>
            </span>
          </Link>
          {isVideoPost(post) && (
            <IconButton label={muted ? "Unmute" : "Mute"} className="bg-white/15 text-white backdrop-blur-md" onClick={() => setMuted((m) => !m)}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </IconButton>
          )}
          <IconButton label="Close" className="bg-white/15 text-white backdrop-blur-md" onClick={close}>
            <X className="h-6 w-6" />
          </IconButton>
        </div>
      </div>

      <div className="flex-1" />

      {/* Bottom */}
      <div className="pointer-events-none relative z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-safe pt-20">
        {post.caption && (
          <motion.p key={post.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 text-[16px] font-medium leading-relaxed">
            {post.caption}
          </motion.p>
        )}
        <div className="pointer-events-auto flex items-center gap-2 pb-1">
          <motion.button
            type="button"
            onClick={toggleLike}
            aria-pressed={post.isLiked}
            aria-label={post.isLiked ? "Unlike" : "Like"}
            whileTap={{ scale: 0.8 }}
            transition={spring.bouncy}
            className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-3 backdrop-blur-md"
          >
            <motion.span key={String(post.isLiked)} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring.bouncy}>
              <Heart className={cn("h-5 w-5", post.isLiked && "fill-accent text-accent")} />
            </motion.span>
            <span className="text-sm font-bold tabular-nums">{post.likesCount}</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={() => setCommentsOpen(true)}
            aria-label="Comments"
            whileTap={{ scale: 0.8 }}
            transition={spring.bouncy}
            className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-3 backdrop-blur-md"
          >
            <MessageCircle className="h-5 w-5" />
            <span className="text-sm font-bold tabular-nums">{post.commentsCount}</span>
          </motion.button>
          <span className="ml-auto text-xs font-semibold tabular-nums text-white/60">
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
    </motion.div>
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
  const { user, profile } = useAuth();
  const [comments, setComments] = useState<CommentWithProfile[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setComments(null);
    fetchComments(postId).then((list) => {
      if (!cancelled) setComments(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, postId]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [comments]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || !user) return;
    setSending(true);
    try {
      const row = await addComment(postId, user.id, content);
      setText("");
      setComments((list) => [...(list ?? []), { ...row, profile: profile ?? undefined }]);
      onAdded();
    } catch {
      toast.error("Couldn't post your comment");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Comments">
      <div className="min-h-[9rem]">
        {comments === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : comments.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No comments yet. Say something nice.</p>
        ) : (
          <Stagger className="space-y-4 pb-2">
            {comments.map((c) => (
              <StaggerItem key={c.id} className="flex gap-3">
                <button type="button" onClick={() => onProfile(c.user_id)} aria-label="View profile">
                  <Avatar src={c.profile?.avatar_url} name={c.profile?.display_name || c.profile?.username} size="h-9 w-9" />
                </button>
                <div className="min-w-0 flex-1 rounded-3xl rounded-tl-lg bg-muted px-4 py-2.5">
                  <p className="text-sm">
                    <span className="font-bold">{c.profile?.username ?? "user"}</span>{" "}
                    <span className="text-xs text-muted-foreground">{shortTimeAgo(c.created_at)}</span>
                  </p>
                  <p className="break-words text-[15px] leading-snug" data-selectable>
                    {c.content}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}
        <div ref={listEnd} />
      </div>
      <form onSubmit={submit} className="sticky bottom-0 -mx-1 mt-3 flex items-center gap-2 bg-card px-1 pb-1 pt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          className="h-12 flex-1 rounded-full border-2 border-transparent bg-muted px-5 text-[16px] placeholder:text-muted-foreground/70 focus:border-accent/70 focus:outline-none"
        />
        <IconButton type="submit" label="Send" variant="accent" size="md" disabled={!text.trim() || sending} className="h-12 w-12">
          {sending ? <Spinner className="h-4 w-4 text-accent-foreground" /> : <Send className="h-5 w-5" />}
        </IconButton>
      </form>
    </Sheet>
  );
}
