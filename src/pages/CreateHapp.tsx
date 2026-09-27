import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
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
    <div className="flex min-h-dvh-screen flex-col bg-background">
      <TopBar title="Create a happ" />

      <form onSubmit={next} className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-safe">
        <div className="flex-1 space-y-6 pt-4">
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                "group relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full transition-transform duration-200 active:scale-95",
                icon ? "shadow-lg" : "border-2 border-dashed border-muted-foreground/30 bg-muted/60 hover:border-accent/50",
              )}
              aria-label={icon ? "Change cover photo" : "Add a cover photo"}
            >
              {processing ? (
                <Spinner />
              ) : icon ? (
                <>
                  <img src={icon.preview} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/45 py-1.5 text-center text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Change
                  </span>
                </>
              ) : (
                <ImagePlus className="h-8 w-8 text-muted-foreground" />
              )}
            </button>
            <p className="text-sm text-muted-foreground">{icon ? "Tap to change" : "Add a cover photo *"}</p>
            {/* No `capture` attribute, so phones offer both camera and library. */}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickIcon(e.target.files?.[0])} />
          </div>

          <Field label="Name" htmlFor="happ-name" required counter={`${name.length}/100`}>
            <Input
              id="happ-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="What’s happening?"
              autoComplete="off"
            />
          </Field>

          <Field label="Description" htmlFor="happ-description" counter={`${description.length}/500`}>
            <Textarea
              id="happ-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="Tell people what to expect"
            />
          </Field>

          <Field label="Location">
            <div className="flex h-12 items-center gap-3 rounded-2xl bg-muted/70 px-4 text-[15px]">
              <MapPin className="h-5 w-5 shrink-0 text-accent" />
              {locating && !location ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Finding you…
                </span>
              ) : locationError && !location ? (
                <span className="flex-1 truncate text-destructive">{locationError}</span>
              ) : (
                <span className="flex-1 truncate">{suburb ?? "Current location"}</span>
              )}
              {!locating && (
                <button type="button" aria-label="Refresh location" onClick={() => refresh()} className="text-muted-foreground hover:text-foreground">
                  <RefreshCw className="h-4 w-4" />
                </button>
              )}
            </div>
          </Field>
        </div>

        <div className="sticky bottom-0 -mx-5 mt-6 bg-gradient-to-t from-background via-background to-transparent px-5 pb-2 pt-6">
          <Button type="submit" size="lg" className="w-full" disabled={!canContinue}>
            Next: take a photo
          </Button>
        </div>
      </form>
    </div>
  );
}
