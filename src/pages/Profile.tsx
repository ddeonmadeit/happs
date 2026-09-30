import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ChevronDown, Grid3X3, MapPin, MessageCircle, Play, Plus, Settings, Store, TicketIcon, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { HappRow, ProfileRow } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/TopBar";
import { SettingsSheet } from "@/components/SettingsSheet";
import { InterestChips, InterestPicker } from "@/components/profile/InterestPicker";
import { SuggestedAccounts } from "@/components/profile/SuggestedAccounts";
import { useTicketing } from "@/hooks/useTicketing";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { FullScreenLoader, Spinner } from "@/components/ui/Spinner";
import { Screen, Stagger, StaggerItem, spring } from "@/components/motion";
import { fetchJoinedHapps, getOrCreateConversation, isVideoPost } from "@/lib/api";
import { readCache, writeCache } from "@/lib/cache";
import { useThumb } from "@/hooks/useThumb";
import { posterUrl } from "@/lib/media";
import { normalizeUsername, validateUsername } from "@/lib/constants";
import { resizeImage, uploadMedia } from "@/lib/media";
import { BRAND_CATEGORIES } from "@/lib/interests";
import { cn, errorMessage, shortTimeAgo } from "@/lib/utils";

type GridPost = { id: string; media_url: string; media_type: string; happ_id: string };
type JoinedHapp = HappRow;
type ProfileData = {
  profile: ProfileRow | null;
  posts: GridPost[];
  stats: { followers: number; following: number };
  isFollowing: boolean;
};

export const profileCacheKey = (userId: string) => `profile:${userId}`;

