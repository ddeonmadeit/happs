import {
  Camera,
  Clapperboard,
  Cpu,
  Disc3,
  Dumbbell,
  Flower2,
  Gamepad2,
  Landmark,
  Laugh,
  Martini,
  Mountain,
  Music,
  Palette,
  Shirt,
  Store,
  Trophy,
  UtensilsCrossed,
  Waves,
  type LucideIcon,
} from "lucide-react";

/** What people can be into. Must match profiles_interests_valid in the database. */
export const INTERESTS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "music", label: "Live music", icon: Music },
  { id: "nightlife", label: "Nightlife", icon: Disc3 },
  { id: "food", label: "Food", icon: UtensilsCrossed },
  { id: "drinks", label: "Drinks", icon: Martini },
  { id: "art", label: "Art", icon: Palette },
  { id: "fashion", label: "Fashion", icon: Shirt },
  { id: "sport", label: "Sport", icon: Trophy },
  { id: "fitness", label: "Fitness", icon: Dumbbell },
  { id: "outdoors", label: "Outdoors", icon: Mountain },
  { id: "beach", label: "Beach", icon: Waves },
  { id: "comedy", label: "Comedy", icon: Laugh },
  { id: "film", label: "Film", icon: Clapperboard },
  { id: "markets", label: "Markets", icon: Store },
  { id: "tech", label: "Tech", icon: Cpu },
  { id: "wellness", label: "Wellness", icon: Flower2 },
  { id: "gaming", label: "Gaming", icon: Gamepad2 },
  { id: "photography", label: "Photography", icon: Camera },
  { id: "culture", label: "Culture", icon: Landmark },
];

export const MAX_INTERESTS = 10;

const byId = new Map(INTERESTS.map((i) => [i.id, i]));
export const interest = (id: string) => byId.get(id);
export const interestLabel = (id: string) => byId.get(id)?.label ?? id;

/** Kinds of brand account, shown under the name like Instagram's category. */
export const BRAND_CATEGORIES = [
  "Venue",
  "Bar & club",
  "Restaurant & café",
  "Promoter",
  "Artist or DJ",
  "Label",
  "Brand",
  "Community",
];

/** "Into Live music & Nightlife" from the interests two accounts share. */
export function sharedReason(shared: string[]) {
  const labels = shared.slice(0, 2).map(interestLabel);
  if (!labels.length) return null;
  return `Into ${labels.join(" & ")}${shared.length > 2 ? ` +${shared.length - 2}` : ""}`;
}
