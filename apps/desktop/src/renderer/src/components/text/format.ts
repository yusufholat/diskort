const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const longDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const full = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'full', timeStyle: 'short' });

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const sameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b);

export const formatTime = (ts: number): string => time.format(ts);

/** Mesaj başlığındaki zaman: "Bugün 14:32", "Dün 09:10" veya "24.09.2026 18:05" */
export function formatStamp(ts: number): string {
  const diff = startOfDay(Date.now()) - startOfDay(ts);
  if (diff <= 0) return `Bugün ${time.format(ts)}`;
  if (diff <= DAY_MS) return `Dün ${time.format(ts)}`;
  return `${shortDate.format(ts)} ${time.format(ts)}`;
}

export const formatDay = (ts: number): string => longDate.format(ts);
export const formatFull = (ts: number): string => full.format(ts);
