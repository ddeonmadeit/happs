import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { CameraOff, CheckCircle2, Clock, Users, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/TopBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { Screen, spring } from "@/components/motion";
import { useRealtime } from "@/hooks/useRealtime";
import { fetchHapp, fetchProfiles, type ProfileLite } from "@/lib/api";
import { checkIn, fetchGuests, formatCode, type CheckIn as CheckInResult, type Guest } from "@/lib/tickets";
import { cn, displayName, errorMessage } from "@/lib/utils";

type Shown = { result: CheckInResult; profile?: ProfileLite };

/** The host's door: scan ticket QR codes (or type a code) to let people in. */
export default function CheckIn() {
  const { id: happId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [happName, setHappName] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [shown, setShown] = useState<Shown | null>(null);
  const [camera, setCamera] = useState<"starting" | "on" | "off">("starting");
  const [code, setCode] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const lastScan = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const loadGuests = useCallback(async () => {
    if (!happId) return;
    const list = await fetchGuests(happId);
    setGuests(list);
    setProfiles(await fetchProfiles(list.map((g) => g.user_id)));
  }, [happId]);

  useEffect(() => {
    if (!happId || !user) return;
    fetchHapp(happId).then((h) => {
      setHappName(h?.name ?? null);
      setAllowed(h?.creator_id === user.id);
    });
    loadGuests();
  }, [happId, user, loadGuests]);

  useRealtime(happId ? [{ table: "tickets", filter: `happ_id=eq.${happId}` }] : null, loadGuests);

  const submit = useCallback(
    async (text: string) => {
      if (busy.current || !text.trim()) return;
      busy.current = true;
      try {
        const result = await checkIn(text);
        const profile = "user_id" in result ? (await fetchProfiles([result.user_id])).get(result.user_id) : undefined;
        setShown({ result, profile });
        navigator.vibrate?.(result.result === "admitted" ? 60 : [40, 60, 40]);
        if (result.result === "admitted") loadGuests();
      } catch (err) {
        setShown({ result: { result: "not_found" } });
        console.error(errorMessage(err));
      } finally {
        setTimeout(() => {
          busy.current = false;
          setShown(null);
        }, 2600);
      }
    },
    [loadGuests],
  );

  // Camera + QR scanning (a few frames a second is plenty).
  useEffect(() => {
    if (!allowed) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    (async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([
          import("jsqr"),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }),
        ]);
        stream = media;
        if (stopped) return media.getTracks().forEach((t) => t.stop());
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play().catch(() => undefined);
        setCamera("on");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const scan = () => {
          if (stopped) return;
          if (ctx && video.videoWidth && !busy.current) {
            const scale = Math.min(1, 480 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, {
              inversionAttempts: "dontInvert",
            });
            const text = found?.data;
            if (text && !(text === lastScan.current.text && Date.now() - lastScan.current.at < 4000)) {
              lastScan.current = { text, at: Date.now() };
              submit(text);
            }
          }
          timer = window.setTimeout(scan, 220);
        };
        scan();
      } catch {
        setCamera("off");
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [allowed, submit]);

  const manual = (e: FormEvent) => {
    e.preventDefault();
    submit(code);
    setCode("");
  };

  const inCount = guests.filter((g) => g.checked_in_at).length;

  if (allowed === false) {
    return (
      <Screen>
        <TopBar title="Check-in" />
        <p className="p-8 text-center text-muted-foreground">Only the host can check people in.</p>
      </Screen>
    );
  }

  return (
    <Screen className="bg-black">
      <TopBar
        title="Check-in"
        subtitle={happName ?? undefined}
        right={
          <IconButton label="Guest list" variant="glass" onClick={() => setListOpen(true)}>
            <Users className="h-5 w-5" />
          </IconButton>
        }
      />

      <div className="relative mx-4 aspect-square overflow-hidden rounded-4xl bg-neutral-900">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {camera !== "on" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            {camera === "starting" ? <Spinner /> : <CameraOff className="h-8 w-8" />}
            {camera === "off" && <p className="px-8 text-center text-sm">No camera. Type ticket codes below instead.</p>}
          </div>
        )}
        {/* Viewfinder */}
        <div className="pointer-events-none absolute inset-[18%] rounded-3xl border-2 border-cream/70 shadow-[0_0_0_999px_rgb(0_0_0/0.35)]" />

        <AnimatePresence>
          {shown && (
            <motion.div
              key={JSON.stringify(shown.result)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={spring.snappy}
              className={cn(
                "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center",
                shown.result.result === "admitted"
                  ? "bg-emerald-600/90"
                  : shown.result.result === "already_checked_in"
                    ? "bg-amber-600/90"
                    : "bg-red-700/90",
              )}
            >
              {shown.result.result === "admitted" ? (
                <CheckCircle2 className="h-16 w-16" />
              ) : shown.result.result === "already_checked_in" ? (
                <Clock className="h-16 w-16" />
              ) : (
                <XCircle className="h-16 w-16" />
              )}
              <p className="text-2xl font-extrabold">{resultTitle(shown.result)}</p>
              {shown.profile && (
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  <Avatar src={shown.profile.avatar_url} name={displayName(shown.profile)} size="h-8 w-8" />
                  {displayName(shown.profile)}
                </span>
              )}
              {shown.result.result === "already_checked_in" && (
                <p className="text-sm opacity-90">
                  at {new Date(shown.result.checked_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mx-auto w-full max-w-md space-y-4 px-4 pb-safe pt-5">
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-4xl font-black tabular-nums">{inCount}</span>
          <span className="text-muted-foreground">of {guests.length} checked in</span>
        </div>
        <form onSubmit={manual} className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Type a ticket code"
            aria-label="Ticket code"
            autoCapitalize="characters"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-full border-2 border-transparent bg-muted px-5 font-mono text-[16px] tracking-wider placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground/70 focus:border-accent/70 focus:outline-none"
          />
          <Button type="submit" disabled={!code.trim()} className="h-12">
            Check in
          </Button>
        </form>
      </div>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title={`Guests · ${inCount}/${guests.length} in`} className="h-[80dvh]">
        {guests.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">No tickets sold yet.</p>
        ) : (
          <ul className="space-y-1 pb-4">
            {guests.map((g) => {
              const p = profiles.get(g.user_id);
              return (
                <li key={g.id} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                  <Avatar src={p?.avatar_url} name={displayName(p)} size="h-10 w-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{displayName(p)}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{formatCode(g.code)}</span>
                  </span>
                  {g.checked_in_at ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-accent">
                      <CheckCircle2 className="h-4 w-4" /> In
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => submit(g.code)}>
                      Check in
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </Screen>
  );
}

function resultTitle(r: CheckInResult) {
  switch (r.result) {
    case "admitted":
      return "Let them in";
    case "already_checked_in":
      return "Already checked in";
    case "not_valid":
      return r.status === "refunded" ? "Ticket was refunded" : "Not a valid ticket";
    case "wrong_happ":
      return "Ticket for another happ";
    default:
      return "Ticket not found";
  }
}
