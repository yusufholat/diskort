// Paylaşılan oynatıcılar: aynı dosyayı gösteren bütün görünümler tek çözücüyü paylaşır; dosya ancak bir görünüm
// oynatmak isteyince açılır; kare saati yalnızca en az bir görünüm ekranda, odakta ve hareket serbestken, uygulama
// öndeyken çalışır; son görünüm kalkınca oynatıcı bekletilip bırakılır; hata veren dosya sabit resme döner ve
// (geçici hataysa) görünüm yeniden kurulmadan yeniden denenir. Sürücü (çözücü ve kare saati) sahtedir.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPlayback,
  IDLE_CLOSE_MS,
  MEASURE_MS,
  RETRY_MS,
  VIDEO_PARK_MS,
  type DriverEvents,
  type FailureKind,
  type Playback,
  type PlaybackView,
  type PlayerSpec,
} from '../src/components/cosmetics/packPlayer';

interface FakePlayer {
  spec: PlayerSpec;
  events: DriverEvents;
  frame: { url: string };
  /** setRunning çağrıları, sırayla */
  running: boolean[];
  closed: number;
}

const plate: PlayerSpec = { url: 'https://s/api/cosmetics/packs/buz/0123456789abcdef/plate.webp', kind: 'image', bytes: 10, fps: 30, frames: 180 };
const deco: PlayerSpec = { url: 'https://s/api/cosmetics/packs/buz/0123456789abcdef/deco.webp', kind: 'image', bytes: 10, fps: 30, frames: 180 };
const video = (set: string): PlayerSpec => ({
  url: `https://s/api/cosmetics/packs/${set}/0123456789abcdef/card.mp4`,
  kind: 'video',
  bytes: 10,
  fps: 30,
  frames: 180,
  video: { width: 1216, height: 900 },
});
const card = video('buz');

let opened: FakePlayer[];
let errors: { spec: PlayerSpec; error: unknown; kind: FailureKind }[];
let playback: Playback<{ url: string }>;
let failOpen = false;

