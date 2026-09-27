import { useMemo, useState, type PointerEvent } from 'react';
import { minuteTicks, pingAxis, PING_HISTORY_MS, type PingSample } from '@diskort/client-core';

const W = 308;
const H = 120;
const PAD = { left: 30, right: 8, top: 10, bottom: 20 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const clock = (t: number, seconds = false): string =>
  new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });

/**
 * Son 5 dakikanın ping grafiği (SVG). Ölçülemeyen anlar çizgide boşluk olarak kalır; fareyle üzerine
 * gelinen ölçümün saati ve değeri gösterilir.
 */
export function PingChart({ samples }: { samples: readonly PingSample[] }) {
  const [hover, setHover] = useState<PingSample | null>(null);
  const to = samples.at(-1)?.at ?? Date.now();
  const from = to - PING_HISTORY_MS;

  const chart = useMemo(() => {
    const axis = pingAxis(samples);
    const x = (t: number): number => PAD.left + ((t - from) / PING_HISTORY_MS) * PLOT_W;
    const y = (v: number): number => PAD.top + PLOT_H - (Math.min(v, axis.max) / axis.max) * PLOT_H;
    // Ölçümsüz noktalarda çizgi kesilir
    const segments: string[] = [];
    const areas: string[] = [];
    let run: [number, number][] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      const line = run.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
      segments.push(run.length === 1 ? `${line}h0.1` : line);
      const base = (PAD.top + PLOT_H).toFixed(1);
      areas.push(`${line}L${run.at(-1)![0].toFixed(1)},${base}L${run[0]![0].toFixed(1)},${base}Z`);
      run = [];
    };
    for (const s of samples) {
      if (s.rttMs === null) flush();
      else run.push([x(s.at), y(s.rttMs)]);
    }
    flush();
    return { axis, x, y, segments, areas, times: minuteTicks(from, to) };
  }, [samples, from, to]);

  const onMove = (e: PointerEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = from + (((e.clientX - rect.left) * (W / rect.width) - PAD.left) / PLOT_W) * PING_HISTORY_MS;
    let best: PingSample | null = null;
    for (const s of samples) {
      if (s.rttMs !== null && (!best || Math.abs(s.at - t) < Math.abs(best.at - t))) best = s;
    }
    setHover(best && Math.abs(best.at - t) < 10_000 ? best : null);
  };

  const { axis, x, y } = chart;
  return (
    <div className="relative rounded-md bg-bg-deep">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Son 5 dakikanın ping grafiği"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="ping-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ok)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-ok)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {axis.ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-line)"
              strokeWidth={1}
              strokeDasharray={v === 0 ? undefined : '3 3'}
            />
            <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--color-text-muted)">
              {v}
            </text>
          </g>
        ))}
        {chart.times.map((t) => (
          <text key={t} x={x(t)} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--color-text-muted)">
            {clock(t)}
          </text>
        ))}
        {chart.areas.map((d, i) => (
          <path key={`a${i}`} d={d} fill="url(#ping-fill)" />
        ))}
        {chart.segments.map((d, i) => (
          <path
            key={`l${i}`}
            d={d}
            fill="none"
            stroke="var(--color-ok)"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hover && hover.rttMs !== null && (
          <g pointerEvents="none">
            <line
              x1={x(hover.at)}
              x2={x(hover.at)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="var(--color-text-faint)"
              strokeWidth={1}
            />
            <circle cx={x(hover.at)} cy={y(hover.rttMs)} r={3.5} fill="var(--color-ok)" stroke="var(--color-bg-deep)" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {samples.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">Ölçülüyor…</div>
      )}
      {hover && hover.rttMs !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded bg-bg-float/90 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-text-head"
          style={{
            left: `${(x(hover.at) / W) * 100}%`,
            transform: `translateX(${x(hover.at) > W / 2 ? 'calc(-100% - 6px)' : '6px'})`,
          }}
        >
          {clock(hover.at, true)} · {hover.rttMs} ms
        </div>
      )}
    </div>
  );
}
