// Etkinlik ayarları: bu bilgisayara özgüdür (hesaba değil), kullanıcı verileri klasöründe activity.json'da
// saklanır. Buradaki işlevler saftır; dosyayı ActivityMonitor okur ve yazar.
import { pathKey } from './libraries';
import { exeBaseName, trimName, type ManualGame } from './classify';

/** Daha önce kendiliğinden algılanmış oyun (ayarlardaki listede görünsün, gizlenebilsin diye hatırlanır) */
export interface SeenGame {
  path: string;
  name: string;
  lastSeenAt: number;
}

export interface ActivityPrefs {
  /** Oynanan oyun başkalarına gösterilsin mi */
  enabled: boolean;
  manual: ManualGame[];
  /** Hiç bildirilmeyecek exe yolları */
  hidden: string[];
  seen: SeenGame[];
}

const MAX_MANUAL = 100;
const MAX_HIDDEN = 200;
const MAX_SEEN = 100;
const MAX_PATH_LENGTH = 1024;

export const defaultPrefs = (): ActivityPrefs => ({ enabled: true, manual: [], hidden: [], seen: [] });

const validPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH;

const same = (a: string, b: string): boolean => pathKey(a) === pathKey(b);

function uniqueByPath<T extends { path: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = pathKey(item.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Kayıtlı (belki eski ya da bozuk) veriyi geçerli ayarlara çevirir */
export function sanitizePrefs(raw: unknown): ActivityPrefs {
  const prefs = defaultPrefs();
  if (!raw || typeof raw !== 'object') return prefs;
  const data = raw as Record<string, unknown>;
  if (typeof data.enabled === 'boolean') prefs.enabled = data.enabled;
  const named = (value: unknown): { path: string; name: string } | null => {
    if (!value || typeof value !== 'object') return null;
    const { path, name } = value as Record<string, unknown>;
    const trimmed = typeof name === 'string' ? trimName(name) : '';
    return validPath(path) && trimmed ? { path, name: trimmed } : null;
  };
  if (Array.isArray(data.manual)) {
    prefs.manual = uniqueByPath(data.manual.map(named).filter((g) => g !== null)).slice(0, MAX_MANUAL);
  }
  if (Array.isArray(data.hidden)) {
    prefs.hidden = uniqueByPath(data.hidden.filter(validPath).map((path) => ({ path })))
      .map((h) => h.path)
      .slice(0, MAX_HIDDEN);
  }
  if (Array.isArray(data.seen)) {
    prefs.seen = uniqueByPath(
      data.seen
        .map((value) => {
          const game = named(value);
          const lastSeenAt = (value as { lastSeenAt?: unknown } | null)?.lastSeenAt;
          return game ? { ...game, lastSeenAt: typeof lastSeenAt === 'number' && Number.isFinite(lastSeenAt) ? lastSeenAt : 0 } : null;
        })
        .filter((g) => g !== null),
    ).slice(0, MAX_SEEN);
  }
  return prefs;
}

/** Elle oyun ekler (zaten ekliyse adını günceller); gizliyse gizliliği kalkar */
export function addManualGame(prefs: ActivityPrefs, game: ManualGame): ActivityPrefs {
  const name = trimName(game.name);
  if (!validPath(game.path) || !name) return prefs;
  return {
    ...prefs,
    manual: [{ path: game.path, name }, ...prefs.manual.filter((g) => !same(g.path, game.path))].slice(0, MAX_MANUAL),
    hidden: prefs.hidden.filter((path) => !same(path, game.path)),
  };
}

/** Elle eklenen oyunu listeden çıkarır */
export function removeManualGame(prefs: ActivityPrefs, path: string): ActivityPrefs {
  return {
    ...prefs,
    manual: prefs.manual.filter((g) => !same(g.path, path)),
    hidden: prefs.hidden.filter((p) => !same(p, path)),
  };
}

export function setGameHidden(prefs: ActivityPrefs, path: string, hidden: boolean): ActivityPrefs {
  if (!validPath(path)) return prefs;
  const rest = prefs.hidden.filter((p) => !same(p, path));
  return { ...prefs, hidden: hidden ? [path, ...rest].slice(0, MAX_HIDDEN) : rest };
}

/**
 * Kendiliğinden algılanan oyunu hatırlar. Zaten biliniyorsa (aynı adla) aynı nesneyi döndürür: her
 * taramada dosyaya yazılmasın. Liste dolunca en eski görülen düşer.
 */
export function rememberSeenGame(prefs: ActivityPrefs, game: { path: string; name: string }, now: number): ActivityPrefs {
  const known = prefs.seen.find((g) => same(g.path, game.path));
  if (known && known.name === game.name) return prefs;
  const seen = [{ path: game.path, name: game.name, lastSeenAt: now }, ...prefs.seen.filter((g) => !same(g.path, game.path))];
  return { ...prefs, seen: seen.slice(0, MAX_SEEN) };
}

/**
 * Arayüzden gelen yol bilinen bir oyunun ya da şu an çalışan bir programın yolu mu. Gizleme gibi işlemler
 * yalnızca bunlara uygulanır: rastgele (ör. ağ) yollar ayarlara girmez, dosya sistemine de sorulmaz.
 */
export function isKnownPath(prefs: ActivityPrefs, runningPaths: readonly string[], path: string): boolean {
  if (!validPath(path)) return false;
  const key = pathKey(path);
  return knownGames(prefs).some((g) => pathKey(g.path) === key) || runningPaths.some((p) => pathKey(p) === key);
}

export interface KnownGame {
  path: string;
  name: string;
  manual: boolean;
  hidden: boolean;
}

/** Ayarlardaki liste: elle eklenenler ve daha önce algılananlar, ada göre sıralı */
export function knownGames(prefs: ActivityPrefs): KnownGame[] {
  const hidden = new Set(prefs.hidden.map(pathKey));
  const games = new Map<string, KnownGame>();
  for (const game of prefs.manual) {
    games.set(pathKey(game.path), { path: game.path, name: game.name, manual: true, hidden: hidden.has(pathKey(game.path)) });
  }
  for (const game of prefs.seen) {
    const key = pathKey(game.path);
    if (!games.has(key)) games.set(key, { path: game.path, name: game.name, manual: false, hidden: hidden.has(key) });
  }
  // Gizlenip sonradan hatırlananlar listesinden düşmüş olanlar da görünür (yoksa geri açılamaz)
  for (const path of prefs.hidden) {
    const key = pathKey(path);
    if (!games.has(key)) games.set(key, { path, name: exeBaseName(path), manual: false, hidden: true });
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr') || a.path.localeCompare(b.path));
}
