// Paket dosyalarının paylaşılan oynatıcıları. Aynı dosyayı (aynı isim plakası, aynı dekorasyon) aynı anda onlarca
// satır gösterebilir: dosya adresi başına TEK oynatıcı (tek çözücü, tek kare saati) kurulur, o dosyayı gösteren
// bütün görünümler onun karesini çizer. Oynatıcı görünümleri sayar:
// - dosya ancak bir görünüm oynatmak isteyince indirilir ve çözülür;
// - kareler yalnızca en az bir görünüm ekranda, ekranı odakta ve uygulama önde iken ilerler;
// - "hareketi azalt" açıkken, durdurulmuş görünümde ve dosya hazır olana kadar görünüm canlı değildir (sabit
//   resmini gösterir);
// - son görünüm de kalkınca oynatıcı kısa bir süre bekletilir (liste kaydırılırken yeniden kurulmasın), sonra
//   bırakılır;
// - video çözücüsü pahalı ve sayılı bir kaynaktır (telefonun donanım çözücüsü): görünümleri dursa da kimse
//   oynatmak istemiyorsa kısa süre sonra, uygulama arka plana geçince hemen bırakılır; yeniden istenince dosya
//   (cihazdaki önbellekten) yeniden açılır. Arka planda hiçbir dosya açılmaz;
// - dosya yüklenemez ya da çözülemezse görünümler sabit resimde kalır; geçici hata bir süre sonra kendiliğinden,
//   bildirim değişince ya da bağlantı geri gelince hemen (`retry`) yeniden denenir: görünümün yeniden kurulması
//   gerekmez.
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
  /** Video: dosyanın tam karesi (piksel); çözülen video bundan küçükse oynatılmaz */
  video?: { width: number; height: number };
}

export interface DriverEvents {
  /** İlk kare hazır */
  ready(): void;
  /** Yüklenemedi, çözülemedi ya da oynarken hata verdi (tür verilmezse geçici) */
  failed(error: unknown, kind?: FailureKind): void;
}

/**
 * Hatanın türü:
 * - `transient`: geçici sayılır (ağ, eskimiş adres, çözülemeyen resim): bir süre sonra ve `retry()` ile yeniden
 *   denenir
 * - `asset`: dosya bu telefonda oynatılamıyor (video açılamadı ya da oynarken hata verdi): bu oturumda yeniden
 *   denenmez (her deneme bir donanım çözücüsü açar); adres değişirse yeni dosya denenir
 * - `device`: dosya sağlam ama telefon kareleri yetiştiremiyor: bu oturumda yeniden denenmez
 */
export type FailureKind = 'transient' | 'asset' | 'device';

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
  onError?: (spec: PlayerSpec, error: unknown, kind: FailureKind) => void;
}

/** Görünümlerin ekranda olup olmadığı bu aralıkla ölçülür (ms) */
export const MEASURE_MS = 500;
/** Görünümü kalmayan oynatıcı bu kadar sonra bırakılır (ms) */
export const IDLE_CLOSE_MS = 4000;
/**
 * Kimsenin oynatmak istemediği videonun çözücüsü bu kadar sonra bırakılır (ms). Resimlerden uzun: Android'de
 * bırakılan çözücüyü sistem hemen değil çöp toplarken kapatır; aynı profil art arda açılınca her seferinde yeni
 * çözücü açılmasın. Aynı anda en çok bir boşta video tutulur (yenisi açılırken eskiler bırakılır).
 */
export const VIDEO_PARK_MS = 30_000;
/**
 * Geçici hata veren dosya bu kadar sonra (ms) kendiliğinden yeniden denenir (görünümü duruyorsa); daha erken
 * yalnızca `retry()` ile (bildirim değişti, bağlantı geri geldi)
 */
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
  /** Geçici hatadan sonra kendiliğinden yeniden deneme */
  retryTimer: unknown;
  /** Kimsenin oynatmak istemediği videonun çözücüsünü bırakma */
  parkTimer: unknown;
}

export interface Playback<F> {
  attach(spec: PlayerSpec, view: PlaybackView<F>): PlaybackHandle;
  /** Uygulama önde mi */
  setAppActive(on: boolean): void;
  /** "Hareketi azalt" açık mı */
  setReducedMotion(on: boolean): void;
  /**
   * Geçici hata vermiş dosyaları beklemeden yeniden dener (bildirim değişti, bağlantı geri geldi): görünümler
   * yeniden kurulmadan, dosya açılınca canlıya döner. Kalıcı hatalar (bkz. FailureKind) denenmez.
   */
  retry(): void;
  stats(): { players: number; views: number; live: number; running: number; loaded: number };
}

