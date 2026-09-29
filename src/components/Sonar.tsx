import { useEffect, useRef, type RefObject } from "react";

/**
 * Sonar around the Happs mark: each of its four tips sends out a ping in the
 * direction it points (a soft beam with wavefronts rolling outward), taking
 * turns clockwise. Echo blips of different sizes light up where a wave
 * reaches them, ring once, and fade away. Drawn on one canvas behind the page.
 */

/** Tips of the mark in its own box (0–1), and the way each one points. */
const TIPS = [
  { x: 0.569, y: 0, angle: -Math.PI / 2 }, // top
  { x: 1, y: 0.569, angle: 0 }, // right
  { x: 0.428, y: 1, angle: Math.PI / 2 }, // bottom
  { x: 0, y: 0.428, angle: Math.PI }, // left
];

const PERIOD = 4.2; // seconds between pings from the same tip
const PING = 3.2; // how long a ping travels
const SPREAD = (26 * Math.PI) / 180; // half-width of a beam
const BLIP_LIFE = 2.6;
const WAVES = [0, 16, 30]; // trailing wavefronts, px behind the leading one
const BEAM_LAYERS = [1, 0.8, 0.6, 0.42, 0.25]; // stacked cone widths: soft edges

const GOLD = "240, 164, 60";
const AMBER = "236, 120, 30";
const CREAM = "246, 222, 176";

/** "rgba(r, g, b, a)" with a tidy alpha. */
const rgba = (rgb: string, alpha: number) => `rgba(${rgb}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;

type Blip = { x: number; y: number; size: number; color: string; appearAt: number };

const easeOut = (v: number) => 1 - (1 - v) ** 3;
/** When (0–1 of a ping) the eased wavefront reaches fraction `v` of its range. */
const whenReached = (v: number) => 1 - Math.cbrt(1 - v);

export function Sonar({ anchor, className }: { anchor: RefObject<HTMLElement | null>; className?: string }) {
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

    // Start once the logo has finished springing in.
    const start = performance.now() + 1100;
    const lastRound = TIPS.map(() => -1);
    let blips: Blip[] = [];
    let frame = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, width, height);

      const mark = anchor.current?.getBoundingClientRect();
      const host = canvas.getBoundingClientRect();
      if (!mark || !mark.width) return;
      const size = mark.width;
      const reach = Math.min(Math.max(width, height) * 0.62, 460);

      TIPS.forEach((tip, i) => {
        const phase = t - (i * PERIOD) / TIPS.length;
        if (phase < 0) return;
        const round = Math.floor(phase / PERIOD);
        const local = phase - round * PERIOD;
        const x = mark.left - host.left + tip.x * size;
        const y = mark.top - host.top + tip.y * size;

        // A new ping: scatter this round's echoes inside its beam.
        if (round > lastRound[i]) {
          lastRound[i] = round;
          const pingStart = now - local * 1000;
          const count = 4 + Math.floor(Math.random() * 5);
          for (let n = 0; n < count; n++) {
            const dist = reach * (0.18 + Math.random() * 0.74);
            const a = tip.angle + (Math.random() * 2 - 1) * SPREAD * 0.85;
            const roll = Math.random();
            blips.push({
              x: x + Math.cos(a) * dist,
              y: y + Math.sin(a) * dist,
              size: 1.3 + Math.random() ** 2 * 5,
              color: roll < 0.2 ? CREAM : roll < 0.6 ? GOLD : AMBER,
              appearAt: pingStart + whenReached(dist / reach) * PING * 1000,
            });
          }
        }
        if (local > PING) return;

        const p = local / PING;
        const radius = reach * easeOut(p);
        const fade = (1 - p) ** 1.4;

        // The beam: a soft cone of light from the tip, brightest down the
        // middle (narrower cones stacked, so the edges fade out) and just
        // behind the wavefront.
        const r0 = Math.max(radius, 1);
        const cone = ctx.createRadialGradient(x, y, 0, x, y, r0);
        cone.addColorStop(0, rgba(GOLD, 0.03 * fade));
        cone.addColorStop(0.8, rgba(GOLD, 0.045 * fade));
        cone.addColorStop(0.97, rgba(CREAM, 0.06 * fade));
        cone.addColorStop(1, rgba(GOLD, 0));
        ctx.fillStyle = cone;
        for (const width of BEAM_LAYERS) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x, y, r0, tip.angle - SPREAD * width, tip.angle + SPREAD * width);
          ctx.closePath();
          ctx.fill();
        }

        // Wavefronts rolling out along the beam.
        ctx.lineCap = "round";
        WAVES.forEach((gap, w) => {
          const r = radius - gap;
          if (r <= 2) return;
          ctx.strokeStyle = rgba(w === 0 ? CREAM : GOLD, (w === 0 ? 0.55 : 0.28 - w * 0.06) * fade);
          ctx.lineWidth = w === 0 ? 1.6 : 1.1;
          ctx.beginPath();
          ctx.arc(x, y, r, tip.angle - SPREAD * 0.92, tip.angle + SPREAD * 0.92);
          ctx.stroke();
        });

        // The emitter flashes as the ping leaves.
        if (p < 0.25) {
          const flash = 1 - p / 0.25;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 14);
          glow.addColorStop(0, rgba(CREAM, 0.8 * flash));
          glow.addColorStop(1, rgba(GOLD, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Echo blips: pop in, ring once, glow, fade away.
      blips = blips.filter((b) => now < b.appearAt + BLIP_LIFE * 1000);
      for (const b of blips) {
        const age = (now - b.appearAt) / 1000;
        if (age < 0) continue;
        const life = age / BLIP_LIFE;
        const alpha = age < 0.15 ? age / 0.15 : (1 - life) ** 1.6;
        const glowR = b.size * 5;
        const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, glowR);
        glow.addColorStop(0, rgba(b.color, 0.45 * alpha));
        glow.addColorStop(1, rgba(b.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(b.x, b.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = rgba(b.color, 0.95 * alpha);
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size * (age < 0.15 ? 0.6 + (age / 0.15) * 0.4 : 1), 0, Math.PI * 2);
        ctx.fill();

        if (age < 0.7) {
          const ring = age / 0.7;
          ctx.strokeStyle = rgba(b.color, 0.6 * (1 - ring));
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.size + ring * b.size * 4, 0, Math.PI * 2);
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
