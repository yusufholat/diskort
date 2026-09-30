// Paket dosyalarının telefondaki çözücüsü ve kare saati (packPlayer.ts'in sürücüsü). Dosya cihaza indirilir
// (packFiles.ts), Skia ile açılır ve kareleri ARAYÜZ İŞ PARÇACIĞINDA (Reanimated'in arayüz çalışma ortamı) tek bir
// requestAnimationFrame döngüsüyle ilerletilir: o dosyayı gösteren bütün Skia yüzeyleri aynı paylaşılan kareyi
// (SharedValue<SkImage>) okur ve kare değişince kendiliğinden, React yeniden çizilmeden boyanır.
//
// - Hareketli WebP: Skia.AnimatedImage (decodeNextFrame / getCurrentFrame).
// - Yan yana video (stacked-h264): Skia.Video. Kareleri GPU dokusudur ve onları çizen iş parçacığında alınmalıdır
//   (Skia'nın kendi useVideo'su gibi); videonun kendisi, Skia'nın yaptığı gibi ayrı bir çalışma ortamında açılır
//   (açılışı arayüzü bekletmesin). iOS'ta kareleri ve döngüyü AVPlayer yürütür.
//
// Android'de video (Skia 2.6.2: android/src/main/java/.../RNSkVideo.java, android/cpp/rnskia-android/
// RNSkAndroidVideo.cpp, OpenGLContext.h), bu dosyanın uyduğu kurallar:
// - Kareleri çağrılar ilerletir: her `nextImage` çözücüye en çok bir örnek verir ve en çok bir kare alır (girdi
//   ve çıktı için 10'ar ms'ye kadar bekleyerek, arayüz iş parçacığında). Saniyede paketin kare hızı kadar çağrı
//   videoyu gerçek hızında oynatır. Yeni kare yoksa son kare yeniden gelir, hiç kare yoksa null.
// - Çözücü dosyanın sonunda başa dönmez (setLooping yalnızca sessiz MediaPlayer'ı döndürür): döngüyü biz kurarız
//   (videoShouldRewind → seek(0)). Sarmadan sonra çözücü dolana dek birkaç kare son kare gösterilir.
// - Kare, çözücünün arabelleğine bağlı bir GPU dokusudur (EGLImage, harici doku): kopyası değildir. Arabellek
//   belleği kare bırakılana kadar durur ama çözücü onu sonraki kareler için yeniden kullanabilir; bu yüzden hep
//   en son kare gösterilir ve önceki kare, yerine yenisi konunca bırakılır (her çağrı yeni bir doku açar:
//   bırakılmayan kare sızar). Kareyi çizen resimler kendi başvurularını tuttuğundan bırakmak çizimi bozmaz.
// - Karenin boyu çözücünün arabelleğininkidir (hizalama payı olabilir); birleştirme gölgelendiricisi videoyu
//   kendi pikselleriyle örneklediğinden pay zararsızdır (bkz. packLayout.ts STACKED_ALPHA_SKSL).
// - Yerel taraf çözücüyü kapatmaz (RNSkVideo.release() çağrılmaz): bırakılan videonun MediaCodec'i çöp
//   toplanınca kapanır. Bu yüzden videolar gereksiz yere açılıp kapatılmaz (packPlayer.ts VIDEO_PARK_MS) ve
//   bırakmadan önce durdurulur.
// - RNSkVideo'nun içinde fırlayan Java hatası yerel tarafta yakalanmaz (uygulamayı kapatabilir). Bilinen iki
//   yolu kapalıdır: Android 10'dan (API 29) eski Android'de video hiç açılmaz (packSource.ts) ve uygulama arka
//   plana geçince video bırakılır (sistem arka plandaki uygulamanın çözücüsünü geri alabilir: sonraki çağrı hata
//   fırlatırdı).
//
// Neden arayüz iş parçacığı: kareyi çizen yerel görünüm de oradadır; kare JavaScript iş parçacığında değiştirilip
// eskisi bırakılırsa çizim silinmiş kareyi okuyabilir (eski motorun RETIRE_MS'le çözdüğü yarış). Burada kare
// değiştirme, çizim ve bırakma aynı iş parçacığında sırayla olur.
//
// Hiçbir yol hata fırlatmaz: çözülemeyen, açılamayan, yavaş kalan dosya `failed` olayıyla bildirilir, görünümler
// sabit resme döner.