export function createPlayback<F>({ driver, timers, now = Date.now, onError }: PlaybackOptions<F>): Playback<F> {
  const players = new Map<string, Player<F>>();
  /** Hata vermiş dosyalar: oynatıcısı bırakılsa da hatırlanır (yeniden kurulan görünüm hemen yeniden denemesin) */
  const failures = new Map<string, { at: number; permanent: boolean }>();
  let appActive = true;
  let reduced = false;
  let measureTimer: unknown = null;

  /** Dosya şu an denenmemeli mi (kalıcı hata ya da geçici hatanın bekleme süresi dolmadı) */
  function blocked(url: string): boolean {
    const failure = failures.get(url);
    return failure !== undefined && (failure.permanent || now() - failure.at < RETRY_MS);
  }

  function cancelRetry(p: Player<F>): void {
    if (p.retryTimer === null) return;
    timers.clearTimeout(p.retryTimer);
    p.retryTimer = null;
  }

  function cancelPark(p: Player<F>): void {
    if (p.parkTimer === null) return;
    timers.clearTimeout(p.parkTimer);
    p.parkTimer = null;
  }

  const anyWanting = (p: Player<F>): boolean => {
    for (const v of p.views) if (wants(v)) return true;
    return false;
  };

  /**
   * Oynatıcının çözücüsünü bırakır ama oynatıcıyı ve görünümlerini tutar: görünümler sabit resme döner, yeniden
   * oynatmak isteyen olunca dosya yeniden açılır. Hata sayılmaz.
   */
  function park(p: Player<F>): void {
    cancelPark(p);
    const handle = p.handle;
    if (!handle) return;
    p.generation++;
    p.handle = null;
    p.running = false;
    p.state = 'idle';
    for (const v of p.views) notify(p, v);
    try {
      handle.close();
    } catch {
      // zaten kapalı
    }
  }

  /** Video çözücüsü boşta tutulmaz: arka planda hemen, kimse oynatmak istemiyorsa kısa süre sonra bırakılır */
  function syncPark(p: Player<F>, wanting: boolean): void {
    if (p.spec.kind !== 'video' || !p.handle) {
      cancelPark(p);
      return;
    }
    if (!appActive) park(p);
    else if (wanting) cancelPark(p);
    else if (p.parkTimer === null) {
      p.parkTimer = timers.setTimeout(() => {
        p.parkTimer = null;
        if (!anyWanting(p)) park(p);
      }, VIDEO_PARK_MS);
    }
  }

  /** Hata vermiş oynatıcıyı yeniden denenebilir yapar; oynatmak isteyen görünümü varsa dosya yeniden açılır */
  function revive(p: Player<F>): void {
    cancelRetry(p);
    if (p.state !== 'failed' || players.get(p.spec.url) !== p) return;
    p.state = 'idle';
    refresh(p);
  }

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

  function fail(p: Player<F>, error: unknown, kind: FailureKind): void {
    if (p.state === 'failed') return;
    const permanent = kind !== 'transient';
    p.state = 'failed';
    p.generation++;
    cancelPark(p);
    failures.delete(p.spec.url);
    failures.set(p.spec.url, { at: now(), permanent });
    if (failures.size > 64) failures.delete(failures.keys().next().value!);
    const handle = p.handle;
    p.handle = null;
    p.running = false;
    try {
      onError?.(p.spec, error, kind);
    } catch {
      // bildirim hatası: yapılacak bir şey yok
    }
    for (const v of p.views) notify(p, v);
    try {
      handle?.close();
    } catch {
      // zaten kapalı
    }
    // Geçici hata sabit resimde sonsuza kadar bırakmaz: bir süre sonra kendiliğinden yeniden denenir
    cancelRetry(p);
    if (!permanent && players.get(p.spec.url) === p) {
      p.retryTimer = timers.setTimeout(() => {
        p.retryTimer = null;
        failures.delete(p.spec.url);
        revive(p);
      }, RETRY_MS);
    }
  }

  function open(p: Player<F>): void {
    // Yeni video açılırken boşta bekleyen diğer videoların çözücüleri bırakılır (donanım çözücüsü sayılıdır)
    if (p.spec.kind === 'video') {
      for (const other of players.values()) if (other !== p && other.spec.kind === 'video' && !anyWanting(other)) park(other);
    }
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
        failed: (error, kind) => {
          if (current()) fail(p, error, kind ?? 'transient');
        },
      });
    } catch (err) {
      fail(p, err, 'transient');
    }
  }

  /** Oynatıcının durumunu görünümlerine göre günceller: dosyayı açar, saati başlatır ya da durdurur */
  function refresh(p: Player<F>): void {
    const wanting = anyWanting(p);
    syncPark(p, wanting);
    if (wanting && appActive && p.state === 'idle') open(p);
    const run = p.state === 'ready' && wanting && appActive;
    if (p.handle && run !== p.running) {
      p.running = run;
      try {
        p.handle.setRunning(run);
      } catch (err) {
        fail(p, err, 'transient');
      }
    }
    for (const v of p.views) notify(p, v);
  }

  function close(p: Player<F>): void {
    if (players.get(p.spec.url) === p) players.delete(p.spec.url);
    cancelRetry(p);
    cancelPark(p);
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
        p = {
          spec,
          state: blocked(spec.url) ? 'failed' : 'idle',
          views: new Set(),
          handle: null,
          running: false,
          generation: 0,
          idleTimer: null,
          retryTimer: null,
          parkTimer: null,
        };
        players.set(spec.url, p);
      } else if (p.state === 'failed' && !blocked(spec.url)) {
        cancelRetry(p);
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
            }, spec.kind === 'video' ? VIDEO_PARK_MS : IDLE_CLOSE_MS);
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
    retry() {
      for (const [url, failure] of failures) if (!failure.permanent) failures.delete(url);
      for (const p of [...players.values()]) if (p.state === 'failed' && !failures.has(p.spec.url)) revive(p);
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
