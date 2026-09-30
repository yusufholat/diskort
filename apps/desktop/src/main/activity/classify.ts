// Taranan süreçlerden hangisinin oyun olduğuna karar verir (saf işlevler; dosya ya da süreç okumaz).
// Sıra: gizlenen hiç bildirilmez → elle eklenen her zaman oyundur → mağaza kaydı (Steam, Epic, Battle.net) →
// bilinen oyun klasörü kalıpları. Başlatıcılar, yardımcılar ve Diskort'un kendisi oyun sayılmaz.
import { ACTIVITY_NAME_MAX_LENGTH } from '@diskort/shared';
import { pathKey, type GameLibraries, type LibraryGame } from './libraries';

/** Görünür penceresi olan bir süreç (tarayıcıdan gelir) */
export interface ScannedProcess {
  pid: number;
  /** Exe'nin tam yolu */
  path: string;
  /** Sürecin başladığı an (ms, bu bilgisayarın saati) */
  startedAt: number;
  /** Exe'nin sürüm bilgisindeki ürün adı ve dosya açıklaması */
  productName: string | null;
  fileDescription: string | null;
}

export interface ManualGame {
  path: string;
  name: string;
}

export type GameSource = 'manual' | LibraryGame['source'] | 'folder';

export interface DetectedGame {
  pid: number;
  path: string;
  name: string;
  startedAt: number;
  source: GameSource;
}

export interface ClassifyContext {
  libraries: GameLibraries;
  /** Kullanıcının elle eklediği oyunlar */
  manual: readonly ManualGame[];
  /** Kullanıcının gizlediği exe yolları */
  hidden: readonly string[];
  /** Diskort'un kendi exe'si */
  selfPath: string | null;
}

/**
 * Mağazaların varsayılan oyun klasörleri: yol bu klasör dizisini içeriyorsa hemen sonraki klasör oyunun
 * kendi klasörüdür. `exclude`: o konumdaki başlatıcı/araç klasörleri.
 */
const FOLDER_RULES: readonly { segments: readonly string[]; exclude?: readonly string[] }[] = [
  { segments: ['steamapps', 'common'], exclude: ['steamworks shared', 'steamvr', 'wallpaper_engine'] },
  { segments: ['epic games'], exclude: ['launcher', 'epic online services', 'directxredist'] },
  { segments: ['riot games'], exclude: ['riot client'] },
  { segments: ['ubisoft game launcher', 'games'] },
  { segments: ['ea games'] },
  { segments: ['origin games'] },
  { segments: ['gog galaxy', 'games'] },
  { segments: ['gog games'] },
  { segments: ['xboxgames'], exclude: ['gamesave'] },
  { segments: ['rockstar games'], exclude: ['launcher', 'social club'] },
];

/** Oyun klasörlerinin içinden de çalışabilen, oyun olmayan exe'ler (uzantısız, küçük harf) */
const EXCLUDED_NAMES = new Set([
  'diskort',
  // Başlatıcılar ve parçaları
  'steam',
  'steamservice',
  'steamwebhelper',
  'gameoverlayui',
  'epicgameslauncher',
  'epicwebhelper',
  'riotclientservices',
  'riotclientux',
  'riotclientuxrender',
  'battle.net',
  'battle.net helper',
  'agent',
  'upc',
  'ubisoftconnect',
  'uplaywebcore',
  'origin',
  'eadesktop',
  'ealauncher',
  'eabackgroundservice',
  'galaxyclient',
  'galaxyclient helper',
  'rockstar games launcher',
  'socialclubhelper',
  // Hile koruması
  'vgc',
  'vgtray',
  'beservice',
  'bedaemon',
  // Kurulum dosyaları
  'dxsetup',
  'dxwebsetup',
  'setup',
  'install',
  'installer',
  'uninstall',
  'uninstaller',
  // Wallpaper Engine
  'wallpaper32',
  'wallpaper64',
  'webwallpaper32',
]);

const EXCLUDED_PATTERN =
  /crash ?(handler|report|pad)|errorreport|bugreport|anti ?cheat|^unins\d*$|redist|^dotnet|^ndp\d|webhelper|cefprocess|cefsubprocess|overlay|^qtwebengineprocess$/;

/** Sürüm bilgisinde oyun adı yerine motorun adını bırakan exe'ler */
const ENGINE_NAMES = new Set(['bootstrappackagedgame', 'unreal engine', 'unrealengine', 'ue4game', 'ue4', 'ue5', 'unity player', 'unityplayer']);

const segmentsOf = (key: string): string[] => key.split('\\').filter(Boolean);