import { makeMutable, type SharedValue } from 'react-native-reanimated';
import { createWorkletRuntime, scheduleOnRN, scheduleOnRuntime, scheduleOnUI, type WorkletRuntime } from 'react-native-worklets';
import type { SkAnimatedImage, SkData, SkImage, Video } from '@shopify/react-native-skia';
import { frameDue, frameInterval, STEP_BUDGET_AFTER, STEP_BUDGET_MS, stepCost, videoShouldRewind } from './packLayout';
import { packFiles } from './packFiles';
import type { DriverEvents, PlayerDriver, PlayerSpec } from './packPlayer';
import { skia, type SkiaModule } from './skia';

/** Görünümlerin çizdiği kare */
export type Frame = SharedValue<SkImage | null>;

type SkiaApi = SkiaModule['Skia'];

/** Dosya bu sürede açılamazsa (ms) vazgeçilir (Android'de okunamayan dosyanın sözü hiç sonuçlanmaz) */
const LOAD_TIMEOUT_MS = 20_000;
/** Videodan ilk kare bu sürede gelmezse (ms) vazgeçilir */
const PRIME_TIMEOUT_MS = 8000;
/** Kapanan oynatıcının son karesi bu kadar sonra bırakılır (ms): onu çizen yüzeyler önce kalksın */
const FRAME_RELEASE_MS = 2000;

// ---------- Arayüz iş parçacığı ----------

interface UiPlayer {
  frame: Frame;
  S: SkiaApi;
  /** Hareketli resim: dosyanın baytları (döngüsü sınırlı dosyada çözücü yeniden kurulur) ve çözücü */
  data: SkData | null;
  image: SkAnimatedImage | null;
  /** Son yeniden kurmadan beri çözülen kare sayısı */
  decoded: number;
  /** Video */
  clip: Video | null;
  /** Döngüyü oynatıcı kurar (Android) */
  manualLoop: boolean;
  frames: number;
  durationMs: number;
  /** Son sarmadan beri kare isteği sayısı ve bir sonraki adımda başa sarılacak mı */
  calls: number;
  rewind: boolean;
  /** Son çözülen karenin zamanı (ms) ve kaç istektir değişmediği */
  lastTimeMs: number;
  idleCalls: number;
  /** Kare aralığı (ms) ve son karenin zamanı */
  interval: number;
  last: number;
  running: boolean;
  /** İlk kare geldi mi (video ilk karesini oynarken verir) */
  primed: boolean;
  openedAt: number;
  failed: boolean;
  /** Kare başına işin kayan ortalaması (ms) ve kare sayısı */
  cost: number;
  steps: number;
}

interface UiState {
  players: Record<string, UiPlayer>;
  /** Kare döngüsünü (çalışmıyorsa) başlatır */
  kick(): void;
}

function messageOf(error: unknown): string {
  'worklet';
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
}

/** Paylaşılan kareyi değiştirir, eskisini bırakır (onu çizen yüzeyler kendi başvurularını tutar) */
function uiShow(frame: Frame, next: SkImage | null): void {
  'worklet';
  const old = frame.value;
  frame.value = next;
  if (old && old !== next) old.dispose();
}

function uiStepImage(p: UiPlayer): void {
  'worklet';
  let image = p.image;
  if (!image) return;
  if (image.decodeNextFrame() < 0) {
    // Döngüsü sınırlı dosya bitti: çözücü baştan kurulur. Hiç ilerlemeden bitiyorsa dosya hareketli değildir.
    if (p.decoded < 2 || !p.data) throw new Error('hareketli resim ilerlemiyor');
    const again = p.S.AnimatedImage.MakeAnimatedImageFromEncoded(p.data);
    if (!again) throw new Error('hareketli resim yeniden açılamadı');
    image.dispose();
    p.image = image = again;
    p.decoded = 0;
  } else p.decoded++;
  const next = image.getCurrentFrame();
  if (next) uiShow(p.frame, next);
}

