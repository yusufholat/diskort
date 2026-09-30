// Paket dosyalarının paylaşılan oynatıcıları. Aynı dosyayı (aynı isim plakası, aynı dekorasyon) aynı anda onlarca
// satır gösterebilir: dosya adresi başına TEK oynatıcı (tek çözücü, tek kare saati) kurulur, o dosyayı gösteren
// bütün görünümler onun karesini çizer. Oynatıcı görünümleri sayar:
// - dosya ancak bir görünüm oynatmak isteyince indirilir ve çözülür;
// - kareler yalnızca en az bir görünüm ekranda, ekranı odakta ve uygulama önde iken ilerler;
// - "hareketi azalt" açıkken, durdurulmuş görünümde ve dosya hazır olana kadar görünüm canlı değildir (sabit
//   resmini gösterir);
// - son görünüm de kalkınca oynatıcı kısa bir süre bekletilir (liste kaydırılırken yeniden kurulmasın), sonra
//   bırakılır.
// Çözme ve kare saati sürücüdedir (packDriver.ts: arayüz iş parçacığı); bu dosya React Native'e ve Skia'ya bağlı
// değildir (birim testleri sahte sürücüyle çalışır). Hiçbir geri çağrısı hata fırlatmaz.

/** Oynatılacak dosya */
export interface PlayerSpec {
  /** Dosyanın sürümlü adresi: paylaşımın anahtarı */
  url: string;
  kind: 'image' | 'video';
  /** Bildirimdeki boyut (bayt): önbellekteki dosyanın doğrulanması için */
  bytes: number;
  /** Kare hızı (en fazla bu hızda ilerler) ve döngüdeki kare sayısı */
  fps: number;
  frames: number;
}

export interface DriverEvents {
  /** İlk kare hazır */
  ready(): void;
  /** Yüklenemedi, çözülemedi ya da oynarken hata verdi */
  failed(error: unknown): void;
}

/** Sürücünün bir dosya için kurduğu oynatıcı; `F`: görünümlerin çizdiği kare (paylaşılan değer) */
export interface DriverPlayer<F> {
  frame: F;
  /** Kareler ilerlesin mi */
  setRunning(on: boolean): void;
  close(): void;
}

export interface PlayerDriver<F> {
  open(spec: PlayerSpec, events: DriverEvents): DriverPlayer<F>;
}

export interface PlaybackView<F> {
  /** Görünümün bulunduğu ekran odakta mı (başka bir ekranın altında kalan oynamaz) */
  focused: boolean;
  /** Durdurulmuş: sabit resim (seçicide seçili olmayan seçenek, seste konuşmayan katılımcı) */
  paused: boolean;
  /** Görünümün pencerede görünür olup olmadığını ölçer (verilmezse hep görünür sayılır) */
  measure?: (done: (visible: boolean) => void) => void;
  /** Görünüm canlı mı: canlıysa `frame` çizilir, değilse sabit resim */
  onChange(state: { live: boolean; frame: F | null }): void;
}

export interface PlaybackHandle {
  update(next: { focused?: boolean; paused?: boolean }): void;
  /** Görünümü hemen yeniden ölçer (boyutu değişti) */
  remeasure(): void;
  dispose(): void;
}

export interface PlaybackTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Bir sonraki karede (yerleşimden sonra ilk ölçüm) */
  nextFrame(fn: () => void): void;
}

export interface PlaybackOptions<F> {
  driver: PlayerDriver<F>;
  timers: PlaybackTimers;
  now?: () => number;
  /** Oynatıcı hata verdi (bildirim için); görünümler sabit resme döner */
  onError?: (spec: PlayerSpec, error: unknown) => void;
}

/** Görünümlerin ekranda olup olmadığı bu aralıkla ölçülür (ms) */
export const MEASURE_MS = 500;
/** Görünümü kalmayan oynatıcı bu kadar sonra bırakılır (ms) */
export const IDLE_CLOSE_MS = 4000;
/** Hata veren dosya bu süre geçmeden yeniden denenmez (ms) */
export const RETRY_MS = 60_000;

type State = 'idle' | 'loading' | 'ready' | 'failed';

interface ViewRec<F> extends PlaybackView<F> {
  visible: boolean;
  live: boolean;
  gone: boolean;
}

interface Player<F> {
  spec: PlayerSpec;
  state: State;
  views: Set<ViewRec<F>>;
  handle: DriverPlayer<F> | null;
  running: boolean;
  /** Sürücünün eski bir oynatıcısından gelen olaylar yok sayılır */
  generation: number;
  idleTimer: unknown;
}

export interface Playback<F> {
  attach(spec: PlayerSpec, view: PlaybackView<F>): PlaybackHandle;
  /** Uygulama önde mi */
  setAppActive(on: boolean): void;
  /** "Hareketi azalt" açık mı */
  setReducedMotion(on: boolean): void;
  stats(): { players: number; views: number; live: number; running: number; loaded: number };
}