beforeEach(() => {
  vi.useFakeTimers();
  opened = [];
  errors = [];
  failOpen = false;
  playback = createPlayback({
    driver: {
      open(spec, events) {
        if (failOpen) throw new Error('açılamadı');
        const player: FakePlayer = { spec, events, frame: { url: spec.url }, running: [], closed: 0 };
        opened.push(player);
        return { frame: player.frame, setRunning: (on) => player.running.push(on), close: () => void player.closed++ };
      },
    },
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      nextFrame: (fn) => void setTimeout(fn, 0),
    },
    onError: (spec, error, kind) => errors.push({ spec, error, kind }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Bir görünüm: son bildirilen durumu ve (ölçülüyorsa) ekranda olup olmadığını tutar */
function view(over: Partial<Pick<PlaybackView<unknown>, 'focused' | 'paused'>> & { measured?: boolean; visible?: boolean } = {}) {
  const v = {
    live: false,
    frame: null as { url: string } | null,
    changes: 0,
    visible: over.visible ?? true,
    measures: 0,
    options: {
      focused: over.focused ?? true,
      paused: over.paused ?? false,
      onChange(state: { live: boolean; frame: { url: string } | null }) {
        v.live = state.live;
        v.frame = state.frame;
        v.changes++;
      },
    } as PlaybackView<{ url: string }>,
  };
  if (over.measured) {
    v.options.measure = (done) => {
      v.measures++;
      done(v.visible);
    };
  }
  return v;
}

describe('paylaşım', () => {
  it('aynı dosyayı gösteren görünümler tek oynatıcıyı paylaşır; başka dosya ayrı oynatıcıdır', () => {
    const rows = [view(), view(), view()];
    for (const r of rows) playback.attach(plate, r.options);
    const avatar = view();
    playback.attach(deco, avatar.options);
    expect(opened.map((p) => p.spec.url)).toEqual([plate.url, deco.url]);
    expect(playback.stats()).toMatchObject({ players: 2, views: 4, loaded: 2 });

    opened[0]!.events.ready();
    expect(rows.every((r) => r.live && r.frame === opened[0]!.frame)).toBe(true);
    expect(avatar.live).toBe(false);
    // Tek kare saati: oynatıcı bir kez başlatılır
    expect(opened[0]!.running).toEqual([true]);
  });

  it('dosya hazır olana kadar görünüm canlı değildir (sabit resim)', () => {
    const v = view();
    playback.attach(plate, v.options);
    expect(v.live).toBe(false);
    expect(opened[0]!.running).toEqual([]);
    opened[0]!.events.ready();
    expect(v.live).toBe(true);
    expect(v.frame).toBe(opened[0]!.frame);
  });

  it('sonradan bağlanan görünüm hazır oynatıcıya hemen katılır', () => {
    playback.attach(plate, view().options);
    opened[0]!.events.ready();
    const late = view();
    playback.attach(plate, late.options);
    expect(late.live).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.running).toEqual([true]);
  });
});

describe('ne zaman oynar', () => {
  it('dosya ancak bir görünüm oynatmak isteyince açılır', () => {
    const paused = view({ paused: true });
    const handle = playback.attach(plate, paused.options);
    expect(opened).toHaveLength(0);
    handle.update({ paused: false });
    expect(opened).toHaveLength(1);
  });

  it('ölçülebilen görünüm ekranda olduğu ölçülene kadar oynamaz', () => {
    const offscreen = view({ measured: true, visible: false });
    playback.attach(plate, offscreen.options);
    vi.advanceTimersByTime(1);
    expect(offscreen.measures).toBe(1);
    expect(opened).toHaveLength(0);

    offscreen.visible = true;
    vi.advanceTimersByTime(MEASURE_MS);
    expect(opened).toHaveLength(1);
    opened[0]!.events.ready();
    expect(offscreen.live).toBe(true);
  });

  it('kare saati en az bir görünüm ekrandayken çalışır', () => {
    const a = view({ measured: true });
    const b = view({ measured: true });
    playback.attach(plate, a.options);
    playback.attach(plate, b.options);
    vi.advanceTimersByTime(1);
    opened[0]!.events.ready();
    expect(opened[0]!.running).toEqual([true]);

    a.visible = false;
    vi.advanceTimersByTime(MEASURE_MS);
    expect(a.live).toBe(false);
    expect(b.live).toBe(true);
    expect(opened[0]!.running).toEqual([true]);

    b.visible = false;
    vi.advanceTimersByTime(MEASURE_MS);
    expect(b.live).toBe(false);
    expect(opened[0]!.running).toEqual([true, false]);
    // Çözücü bırakılmaz: görünümler duruyor
    expect(opened[0]!.closed).toBe(0);

    a.visible = true;
    vi.advanceTimersByTime(MEASURE_MS);
    expect(a.live).toBe(true);
    expect(opened[0]!.running).toEqual([true, false, true]);
  });

  it('odak dışındaki ekranda oynamaz ve ölçülmez; odak gelince hemen ölçülür', () => {
    const v = view({ measured: true, focused: false });
    const handle = playback.attach(plate, v.options);
    vi.advanceTimersByTime(MEASURE_MS * 3);
    expect(opened).toHaveLength(0);
    const before = v.measures;
    handle.update({ focused: true });
    expect(v.measures).toBe(before + 1);
    expect(opened).toHaveLength(1);
    opened[0]!.events.ready();
    expect(v.live).toBe(true);
    handle.update({ focused: false });
    expect(v.live).toBe(false);
    expect(opened[0]!.running).toEqual([true, false]);
  });

  it('durdurulmuş görünüm sabit resimde kalır, diğerleri oynar', () => {
    const speaking = view();
    const silent = view({ paused: true });
    playback.attach(deco, speaking.options);
    const handle = playback.attach(deco, silent.options);
    opened[0]!.events.ready();
    expect(speaking.live).toBe(true);
    expect(silent.live).toBe(false);
    handle.update({ paused: false });
    expect(silent.live).toBe(true);
  });

  it('"hareketi azalt" açıkken hiçbir görünüm canlı değildir, saat durur; kapanınca sürer', () => {
    const v = view();
    playback.attach(plate, v.options);
    opened[0]!.events.ready();
    playback.setReducedMotion(true);
    expect(v.live).toBe(false);
    expect(opened[0]!.running).toEqual([true, false]);
    playback.setReducedMotion(false);
    expect(v.live).toBe(true);
    expect(opened[0]!.running).toEqual([true, false, true]);
  });

  it('"hareketi azalt" açıkken dosya hiç açılmaz', () => {
    playback.setReducedMotion(true);
    playback.attach(plate, view().options);
    expect(opened).toHaveLength(0);
  });

  it('uygulama arka plandayken saat durur ve ölçüm yapılmaz; öne gelince sürer', () => {
    const v = view({ measured: true });
    playback.attach(plate, v.options);
    vi.advanceTimersByTime(1);
    opened[0]!.events.ready();
    playback.setAppActive(false);
    expect(opened[0]!.running).toEqual([true, false]);
    // Görünüm son karesinde kalır (sabit resme dönmez)
    expect(v.live).toBe(true);
    const before = v.measures;
    vi.advanceTimersByTime(MEASURE_MS * 4);
    expect(v.measures).toBe(before);
    playback.setAppActive(true);
    expect(opened[0]!.running).toEqual([true, false, true]);
    expect(v.measures).toBe(before + 1);
  });
});

describe('video çözücüsü boşta tutulmaz', () => {
  it('uygulama arka plana geçince video hemen bırakılır, görünüm sabit resme döner; öne gelince yeniden açılır', () => {
    const v = view();
    playback.attach(card, v.options);
    opened[0]!.events.ready();
    expect(v.live).toBe(true);

    playback.setAppActive(false);
    expect(opened[0]!.closed).toBe(1);
    expect(v.live).toBe(false);
    expect(errors).toHaveLength(0);
    // Arka planda yeniden açılmaz
    vi.advanceTimersByTime(VIDEO_PARK_MS * 2);
    expect(opened).toHaveLength(1);

    playback.setAppActive(true);
    expect(opened).toHaveLength(2);
    expect(v.live).toBe(false);
    opened[1]!.events.ready();
    expect(v.live).toBe(true);
    expect(v.frame).toBe(opened[1]!.frame);
    // Bırakılan oynatıcıdan gelen geç olay yok sayılır
    opened[0]!.events.failed(new Error('geç'));
    expect(v.live).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('arka planda hiçbir dosya açılmaz; öne gelince açılır', () => {
    playback.setAppActive(false);
    playback.attach(plate, view().options);
    playback.attach(card, view().options);
    expect(opened).toHaveLength(0);
    playback.setAppActive(true);
    expect(opened.map((p) => p.spec.kind).sort()).toEqual(['image', 'video']);
  });

  it('görünümü dursa da kimse oynatmak istemiyorsa video bir süre sonra bırakılır, istenince yeniden açılır', () => {
    const v = view();
    const handle = playback.attach(card, v.options);
    opened[0]!.events.ready();
    handle.update({ focused: false });
    expect(opened[0]!.running).toEqual([true, false]);
    vi.advanceTimersByTime(VIDEO_PARK_MS - 1);
    expect(opened[0]!.closed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(opened[0]!.closed).toBe(1);
    expect(playback.stats()).toMatchObject({ players: 1, views: 1, loaded: 0 });

    handle.update({ focused: true });
    expect(opened).toHaveLength(2);
    opened[1]!.events.ready();
    expect(v.live).toBe(true);
  });

  it('süre dolmadan yeniden istenirse video bırakılmaz', () => {
    const handle = playback.attach(card, view().options);
    opened[0]!.events.ready();
    handle.update({ paused: true });
    vi.advanceTimersByTime(VIDEO_PARK_MS / 2);
    handle.update({ paused: false });
    vi.advanceTimersByTime(VIDEO_PARK_MS * 2);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(0);
    expect(opened[0]!.running).toEqual([true, false, true]);
  });

  it('görünümü kalmayan video resimlerden uzun bekletilir (aynı profil yeniden açılınca çözücü yeniden kurulmasın)', () => {
    const handle = playback.attach(card, view().options);
    opened[0]!.events.ready();
    handle.dispose();
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    expect(opened[0]!.closed).toBe(0);
    const again = view();
    playback.attach(card, again.options);
    expect(opened).toHaveLength(1);
    expect(again.live).toBe(true);
  });

  it('görünümü kalmayan video süre dolunca bırakılır (bir kez)', () => {
    playback.attach(card, view().options).dispose();
    vi.advanceTimersByTime(VIDEO_PARK_MS * 2);
    expect(opened[0]!.closed).toBe(1);
    expect(playback.stats().players).toBe(0);
  });

  it('yeni video açılırken boşta bekleyen diğer videolar bırakılır; oynayan bırakılmaz', () => {
    const first = playback.attach(video('buz'), view().options);
    opened[0]!.events.ready();
    const playing = view();
    playback.attach(video('neon'), playing.options);
    opened[1]!.events.ready();
    first.dispose();
    expect(opened[0]!.closed).toBe(0);

    playback.attach(video('sakura'), view().options);
    expect(opened).toHaveLength(3);
    expect(opened[0]!.closed).toBe(1);
    expect(opened[1]!.closed).toBe(0);
    expect(playing.live).toBe(true);
  });

  it('resim çözücüleri arka planda ve odak dışında bırakılmaz (yalnızca saat durur)', () => {
    const handle = playback.attach(plate, view().options);
    opened[0]!.events.ready();
    playback.setAppActive(false);
    playback.setAppActive(true);
    handle.update({ focused: false });
    vi.advanceTimersByTime(VIDEO_PARK_MS * 2);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(0);
  });
});

describe('bırakma', () => {
  it('son görünüm kalkınca saat durur; oynatıcı bir süre bekletilip bırakılır', () => {
    const a = view();
    const b = view();
    const ha = playback.attach(plate, a.options);
    const hb = playback.attach(plate, b.options);
    opened[0]!.events.ready();
    ha.dispose();
    expect(opened[0]!.running).toEqual([true]);
    hb.dispose();
    expect(opened[0]!.running).toEqual([true, false]);
    expect(opened[0]!.closed).toBe(0);
    vi.advanceTimersByTime(IDLE_CLOSE_MS - 1);
    expect(opened[0]!.closed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(opened[0]!.closed).toBe(1);
    expect(playback.stats()).toMatchObject({ players: 0, views: 0, loaded: 0 });
  });

  it('beklerken yeniden bağlanan görünüm aynı oynatıcıyı kullanır (yeniden çözülmez)', () => {
    const handle = playback.attach(plate, view().options);
    opened[0]!.events.ready();
    handle.dispose();
    vi.advanceTimersByTime(IDLE_CLOSE_MS / 2);
    const again = view();
    playback.attach(plate, again.options);
    expect(opened).toHaveLength(1);
    expect(again.live).toBe(true);
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    expect(opened[0]!.closed).toBe(0);
  });

  it('bırakılan oynatıcıdan sonra aynı dosya yeniden açılır', () => {
    playback.attach(plate, view().options).dispose();
    vi.advanceTimersByTime(IDLE_CLOSE_MS);
    playback.attach(plate, view().options);
    expect(opened).toHaveLength(2);
  });

  it('kalkan görünüme bir daha haber verilmez; ikinci dispose bir şey yapmaz', () => {
    const v = view();
    const handle = playback.attach(plate, v.options);
    handle.dispose();
    handle.dispose();
    const changes = v.changes;
    opened[0]!.events.ready();
    handle.update({ paused: true });
    expect(v.changes).toBe(changes);
    expect(playback.stats().views).toBe(0);
  });

  it('görünüm kalmayınca ölçüm zamanlayıcısı durur', () => {
    const v = view({ measured: true });
    const handle = playback.attach(plate, v.options);
    vi.advanceTimersByTime(MEASURE_MS * 2 + 1);
    const before = v.measures;
    expect(before).toBeGreaterThan(1);
    handle.dispose();
    vi.advanceTimersByTime(MEASURE_MS * 4);
    expect(v.measures).toBe(before);
  });
});

describe('hata', () => {
  it('yüklenemeyen dosyada görünümler sabit resimde kalır, hata bir kez bildirilir, oynatıcı kapatılır', () => {
    const a = view();
    const b = view();
    playback.attach(plate, a.options);
    playback.attach(plate, b.options);
    opened[0]!.events.failed(new Error('indirilemedi'));
    opened[0]!.events.failed(new Error('yine'));
    expect(a.live || b.live).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.spec.url).toBe(plate.url);
    expect(opened[0]!.closed).toBe(1);
  });

  it('oynarken hata veren oynatıcı: görünümler sabit resme döner', () => {
    const v = view();
    playback.attach(plate, v.options);
    opened[0]!.events.ready();
    expect(v.live).toBe(true);
    opened[0]!.events.failed(new Error('kareler yavaş'));
    expect(v.live).toBe(false);
    expect(v.frame).toBeNull();
    expect(opened[0]!.closed).toBe(1);
  });

  it('geçici hata: görünüm yeniden kurulmadan, süre dolunca kendiliğinden yeniden denenir', () => {
    const v = view();
    playback.attach(plate, v.options);
    opened[0]!.events.failed(new Error('ağ yok'));
    expect(errors[0]!.kind).toBe('transient');
    // Bu arada bağlanan başka görünüm yeniden denetmez
    playback.attach(plate, view().options);
    vi.advanceTimersByTime(RETRY_MS - 1);
    expect(opened).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(opened).toHaveLength(2);
    opened[1]!.events.ready();
    expect(v.live).toBe(true);
    expect(v.frame).toBe(opened[1]!.frame);
  });

  it('retry: bildirim değişince ya da bağlantı gelince beklemeden yeniden denenir', () => {
    const v = view();
    playback.attach(plate, v.options);
    opened[0]!.events.failed(new Error('404'));
    playback.retry();
    expect(opened).toHaveLength(2);
    opened[1]!.events.ready();
    expect(v.live).toBe(true);
    // Bekleyen kendiliğinden deneme iptal edilmiştir: çalışan oynatıcı yeniden açılmaz
    vi.advanceTimersByTime(RETRY_MS * 2);
    expect(opened).toHaveLength(2);
    expect(opened[1]!.closed).toBe(0);
  });

  it('retry: oynatmak isteyen görünüm yoksa dosya açılmaz, isteyince açılır', () => {
    const v = view();
    const handle = playback.attach(plate, v.options);
    opened[0]!.events.failed(new Error('404'));
    handle.update({ paused: true });
    playback.retry();
    expect(opened).toHaveLength(1);
    handle.update({ paused: false });
    expect(opened).toHaveLength(2);
  });

  it('yeniden denemede de hata veren dosya her seferinde bir kez denenir', () => {
    playback.attach(plate, view().options);
    opened[0]!.events.failed(new Error('404'));
    vi.advanceTimersByTime(RETRY_MS);
    opened[1]!.events.failed(new Error('404'));
    expect(opened).toHaveLength(2);
    vi.advanceTimersByTime(RETRY_MS);
    expect(opened).toHaveLength(3);
    expect(errors).toHaveLength(2);
    // Arada başka deneme yok: her süre dolumunda tek açılış
    expect(opened.slice(0, 2).every((p) => p.closed === 1)).toBe(true);
  });

  it('kalıcı hata (cihaz kareleri yetiştiremiyor) bu oturumda yeniden denenmez', () => {
    const v = view();
    const handle = playback.attach(plate, v.options);
    opened[0]!.events.ready();
    opened[0]!.events.failed(new Error('kareler yavaş'), 'device');
    expect(v.live).toBe(false);
    expect(errors[0]!.kind).toBe('device');
    vi.advanceTimersByTime(RETRY_MS * 3);
    playback.retry();
    playback.attach(plate, view().options);
    expect(opened).toHaveLength(1);
    // Oynatıcı bırakılıp yeniden kurulunca da
    handle.dispose();
    vi.advanceTimersByTime(RETRY_MS);
    playback.attach(plate, view().options);
    expect(opened).toHaveLength(1);
  });

  it('oynatılamayan video bu oturumda yeniden açılmaz (her deneme bir çözücü açar); başka adres denenir', () => {
    const v = view();
    playback.attach(card, v.options);
    opened[0]!.events.failed(new Error('video açılamadı'), 'asset');
    expect(errors[0]!.kind).toBe('asset');
    expect(opened[0]!.closed).toBe(1);
    vi.advanceTimersByTime(RETRY_MS * 3);
    playback.retry();
    playback.setAppActive(false);
    playback.setAppActive(true);
    expect(opened).toHaveLength(1);
    // Yeniden yayınlanan paketin yeni adresi ayrı bir dosyadır
    playback.attach(video('neon'), view().options);
    expect(opened).toHaveLength(2);
  });

  it('bırakılmış oynatıcının hatası hatırlanır: yeniden kurulan görünüm süre dolmadan denemez, dolunca dener', () => {
    const handle = playback.attach(plate, view().options);
    opened[0]!.events.failed(new Error('bozuk'));
    handle.dispose();
    vi.advanceTimersByTime(IDLE_CLOSE_MS);
    expect(playback.stats().players).toBe(0);

    const early = playback.attach(plate, view().options);
    expect(opened).toHaveLength(1);
    early.dispose();
    vi.advanceTimersByTime(RETRY_MS);
    playback.attach(plate, view().options);
    expect(opened).toHaveLength(2);
  });

  it('sürücü açarken fırlatırsa: hata bildirilir, fırlatılmaz', () => {
    failOpen = true;
    const v = view();
    expect(() => playback.attach(plate, v.options)).not.toThrow();
    expect(v.live).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('bırakılmış oynatıcıdan gelen geç olaylar yok sayılır', () => {
    playback.attach(plate, view().options).dispose();
    vi.advanceTimersByTime(IDLE_CLOSE_MS);
    const stale = opened[0]!;
    const v = view();
    playback.attach(plate, v.options);
    stale.events.ready();
    expect(v.live).toBe(false);
    stale.events.failed(new Error('geç'));
    expect(errors).toHaveLength(0);
    opened[1]!.events.ready();
    expect(v.live).toBe(true);
  });

  it('görünümün geri çağrısı ya da ölçümü fırlatsa da oynatıcı çalışmaya devam eder', () => {
    const bad: PlaybackView<{ url: string }> = {
      focused: true,
      paused: false,
      measure: () => {
        throw new Error('görünüm yok');
      },
      onChange: () => {
        throw new Error('bileşen hatası');
      },
    };
    const good = view();
    expect(() => playback.attach(plate, bad)).not.toThrow();
    playback.attach(plate, good.options);
    expect(() => vi.advanceTimersByTime(MEASURE_MS * 2)).not.toThrow();
    expect(() => opened[0]?.events.ready()).not.toThrow();
    expect(good.live).toBe(true);
  });
});
