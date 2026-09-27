import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ImagePlus, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Screen, spring } from "@/components/motion";
import { useGeolocation } from "@/hooks/useGeolocation";
import { draftStore, useDraft } from "@/lib/draft";
import { reverseGeocode } from "@/lib/mapbox";
import { resizeImage } from "@/lib/media";
import { cn } from "@/lib/utils";

export default function CreateHapp() {
  const navigate = useNavigate();
  const draft = useDraft();
  const previous = draft.target?.kind === "new" ? draft.target.happ : null;
  const { location, error: locationError, isLoading: locating, refresh } = useGeolocation();

  const [name, setName] = useState(previous?.name ?? "");
  const [description, setDescription] = useState(previous?.description ?? "");
  const [icon, setIcon] = useState<{ blob: Blob; preview: string } | null>(
    previous ? { blob: previous.icon, preview: previous.iconPreview } : null,
  );
  const [suburb, setSuburb] = useState<string | null>(previous?.suburb ?? null);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    reverseGeocode(location.latitude, location.longitude).then((place) => {
      if (!cancelled) setSuburb(place ?? "Current location");
    });
    return () => {
      cancelled = true;
    };
  }, [location]);

  const pickIcon = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    setProcessing(true);
    const blob = await resizeImage(file, 512);
    setProcessing(false);
    if (icon && icon.preview !== previous?.iconPreview) URL.revokeObjectURL(icon.preview);
    setIcon({ blob, preview: URL.createObjectURL(blob) });
  };

  const canContinue = Boolean(name.trim() && icon && location);

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (!icon || !location) return;
    draftStore.setTarget({
      kind: "new",
      happ: {
        name: name.trim(),
        description: description.trim(),
        latitude: location.latitude,
        longitude: location.longitude,
        suburb: suburb ?? "Current location",
        icon: icon.blob,
        iconPreview: icon.preview,
      },
    });
    navigate("/camera");
  };

  return (
    <Screen>
      <TopBar title="New happ" />

      <form onSubmit={next} className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
        <div className="scroll-area flex-1 space-y-6 px-5 pt-3">
          <div className="flex flex-col items-center gap-3">
            <motion.button
              type="button"
              onClick={() => fileRef.current?.click()}
              whileTap={{ scale: 0.9 }}
              transition={spring.bouncy}
              className={cn(
                "relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-[40px]",
                icon ? "shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)]" : "border-[3px] border-dashed border-accent/40 bg-accent/10",
              )}
              aria-label={icon ? "Change cover photo" : "Add a cover photo"}
            >
              {processing ? (
                <Spinner />
              ) : icon ? (
                <motion.img
                  key={icon.preview}
                  initial={{ scale: 1.3, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={spring.snappy}
                  src={icon.preview}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImagePlus className="h-9 w-9 text-accent" />
              )}
            </motion.button>
            <p className="text-sm font-medium text-muted-foreground">{icon ? "Tap to change" : "Add a cover photo"}</p>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickIcon(e.target.files?.[0])} />
          </div>

          <Field label="What’s happening?" htmlFor="happ-name" counter={`${name.length}/100`}>
            <Input
              id="happ-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Rooftop party, footy in the park…"
              autoComplete="off"
            />
          </Field>

          <Field label="Details" htmlFor="happ-description" counter={`${description.length}/500`} hint="Optional">
            <Textarea
              id="happ-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="Tell people what to expect"
            />
          </Field>

          <Field label="Where">
            <div className="flex h-[52px] items-center gap-3 rounded-2xl bg-muted px-4 text-[15px]">
              <MapPin className="h-5 w-5 shrink-0 text-accent" />
              {locating && !location ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Finding you…
                </span>
              ) : locationError && !location ? (
                <span className="flex-1 truncate text-destructive">{locationError}</span>
              ) : (
                <span className="flex-1 truncate font-semibold">{suburb ?? "Current location"}</span>
              )}
              {!locating && (
                <motion.button
                  type="button"
                  aria-label="Refresh location"
                  onClick={() => refresh()}
                  whileTap={{ rotate: 180, scale: 0.8 }}
                  transition={spring.bouncy}
                  className="text-muted-foreground"
                >
                  <RefreshCw className="h-4 w-4" />
                </motion.button>
              )}
            </div>
          </Field>
          <div className="h-4" />
        </div>

        <div className="shrink-0 px-5 pb-safe pt-3">
          <Button type="submit" size="lg" className="w-full" disabled={!canContinue}>
            Next: take a photo
          </Button>
        </div>
      </form>
    </Screen>
  );
}