/** Exe'nin uzantısız dosya adı */
export function exeBaseName(path: string): string {
  const file = path.replace(/\//g, '\\').split('\\').pop() ?? path;
  return file.replace(/\.exe$/i, '');
}

export function isExcludedExe(path: string): boolean {
  const name = exeBaseName(path).toLowerCase();
  return EXCLUDED_NAMES.has(name) || EXCLUDED_PATTERN.test(name);
}

function isSelf(proc: ScannedProcess, selfPath: string | null): boolean {
  return exeBaseName(proc.path).toLowerCase() === 'diskort' || (selfPath !== null && pathKey(selfPath) === pathKey(proc.path));
}

const clean = (text: string | null | undefined): string | null => {
  const trimmed = text?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
};

const meaningful = (text: string | null): string | null => {
  const value = clean(text);
  return value && !ENGINE_NAMES.has(value.toLowerCase()) ? value : null;
};

/** Gösterilecek adı sınıra çeker (sınır UTF-16 birimiyle; çift birimli karakter ortadan bölünmez) */
export function trimName(name: string): string {
  let result = '';
  for (const ch of name.trim()) {
    if (result.length + ch.length > ACTIVITY_NAME_MAX_LENGTH) break;
    result += ch;
  }
  return result.trim();
}

/**
 * Ad sırası: mağaza kaydındaki ad → ürün adı → dosya açıklaması → (klasörden tanındıysa) oyunun klasörü →
 * exe'nin adı.
 */
export function resolveName(proc: ScannedProcess, storeName: string | null = null, folderName: string | null = null): string {
  return trimName(
    clean(storeName) ?? meaningful(proc.productName) ?? meaningful(proc.fileDescription) ?? clean(folderName) ?? exeBaseName(proc.path),
  );
}

/** Yol, kayıtlı bir oyunun klasörünün içinde mi (en derin eşleşme) */
function libraryGameOf(key: string, libraries: GameLibraries): LibraryGame | null {
  let best: LibraryGame | null = null;
  for (const game of libraries.games) {
    if (key.startsWith(game.dir + '\\') && (!best || game.dir.length > best.dir.length)) best = game;
  }
  return best;
}

/** Yol bilinen bir oyun klasörü kalıbına uyuyorsa oyunun klasörünün adı (özgün harfleriyle) */
function folderGameOf(path: string): string | null {
  const original = segmentsOf(path.replace(/\//g, '\\'));
  const dirs = original.slice(0, -1).map((s) => s.toLowerCase());
  for (const rule of FOLDER_RULES) {
    for (let i = 0; i + rule.segments.length < dirs.length; i++) {
      if (!rule.segments.every((segment, j) => dirs[i + j] === segment)) continue;
      const game = i + rule.segments.length;
      if (rule.exclude?.includes(dirs[game]!)) return null;
      return original[game]!;
    }
  }
  return null;
}

/** Süreç bir oyunsa oyunu, değilse null döndürür */
export function classifyProcess(proc: ScannedProcess, ctx: ClassifyContext): DetectedGame | null {
  if (!proc.path || isSelf(proc, ctx.selfPath)) return null;
  const key = pathKey(proc.path);
  if (ctx.hidden.some((path) => pathKey(path) === key)) return null;
  const found = (name: string, source: GameSource): DetectedGame => ({
    pid: proc.pid,
    path: proc.path,
    name,
    startedAt: proc.startedAt,
    source,
  });

  const manual = ctx.manual.find((game) => pathKey(game.path) === key);
  if (manual) return found(trimName(manual.name) || resolveName(proc), 'manual');

  if (isExcludedExe(proc.path)) return null;
  const library = libraryGameOf(key, ctx.libraries);
  if (library) return library.tool ? null : found(resolveName(proc, library.name), library.source);
  const folder = folderGameOf(proc.path);
  return folder ? found(resolveName(proc, null, folder), 'folder') : null;
}

/** Birden çok oyun açıksa en son başlatılan bildirilir */
export function pickCurrentGame(games: readonly DetectedGame[]): DetectedGame | null {
  let best: DetectedGame | null = null;
  for (const game of games) {
    if (!best || game.startedAt > best.startedAt || (game.startedAt === best.startedAt && game.pid > best.pid)) best = game;
  }
  return best;
}

/** Taramadaki oyunlar (aynı exe birkaç süreçse en eskisi: oyun o zaman başladı) */
export function detectGames(procs: readonly ScannedProcess[], ctx: ClassifyContext): DetectedGame[] {
  const byPath = new Map<string, DetectedGame>();
  for (const proc of procs) {
    const game = classifyProcess(proc, ctx);
    if (!game) continue;
    const key = pathKey(game.path);
    const other = byPath.get(key);
    if (!other || game.startedAt < other.startedAt) byPath.set(key, game);
  }
  return [...byPath.values()];
}

/** "Oyun ekle" listesindeki adı: ürün adı → dosya açıklaması → exe'nin adı */
export const programName = (proc: ScannedProcess): string => resolveName(proc);
