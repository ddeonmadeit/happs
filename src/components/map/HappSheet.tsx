import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Camera, Users } from "lucide-react";
import type { HappRow } from "@/integrations/supabase/types";
import { fetchHapp, fetchParticipants, type Participant } from "@/lib/api";
import { useRealtime } from "@/hooks/useRealtime";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Pressable, spring, Stagger, StaggerItem } from "@/components/motion";
import { draftStore } from "@/lib/draft";
import { cn, shortTimeAgo } from "@/lib/utils";

type Props = {
  happId: string | null;
  onClose: () => void;
  onLoaded?: (happ: HappRow) => void;
};

/** Details for a happ, sliding up over the map (like a place card in Waze). */
export function HappSheet({ happId, onClose, onLoaded }: Props) {
  const navigate = useNavigate();
  const [happ, setHapp] = useState<HappRow | null>(null);
  const [people, setPeople] = useState<Participant[] | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!happId) return;
    const [h, p] = await Promise.all([fetchHapp(happId), fetchParticipants(happId)]);
    setMissing(!h);
    setHapp(h);
    setPeople(p);
    if (h) onLoaded?.(h);
  }, [happId, onLoaded]);

  useEffect(() => {
    setHapp(null);
    setPeople(null);
    setMissing(false);
    load();
  }, [load]);

  useRealtime(happId ? [{ table: "happ_participants", filter: `happ_id=eq.${happId}` }] : null, load);

  const storytellers = (people ?? []).filter((p) => p.hasPosts);

  const joinAndPost = () => {
    if (!happ) return;
    draftStore.setTarget({ kind: "existing", happId: happ.id, happName: happ.name });
    navigate("/camera");
  };

  return (
    <Sheet open={Boolean(happId)} onClose={onClose} dim="light">
      {missing ? (
        <div className="py-10 text-center">
          <p className="text-lg font-bold">This happ has ended</p>
          <p className="mt-1 text-muted-foreground">It’s no longer on the map.</p>
          <Button variant="secondary" className="mt-6" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : !happ ? (
        <div className="space-y-4 pb-4 pt-2">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 animate-pulse rounded-3xl bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-2/3 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-1/3 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
          <div className="h-14 animate-pulse rounded-full bg-muted" />
        </div>
      ) : (
        <div className="space-y-5 pb-3 pt-1">
          <div className="flex items-center gap-4">
            <motion.div initial={{ scale: 0.5, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy}>
              <Avatar
                src={happ.icon_url}
                name={happ.name}
                size="h-16 w-16"
                className={cn("rounded-3xl text-2xl ring-[3px]", happ.is_active ? "ring-accent" : "ring-dead")}
              />
            </motion.div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[22px] font-extrabold leading-tight tracking-tight">{happ.name}</h2>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide",
                    happ.is_active ? "bg-accent/15 text-accent" : "bg-dead/15 text-dead",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", happ.is_active ? "animate-pulse bg-accent" : "bg-dead")} />
                  {happ.is_active ? "Live" : "Dead"}
                </span>
                {happ.suburb && <span className="truncate text-muted-foreground">{happ.suburb}</span>}
              </div>
            </div>
          </div>

          {happ.description && <p className="text-[15px] leading-relaxed text-foreground/80">{happ.description}</p>}

          {storytellers.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Stories</h3>
              <Stagger as="div" className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 pb-1">
                {storytellers.map((p) => (
                  <StaggerItem as="div" key={p.id}>
                    <Pressable
                      onClick={() => navigate(`/happ/${happ.id}/story/${p.user_id}`)}
                      className="flex w-[68px] flex-col items-center gap-1.5"
                    >
                      <span className="rounded-full bg-gradient-to-tr from-accent to-amber-300 p-[3px]">
                        <Avatar
                          src={p.profile?.avatar_url}
                          name={p.profile?.display_name || p.profile?.username}
                          size="h-[58px] w-[58px]"
                          className="ring-[3px] ring-card"
                        />
                      </span>
                      <span className="w-full truncate text-center text-xs font-medium">
                        {p.profile?.username ?? "someone"}
                      </span>
                    </Pressable>
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          )}

          <div className="flex items-center gap-3 rounded-3xl bg-muted/60 px-4 py-3">
            <div className="flex -space-x-2.5">
              {(people ?? []).slice(0, 5).map((p) => (
                <Avatar
                  key={p.id}
                  src={p.profile?.avatar_url}
                  name={p.profile?.display_name || p.profile?.username}
                  size="h-8 w-8"
                  className="text-xs ring-2 ring-card"
                />
              ))}
              {(people?.length ?? 0) === 0 && (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                  <Users className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
            </div>
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-bold">{people?.length ?? 0}</span>{" "}
              <span className="text-muted-foreground">
                {people?.length === 1 ? "person" : "people"} here
              </span>
            </p>
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">{shortTimeAgo(happ.last_activity_at)} ago</span>
          </div>

          <Button size="lg" className="w-full" onClick={joinAndPost}>
            <Camera className="h-5 w-5" strokeWidth={2.5} /> Join & post
          </Button>
        </div>
      )}
    </Sheet>
  );
}
