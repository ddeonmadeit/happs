import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { CameraOff, ImageIcon, SwitchCamera, X } from "lucide-react";
import { toast } from "sonner";
import { useGoBack } from "@/components/TopBar";
import { Button, IconButton } from "@/components/ui/Button";
import { Screen, spring } from "@/components/motion";
import { Spinner } from "@/components/ui/Spinner";
import { draftStore, useDraft } from "@/lib/draft";
import { MAX_VIDEO_SECONDS } from "@/lib/constants";
import { baseMimeType, pickRecorderMimeType, resizeImage } from "@/lib/media";
import { cn } from "@/lib/utils";

type Mode = "photo" | "video";
type Facing = "environment" | "user";

function videoDuration(file: Blob) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    v.src = url;
  });
}

export default function Camera() {
  const navigate = useNavigate();
  const { target } = useDraft();
  const goBack = useGoBack("/map");

  const [mode, setMode] = useState<Mode>("photo");
  const [facing, setFacing] = useState<Facing>("environment");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Refs, not state: the old camera read stale state inside timers and
  // cleanups, so clips never auto-stopped at 15 s and the camera light
  // could stay on after leaving.
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // No happ chosen (e.g. page was refreshed) — nothing to post to.
  useEffect(() => {
    if (!target) {
      toast("Pick a happ first");
      navigate("/map", { replace: true });
    }
  }, [target, navigate]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      stopStream();
      const video: MediaTrackConstraints = {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      };
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: mode === "video" });
      } catch {
        // Mic refused? Still let people record silent clips / take photos.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (err) {
          console.error("Camera error:", err);
        }
      }
      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!stream) {
        setStatus("error");
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [facing, mode, attempt, stopStream]);

  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      stopStream();
    },
    [stopStream],
  );

  const finish = (blob: Blob, type: "image" | "video") => {
    draftStore.setMedia({ blob, type, mimeType: baseMimeType(blob.type), previewUrl: URL.createObjectURL(blob) });
    navigate("/camera/preview");
  };

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && finish(blob, "image"), "image/jpeg", 0.9);
  };

  const stopRecording = useCallback(() => {
    clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }, []);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      toast.error("Video recording isn't supported on this device");
      return;
    }
    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      const type = baseMimeType(recorder.mimeType || mimeType || "video/webm");
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size > 0) finish(blob, "video");
    };
    recorderRef.current = recorder;
    recorder.start(250);
    setRecording(true);
    setElapsed(0);

    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= MAX_VIDEO_SECONDS) stopRecording();
    }, 100);
  };

  const shutter = () => {
    if (status !== "ready") return;
    if (mode === "photo") takePhoto();
    else if (recording) stopRecording();
    else startRecording();
  };

  const pickFromLibrary = async (file?: File) => {
    if (!file) return;
    if (file.type.startsWith("video/")) {
      const duration = await videoDuration(file);
      if (duration > MAX_VIDEO_SECONDS + 0.5) {
        toast.error(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds`);
        return;
      }
      finish(file, "video");
    } else if (file.type.startsWith("image/")) {
      finish(await resizeImage(file, 2048, 0.88), "image");
    } else {
      toast.error("Please choose a photo or video");
    }
  };

  const progress = Math.min(elapsed / MAX_VIDEO_SECONDS, 1);
  const circumference = 2 * Math.PI * 36;
  const label = target?.kind === "existing" ? target.happName : target?.kind === "new" ? target.happ.name : "";

  return (
    <Screen className="bg-black text-white">
      <canvas ref={canvasRef} hidden />

      <div className="relative flex-1 overflow-hidden rounded-b-[36px] bg-neutral-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            facing === "user" && "-scale-x-100",
            status === "ready" ? "opacity-100" : "opacity-0",
          )}
        />

        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="text-white/60" />
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <CameraOff className="h-12 w-12 text-white/50" />
            <div>
              <p className="font-medium">Camera unavailable</p>
              <p className="mt-1 text-sm text-white/60">Allow camera access, or choose something from your library.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="bg-white/15 text-white hover:bg-white/25" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                Open library
              </Button>
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent px-3 pb-10 pt-safe">
          <IconButton label="Close camera" variant="ghost" className="bg-black/30 text-white backdrop-blur-md hover:bg-black/50" onClick={goBack}>
            <X className="h-6 w-6" />
          </IconButton>
          {recording ? (
            <span className="glitch-bg flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold tabular-nums text-accent-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-foreground" />
              0:{String(Math.floor(elapsed)).padStart(2, "0")} / 0:{MAX_VIDEO_SECONDS}
            </span>
          ) : (
            label && (
              <span className="max-w-[60%] truncate rounded-full bg-black/30 px-3.5 py-1.5 text-sm font-medium backdrop-blur-md">
                {label}
              </span>
            )
          )}
          <span className="w-11" />
        </div>
      </div>

      <div className="pb-safe pt-4">
        <div className="mb-5 flex justify-center">
          <div className="flex rounded-full bg-white/10 p-1 text-xs font-semibold uppercase tracking-wider">
            {(["photo", "video"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={recording}
                onClick={() => setMode(m)}
                className={cn(
                  "relative rounded-full px-5 py-2 transition-colors duration-200 disabled:opacity-50",
                  mode === m ? "text-black" : "text-white/70",
                )}
              >
                {mode === m && (
                  <motion.span layoutId="camera-mode" transition={spring.bouncy} className="absolute inset-0 rounded-full bg-white" />
                )}
                <span className="relative">{m}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-around px-8 pb-2">
          <IconButton
            label="Choose from library"
            variant="ghost"
            disabled={recording}
            className="h-12 w-12 bg-white/10 text-white hover:bg-white/20"
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon className="h-5 w-5" />
          </IconButton>

          <motion.button
            type="button"
            onClick={shutter}
            disabled={status !== "ready"}
            aria-label={mode === "photo" ? "Take photo" : recording ? "Stop recording" : "Start recording"}
            whileTap={{ scale: 0.85 }}
            transition={spring.bouncy}
            className="relative flex h-20 w-20 items-center justify-center rounded-full disabled:opacity-40"
          >
            <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
              <circle cx="40" cy="40" r="36" fill="none" stroke="white" strokeOpacity={recording ? 0.3 : 1} strokeWidth="4" />
              {recording && (
                <circle
                  cx="40"
                  cy="40"
                  r="36"
                  fill="none"
                  stroke="hsl(16 81% 49%)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - progress)}
                  className="transition-[stroke-dashoffset] duration-100 ease-linear"
                />
              )}
            </svg>
            <span
              className={cn(
                "transition-all duration-300 ease-spring",
                mode === "photo" && "h-[62px] w-[62px] rounded-full bg-white",
                mode === "video" && !recording && "glitch-bg h-[58px] w-[58px] rounded-full",
                mode === "video" && recording && "glitch-bg h-7 w-7 rounded-lg",
              )}
            />
          </motion.button>

          <IconButton
            label="Flip camera"
            variant="ghost"
            disabled={recording}
            className="h-12 w-12 bg-white/10 text-white hover:bg-white/20"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          >
            <SwitchCamera className="h-5 w-5" />
          </IconButton>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={mode === "video" ? "video/*,image/*" : "image/*,video/*"}
        hidden
        onChange={(e) => {
          pickFromLibrary(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </Screen>
  );
}
