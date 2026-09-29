import { useEffect, useRef, type RefObject } from "react";

/**
 * A ship's-radar sweep around the Happs mark: a line turns clockwise from
 * the centre of the logo with a fading afterglow behind it, over faint range
 * rings. Contacts of different sizes light up as the line passes over them
 * and fade away (like the phosphor on an old radar screen); some drift, some
 * vanish and new ones appear elsewhere. One canvas behind the page.
 */

const TURN = 4.8; // seconds per revolution
const TRAIL = (100 * Math.PI) / 180; // afterglow behind the line
const TRAIL_STEPS = 36;
const FADE = 3.6; // seconds a contact glows after the sweep passes
const CONTACTS = 16;

const GOLD = "240, 164, 60";
const AMBER = "236, 120, 30";
const CREAM = "246, 222, 176";

/** "rgba(r, g, b, a)" with a tidy alpha. */
const rgba = (rgb: string, alpha: number) => `rgba(${rgb}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

type Contact = {
  angle: number;
  dist: number; // 0–1 of the radar's range
  size: number;
  color: string;
  drift: number; // radians per second (slow movers)
  litAt: number; // ms, when the sweep last passed
};

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

function newContact(): Contact {
  const roll = Math.random();
  return {
    angle: Math.random() * TAU,
    dist: 0.16 + Math.random() * 0.8,
    size: 1.3 + Math.random() ** 2 * 4.6,
    color: roll < 0.2 ? CREAM : roll < 0.6 ? GOLD : AMBER,
    drift: Math.random() < 0.4 ? (Math.random() - 0.5) * 0.03 : 0,
    litAt: -Infinity,
  };
}

function drawTrail(ctx: CanvasRenderingContext2D, cx: number, cy: number, range: number, sweep: number, intro: number) {
  const peak = 0.3 * intro;
  if (typeof ctx.createConicGradient === "function") {
    const cone = ctx.createConicGradient(sweep - TRAIL, cx, cy);
    const span = TRAIL / TAU;
    for (const f of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
      cone.addColorStop(f * span, rgba(f > 0.6 ? GOLD : AMBER, peak * f ** 2));
    }
    cone.addColorStop(Math.min(1, span + 0.0005), rgba(GOLD, 0));
    cone.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, range, sweep - TRAIL, sweep);
    ctx.closePath();
    ctx.fill();
    // Fade it out towards the edge (the canvas is otherwise empty at this point).
    const edge = ctx.createRadialGradient(cx, cy, 0, cx, cy, range);
    edge.addColorStop(0, "rgba(0, 0, 0, 1)");
    edge.addColorStop(1, "rgba(0, 0, 0, 0.3)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = edge;
    ctx.fillRect(cx - range, cy - range, range * 2, range * 2);
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, range);
  glow.addColorStop(0, rgba(GOLD, 0.34));
  glow.addColorStop(0.5, rgba(AMBER, 0.2));
  glow.addColorStop(1, rgba(AMBER, 0.05));
  ctx.fillStyle = glow;
  const step = TRAIL / TRAIL_STEPS;
  for (let k = 0; k < TRAIL_STEPS; k++) {
    ctx.globalAlpha = intro * (1 - k / TRAIL_STEPS) ** 2 * 0.75;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, range, sweep - (k + 1) * step, sweep - k * step + 0.002);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function Radar({ anchor, className }: { anchor: RefObject<HTMLElement | null>; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Start once the logo has finished springing in; the sweep begins at 12 o'clock.
    const start = performance.now() + 900;
    const contacts = Array.from({ length: CONTACTS }, newContact);
    let lastSweep = -Math.PI / 2;
    let lastTime = start;
    let frame = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, width, height);
      if (now < start) return;

      const mark = anchor.current?.getBoundingClientRect();
      const host = canvas.getBoundingClientRect();
      if (!mark || !mark.width) return;
      const cx = mark.left - host.left + mark.width / 2;
      const cy = mark.top - host.top + mark.height / 2;
      const range = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
      const intro = Math.min(1, (now - start) / 800); // fade in

      const sweep = -Math.PI / 2 + (((now - start) / 1000) * TAU) / TURN;
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      // Afterglow behind the line: one smooth conic fade where supported
      // (thin wedges otherwise), dimming towards the edge of the range.
      drawTrail(ctx, cx, cy, range, sweep, intro);

      // Range rings, very faint.
      ctx.lineWidth = 1;
      for (const f of [0.18, 0.36, 0.56, 0.78]) {
        ctx.strokeStyle = rgba(CREAM, 0.045 * intro);
        ctx.beginPath();
        ctx.arc(cx, cy, range * f, 0, TAU);
        ctx.stroke();
      }

      // The sweep line itself, with a soft glow.
      const end = { x: cx + Math.cos(sweep) * range, y: cy + Math.sin(sweep) * range };
      const line = ctx.createLinearGradient(cx, cy, end.x, end.y);
      line.addColorStop(0, rgba(CREAM, 0.9 * intro));
      line.addColorStop(0.6, rgba(GOLD, 0.55 * intro));
      line.addColorStop(1, rgba(GOLD, 0.15 * intro));
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(GOLD, 0.12 * intro);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Contacts: light up as the line crosses them, then fade.
      const from = wrap(lastSweep);
      const swept = sweep - lastSweep;
      lastSweep = sweep;
      contacts.forEach((c, i) => {
        c.angle = wrap(c.angle + c.drift * dt);
        if (swept > 0 && wrap(c.angle - from) <= swept) {
          // Now and then a contact is gone next time round and a new one shows up.
          if (c.litAt > 0 && Math.random() < 0.3) {
            contacts[i] = { ...newContact(), angle: c.angle + (Math.random() - 0.5) * 0.6 };
            contacts[i].litAt = now;
            return;
          }
          c.litAt = now;
        }
      });
      for (const c of contacts) {
        const age = (now - c.litAt) / 1000;
        if (age < 0 || age > FADE) continue;
        const alpha = (age < 0.08 ? age / 0.08 : (1 - age / FADE) ** 1.8) * intro;
        const x = cx + Math.cos(c.angle) * c.dist * range;
        const y = cy + Math.sin(c.angle) * c.dist * range;

        const halo = ctx.createRadialGradient(x, y, 0, x, y, c.size * 5);
        halo.addColorStop(0, rgba(c.color, 0.45 * alpha));
        halo.addColorStop(1, rgba(c.color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, c.size * 5, 0, TAU);
        ctx.fill();

        ctx.fillStyle = rgba(c.color, 0.95 * alpha);
        ctx.beginPath();
        ctx.arc(x, y, c.size, 0, TAU);
        ctx.fill();

        if (age < 0.6) {
          const ring = age / 0.6;
          ctx.strokeStyle = rgba(c.color, 0.55 * (1 - ring) * intro);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, c.size + ring * c.size * 4, 0, TAU);
          ctx.stroke();
        }
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [anchor]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
