import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { addDays, format } from "date-fns";
import { CalendarDays, ChevronRight, Clock, ImagePlus, MapPin, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { Screen, spring } from "@/components/motion";
import { LocationPicker, type PickedLocation } from "@/components/LocationPicker";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useTicketing } from "@/hooks/useTicketing";
import { createHapp } from "@/lib/api";
import { draftStore, useDraft } from "@/lib/draft";
import { reverseAddress } from "@/lib/mapbox";
import { resizeImage, uploadMedia } from "@/lib/media";
import { formatPrice, hostShare, MAX_PRICE_CENTS, MIN_PRICE_CENTS, PLATFORM_FEE_RATE } from "@/lib/tickets";
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
  const [gpsAddress, setGpsAddress] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The street address people see; filled in from the map, and editable (unit, level…).
  const [address, setAddress] = useState(previous?.suburb ?? "");
  const [addressEdited, setAddressEdited] = useState(Boolean(previous));

  // When: now, or a date and time.
  const initialStart = previous?.startsAt ? new Date(previous.startsAt) : defaultStart();
  const [when, setWhen] = useState<"now" | "later">(previous?.startsAt ? "later" : "now");
  const [date, setDate] = useState(format(initialStart, "yyyy-MM-dd"));
  const [time, setTime] = useState(format(initialStart, "HH:mm"));
  const [saving, setSaving] = useState(false);

  // Entry: free, or a ticket price (only where paid happs are switched on).
  const ticketing = useTicketing();
  const [entry, setEntry] = useState<"free" | "paid">(previous?.priceCents ? "paid" : "free");
  const [price, setPrice] = useState(previous?.priceCents ? String(previous.priceCents / 100) : "");
  const [limit, setLimit] = useState(previous?.capacity ? String(previous.capacity) : "");

  useEffect(() => {
    if (!gps || picked) return;
    let cancelled = false;
    reverseAddress(gps.latitude, gps.longitude).then((place) => {
      if (!cancelled) setGpsAddress(place ?? "Current location");
    });
    return () => {
      cancelled = true;
    };
  }, [gps, picked]);

  const place = picked ?? (gps ? { latitude: gps.latitude, longitude: gps.longitude, suburb: gpsAddress ?? "" } : null);

  // Keep the address in step with the pin until you type your own.
  useEffect(() => {
    if (!addressEdited && place?.suburb) setAddress(place.suburb);
  }, [place?.suburb, addressEdited]);

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

  const paid = ticketing && entry === "paid";
  const priceCents = paid ? Math.round(Number(price.replace(/[^0-9.]/g, "")) * 100) || 0 : 0;
  const capacity = paid && Number(limit) > 0 ? Math.floor(Number(limit)) : null;
  const priceError = !paid
    ? null
    : !price.trim()
      ? "Set a ticket price"
      : priceCents < MIN_PRICE_CENTS || priceCents > MAX_PRICE_CENTS
        ? `Tickets can be ${formatPrice(MIN_PRICE_CENTS)} to ${formatPrice(MAX_PRICE_CENTS)}`
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

  const canContinue = Boolean(name.trim() && icon && place && !startError && !priceError && !saving);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!icon || !place || startError || priceError) return;
    const details = {
      name: name.trim(),
      description: description.trim(),
      latitude: place.latitude,
      longitude: place.longitude,
      suburb: address.trim() || place.suburb || "Pinned location",
      startsAt: start ? start.toISOString() : null,
      priceCents,
      capacity,
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
          price_cents: details.priceCents,
          capacity: details.capacity,
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

          <Field
            label="Where"
            htmlFor="happ-address"
            hint={
              place
                ? `${picked ? "Pinned on the map" : "Your current location"} · add a unit or level if it helps`
                : null
            }
          >
            <div className="flex h-[52px] items-center gap-2 rounded-2xl border-2 border-transparent bg-muted pl-4 pr-1.5 transition-colors focus-within:border-accent/70">
              <MapPin className="h-5 w-5 shrink-0 text-accent" />
              {!place && locating ? (
                <span className="flex flex-1 items-center gap-2 text-[15px] text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Finding you…
                </span>
              ) : (
                <input
                  id="happ-address"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setAddressEdited(true);
                  }}
                  maxLength={140}
                  placeholder={place ? "Street address" : "Choose where it’s happening"}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold placeholder:font-normal placeholder:text-muted-foreground focus:outline-none"
                />
              )}
              <motion.button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label="Choose on the map"
                whileTap={{ scale: 0.92 }}
                transition={spring.bouncy}
                className="flex h-10 shrink-0 items-center gap-1 rounded-xl bg-white/[0.06] px-3 text-sm font-bold text-accent"
              >
                Map <ChevronRight className="h-4 w-4" strokeWidth={2.6} />
              </motion.button>
            </div>
          </Field>
          {ticketing && (
            <Field
              label="Entry"
              htmlFor="happ-price"
              error={paid && price.trim() ? priceError : null}
              hint={
                paid
                  ? priceCents && !priceError
                    ? `You get ${formatPrice(hostShare(priceCents))} a ticket · The Happs keeps ${Math.round(PLATFORM_FEE_RATE * 100)}%, card fees included. Set up payouts whenever you like.`
                    : `The Happs keeps ${Math.round(PLATFORM_FEE_RATE * 100)}% of each ticket, card fees included`
                  : "Anyone can join and post"
              }
            >
              <div className="grid grid-cols-2 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Entry">
                {(["free", "paid"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={entry === option}
                    onClick={() => setEntry(option)}
                    className="relative h-11 rounded-xl text-[15px] font-bold"
                  >
                    {entry === option && (
                      <motion.span layoutId="entry-pill" transition={spring.bouncy} className="glitch-bg absolute inset-0 rounded-xl" />
                    )}
                    <span className={cn("relative transition-colors", entry === option ? "text-accent-foreground" : "text-muted-foreground")}>
                      {option === "free" ? "Free" : "Paid"}
                    </span>
                  </button>
                ))}
              </div>
              <AnimatePresence initial={false}>
                {paid && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={spring.snappy}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <label className="flex h-[52px] items-center gap-1.5 rounded-2xl border-2 border-transparent bg-muted px-4 transition-colors focus-within:border-accent/70">
                        <span className="text-[16px] font-bold text-accent">$</span>
                        <input
                          id="happ-price"
                          inputMode="decimal"
                          value={price}
                          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, "").slice(0, 7))}
                          placeholder="Price"
                          aria-label="Ticket price in dollars"
                          autoComplete="off"
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none"
                        />
                      </label>
                      <label className="flex h-[52px] items-center gap-2 rounded-2xl border-2 border-transparent bg-muted px-4 transition-colors focus-within:border-accent/70">
                        <Users className="h-5 w-5 shrink-0 text-accent" />
                        <input
                          inputMode="numeric"
                          value={limit}
                          onChange={(e) => setLimit(e.target.value.replace(/\D/g, "").slice(0, 5))}
                          placeholder="No limit"
                          aria-label="Ticket limit"
                          autoComplete="off"
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none"
                        />
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Field>
          )}
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
          setAddress(loc.suburb);
          setAddressEdited(false);
          setPickerOpen(false);
        }}
      />
    </Screen>
  );
}
