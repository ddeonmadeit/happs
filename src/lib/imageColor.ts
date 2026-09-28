/**
 * The main colour of an image, tuned to glow on the dark map: its most
 * common vivid hue, kept bright and saturated enough to read. Returns an
 * "h s% l%" triplet (for `hsl(var(--x))`), or null for greyscale images or
 * ones the browser won't let us read.
 */
const cache = new Map<string, Promise<string | null>>();

export function imageColor(url: string): Promise<string | null> {
  let result = cache.get(url);
  if (!result) {
    result = extract(url);
    cache.set(url, result);
  }
  return result;
}

function extract(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Must match the <img> tags' mode, or the browser's cached copy can't be read.
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        resolve(dominant(img));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function dominant(img: HTMLImageElement): string | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // Weighted hue histogram: vivid, mid-bright pixels count most.
  const BINS = 36;
  const weight = new Float64Array(BINS);
  const sat = new Float64Array(BINS);
  const light = new Float64Array(BINS);
  const hx = new Float64Array(BINS);
  const hy = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [h, s, l] = toHsl(data[i], data[i + 1], data[i + 2]);
    const w = s * s * (1 - Math.abs(l - 0.5) * 1.6);
    if (w <= 0.02) continue;
    const b = Math.min(BINS - 1, Math.floor((h / 360) * BINS));
    weight[b] += w;
    sat[b] += s * w;
    light[b] += l * w;
    hx[b] += Math.cos((h * Math.PI) / 180) * w;
    hy[b] += Math.sin((h * Math.PI) / 180) * w;
    total += w;
  }
  // Barely any colour: let the caller fall back to the theme colour.
  if (total < size * size * 0.02) return null;

  // Take the strongest hue, blending in its neighbours.
  let best = 0;
  let bestScore = -1;
  for (let b = 0; b < BINS; b++) {
    const score = weight[b] + 0.5 * (weight[(b + 1) % BINS] + weight[(b + BINS - 1) % BINS]);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  let h = (Math.atan2(hy[best], hx[best]) * 180) / Math.PI;
  if (h < 0) h += 360;
  const s = clamp(sat[best] / weight[best], 0.6, 0.95);
  const l = clamp(light[best] / weight[best], 0.52, 0.64);
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}