export function createPlayback<F>({ driver, timers, now = Date.now, onError }: PlaybackOptions<F>): Playback<F> {
  const players = new Map<string, Player<F>>();
  const failures = new Map<string, number>();
  let appActive = true;
  let reduced = false;
  let measureTimer: unknown = null;

  const wants = (v: ViewRec<F>): boolean => !v.gone && v.focused && v.visible && !v.paused && !reduced;

  function notify(p: Player<F>, v: ViewRec<F>): void {
    const live = p.state === 'ready' && p.handle !== null && wants(v);
    if (live === v.live) return;
    v.live = live;
    try {
      v.onChange({ live, frame: live ? p.handle!.frame : null });
    } catch {
      // görünümün geri çağrısı oynatıcıyı düşürmesin
    }
  }

  function fail(p: Player<F>, error: unknown): void {
    if (p.state === 'failed') return;
    p.state = 'failed';
    p.generation++;
    failures.set(p.spec.url, now());
    if (failures.size > 64) failures.delete(failures.keys().next().value!);
    const handle = p.handle;
    p.handle = null;
    p.running = false;
    try {
      onError?.(p.spec, error);
    } catch {
      // bildirim hatası: yapılacak bir şey yok
    }
    for (const v of p.views) notify(p, v);
    try {
      handle?.close();
    } catch {
      // zaten kapalı
    }
  }

  function open(p: Player<F>): void {
    p.state = 'loading';
    const generation = ++p.generation;
    const current = (): boolean => players.get(p.spec.url) === p && p.generation === generation;
    try {
      p.handle = driver.open(p.spec, {
        ready: () => {
          if (!current() || p.state !== 'loading') return;
          p.state = 'ready';
          refresh(p);
        },
        failed: (error) => {
          if (current()) fail(p, error);
        },
      });
    } catch (err) {
      fail(p, err);
    }
  }

  /** Oynatıcının durumunu görünümlerine göre günceller: dosyayı açar, saati başlatır ya da durdurur */
  function refresh(p: Player<F>): void {
    let wanting = false;
    for (const v of p.views) {
      if (wants(v)) {
        wanting = true;
        break;
      }
    }
    if (wanting && p.state === 'idle') open(p);
    const run = p.state === 'ready' && wanting && appActive;
    if (p.handle && run !== p.running) {
      p.running = run;
      try {
        p.handle.setRunning(run);
      } catch (err) {
        fail(p, err);
      }
    }
    for (const v of p.views) notify(p, v);
  }

  function close(p: Player<F>): void {
    if (players.get(p.spec.url) === p) players.delete(p.spec.url);
    p.generation++;
    const handle = p.handle;
    p.handle = null;
    p.running = false;
    try {
      handle?.close();
    } catch {
      // zaten kapalı
    }
  }

  function measureOne(p: Player<F>, v: ViewRec<F>): void {
    if (v.gone || !v.measure) return;
    try {
      v.measure((visible) => {
        if (v.gone || visible === v.visible) return;
        v.visible = visible;
        refresh(p);
      });
    } catch {
      // ölçülemeyen görünüm (yerel görünümü kalkmış): bir sonraki ölçümde yeniden denenir
    }
  }

  function measureAll(): void {
    for (const p of players.values()) for (const v of p.views) if (v.focused) measureOne(p, v);
  }

  function syncMeasureTimer(): void {
    let any = false;
    for (const p of players.values()) {
      if (p.views.size > 0) {
        any = true;
        break;
      }
    }
    if (any && appActive) {
      if (measureTimer === null) measureTimer = timers.setInterval(measureAll, MEASURE_MS);
    } else if (measureTimer !== null) {
      timers.clearInterval(measureTimer);
      measureTimer = null;
    }
  }

  return {
    attach(spec, view) {
      let p = players.get(spec.url);
      if (!p) {
        const failedAt = failures.get(spec.url);
        const blocked = failedAt !== undefined && now() - failedAt < RETRY_MS;
        p = { spec, state: blocked ? 'failed' : 'idle', views: new Set(), handle: null, running: false, generation: 0, idleTimer: null };
        players.set(spec.url, p);
      } else if (p.state === 'failed' && now() - (failures.get(spec.url) ?? 0) >= RETRY_MS) {
        p.state = 'idle';
      }
      if (p.idleTimer !== null) {
        timers.clearTimeout(p.idleTimer);
        p.idleTimer = null;
      }
      const player = p;
      // Ölçülebilen görünüm ekranda olduğu ölçülene kadar oynamaz (listede pencerenin dışında kurulan satırlar)
      const v: ViewRec<F> = { ...view, visible: !view.measure, live: false, gone: false };
      player.views.add(v);
      syncMeasureTimer();
      refresh(player);
      // İlk ölçüm yerleşimden sonraki karede, MEASURE_MS'lik aralığı beklemeden
      if (v.measure) timers.nextFrame(() => measureOne(player, v));
      return {
        update(next) {
          if (v.gone) return;
          const wasFocused = v.focused;
          if (next.focused !== undefined) v.focused = next.focused;
          if (next.paused !== undefined) v.paused = next.paused;
          refresh(player);
          if (v.focused && !wasFocused) measureOne(player, v);
        },
        remeasure() {
          measureOne(player, v);
        },
        dispose() {
          if (v.gone) return;
          v.gone = true;
          v.live = false;
          player.views.delete(v);
          refresh(player);
          syncMeasureTimer();
          if (player.views.size === 0 && players.get(spec.url) === player && player.idleTimer === null) {
            player.idleTimer = timers.setTimeout(() => {
              player.idleTimer = null;
              if (player.views.size === 0) close(player);
            }, IDLE_CLOSE_MS);
          }
        },
      };
    },
    setAppActive(on) {
      if (on === appActive) return;
      appActive = on;
      for (const p of players.values()) refresh(p);
      syncMeasureTimer();
      if (on) measureAll();
    },
    setReducedMotion(on) {
      if (on === reduced) return;
      reduced = on;
      for (const p of players.values()) refresh(p);
    },
    stats() {
      let views = 0;
      let live = 0;
      let running = 0;
      let loaded = 0;
      for (const p of players.values()) {
        views += p.views.size;
        for (const v of p.views) if (v.live) live++;
        if (p.running) running++;
        if (p.handle) loaded++;
      }
      return { players: players.size, views, live, running, loaded };
    },
  };
}
