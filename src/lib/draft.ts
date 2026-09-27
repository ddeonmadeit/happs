import { useSyncExternalStore } from "react";

/**
 * The post being put together across Create happ -> Camera -> Preview.
 *
 * The old app pushed base64 photos/videos into sessionStorage. Anything over
 * ~5 MB (most videos) threw a quota error and the preview never opened, and
 * a stale "post to happ" id could hijack a later "create happ" flow. Keeping
 * the draft in memory, with one explicit target, fixes both.
 */
export type NewHappDetails = {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  suburb: string;
  icon: Blob;
  iconPreview: string;
};

export type DraftTarget =
  | { kind: "existing"; happId: string; happName: string }
  | { kind: "new"; happ: NewHappDetails };

export type CapturedMedia = {
  blob: Blob;
  type: "image" | "video";
  mimeType: string;
  previewUrl: string;
};

type Draft = { target: DraftTarget | null; media: CapturedMedia | null };

let draft: Draft = { target: null, media: null };
const listeners = new Set<() => void>();

function emit(next: Draft) {
  draft = next;
  listeners.forEach((l) => l());
}

export const draftStore = {
  get: () => draft,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Start a fresh flow. Clears any previous media. */
  setTarget(target: DraftTarget) {
    if (draft.media) URL.revokeObjectURL(draft.media.previewUrl);
    const oldIcon = draft.target?.kind === "new" ? draft.target.happ.iconPreview : null;
    const newIcon = target.kind === "new" ? target.happ.iconPreview : null;
    if (oldIcon && oldIcon !== newIcon) URL.revokeObjectURL(oldIcon);
    emit({ target, media: null });
  },
  setMedia(media: CapturedMedia) {
    if (draft.media) URL.revokeObjectURL(draft.media.previewUrl);
    emit({ ...draft, media });
  },
  clearMedia() {
    if (draft.media) URL.revokeObjectURL(draft.media.previewUrl);
    emit({ ...draft, media: null });
  },
  clear() {
    if (draft.media) URL.revokeObjectURL(draft.media.previewUrl);
    if (draft.target?.kind === "new") URL.revokeObjectURL(draft.target.happ.iconPreview);
    emit({ target: null, media: null });
  },
};

export function useDraft() {
  return useSyncExternalStore(draftStore.subscribe, draftStore.get, draftStore.get);
}
