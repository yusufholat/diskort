import { useMemo, useState } from 'react';
import { Text, View, type GestureResponderEvent } from 'react-native';
import { minuteTicks, pingAxis, PING_HISTORY_MS, type PingSample } from '@diskort/client-core';
import { colors, createStyles, radius } from '../theme';

const H = 132;
const PAD = { left: 34, right: 10, top: 12, bottom: 22 };
const PLOT_H = H - PAD.top - PAD.bottom;
const LINE = 2;

const two = (n: number): string => String(n).padStart(2, '0');
/** "14:05" ya da "14:05:32" (Hermes'teki Intl'e güvenmeden) */
const clock = (t: number, seconds = false): string => {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}${seconds ? `:${two(d.getSeconds())}` : ''}`;
};

interface Point {
  x: number;
  y: number;
  sample: PingSample;
}

/**
 * Son 5 dakikanın ping grafiği (masaüstündeki PingChart'ın telefondaki karşılığı). SVG kütüphanesi
 * olmadığından düz View'larla çizilir: çizgi parçaları döndürülmüş ince kutular, altındaki dolgu ölçüm
 * başına yarı saydam sütunlar. Ölçülemeyen anlar boşluk olarak kalır; parmakla dokunulan/sürüklenen
 * ölçümün saati ve değeri gösterilir.
 */
export function PingChart({ samples }: { samples: readonly PingSample[] }) {
  const [width, setWidth] = useState(0);
  const [touched, setTouched] = useState<PingSample | null>(null);
  const to = samples.at(-1)?.at ?? Date.now();
  const from = to - PING_HISTORY_MS;
  const plotW = Math.max(0, width - PAD.left - PAD.right);

  const chart = useMemo(() => {
    const axis = pingAxis(samples);
    const x = (t: number): number => PAD.left + ((t - from) / PING_HISTORY_MS) * plotW;
    const y = (v: number): number => PAD.top + PLOT_H - (Math.min(v, axis.max) / axis.max) * PLOT_H;
    const runs: Point[][] = [];
    let run: Point[] = [];
    for (const s of samples) {
      if (s.rttMs === null) {
        if (run.length) runs.push(run);
        run = [];
      } else if (s.at >= from) {
        run.push({ x: x(s.at), y: y(s.rttMs), sample: s });
      }
    }
    if (run.length) runs.push(run);
    return { axis, x, y, runs, times: minuteTicks(from, to) };
  }, [samples, from, to, plotW]);

  const pick = (e: GestureResponderEvent): void => {
    if (plotW <= 0) return;
    const t = from + ((e.nativeEvent.locationX - PAD.left) / plotW) * PING_HISTORY_MS;
    let best: PingSample | null = null;
    for (const s of samples) {
      if (s.rttMs !== null && (!best || Math.abs(s.at - t) < Math.abs(best.at - t))) best = s;
    }
    setTouched(best && Math.abs(best.at - t) < 15_000 ? best : null);
  };

  const { axis, x, y, runs } = chart;
  const base = PAD.top + PLOT_H;
  // Ölçüm başına dolgu sütunu (2 saniyelik aralığın genişliği)
  const column = Math.max(1, (plotW * 2000) / PING_HISTORY_MS);

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Son 5 dakikanın ping grafiği"
    >
      {width > 0 && (
        <>
          {axis.ticks.map((v) => (
            <View key={`g${v}`} pointerEvents="none">
              <View
                style={[
                  styles.grid,
                  { left: PAD.left, width: plotW, top: Math.round(y(v)), opacity: v === 0 ? 1 : 0.55 },
                ]}
              />
              <Text style={[styles.axisText, { top: y(v) - 7, left: 0, width: PAD.left - 6, textAlign: 'right' }]}>{v}</Text>
            </View>
          ))}
          {chart.times.map((t) => (
            <Text key={`t${t}`} style={[styles.axisText, { top: H - 17, left: x(t) - 20, width: 40, textAlign: 'center' }]}>
              {clock(t)}
            </Text>
          ))}
          {runs.map((points) =>
            points.map((p) => (
              <View
                key={`a${p.sample.at}`}
                pointerEvents="none"
                style={[styles.area, { left: p.x - column / 2, width: column, top: p.y, height: Math.max(0, base - p.y) }]}
              />
            )),
          )}
          {runs.map((points) =>
            points.length === 1 ? (
              <View
                key={`d${points[0]!.sample.at}`}
                pointerEvents="none"
                style={[styles.dot, { left: points[0]!.x - LINE, top: points[0]!.y - LINE }]}
              />
            ) : (
              points.slice(1).map((p, i) => <Segment key={`l${p.sample.at}`} a={points[i]!} b={p} />)
            ),
          )}
          {touched && touched.rttMs !== null && (
            <>
              <View pointerEvents="none" style={[styles.cursor, { left: x(touched.at), top: PAD.top, height: PLOT_H }]} />
              <View
                pointerEvents="none"
                style={[styles.marker, { left: x(touched.at) - 4.5, top: y(touched.rttMs) - 4.5 }]}
              />
              <View
                pointerEvents="none"
                style={[
                  styles.tip,
                  x(touched.at) > width / 2 ? { right: width - x(touched.at) + 6 } : { left: x(touched.at) + 6 },
                ]}
              >
                <Text style={styles.tipText}>
                  {clock(touched.at, true)} · {touched.rttMs} ms
                </Text>
              </View>
            </>
          )}
          {/* Dokunma katmanı en üstte: locationX grafiğin soluna göre olsun */}
          <View
            style={styles.touch}
            onStartShouldSetResponder={() => true}
            onResponderGrant={pick}
            onResponderMove={pick}
            onResponderRelease={() => setTouched(null)}
            onResponderTerminate={() => setTouched(null)}
          />
        </>
      )}
      {samples.length === 0 && (
        <View style={styles.empty} pointerEvents="none">
          <Text style={styles.emptyText}>Ölçülüyor…</Text>
        </View>
      )}
    </View>
  );
}

/** İki nokta arasındaki çizgi: ortası iki noktanın ortasında, açısı kadar döndürülmüş ince kutu */
function Segment({ a, b }: { a: Point; b: Point }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.line,
        {
          left: (a.x + b.x) / 2 - length / 2,
          top: (a.y + b.y) / 2 - LINE / 2,
          width: length + 0.6,
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
        },
      ]}
    />
  );
}

const styles = createStyles(() => ({
  wrap: { height: H, borderRadius: radius.md, backgroundColor: colors.deep, overflow: 'hidden' },
  grid: { position: 'absolute', height: 1, backgroundColor: colors.line },
  axisText: { position: 'absolute', color: colors.muted, fontSize: 10.5, fontVariant: ['tabular-nums'] },
  area: { position: 'absolute', backgroundColor: colors.ok, opacity: 0.16 },
  line: { position: 'absolute', height: LINE, borderRadius: LINE / 2, backgroundColor: colors.ok },
  dot: { position: 'absolute', width: LINE * 2, height: LINE * 2, borderRadius: LINE, backgroundColor: colors.ok },
  cursor: { position: 'absolute', width: 1, backgroundColor: colors.faint },
  marker: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.ok,
    borderWidth: 1.5,
    borderColor: colors.deep,
  },
  tip: {
    position: 'absolute',
    top: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.active,
  },
  tipText: { color: colors.head, fontSize: 11.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  touch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  empty: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.muted, fontSize: 12.5 },
}));
