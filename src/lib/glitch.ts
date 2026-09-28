/**
 * Makes the brand texture react to touch: while a finger (or mouse) is over
 * an orange element, a hot yellow spot follows it, easing in and out and
 * swelling with the speed of the swipe. It works through the `--touch-*`
 * custom properties that the .glitch-* classes paint (src/index.css).
 *
 * One set of window listeners covers every element, so components don't
 * need to opt in.
 */
const SELECTOR = ".glitch-bg, .glitch-text, .glitch-mark";
/** Reach a little past the edge so thin elements (text, a switch) are easy to hit. */
const SLOP = 14;

type Spot = { x: number; y: number; tx: number; ty: number; a: number; ta: number; r: number; tr: number; base: number };

const spots = new Map<HTMLElement, Spot>();
let pointer: { x: number; y: number } | null = null;
let moved = false;
let frame = 0;

function baseRadius(rect: DOMRect) {
  const r = Math.min(rect.width, rect.height) * 0.5 + Math.max(rect.width, rect.height) * 0.12;
  return Math.min(96, Math.max(30, r));
}

/** Work out which elements are under the pointer (only after it moves). */
function track() {
  if (!moved) return;
  moved = false;
  const at = pointer;
  if (!at) {
    spots.forEach((spot) => (spot.ta = 0));
    return;
  }
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    const rect = el.getBoundingClientRect();
    const over =
      rect.width > 0 &&
      at.x >= rect.left - SLOP &&
      at.x <= rect.right + SLOP &&
      at.y >= rect.top - SLOP &&
      at.y <= rect.bottom + SLOP;
    let spot = spots.get(el);
    if (!over) {
      if (spot) spot.ta = 0;
      return;
    }
    const x = at.x - rect.left;
    const y = at.y - rect.top;
    const base = baseRadius(rect);
    if (!spot) {
      spot = { x, y, tx: x, ty: y, a: 0, ta: 1, r: base, tr: base, base };
      spots.set(el, spot);
    }
    // Faster swipes make a bigger, hotter spot.
    const speed = Math.hypot(x - spot.tx, y - spot.ty);
    spot.tx = x;
    spot.ty = y;
    spot.ta = 1;
    spot.base = base;
    spot.tr = Math.max(spot.tr, base + Math.min(speed * 2.2, base * 0.8));
  });
}

function step() {
  frame = 0;
  track();
  let busy = false;
  spots.forEach((s, el) => {
    if (!el.isConnected) {
      spots.delete(el);
      return;
    }
    s.x += (s.tx - s.x) * 0.3;
    s.y += (s.ty - s.y) * 0.3;
    s.a += (s.ta - s.a) * (s.ta > s.a ? 0.25 : 0.07);
    s.r += (s.tr - s.r) * 0.18;
    // Let a swelled spot relax back once the finger slows down.
    s.tr += (s.base - s.tr) * 0.06;

    if (s.ta === 0 && s.a < 0.01) {
      spots.delete(el);
      for (const p of ["--touch-x", "--touch-y", "--touch-a", "--touch-r"]) el.style.removeProperty(p);
      return;
    }
    el.style.setProperty("--touch-x", `${s.x.toFixed(1)}px`);
    el.style.setProperty("--touch-y", `${s.y.toFixed(1)}px`);
    el.style.setProperty("--touch-a", s.a.toFixed(3));
    el.style.setProperty("--touch-r", `${s.r.toFixed(1)}px`);
    const settled =
      Math.abs(s.tx - s.x) < 0.3 && Math.abs(s.ty - s.y) < 0.3 && Math.abs(s.ta - s.a) < 0.005 && Math.abs(s.tr - s.r) < 0.3;
    if (!settled) busy = true;
  });
  if (busy || moved) schedule();
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(step);
}

function moveTo(x: number, y: number) {
  pointer = { x, y };
  moved = true;
  schedule();
}

function release() {
  pointer = null;
  moved = true;
  schedule();
}

export function installGlitchTouch() {
  if (typeof window === "undefined") return;
  // The drifting blobs animate registered custom properties; without
  // registration they would jump instead of glide, so they stay still.
  if (typeof CSS !== "undefined" && "registerProperty" in CSS) {
    document.documentElement.classList.add("fluid");
  }

  const opts = { passive: true } as const;
  window.addEventListener("pointerdown", (e) => moveTo(e.clientX, e.clientY), opts);
  window.addEventListener("pointermove", (e) => moveTo(e.clientX, e.clientY), opts);
  // Touch moves keep coming while the browser scrolls (pointer events are
  // cancelled then), so follow those too.
  window.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (t) moveTo(t.clientX, t.clientY);
    },
    opts,
  );
  window.addEventListener("pointerup", (e) => e.pointerType !== "mouse" && release(), opts);
  window.addEventListener("touchend", (e) => e.touches.length === 0 && release(), opts);
  window.addEventListener("touchcancel", release, opts);
  document.documentElement.addEventListener("pointerleave", release, opts);
  window.addEventListener("blur", release);
}