export default function Profile() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user, profile: ownProfile, setProfile: setOwnProfile } = useAuth();
  const targetId = userId ?? user?.id;
  const isOwn = !userId || userId === user?.id;
  const ticketing = useTicketing();

  // Show what we had last time (or your own profile from sign-in) straight
  // away, and refresh underneath.
  const cached = targetId ? readCache<ProfileData>(profileCacheKey(targetId), { persist: isOwn }) : undefined;
  const [profile, setProfile] = useState<ProfileRow | null>(cached?.profile ?? (isOwn ? ownProfile : null));
  const [posts, setPosts] = useState<GridPost[] | null>(cached?.posts ?? null);
  const [happs, setHapps] = useState<JoinedHapp[] | null>(null);
  const [stats, setStats] = useState(cached?.stats ?? { followers: 0, following: 0 });
  const [isFollowing, setIsFollowing] = useState(cached?.isFollowing ?? false);
  const [loading, setLoading] = useState(!cached && !(isOwn && ownProfile));
  const [tab, setTab] = useState<"posts" | "happs">("posts");
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // "Suggested for you" under someone's profile, like Instagram after you follow.
  const [showSimilar, setShowSimilar] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    setTab("posts");
    setHapps(null);
    setShowSimilar(false);
    (async () => {
      const [profileRes, postsRes, followersRes, followingRes, followRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", targetId).maybeSingle(),
        supabase
          .from("posts")
          .select("id, media_url, media_type, happ_id")
          .eq("user_id", targetId)
          .order("created_at", { ascending: false }),
        supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", targetId),
        supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", targetId),
        user && !isOwn
          ? supabase.from("follows").select("id").eq("follower_id", user.id).eq("following_id", targetId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      const fresh: ProfileData = {
        profile: profileRes.data,
        posts: (postsRes.data as GridPost[]) ?? [],
        stats: { followers: followersRes.count ?? 0, following: followingRes.count ?? 0 },
        isFollowing: Boolean(followRes.data),
      };
      if (!profileRes.error) writeCache(profileCacheKey(targetId), fresh, { persist: isOwn });
      setProfile(fresh.profile);
      setPosts(fresh.posts);
      setStats(fresh.stats);
      setIsFollowing(fresh.isFollowing);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId, user, isOwn]);

  // The old "happs" tab just showed the posts grid again.
  useEffect(() => {
    if (tab !== "happs" || happs !== null || !targetId) return;
    fetchJoinedHapps(targetId).then(setHapps);
  }, [tab, happs, targetId]);

  const toggleFollow = async () => {
    if (!user || !targetId || followBusy) return;
    setFollowBusy(true);
    const next = !isFollowing;
    setIsFollowing(next);
    if (next) setShowSimilar(true);
    setStats((s) => ({ ...s, followers: Math.max(0, s.followers + (next ? 1 : -1)) }));
    const { error } = next
      ? await supabase.from("follows").insert({ follower_id: user.id, following_id: targetId })
      : await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", targetId);
    if (error && error.code !== "23505") {
      setIsFollowing(!next);
      setStats((s) => ({ ...s, followers: Math.max(0, s.followers + (next ? -1 : 1)) }));
      toast.error("Something went wrong");
    }
    setFollowBusy(false);
  };

  const startMessage = async () => {
    if (!targetId || !user) return;
    setMessageBusy(true);
    try {
      navigate(`/messages/${await getOrCreateConversation(user.id, targetId)}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't open the conversation"));
    } finally {
      setMessageBusy(false);
    }
  };

  const changeAvatar = async (file?: File) => {
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    setAvatarBusy(true);
    try {
      const url = await uploadMedia(user.id, await resizeImage(file, 512), "avatar");
      const { data, error } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;
      setProfile(data);
      setOwnProfile(data);
      toast.success("Photo updated");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update your photo"));
    } finally {
      setAvatarBusy(false);
    }
  };

  if (loading) return <FullScreenLoader />;

  if (!profile) {
    return (
      <Screen>
        <TopBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <UserRound className="h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-bold">This account doesn’t exist</p>
        </div>
      </Screen>
    );
  }

  const name = profile.display_name || profile.username || "No name";

  return (
    <Screen>
      <TopBar
        title={profile.username ? `@${profile.username}` : "Profile"}
        right={
          isOwn ? (
            <div className="flex items-center">
              {ticketing && (
                <IconButton label="Your tickets" variant="ghost" onClick={() => navigate("/tickets")}>
                  <TicketIcon className="h-5 w-5" />
                </IconButton>
              )}
              <IconButton label="Settings" variant="ghost" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-5 w-5" />
              </IconButton>
            </div>
          ) : null
        }
      />

      <main className="scroll-area mx-auto min-h-0 w-full max-w-lg flex-1">
        <section className="space-y-5 px-5 pb-5 pt-2">
          <div className="flex items-center gap-6">
            <div className="relative">
              <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring.bouncy}>
                <Avatar src={profile.avatar_url} name={name} size="h-[88px] w-[88px]" className="text-3xl ring-[3px] ring-accent ring-offset-[3px] ring-offset-background" />
              </motion.div>
              {isOwn && (
                <>
                  <motion.button
                    type="button"
                    onClick={() => avatarInput.current?.click()}
                    aria-label="Change profile photo"
                    whileTap={{ scale: 0.8 }}
                    transition={spring.bouncy}
                    className="glitch-bg absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full text-accent-foreground shadow-md ring-[3px] ring-background"
                  >
                    {avatarBusy ? <Spinner className="h-4 w-4 text-accent-foreground" /> : <Camera className="h-4 w-4" strokeWidth={2.5} />}
                  </motion.button>
                  <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => changeAvatar(e.target.files?.[0])} />
                </>
              )}
            </div>
            <dl className="grid flex-1 grid-cols-3 text-center">
              {[
                ["Posts", posts?.length ?? "–"],
                ["Followers", stats.followers],
                ["Following", stats.following],
              ].map(([label, value]) => (
                <div key={label}>
                  <dd className="text-xl font-extrabold tabular-nums">{value}</dd>
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 truncate text-xl font-extrabold tracking-tight">{name}</h2>
              {profile.account_type === "brand" && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">
                  <Store className="h-3 w-3" strokeWidth={2.6} />
                  {profile.brand_category || "Brand"}
                </span>
              )}
            </div>
            {profile.bio ? (
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">{profile.bio}</p>
            ) : (
              isOwn && <p className="mt-1 text-sm text-muted-foreground">Add a bio so people know who you are.</p>
            )}
            <InterestChips ids={profile.interests ?? []} className="mt-3" />
            {isOwn && profile.interests !== undefined && profile.interests.length === 0 && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="mt-3 flex items-center gap-1 rounded-full border border-dashed border-accent/50 px-3 py-1 text-xs font-bold text-accent"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.6} /> Add your interests
              </button>
            )}
          </div>

          {isOwn ? (
            <Button variant="secondary" className="w-full" onClick={() => setEditOpen(true)}>
              Edit profile
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant={isFollowing ? "secondary" : "accent"} className="flex-1" onClick={toggleFollow} disabled={followBusy}>
                {isFollowing ? "Following" : "Follow"}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={startMessage} loading={messageBusy}>
                <MessageCircle className="h-4 w-4" /> Message
              </Button>
              <IconButton
                label={showSimilar ? "Hide suggestions" : "Similar accounts"}
                variant="muted"
                className="h-11 w-11 rounded-2xl"
                onClick={() => setShowSimilar((v) => !v)}
              >
                <motion.span animate={{ rotate: showSimilar ? 180 : 0 }} transition={spring.snappy}>
                  <ChevronDown className="h-5 w-5" />
                </motion.span>
              </IconButton>
            </div>
          )}

          {isOwn ? (
            <SuggestedAccounts title="Discover people" />
          ) : (
            <AnimatePresence initial={false}>
              {showSimilar && targetId && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring.snappy}
                  className="overflow-hidden"
                >
                  <SuggestedAccounts title="Suggested for you" like={targetId} />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </section>

        <div className="sticky top-0 z-20 mx-5 mb-1 flex rounded-full bg-muted p-1" role="tablist">
          {(
            [
              ["posts", Grid3X3, "Posts"],
              ["happs", MapPin, "Happs"],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold transition-colors",
                tab === key ? "text-accent-foreground" : "text-muted-foreground",
              )}
            >
              {tab === key && (
                <motion.span layoutId="profile-tab" transition={spring.bouncy} className="glitch-bg absolute inset-0 rounded-full" />
              )}
              <span className="relative flex items-center gap-2">
                <Icon className="h-4 w-4" strokeWidth={2.5} /> {label}
              </span>
            </button>
          ))}
        </div>

        {tab === "posts" ? (
          posts === null ? (
            <div className="grid grid-cols-3 gap-1 px-1 pt-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <EmptyTab icon={<Grid3X3 className="h-8 w-8" />} text={isOwn ? "Your posts will show up here" : "No posts yet"} />
          ) : (
            <Stagger as="div" className="grid grid-cols-3 gap-1 px-1 pb-safe pt-2">
              {posts.map((p) => (
                <StaggerItem as="div" key={p.id}>
                <Link
                  to={`/happ/${p.happ_id}/story/${targetId}?post=${p.id}`}
                  className="relative block aspect-square overflow-hidden rounded-2xl bg-muted"
                >
                  <PostTile post={p} />
                </Link>
                </StaggerItem>
              ))}
            </Stagger>
          )
        ) : happs === null ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : happs.length === 0 ? (
          <EmptyTab icon={<MapPin className="h-8 w-8" />} text={isOwn ? "Happs you join or create show up here" : "No happs yet"} />
        ) : (
          <Stagger className="space-y-1 px-2 pb-safe pt-2">
            {happs.map((h) => (
              <StaggerItem key={h.id}>
                <Link to={`/happ/${h.id}`} className="flex items-center gap-3 rounded-3xl px-3 py-2.5 active:bg-muted">
                  <Avatar src={h.icon_url} name={h.name} size="h-12 w-12" className={cn("rounded-2xl ring-2", h.is_active ? "ring-accent" : "ring-dead")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{h.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {h.creator_id === targetId ? "Created" : "Joined"}
                      {h.suburb ? ` · ${h.suburb}` : ""}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{shortTimeAgo(h.last_activity_at)}</span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </main>

      {isOwn && (
        <>
          <EditProfileSheet
            open={editOpen}
            onClose={() => setEditOpen(false)}
            profile={profile}
            onSaved={(p) => {
              setProfile(p);
              setOwnProfile(p);
            }}
          />
          <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </>
      )}
    </Screen>
  );
}

/** A grid square: a small thumbnail (a poster frame for videos). */
function PostTile({ post }: { post: GridPost }) {
  const video = isVideoPost(post);
  const image = useThumb(video ? posterUrl(post.media_url) : post.media_url, 140, { square: true });
  return (
    <>
      {video && image.failed ? (
        <video src={`${post.media_url}#t=0.1`} className="h-full w-full object-cover" muted playsInline preload="metadata" />
      ) : (
        image.src && (
          <img
            src={image.src}
            alt=""
            crossOrigin="anonymous"
            decoding="async"
            className="h-full w-full object-cover"
            onLoad={image.onLoad}
            onError={image.onError}
          />
        )
      )}
      {video && <Play className="absolute right-2 top-2 h-4 w-4 fill-white text-white drop-shadow" />}
    </>
  );
}

function EmptyTab({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center text-muted-foreground">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">{icon}</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function EditProfileSheet({
  open,
  onClose,
  profile,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profile: ProfileRow;
  onSaved: (p: ProfileRow) => void;
}) {
  const [form, setForm] = useState({ display_name: "", username: "", bio: "" });
  const [interests, setInterests] = useState<string[]>([]);
  const [accountType, setAccountType] = useState<"person" | "brand">("person");
  const [category, setCategory] = useState<string | null>(null);
  // The original backend has none of these columns.
  const extended = profile.interests !== undefined;
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ display_name: profile.display_name ?? "", username: profile.username ?? "", bio: profile.bio ?? "" });
      setInterests(profile.interests ?? []);
      setAccountType(profile.account_type ?? "person");
      setCategory(profile.brand_category ?? null);
      setUsernameError(null);
    }
  }, [open, profile]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    // The old editor let you blank or duplicate your username, which then
    // locked you out behind the onboarding screen.
    const username = normalizeUsername(form.username);
    const invalid = validateUsername(username);
    if (invalid) {
      setUsernameError(invalid);
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("profiles")
      .update({
        username,
        display_name: form.display_name.trim() || null,
        bio: form.bio.trim() || null,
        ...(extended
          ? { interests, account_type: accountType, brand_category: accountType === "brand" ? category : null }
          : {}),
      })
      .eq("user_id", profile.user_id)
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      if (error.code === "23505") setUsernameError("That username is taken");
      else toast.error("Couldn't save your profile");
      return;
    }
    onSaved(data);
    toast.success("Profile updated");
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Edit profile">
      <form onSubmit={save} className="space-y-4">
        <Field label="Name" htmlFor="edit-name">
          <Input
            id="edit-name"
            value={form.display_name}
            maxLength={50}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            placeholder="Your name"
          />
        </Field>
        <Field label="Username" htmlFor="edit-username" error={usernameError}>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
            <Input
              id="edit-username"
              value={form.username}
              maxLength={20}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              invalid={Boolean(usernameError)}
              onChange={(e) => {
                setForm((f) => ({ ...f, username: normalizeUsername(e.target.value) }));
                setUsernameError(null);
              }}
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Bio" htmlFor="edit-bio" counter={`${form.bio.length}/150`}>
          <Textarea
            id="edit-bio"
            value={form.bio}
            maxLength={150}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            placeholder="A little about you"
            className="min-h-[5.5rem]"
          />
        </Field>
        {extended && (
          <>
            <Field label="Account type">
              <div className="grid grid-cols-2 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Account type">
                {(["person", "brand"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={accountType === option}
                    onClick={() => setAccountType(option)}
                    className="relative h-11 rounded-xl text-[15px] font-bold"
                  >
                    {accountType === option && (
                      <motion.span layoutId="account-type-pill" transition={spring.bouncy} className="glitch-bg absolute inset-0 rounded-xl" />
                    )}
                    <span className={cn("relative transition-colors", accountType === option ? "text-accent-foreground" : "text-muted-foreground")}>
                      {option === "person" ? "Personal" : "Brand"}
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            <AnimatePresence initial={false}>
              {accountType === "brand" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring.snappy}
                  className="overflow-hidden"
                >
                  <Field label="What kind of brand?">
                    <div className="flex flex-wrap gap-2">
                      {BRAND_CATEGORIES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={category === c}
                          onClick={() => setCategory(category === c ? null : c)}
                          className={cn(
                            "h-9 rounded-full px-3.5 text-sm font-bold transition-colors",
                            category === c ? "glitch-bg text-accent-foreground" : "bg-muted text-foreground/80",
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>
            <Field label="Interests" counter={`${interests.length}/10`} hint="Shown on your profile, and used to suggest people to follow">
              <InterestPicker value={interests} onChange={setInterests} />
            </Field>
          </>
        )}
        <Button type="submit" size="lg" className="w-full" loading={saving}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}