function uiStepVideo(key: number, p: UiPlayer, clip: Video, now: number): void {
  'worklet';
  if (p.rewind) {
    clip.seek(0);
    p.calls = 0;
    p.idleCalls = 0;
    p.rewind = false;
  }
  const counted = p.manualLoop && (!p.primed || clip.isPlaying());
  const started = performance.now();
  const next = clip.nextImage();
  const took = performance.now() - started;
  if (next) {
    uiShow(p.frame, next);
    if (!p.primed) {
      p.primed = true;
      if (!p.running) clip.pause();
      scheduleOnRN(onUiEvent, key, 'ready', '');
    }
  } else if (!p.primed && now - p.openedAt > PRIME_TIMEOUT_MS) throw new Error('videodan kare gelmedi');
  if (counted) {
    p.calls++;
    const time = clip.currentTime();
    if (time === p.lastTimeMs) p.idleCalls++;
    else {
      p.lastTimeMs = time;
      p.idleCalls = 0;
    }
    p.rewind = videoShouldRewind(p.calls, p.idleCalls, p.frames, time, p.durationMs, p.interval, took);
  }
}

/** Bir kare ilerletir; kareler bu cihazda yetişmiyorsa (ortalama iş bütçeyi aşıyor) false döner */
function uiStep(key: number, p: UiPlayer, now: number): boolean {
  'worklet';
  const started = performance.now();
  if (p.clip) uiStepVideo(key, p, p.clip, now);
  else uiStepImage(p);
  if (!p.primed) return true;
  p.cost = stepCost(p.cost, performance.now() - started);
  p.steps++;
  return p.steps <= STEP_BUDGET_AFTER || p.cost <= (p.clip ? STEP_BUDGET_MS.video : STEP_BUDGET_MS.image);
}

/** `type`: 'error' dosya açılamadı ya da çözülemedi (geçici sayılır), 'slow' cihaz yetiştiremiyor (yeniden denenmez) */
function uiFail(key: number, p: UiPlayer, type: 'error' | 'slow', message: string): void {
  'worklet';
  p.failed = true;
  p.running = false;
  p.primed = true;
  try {
    p.clip?.pause();
  } catch {
    // zaten durmuş
  }
  scheduleOnRN(onUiEvent, key, type, message);
}

/** Arayüz çalışma ortamındaki durum (oynatıcılar ve kare döngüsü); ilk çağrıda kurulur */
function ui(): UiState {
  'worklet';
  const g = globalThis as unknown as { __diskortKozmetik?: UiState };
  if (g.__diskortKozmetik) return g.__diskortKozmetik;
  const players: Record<string, UiPlayer> = {};
  let looping = false;
  const tick = (now: number): void => {
    let more = false;
    for (const key in players) {
      const p = players[key];
      // Çalışan ya da ilk karesini bekleyen oynatıcı ilerler
      if (!p || p.failed || (!p.running && p.primed)) continue;
      more = true;
      if (p.openedAt === 0) p.openedAt = now;
      if (!frameDue(now, p.last, p.interval)) continue;
      p.last = now;
      try {
        if (!uiStep(Number(key), p, now)) uiFail(Number(key), p, 'slow', `kareler yavaş (ortalama ${Math.round(p.cost)} ms)`);
      } catch (err) {
        uiFail(Number(key), p, 'error', messageOf(err));
      }
    }
    if (more) requestAnimationFrame(tick);
    else looping = false;
  };
  const state: UiState = {
    players,
    kick: () => {
      if (looping) return;
      looping = true;
      requestAnimationFrame(tick);
    },
  };
  g.__diskortKozmetik = state;
  return state;
}

function uiPlayer(S: SkiaApi, frame: Frame, fps: number, frames: number): UiPlayer {
  'worklet';
  return {
    frame,
    S,
    data: null,
    image: null,
    decoded: 0,
    clip: null,
    manualLoop: false,
    frames,
    durationMs: 0,
    calls: 0,
    rewind: false,
    lastTimeMs: -1,
    idleCalls: 0,
    interval: 1000 / fps,
    last: 0,
    running: false,
    primed: false,
    openedAt: 0,
    failed: false,
    cost: 0,
    steps: 0,
  };
}

