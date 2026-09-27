import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Camera, MapPin, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { HappRow } from "@/integrations/supabase/types";
import { useRealtime } from "@/hooks/useRealtime";
import { TopBar } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { FullScreenLoader } from "@/components/ui/Spinner";
import { draftStore } from "@/lib/draft";
import { cn, timeAgo } from "@/lib/utils";

type Participant = {
  id: string;
  user_id: string;
  is_active: boolean;
  dh_pressed: boolean;
  profile: { username: string | null; display_name: string | null; avatar_url: string | null } | null;
};

const MAX_ORBIT = 10;

function orbitPosition(index: number, total: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { left: `${50 + 40 * Math.cos(angle)}%`, top: `${50 + 40 * Math.sin(angle)}%` };
}

export default function HappDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [happ, setHapp] = useState<HappRow | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [postsBy, setPostsBy] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [happRes, partRes, postRes] = await Promise.all([
      supabase.from("happs").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("happ_participants")
        .select("id, user_id, is_active, dh_pressed, profile:profiles(username, display_name, avatar_url)")
        .eq("happ_id", id)
        .order("last_activity_at", { ascending: false }),
      supabase.from("posts").select("user_id").eq("happ_id", id),
    ]);
    setHapp(happRes.data);
    setParticipants((partRes.data as unknown as Participant[]) ?? []);
    setPostsBy(new Set((postRes.data ?? []).map((p) => p.user_id)));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtime(
    id
      ? [
          { table: "happ_participants", filter: `happ_id=eq.${id}` },
          { table: "happs", event: "UPDATE", filter: `id=eq.${id}` },
        ]
      : null,
    load,
  );

  if (loading) return <FullScreenLoader />;

  if (!happ) {
    return (
      <div className="flex min-h-dvh-screen flex-col bg-background">
        <TopBar />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <MapPin className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">This happ doesn’t exist anymore</p>
          <Button variant="secondary" onClick={() => navigate("/map")}>
            Back to the map
          </Button>
        </div>
      </div>
    );
  }

  const orbit = participants.slice(0, MAX_ORBIT);
  const overflow = participants.length - orbit.length;
  const orbitCount = orbit.length + (overflow > 0 ? 1 : 0);

  const openStory = (userId: string) => navigate(`/happ/${happ.id}/story/${userId}`);

  const joinAndPost = () => {
    draftStore.setTarget({ kind: "existing", happId: happ.id, happName: happ.name });
    navigate("/camera");
  };

  return (
    <div className="flex min-h-dvh-screen flex-col bg-background">
      <TopBar title={happ.name} subtitle={happ.suburb} />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-safe">
        <div className="flex items-center justify-center gap-2 pt-1 text-sm">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold",
              happ.is_active ? "bg-live/15 text-live" : "bg-dead/15 text-dead",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", happ.is_active ? "animate-pulse bg-live" : "bg-dead")} />
            {happ.is_active ? "Live" : "Dead Happ"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {participants.length} {participants.length === 1 ? "person" : "people"}
          </span>
        </div>

        {happ.description && (
          <p className="mx-auto mt-4 max-w-sm text-center text-[15px] leading-relaxed text-muted-foreground">{happ.description}</p>
        )}

        <div className="flex flex-1 items-center justify-center py-6">
          <div className="relative aspect-square w-full max-w-[340px]">
            <div className="absolute inset-[10%] rounded-full border border-dashed border-border" />

            <button
              type="button"
              onClick={() => navigate(`/profile/${happ.creator_id}`)}
              aria-label="View creator"
              className={cn(
                "absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full bg-muted shadow-xl transition-transform duration-200 hover:scale-105",
                happ.is_active ? "ring-4 ring-live" : "ring-4 ring-dead",
              )}
            >
              {happ.icon_url ? (
                <img src={happ.icon_url} alt={happ.name} className="h-full w-full object-cover" />
              ) : (
                <span className="px-2 text-center text-lg font-bold leading-tight">{happ.name}</span>
              )}
            </button>

            {orbit.map((p, i) => {
              const hasPosts = postsBy.has(p.user_id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => (hasPosts ? openStory(p.user_id) : navigate(`/profile/${p.user_id}`))}
                  style={orbitPosition(i, orbitCount)}
                  aria-label={p.profile?.username ? `@${p.profile.username}` : "Participant"}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                >
                  <span className="block animate-pop-in" style={{ animationDelay: `${i * 40}ms` }}>
                  <Avatar
                    src={p.profile?.avatar_url}
                    name={p.profile?.display_name || p.profile?.username}
                    size="h-14 w-14"
                    className={cn(
                      "shadow-md ring-[3px] ring-offset-2 ring-offset-background transition-transform duration-200 hover:scale-110",
                      p.dh_pressed ? "ring-dead" : hasPosts ? "ring-live" : "ring-border",
                    )}
                  />
                  </span>
                </button>
              );
            })}

            {overflow > 0 && (
              <span
                style={orbitPosition(orbit.length, orbitCount)}
                className="absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
              >
                +{overflow}
              </span>
            )}
          </div>
        </div>

        <p className="mb-4 text-center text-xs text-muted-foreground">
          Started {timeAgo(happ.created_at)} · active {timeAgo(happ.last_activity_at)}
        </p>

        <Button size="lg" className="w-full" onClick={joinAndPost}>
          <Camera className="h-5 w-5" /> Join & post
        </Button>
      </main>
    </div>
  );
}
