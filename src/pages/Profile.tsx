import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Camera, Grid3X3, MapPin, MessageCircle, Play, Settings, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ProfileRow } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/TopBar";
import { SettingsSheet } from "@/components/SettingsSheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { FullScreenLoader, Spinner } from "@/components/ui/Spinner";
import { normalizeUsername, validateUsername } from "@/lib/constants";
import { resizeImage, uploadMedia } from "@/lib/media";
import { cn, errorMessage, shortTimeAgo } from "@/lib/utils";

type GridPost = { id: string; media_url: string; media_type: "image" | "video"; happ_id: string };
type JoinedHapp = {
  id: string;
  name: string;
  suburb: string | null;
  icon_url: string | null;
  is_active: boolean;
  last_activity_at: string;
  creator_id: string;
};

export default function Profile() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user, setProfile: setOwnProfile } = useAuth();
  const targetId = userId ?? user?.id;
  const isOwn = !userId || userId === user?.id;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [posts, setPosts] = useState<GridPost[]>([]);
  const [happs, setHapps] = useState<JoinedHapp[] | null>(null);
  const [stats, setStats] = useState({ followers: 0, following: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"posts" | "happs">("posts");
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    setLoading(true);
    setTab("posts");
    setHapps(null);
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
      setProfile(profileRes.data);
      setPosts((postsRes.data as GridPost[]) ?? []);
      setStats({ followers: followersRes.count ?? 0, following: followingRes.count ?? 0 });
      setIsFollowing(Boolean(followRes.data));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId, user, isOwn]);

  // The old "happs" tab just showed the posts grid again.
  useEffect(() => {
    if (tab !== "happs" || happs !== null || !targetId) return;
    supabase
      .from("happ_participants")
      .select("joined_at, happ:happs(id, name, suburb, icon_url, is_active, last_activity_at, creator_id)")
      .eq("user_id", targetId)
      .order("joined_at", { ascending: false })
      .limit(60)
      .then(({ data }) => {
        const rows = (data as unknown as { happ: JoinedHapp | null }[]) ?? [];
        setHapps(rows.map((r) => r.happ).filter((h): h is JoinedHapp => Boolean(h)));
      });
  }, [tab, happs, targetId]);

  const toggleFollow = async () => {
    if (!user || !targetId || followBusy) return;
    setFollowBusy(true);
    const next = !isFollowing;
    setIsFollowing(next);
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
    if (!targetId) return;
    setMessageBusy(true);
    const { data, error } = await supabase.rpc("get_or_create_conversation", { p_other_user: targetId });
    setMessageBusy(false);
    if (error || !data) {
      toast.error(errorMessage(error, "Couldn't open the conversation"));
      return;
    }
    navigate(`/messages/${data}`);
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
      <div className="flex min-h-dvh-screen flex-col bg-background">
        <TopBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <UserRound className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">This account doesn’t exist</p>
        </div>
      </div>
    );
  }

  const name = profile.display_name || profile.username || "No name";

  return (
    <div className="flex min-h-dvh-screen flex-col bg-background">
      <TopBar
        title={profile.username ? `@${profile.username}` : "Profile"}
        right={
          isOwn ? (
            <IconButton label="Settings" variant="ghost" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-5 w-5" />
            </IconButton>
          ) : null
        }
      />

      <main className="mx-auto w-full max-w-lg flex-1">
        <section className="space-y-5 px-5 pb-5 pt-2">
          <div className="flex items-center gap-6">
            <div className="relative">
              <Avatar src={profile.avatar_url} name={name} size="h-20 w-20" className="text-2xl ring-2 ring-accent/40 ring-offset-2 ring-offset-background" />
              {isOwn && (
                <>
                  <button
                    type="button"
                    onClick={() => avatarInput.current?.click()}
                    aria-label="Change profile photo"
                    className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-md ring-2 ring-background transition-transform active:scale-90"
                  >
                    {avatarBusy ? <Spinner className="h-4 w-4 text-accent-foreground" /> : <Camera className="h-4 w-4" />}
                  </button>
                  <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => changeAvatar(e.target.files?.[0])} />
                </>
              )}
            </div>
            <dl className="grid flex-1 grid-cols-3 text-center">
              {[
                ["Posts", posts.length],
                ["Followers", stats.followers],
                ["Following", stats.following],
              ].map(([label, value]) => (
                <div key={label}>
                  <dd className="text-lg font-bold tabular-nums">{value}</dd>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="text-[17px] font-semibold">{name}</h2>
            {profile.bio ? (
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">{profile.bio}</p>
            ) : (
              isOwn && <p className="mt-1 text-sm text-muted-foreground">Add a bio so people know who you are.</p>
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
            </div>
          )}
        </section>

        <div className="sticky top-[calc(max(env(safe-area-inset-top),0.75rem)+3.25rem)] z-20 flex border-b border-border bg-background/90 backdrop-blur-xl" role="tablist">
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
                "relative flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors",
                tab === key ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
              <span
                className={cn(
                  "absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-foreground transition-transform duration-300 ease-smooth",
                  tab === key ? "scale-x-100" : "scale-x-0",
                )}
              />
            </button>
          ))}
        </div>

        {tab === "posts" ? (
          posts.length === 0 ? (
            <EmptyTab icon={<Grid3X3 className="h-8 w-8" />} text={isOwn ? "Your posts will show up here" : "No posts yet"} />
          ) : (
            <div className="grid grid-cols-3 gap-0.5 pb-safe">
              {posts.map((p) => (
                <Link
                  key={p.id}
                  to={`/happ/${p.happ_id}/story/${targetId}?post=${p.id}`}
                  className="relative aspect-square overflow-hidden bg-muted"
                >
                  {p.media_type === "video" ? (
                    <>
                      <video src={`${p.media_url}#t=0.1`} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      <Play className="absolute right-2 top-2 h-4 w-4 fill-white text-white drop-shadow" />
                    </>
                  ) : (
                    <img src={p.media_url} alt="" loading="lazy" className="h-full w-full object-cover transition-opacity hover:opacity-90" />
                  )}
                </Link>
              ))}
            </div>
          )
        ) : happs === null ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : happs.length === 0 ? (
          <EmptyTab icon={<MapPin className="h-8 w-8" />} text={isOwn ? "Happs you join or create show up here" : "No happs yet"} />
        ) : (
          <ul className="divide-y divide-border pb-safe">
            {happs.map((h) => (
              <li key={h.id}>
                <Link to={`/happ/${h.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
                  <Avatar src={h.icon_url} name={h.name} size="h-12 w-12" className={cn("ring-2", h.is_active ? "ring-live" : "ring-dead")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{h.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {h.creator_id === targetId ? "Created" : "Joined"}
                      {h.suburb ? ` · ${h.suburb}` : ""}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{shortTimeAgo(h.last_activity_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
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
    </div>
  );
}

function EmptyTab({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center text-muted-foreground">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">{icon}</span>
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
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ display_name: profile.display_name ?? "", username: profile.username ?? "", bio: profile.bio ?? "" });
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
        <Button type="submit" size="lg" className="w-full" loading={saving}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}
