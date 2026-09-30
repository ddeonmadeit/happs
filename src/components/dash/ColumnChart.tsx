import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export type Column = { key: string; label: string; value: number };

type Props = {
  columns: Column[];
  /** What one column counts, for the tooltip and screen readers ("signups"). */
  unit: string;
  /** Show every nth x-axis label. */
  labelEvery?: number;
};

const PLOT_H = 168;
const TOP = 20; // room for the peak label
const AXIS_H = 26;
const LEFT = 34; // y-axis labels
const MAX_BAR = 24;

/** Rounds up to 1, 2 or 5 × 10ⁿ so the axis reads cleanly. */
function niceCeil(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= v) ?? 10;
  return step * pow;
}

/** A column path: 4px rounded data end, square on the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** A single-series column chart with a hover/focus tooltip. */
export function ColumnChart({ columns, unit, labelEvery = 7 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = columns.length;
  const max = Math.max(0, ...columns.map((c) => c.value));
  const top = niceCeil(max);
  const ticks = [0, top / 2, top];
  const plotW = width - LEFT;
  const slot = plotW / Math.max(1, n);
  const bar = Math.max(2, Math.min(MAX_BAR, slot * 0.62));
  const y = (v: number) => TOP + PLOT_H - (v / top) * PLOT_H;
  const x = (i: number) => LEFT + i * slot + (slot - bar) / 2;
  const peak = max > 0 ? columns.findIndex((c) => c.value === max) : -1;
  const total = columns.reduce((s, c) => s + c.value, 0);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else return;
    e.preventDefault();
  };

  const shown = active !== null ? columns[active] : null;

  return (
    <div ref={wrap} className="relative w-full select-none">
      <svg
        width={width}
        height={TOP + PLOT_H + AXIS_H}
        role="img"
        tabIndex={0}
        aria-label={`${total} ${unit} over ${n} days, most on ${peak >= 0 ? columns[peak].label : "no day"}. Use the arrow keys to read each day.`}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={width} y1={y(t)} y2={y(t)} stroke="hsl(var(--muted))" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
              {t.toLocaleString("en-AU")}
            </text>
          </g>
        ))}

        {columns.map((c, i) => {
          const h = (c.value / top) * PLOT_H;
          return (
            <g key={c.key}>
              {c.value > 0 && (
                <path
                  d={columnPath(x(i), y(c.value), bar, h)}
                  fill="hsl(var(--accent))"
                  opacity={active === null || active === i ? 1 : 0.45}
                  className="transition-opacity duration-150"
                />
              )}
              {/* The whole slot is the hover target, not just the painted column. */}
              <rect
                x={LEFT + i * slot}
                y={TOP}
                width={slot}
                height={PLOT_H}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              />
              {((i % labelEvery === 0 && n - 1 - i >= labelEvery / 2) || i === n - 1) && (
                <text x={x(i) + bar / 2} y={TOP + PLOT_H + 17} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {c.label}
                </text>
              )}
            </g>
          );
        })}

        {peak >= 0 && active === null && (
          <text x={x(peak) + bar / 2} y={y(max) - 7} textAnchor="middle" className="fill-foreground text-[11px] font-bold tabular-nums">
            {max.toLocaleString("en-AU")}
          </text>
        )}
      </svg>

      {shown && active !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl bg-background/95 px-3 py-2 text-center shadow-xl ring-1 ring-white/10"
          style={{
            left: Math.min(width - 50, Math.max(50, x(active) + bar / 2)),
            top: y(shown.value) - 8,
          }}
        >
          <p className="text-base font-extrabold tabular-nums">
            {shown.value.toLocaleString("en-AU")} <span className="text-xs font-semibold text-muted-foreground">{unit}</span>
          </p>
          <p className="text-xs text-muted-foreground">{shown.label}</p>
        </div>
      )}
    </div>
  );
}