function uiOpenImage(key: number, S: SkiaApi, data: SkData, frame: Frame, fps: number, frames: number): void {
  'worklet';
  try {
    const image = S.AnimatedImage.MakeAnimatedImageFromEncoded(data);
    if (!image) throw new Error('hareketli resim açılamadı');
    const first = image.getCurrentFrame();
    if (!first) {
      image.dispose();
      throw new Error('hareketli resmin ilk karesi yok');
    }
    const p = uiPlayer(S, frame, fps, frames);
    p.data = data;
    p.image = image;
    p.primed = true;
    uiShow(frame, first);
    ui().players[key] = p;
    scheduleOnRN(onUiEvent, key, 'ready', '');
  } catch (err) {
    try {
      data.dispose();
    } catch {
      // zaten bırakılmış
    }
    scheduleOnRN(onUiEvent, key, 'error', messageOf(err));
  }
}

function uiOpenVideo(
  key: number,
  S: SkiaApi,
  clip: Video,
  frame: Frame,
  fps: number,
  frames: number,
  manualLoop: boolean,
  width: number,
  height: number,
): void {
  'worklet';
  try {
    // Video bildirimdeki kareden küçükse ya da döndürülmüşse iki yarı yerinde değildir: birleştirilemez
    const size = clip.size();
    if (size.width > 0 && size.height > 0 && (size.width < width || size.height < height)) {
      throw new Error(`video ${size.width}×${size.height}, beklenen ${width}×${height}`);
    }
    if (clip.rotation() !== 0) throw new Error('video döndürülmüş');
    clip.setVolume(0);
    clip.setLooping(true);
    const p = uiPlayer(S, frame, fps, frames);
    p.clip = clip;
    p.manualLoop = manualLoop;
    const duration = clip.duration();
    p.durationMs = duration > 0 ? duration : frames * p.interval;
    if (duration > 0) p.frames = Math.max(1, Math.round(duration / p.interval));
    const state = ui();
    state.players[key] = p;
    // İlk kare oynarken gelir; gelince (kimse oynatmak istemiyorsa) durdurulur
    clip.play();
    state.kick();
  } catch (err) {
    try {
      clip.dispose();
    } catch {
      // zaten bırakılmış
    }
    scheduleOnRN(onUiEvent, key, 'error', messageOf(err));
  }
}

function uiSetRunning(key: number, on: boolean): void {
  'worklet';
  const state = ui();
  const p = state.players[key];
  if (!p || p.failed || p.running === on) return;
  p.running = on;
  try {
    if (p.clip && p.primed) {
      if (on) p.clip.play();
      else p.clip.pause();
    }
  } catch (err) {
    uiFail(key, p, 'error', messageOf(err));
    return;
  }
  if (on) {
    p.last = 0;
    state.kick();
  }
}

function uiClose(key: number): void {
  'worklet';
  const state = ui();
  const p = state.players[key];
  if (!p) return;
  delete state.players[key];
  p.running = false;
  try {
    p.clip?.pause();
  } catch {
    // zaten durmuş
  }
  for (const resource of [p.clip, p.image, p.data]) {
    try {
      resource?.dispose();
    } catch {
      // zaten bırakılmış
    }
  }
}

/** Kullanılmayacak videoyu bırakır (oynatıcı, video açılırken kapandı) */
function uiDropVideo(clip: Video): void {
  'worklet';
  try {
    clip.dispose();
  } catch {
    // zaten bırakılmış
  }
}

function uiRelease(frame: Frame): void {
  'worklet';
  uiShow(frame, null);
}

// ---------- Video: ayrı çalışma ortamında açılır ----------

let runtime: WorkletRuntime | null = null;
const videoRuntime = (): WorkletRuntime => (runtime ??= createWorkletRuntime({ name: 'diskort-kozmetik-video' }));

function workerOpenVideo(S: SkiaApi, uri: string, key: number): void {
  'worklet';
  try {
    scheduleOnRN(onVideoOpened, key, S.Video(uri) as Video);
  } catch (err) {
    scheduleOnRN(onUiEvent, key, 'error', `video açılamadı: ${messageOf(err)}`);
  }
}

