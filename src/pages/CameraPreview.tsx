import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/motion";
import { createHapp, createPost } from "@/lib/api";
import { draftStore, useDraft } from "@/lib/draft";
import { uploadMedia, uploadPoster, videoPoster } from "@/lib/media";
import { forgetCache } from "@/lib/cache";
import { requestPush } from "@/lib/push";
import { errorMessage } from "@/lib/utils";

export default function CameraPreview() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { target, media } = useDraft();
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const done = useRef(false);

  // Nothing captured (e.g. after a refresh) — go back instead of showing an empty screen.
  useEffect(() => {
    if (done.current) return;
    if (!target) navigate("/map", { replace: true });
    else if (!media) navigate("/camera", { replace: true });
  }, [target, media, navigate]);

  if (!target || !media) return null;

  const retake = () => {
    draftStore.clearMedia();
    navigate("/camera", { replace: true });
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const post = async () => {
    if (!user) return;
    try {
      setStatus(media.type === "video" ? "Uploading video…" : "Uploading photo…");
      const mediaUrl = await uploadMedia(user.id, media.blob, media.type === "video" ? "video" : "photo");
      // Videos get a poster frame so grids can show a small picture instead of loading the clip.
      if (media.type === "video") {
        void videoPoster(media.blob).then((poster) => poster && uploadPoster(mediaUrl, poster).catch(() => undefined));
      }

      let happId: string;
      if (target.kind === "existing") {
        happId = target.happId;
      } else {
        setStatus("Creating your happ…");
        const iconUrl = await uploadMedia(user.id, target.happ.icon, "icon");
        happId = await createHapp(
          {
            name: target.happ.name,
            description: target.happ.description || null,
            latitude: target.happ.latitude,
            longitude: target.happ.longitude,
            suburb: target.happ.suburb,
            icon_url: iconUrl,
            starts_at: target.happ.startsAt,
          },
          user.id,
        );
        // If the post below fails, "try again" posts to this happ rather than making another.
        draftStore.happCreated(happId);
      }

      setStatus("Posting…");
      await createPost(
        { happ_id: happId, media_url: mediaUrl, media_type: media.type, caption: caption.trim() || null },
        user.id,
      );

      const isNew = target.kind === "new" || target.justCreated;
      if (isNew) requestPush({ type: "happ", happ_id: happId });

      forgetCache(`profile:${user.id}`);
      done.current = true;
      toast.success(isNew ? "Your happ is live!" : "Posted!");
      navigate(`/happ/${happId}`, { replace: true });
      draftStore.clear();
    } catch (err) {
      console.error("Post failed:", err);
      toast.error(errorMessage(err, "Couldn't post. Please try again."));
      setStatus(null);
    }
  };

  const busy = status !== null;

  return (
    <Screen>
      <TopBar
        title={target.kind === "new" || target.justCreated ? "New happ" : "New post"}
        onBack={retake}
        right={
          <Button variant="ghost" size="sm" onClick={retake} disabled={busy} className="px-3">
            <RotateCcw className="h-4 w-4" /> Retake
          </Button>
        }
      />

      <main className="scroll-area mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-4 px-4 pb-safe">
        <div className="relative shrink-0 overflow-hidden rounded-4xl bg-black shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)]">
          {media.type === "image" ? (
            <img src={media.previewUrl} alt="Your capture" className="max-h-[55dvh] w-full object-contain" />
          ) : (
            <>
              <video
                ref={videoRef}
                src={media.previewUrl}
                className="max-h-[55dvh] w-full object-contain"
                autoPlay
                loop
                playsInline
                muted
                onClick={togglePlay}
              />
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
                className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md"
              >
                {playing ? <Pause className="h-4 w-4 fill-white" /> : <Play className="ml-0.5 h-4 w-4 fill-white" />}
              </button>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 rounded-full bg-muted px-4 py-3 text-sm">
          {target.kind === "new" ? (
            <>
              <Sparkles className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">
                Starting <span className="font-semibold">{target.happ.name}</span> · {target.happ.suburb}
              </span>
            </>
          ) : (
            <>
              <MapPin className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">
                Posting to <span className="font-semibold">{target.happName}</span>
              </span>
            </>
          )}
        </div>

        <div className="flex gap-3">
          <Avatar src={profile?.avatar_url} name={profile?.display_name || profile?.username} size="h-10 w-10" />
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
            placeholder="Add a caption…"
            aria-label="Caption"
            className="min-h-[5.5rem] flex-1 resize-none rounded-3xl border-2 border-transparent bg-muted px-4 py-3 text-[16px] placeholder:text-muted-foreground/70 focus:border-accent/70 focus:outline-none"
          />
        </div>

        <div className="mt-auto pt-2">
          <Button size="lg" className="w-full" onClick={post} disabled={busy}>
            {busy ? status : target.kind === "new" ? "Create happ & post" : target.justCreated ? "Try posting again" : "Post"}
          </Button>
        </div>
      </main>
    </Screen>
  );
}
