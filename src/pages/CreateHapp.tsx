import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { addDays, format } from "date-fns";
import { CalendarDays, ChevronRight, Clock, ImagePlus, MapPin } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Screen, spring } from "@/components/motion";
import { LocationPicker, type PickedLocation } from "@/components/LocationPicker";
import { useGeolocation } from "@/hooks/useGeolocation";
import { createHapp } from "@/lib/api";
import { draftStore, useDraft } from "@/lib/draft";
import { reverseGeocode } from "@/lib/mapbox";
import { resizeImage, uploadMedia } from "@/lib/media";
import { cn, errorMessage, formatStart, startsIn } from "@/lib/utils";

/** Scheduling window (matches the database). */
const MAX_DAYS_AHEAD = 60;
/** Anything sooner than this is just "now". */
const MIN_LEAD_MS = 5 * 60_000;

/** A sensible default for "Later": on the hour, at least an hour away. */
function defaultStart() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 2);
  return d;
}

/** Open the native date/time picker from anywhere on the field (not just its tiny icon). */
function openPicker(e: MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    // Not allowed here; the browser's own behaviour still works.
  }
}

export default function CreateHapp() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const draft = useDraft();
  const previous = draft.target?.kind === "new" ? draft.target.happ : null;
  const { location: gps, isLoading: locating, refresh } = useGeolocation();

  const [name, setName] = useState(previous?.name ?? "");
  const [description, setDescription] = useState(previous?.description ?? "");
  const [icon, setIcon] = useState<{ blob: Blob; preview: string } | null>(
    previous ? { blob: previous.icon, preview: previous.iconPreview } : null,
  );
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Where: your location unless you pin somewhere else.
  const [picked, setPicked] = useState<PickedLocation | null>(
    previous ? { latitude: previous.latitude, longitude: previous.longitude, suburb: previous.suburb } : null,
  );
  const [gpsSuburb, setGpsSuburb] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // When: now, or a date and time.
  const initialStart = previous?.startsAt ? new Date(previous.startsAt) : defaultStart();
  const [when, setWhen] = useState<"now" | "later">(previous?.startsAt ? "later" : "now");
  const [date, setDate] = useState(format(initialStart, "yyyy-MM-dd"));
  const [time, setTime] = useState(format(initialStart, "HH:mm"));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gps || picked) return;
    let cancelled = false;
    reverseGeocode(gps.latitude, gps.longitude).then((place) => {
      if (!cancelled) setGpsSuburb(place ?? "Current location");
    });
    return () => {
      cancelled = true;
    };
  }, [gps, picked]);

  const place = picked ?? (gps ? { latitude: gps.latitude, longitude: gps.longitude, suburb: gpsSuburb ?? "Current location" } : null);

  const start = useMemo(() => {
    if (when === "now") return null;
    const d = new Date(`${date}T${time}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [when, date, time]);

  const startError =
    when === "now"
      ? null
      : !start
        ? "Pick a date and time"
        : start.getTime() < Date.now() + MIN_LEAD_MS
          ? "Pick a time in the future"
          : start.getTime() > addDays(new Date(), MAX_DAYS_AHEAD).getTime()
            ? `Happs can be scheduled up to ${MAX_DAYS_AHEAD} days ahead`
            : null;

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

  const canContinue = Boolean(name.trim() && icon && place && !startError && !saving);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!icon || !place || startError) return;
    const details = {
      name: name.trim(),
      description: description.trim(),
      latitude: place.latitude,
      longitude: place.longitude,
      suburb: place.suburb,
      startsAt: start ? start.toISOString() : null,
    };

    // Starting now: take the first photo, then it goes live.
    if (!start) {
      draftStore.setTarget({ kind: "new", happ: { ...details, icon: icon.blob, iconPreview: icon.preview } });
      navigate("/camera");
      return;
    }

    // Scheduled: it goes on the map straight away (faded until it starts).
    if (!user) return;
    setSaving(true);
    try {
      const iconUrl = await uploadMedia(user.id, icon.blob, "icon");
      const happId = await createHapp(
        {
          name: details.name,
          description: details.description || null,
          latitude: details.latitude,
          longitude: details.longitude,
          suburb: details.suburb,
          icon_url: iconUrl,
          starts_at: details.startsAt,
        },
        user.id,
      );
      draftStore.clear();
      toast.success(`${details.name} goes live ${formatStart(start)}`);
      navigate(`/happ/${happId}`, { replace: true });
    } catch (err) {
      console.error("Scheduling failed:", err);
      toast.error(errorMessage(err, "Couldn’t create your happ. Please try again."));
      setSaving(false);
    }
  };

  const whereLabel = place ? place.suburb : locating ? null : "Choose where it’s happening";

  return (
    <Screen>
      <TopBar title="New happ" />

      <form onSubmit={submit} className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
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

          <Field
            label="When"
            error={startError && when === "later" ? startError : null}
            hint={start && !startError ? `Goes live ${formatStart(start)} · ${startsIn(start)}` : null}
          >
            <div className="grid grid-cols-2 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="When">
              {(["now", "later"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={when === option}
                  onClick={() => setWhen(option)}
                  className="relative h-11 rounded-xl text-[15px] font-bold"
                >
                  {when === option && (
                    <motion.span layoutId="when-pill" transition={spring.bouncy} className="glitch-bg absolute inset-0 rounded-xl" />
                  )}
                  <span className={cn("relative transition-colors", when === option ? "text-accent-foreground" : "text-muted-foreground")}>
                    {option === "now" ? "Now" : "Later"}
                  </span>
                </button>
              ))}
            </div>
            <AnimatePresence initial={false}>
              {when === "later" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring.snappy}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-[1.3fr_1fr] gap-3 pt-1">
                    <label className="flex h-[52px] items-center gap-2.5 rounded-2xl bg-muted px-4">
                      <CalendarDays className="h-5 w-5 shrink-0 text-accent" />
                      <input
                        type="date"
                        aria-label="Date"
                        value={date}
                        min={format(new Date(), "yyyy-MM-dd")}
                        max={format(addDays(new Date(), MAX_DAYS_AHEAD), "yyyy-MM-dd")}
                        onChange={(e) => e.target.value && setDate(e.target.value)}
                        onClick={openPicker}
                        className="date-input"
                      />
                    </label>
                    <label className="flex h-[52px] items-center gap-2.5 rounded-2xl bg-muted px-4">
                      <Clock className="h-5 w-5 shrink-0 text-accent" />
                      <input
                        type="time"
                        aria-label="Time"
                        value={time}
                        step={300}
                        onChange={(e) => e.target.value && setTime(e.target.value)}
                        onClick={openPicker}
                        className="date-input"
                      />
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Field>

          <Field label="Where" hint={picked ? "Pinned on the map" : place ? "Your current location" : null}>
            <motion.button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label={`Where: ${whereLabel ?? "finding your location"}. Change`}
              whileTap={{ scale: 0.97 }}
              transition={spring.bouncy}
              className="flex h-[52px] w-full items-center gap-3 rounded-2xl bg-muted px-4 text-left text-[15px]"
            >
              <MapPin className="h-5 w-5 shrink-0 text-accent" />
              {whereLabel === null ? (
                <span className="flex flex-1 items-center gap-2 text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Finding you…
                </span>
              ) : (
                <span className={cn("flex-1 truncate font-semibold", !place && "text-muted-foreground")}>{whereLabel}</span>
              )}
              <span className="flex items-center text-sm font-bold text-accent">
                Change <ChevronRight className="h-4 w-4" strokeWidth={2.6} />
              </span>
            </motion.button>
          </Field>
          <div className="h-4" />
        </div>

        <div className="shrink-0 px-5 pb-safe pt-3">
          <Button type="submit" size="lg" className="w-full" disabled={!canContinue} loading={saving}>
            {start ? "Schedule happ" : "Next: take a photo"}
          </Button>
        </div>
      </form>

      <LocationPicker
        open={pickerOpen}
        initial={place}
        locate={refresh}
        onClose={() => setPickerOpen(false)}
        onPick={(loc) => {
          setPicked(loc);
          setPickerOpen(false);
        }}
      />
    </Screen>
  );
}