// ---------- JavaScript iş parçacığı ----------

interface OpenPlayer {
  spec: PlayerSpec;
  events: DriverEvents;
  frame: Frame;
  S: SkiaApi;
  /** Kare hızı (sınırlanmış) */
  fps: number;
  manualVideoLoop: boolean;
}

/** Açık oynatıcılar (anahtar: arayüz çalışma ortamındaki kaydın anahtarı); kapanan buradan çıkar */
const opened = new Map<number, OpenPlayer>();
let nextKey = 1;

function onUiEvent(key: number, type: 'ready' | 'error' | 'slow', message: string): void {
  const player = opened.get(key);
  if (!player) return;
  if (type === 'ready') player.events.ready();
  // Cihazdaki dosyadan açılamayan ya da oynarken hata veren video yeniden denenmez: her deneme bir donanım
  // çözücüsü açar ve yerel taraf onu ancak çöp toplarken kapatır. Çözülemeyen resim ucuzdur, yeniden denenir.
  else player.events.failed(new Error(message), type === 'slow' ? 'device' : player.spec.kind === 'video' ? 'asset' : 'transient');
}

function onVideoOpened(key: number, clip: Video): void {
  const player = opened.get(key);
  if (!player) {
    scheduleOnUI(uiDropVideo, clip);
    return;
  }
  const { spec } = player;
  scheduleOnUI(
    uiOpenVideo,
    key,
    player.S,
    clip,
    player.frame,
    player.fps,
    spec.frames,
    player.manualVideoLoop,
    spec.video?.width ?? 0,
    spec.video?.height ?? 0,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} zaman aşımına uğradı`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function load(key: number, player: OpenPlayer): Promise<void> {
  const { spec, frame, S, fps } = player;
  if (spec.kind === 'video') {
    // Video yalnızca cihazdaki dosyadan oynatılır (ağdan okumak kare döngüsünü bekletir)
    const uri = await packFiles.ensure(spec);
    if (!opened.has(key)) return;
    scheduleOnRuntime(videoRuntime(), workerOpenVideo, S, uri, key);
    return;
  }
  // Cihazda önbellek klasörü yoksa dosya doğrudan sunucudan okunur (her açılışta yeniden iner)
  const uri = packFiles.available ? await packFiles.ensure(spec) : spec.url;
  if (!opened.has(key)) return;
  const data = await withTimeout(S.Data.fromURI(uri), LOAD_TIMEOUT_MS, 'dosyanın okunması');
  if (!opened.has(key)) {
    data.dispose();
    return;
  }
  scheduleOnUI(uiOpenImage, key, S, data, frame, fps, spec.frames);
}

/**
 * Skia ile çözen sürücü. `manualVideoLoop`: videonun döngüsünü oynatıcı kurar (Android; bkz. dosyanın başı).
 * Skia kurulmadıysa `open` hemen `failed` bildirir.
 */
export function createSkiaDriver(options: { manualVideoLoop: boolean }): PlayerDriver<Frame> {
  return {
    open(spec, events) {
      const key = nextKey++;
      const frame = makeMutable<SkImage | null>(null);
      const sk = skia();
      if (!sk) {
        queueMicrotask(() => events.failed(new Error('Skia yok'), 'device'));
        return { frame, setRunning: () => undefined, close: () => undefined };
      }
      const player: OpenPlayer = {
        spec,
        events,
        frame,
        S: sk.Skia,
        fps: 1000 / frameInterval(spec.fps),
        manualVideoLoop: options.manualVideoLoop,
      };
      opened.set(key, player);
      load(key, player).catch((err: unknown) => {
        if (opened.has(key)) events.failed(err);
      });
      return {
        frame,
        setRunning(on) {
          if (opened.has(key)) scheduleOnUI(uiSetRunning, key, on);
        },
        close() {
          if (!opened.delete(key)) return;
          scheduleOnUI(uiClose, key);
          setTimeout(() => scheduleOnUI(uiRelease, frame), FRAME_RELEASE_MS);
        },
      };
    },
  };
}
