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

const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });

/** Listedeki kısa "son etkinlik": "şimdi", "5 dk", "3 sa", "Dün", "4 g", "12 Eyl" */
export function formatAgo(ts: number, now = Date.now()): string {
  const minutes = Math.floor((now - ts) / 60_000);
  if (minutes < 1) return 'şimdi';
  if (minutes < 60) return `${minutes} dk`;
  if (sameDay(ts, now)) return `${Math.floor(minutes / 60)} sa`;
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (days === 1) return 'Dün';
  if (days < 7) return `${days} g`;
  return dayMonth.format(ts);
}
export const formatFull = (ts: number): string => full.format(ts);
