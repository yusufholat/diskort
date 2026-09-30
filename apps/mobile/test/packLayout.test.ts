// Kozmetik paketlerinin yerleşim ve kare saati hesapları: parçaların kutuları (paketin dosya ölçüleriyle), çizim
// yüzeyinin çözünürlüğü, yan yana videonun koordinat hesabı, kare sınırı ve Android'deki video döngüsünün kuralı.

import { describe, expect, it } from 'vitest';
import {
  BUDGET_STRIKES,
  budgetStrikes,
  heaviest,
  nextFrames,
  STEP_BUDGET_MS,
  TICK_BUDGET_MS,
  FEW_PLAYERS,
  tickBudget,
  ANIMATED_DECORATION_MIN_SIZE,
  CARD_BANNER_RATIO,
  cardEffectBox,
  decorationBox,
  decorationCanvasSize,
  decorationLook,
  decorationRadius,
  frameDue,
  frameInterval,
  isStackedLayout,
  plateBox,
  PLATE_BLEND,
  stackedSample,
  stackedUniforms,
  stepCost,
  surfaceScale,
  VIDEO_BROKEN_TIME,
  videoBroken,
  VIDEO_TAIL_FRAMES,
  videoShouldRewind,
  withAlpha,
} from '../src/components/cosmetics/packLayout';

describe('avatar dekorasyonu', () => {
  it('paketin oranı: 46 piksellik dış yarıçapa 132 piksellik kare', () => {
    // Profil kartındaki 80 piksellik avatar + halka = 46 piksellik dış yarıçap
    expect(decorationRadius(80)).toBeCloseTo(46);
    expect(decorationBox(80)).toBe(132);
    expect(decorationBox(72)).toBe(119);
    expect(decorationBox(88)).toBe(145);
  });

  it('küçük avatarda yerleşim avatarın kendisi, büyükte hareketli kare', () => {
    expect(decorationCanvasSize(38)).toBe(38);
    expect(decorationCanvasSize(ANIMATED_DECORATION_MIN_SIZE - 1)).toBe(ANIMATED_DECORATION_MIN_SIZE - 1);
    expect(decorationCanvasSize(ANIMATED_DECORATION_MIN_SIZE)).toBe(decorationBox(ANIMATED_DECORATION_MIN_SIZE));
    expect(decorationCanvasSize(72)).toBe(119);
  });

  it('yalnızca animate ile oynar (açık profil); gerisi sabit resim ya da halka', () => {
    // Açık profil kartı (72 ve ayarlardaki 88 piksellik avatar)
    expect(decorationLook(72, { animate: true })).toBe('live');
    expect(decorationLook(88, { animate: true })).toBe('live');
    // Ses kutucuğunun büyük avatarı (72): sabit resim, konuşurken de
    expect(decorationLook(72)).toBe('poster');
    expect(decorationLook(ANIMATED_DECORATION_MIN_SIZE)).toBe('poster');
    // Seçicinin kutuları (42): halka yerine sabit resim, oynamaz
    expect(decorationLook(42, { poster: true })).toBe('poster');
    // Mesajlar, üye ve konuşma listeleri, alt panel, küçük ses kutucuğu: halka
    for (const size of [16, 30, 34, 36, 38, 40, 44, 56, ANIMATED_DECORATION_MIN_SIZE - 1]) expect(decorationLook(size)).toBe('ring');
  });
});

describe('profil kartı efekti', () => {
  it('kartın genişliğine ölçeklenir, üste yaslanır, oranı dosyadan gelir', () => {
    expect(cardEffectBox(300, 540, 600, 900)).toEqual({ width: 300, height: 450, visibleHeight: 450 });
    expect(cardEffectBox(360, 800, 600, 900)).toEqual({ width: 360, height: 540, visibleHeight: 540 });
  });

  it('kısa kart altını kırpar', () => {
    expect(cardEffectBox(300, 320, 600, 900)).toEqual({ width: 300, height: 450, visibleHeight: 320 });
  });

  it('ölçülmemiş kartta ya da bozuk dosyada boş', () => {
    expect(cardEffectBox(0, 0, 600, 900).width).toBe(0);
    expect(cardEffectBox(300, 400, 0, 900).height).toBe(0);
    expect(cardEffectBox(NaN, 400, 600, 900).height).toBe(0);
  });

  it('efektin varsaydığı afiş: 300 piksellik kartta 106 piksel (paketin ölçüsü)', () => {
    expect(Math.round(300 * CARD_BANNER_RATIO)).toBe(106);
  });
});

describe('isim plakası', () => {
  it('paketin satırında (223×40) resim satırı tam kaplar', () => {
    expect(plateBox(223, 40, 446, 80)).toEqual({ left: 0, width: 223, height: 40, fill: 0, blend: 0 });
  });

  it('satırın yüksekliğinde, sağa yaslı; solda kalan kısım dolar ve kenar karışır', () => {
    const box = plateBox(360, 58, 446, 80);
    expect(box.height).toBe(58);
    expect(box.width).toBeCloseTo(323.35);
    expect(box.left + box.width).toBeCloseTo(360);
    expect(box.fill).toBeCloseTo(36.65);
    expect(box.blend).toBeCloseTo(323.35 * PLATE_BLEND);
  });

  it('dar satırda resmin solu kırpılır, dolgu ve karışım yok', () => {
    const box = plateBox(300, 58, 446, 80);
    expect(box.left).toBeLessThan(0);
    expect(box.left + box.width).toBeCloseTo(300);
    expect(box.fill).toBe(0);
    expect(box.blend).toBe(0);
  });

  it('ölçülmemiş satırda boş', () => {
    expect(plateBox(0, 0, 446, 80)).toEqual({ left: 0, width: 0, height: 0, fill: 0, blend: 0 });
  });
});

describe('çizim yüzeyi', () => {
  it('yüzey dosyanın pikselinden fazlasını çizmez', () => {
    // 3× ekranda 119 piksellik dekorasyon karesi 357 piksel eder; dosya 264 piksel
    expect(surfaceScale(264, 119, 3)).toBeCloseTo(264 / 357);
    // 2× ekranda dosya yüzeyden büyük: tam çözünürlük
    expect(surfaceScale(264, 119, 2)).toBe(1);
    expect(surfaceScale(600, 300, 2)).toBe(1);
  });

  it('geçersiz ölçüde 1', () => {
    expect(surfaceScale(0, 100, 3)).toBe(1);
    expect(surfaceScale(264, 0, 3)).toBe(1);
    expect(surfaceScale(264, 100, NaN)).toBe(1);
  });
});

describe('withAlpha', () => {
  it('"#rrggbb" ve "rgb(a)(…)" renklerinin saydam hali', () => {
    expect(withAlpha('#04101c', 0)).toBe('rgba(4,16,28,0)');
    expect(withAlpha('#FFFFFF', 0.5)).toBe('rgba(255,255,255,0.5)');
    expect(withAlpha('rgba(180,235,255,.35)', 0)).toBe('rgba(180,235,255,0)');
    expect(withAlpha('rgba(180,235,255,.5)', 0.5)).toBe('rgba(180,235,255,0.25)');
    expect(withAlpha('rgb(1,2,3)', 1)).toBe('rgba(1,2,3,1)');
  });

  it('çözülemeyen renk null', () => {
    expect(withAlpha('red', 0)).toBeNull();
    expect(withAlpha('#fff', 0)).toBeNull();
  });
});

describe('yan yana video', () => {
  // Gerçek kart dosyası: görünen kare 600×900, video 1216 piksel genişliğinde, alfa yarısı 616. sütunda
  const layout = { width: 600, height: 900, stackedWidth: 1216, alphaX: 616 };

  it('geçerli yerleşim: alfa yarısı renk yarısının sağında ve videonun içinde', () => {
    expect(isStackedLayout(layout)).toBe(true);
    expect(isStackedLayout({ width: 600, height: 900 })).toBe(false);
    expect(isStackedLayout({ ...layout, alphaX: 500 })).toBe(false);
    expect(isStackedLayout({ ...layout, alphaX: 700 })).toBe(false);
    expect(isStackedLayout({ ...layout, width: 0 })).toBe(false);
  });

  it('çizim biriminden videonun pikseline ölçek', () => {
    expect(stackedUniforms(layout, 300, 450)).toEqual({ scale: [2, 2], size: [600, 900], alphaX: 616 });
    expect(stackedUniforms(layout, 360, 540).scale[0]).toBeCloseTo(600 / 360);
    // boş yüzeyde bölme hatası olmaz
    expect(stackedUniforms(layout, 0, 0).scale).toEqual([1, 1]);
  });

  it('renk soldaki yarıdan, alfa aynı noktanın alphaX kadar sağından okunur', () => {
    const u = stackedUniforms(layout, 300, 450);
    expect(stackedSample(100, 200, u)).toEqual({ color: [200, 400], alpha: [816, 400] });
  });

  it('kenarlarda yarım piksel içeride kalır: iki yarı birbirine ve boşluğa taşmaz', () => {
    const u = stackedUniforms(layout, 300, 450);
    const topLeft = stackedSample(0, 0, u);
    expect(topLeft.color).toEqual([0.5, 0.5]);
    expect(topLeft.alpha).toEqual([616.5, 0.5]);
    const bottomRight = stackedSample(300, 450, u);
    expect(bottomRight.color).toEqual([599.5, 899.5]);
    expect(bottomRight.alpha).toEqual([1215.5, 899.5]);
    // Renk örneği boşluğa (600–616) ve alfa yarısına hiç girmez; alfa örneği videodan taşmaz
    expect(bottomRight.color[0]).toBeLessThan(layout.width);
    expect(bottomRight.alpha[0]).toBeLessThan(layout.stackedWidth);
    expect(stackedSample(999, 9999, u)).toEqual(bottomRight);
  });
});

describe('kare saati', () => {
  it('kare hızından aralık; geçersiz hız 30, en çok 60', () => {
    expect(frameInterval(30)).toBeCloseTo(33.33, 1);
    expect(frameInterval(24)).toBeCloseTo(41.67, 1);
    expect(frameInterval(120)).toBeCloseTo(16.67, 1);
    expect(frameInterval(0)).toBeCloseTo(33.33, 1);
    expect(frameInterval(NaN)).toBeCloseTo(33.33, 1);
  });

  it('ilk kare hemen çizilir', () => {
    expect(frameDue(1000, 0, 33.3)).toBe(true);
  });

  /** Ekranın yenileme hızında bir saniye boyunca kaç kare ilerler */
  function framesPerSecond(hz: number, fps: number): number {
    const interval = frameInterval(fps);
    let last = 0;
    let frames = 0;
    for (let i = 1; i <= hz; i++) {
      const now = 5000 + (i * 1000) / hz;
      if (frameDue(now, last, interval)) {
        last = now;
        frames++;
      }
    }
    return frames;
  }

  it('60, 90 ve 120 Hz ekranda da saniyede 30 kare', () => {
    expect(framesPerSecond(60, 30)).toBe(30);
    expect(framesPerSecond(90, 30)).toBe(30);
    expect(framesPerSecond(120, 30)).toBe(30);
  });

  it('kayan ortalama yavaş kareye doğru yavaşça kayar; tek ölçüm bütçenin üç katında kırpılır', () => {
    let cost = 0;
    for (let i = 0; i < 100; i++) cost = stepCost(cost, 20, 30);
    expect(cost).toBeGreaterThan(19);
    expect(stepCost(2, 2, 12)).toBeCloseTo(2);
    expect(stepCost(0, 30, 12)).toBeCloseTo(3);
    // 500 ms'lik tek takılma ortalamaya 36 ms (3 × 12) olarak girer
    expect(stepCost(0, 500, 12)).toBeCloseTo(3.6);
  });
});

describe('karelerin ömrü', () => {
  it('yerine yenisi konan kare bir adım daha yaşar; iki adım önceki bırakılır', () => {
    const held: { current: string | null; previous: string | null } = { current: null, previous: null };
    const released: (string | null)[] = [];
    for (const frame of ['a', 'b', 'c', 'd']) {
      released.push(nextFrames(held, frame));
      // Gösterilen ve bir önceki kare hiçbir zaman bırakılmaz
      const disposed = released.filter((f) => f !== null);
      expect(disposed).not.toContain(held.current);
      if (held.previous !== null) expect(disposed).not.toContain(held.previous);
    }
    expect(released).toEqual([null, null, 'a', 'b']);
    expect(held).toEqual({ current: 'd', previous: 'c' });
  });
});

describe('iş bütçesi', () => {
  /** Bir oynatıcının kare süreleri boyunca bütçesi dolar mı; dolduğu kare (dolmazsa -1) */
  function tripsAt(samples: readonly number[], budget: number): number {
    let cost = 0;
    let strikes = 0;
    for (let i = 0; i < samples.length; i++) {
      cost = stepCost(cost, samples[i]!, budget);
      strikes = budgetStrikes(strikes, cost, budget);
      if (strikes >= BUDGET_STRIKES) return i;
    }
    return -1;
  }
  const steady = (ms: number, n = 600): number[] => Array.from({ length: n }, () => ms);

  it('tek ya da birkaç uzun takılma bütçeyi doldurmaz', () => {
    const budget = STEP_BUDGET_MS.image;
    const samples = steady(8);
    samples[100] = 500;
    samples[300] = 800;
    samples[301] = 800;
    expect(tripsAt(samples, budget)).toBe(-1);
  });

  it('sürekli bütçenin üstündeki iş art arda BUDGET_STRIKES kareden sonra doldurur', () => {
    const at = tripsAt(steady(20), STEP_BUDGET_MS.image);
    expect(at).toBeGreaterThanOrEqual(BUDGET_STRIKES - 1);
    expect(at).toBeLessThan(BUDGET_STRIKES + 20);
    // Bütçenin hemen altındaki iş hiç doldurmaz
    expect(tripsAt(steady(STEP_BUDGET_MS.image - 1), STEP_BUDGET_MS.image)).toBe(-1);
  });

  it('aşım arada kesilirse sayaç sıfırlanır', () => {
    let strikes = 0;
    strikes = budgetStrikes(strikes, 15, 12);
    strikes = budgetStrikes(strikes, 15, 12);
    expect(strikes).toBe(2);
    expect(budgetStrikes(strikes, 11, 12)).toBe(0);
  });

  it('en pahalı oynatıcı seçilir; liste boşsa hiçbiri', () => {
    expect(heaviest([1.5, 4, 2])).toBe(1);
    expect(heaviest([3])).toBe(0);
    expect(heaviest([])).toBe(-1);
  });

  /**
   * Sürücünün kare döngüsündeki toplam bütçe kuralının aynısı (bkz. packDriver.ts): her karede çalışan oynatıcıların
   * toplam işi; bütçe dolunca en pahalı sabit resme alınır. Bırakılanların sırası döner.
   */
  function shedOrder(costs: readonly number[], ticks = 2000): { shed: number[]; running: boolean[] } {
    const running = costs.map(() => true);
    let total = 0;
    let strikes = 0;
    const shed: number[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      const stepped = running.filter(Boolean).length;
      if (stepped < 2) continue;
      const budget = tickBudget(stepped);
      const sum = costs.reduce((s, c, i) => s + (running[i] ? c : 0), 0);
      total = stepCost(total, sum, budget);
      strikes = budgetStrikes(strikes, total, budget);
      if (strikes >= BUDGET_STRIKES) {
        strikes = 0;
        const index = heaviest(costs.map((c, i) => (running[i] ? c : -1)).filter((c) => c >= 0));
        const candidates = costs.map((c, i) => [c, i] as const).filter(([, i]) => running[i]);
        const [cost, i] = candidates[index]!;
        running[i] = false;
        total = Math.max(0, total - cost);
        shed.push(i);
      }
    }
    return { shed, running };
  }

  it('az oynatıcıda (açık profil) toplam bütçe geniş, çokta dar', () => {
    expect(tickBudget(2)).toBe(TICK_BUDGET_MS.few);
    expect(tickBudget(FEW_PLAYERS)).toBe(TICK_BUDGET_MS.few);
    expect(tickBudget(FEW_PLAYERS + 1)).toBe(TICK_BUDGET_MS.many);
    expect(TICK_BUDGET_MS.few).toBeGreaterThan(TICK_BUDGET_MS.many);
  });

  it('açık profil: Android kart videosu (~10 ms) ve dekorasyon (~4 ms) birlikte sabit resme alınmaz', () => {
    expect(shedOrder([10, 4]).shed).toEqual([]);
    // plaka da olsa (üç oynatıcı)
    expect(shedOrder([10, 4, 2]).shed).toEqual([]);
  });

  it('on iki ayrı plaka (1,5 ms): toplam bütçe dolar, en pahalılar sırayla sabit resme alınır, toplam bütçeye iner', () => {
    const costs = Array.from({ length: 12 }, (_, i) => 1.5 + i * 0.01);
    const { shed, running } = shedOrder(costs);
    // 18 ms → 10 ms'nin altına: en az altı oynatıcı bırakılır, en pahalıdan başlayarak
    const left = costs.reduce((s, c, i) => s + (running[i] ? c : 0), 0);
    expect(left).toBeLessThanOrEqual(TICK_BUDGET_MS.many);
    expect(shed.length).toBeGreaterThanOrEqual(6);
    expect(shed.slice(0, 3)).toEqual([11, 10, 9]);
    // Bütçeye inince daha fazlası bırakılmaz
    expect(left).toBeGreaterThan(TICK_BUDGET_MS.many - 2);
  });
});

describe('bozulan video çözücüsü', () => {
  it('yalnızca yamalı Skia videosunun işareti bozukluk sayılır; eksi kare zamanları değil', () => {
    expect(VIDEO_BROKEN_TIME).toBe(-1e9);
    expect(videoBroken(VIDEO_BROKEN_TIME)).toBe(true);
    // B-kareleri ve düzenleme listeleri yüzünden kare zamanı biraz eksi olabilir
    for (const time of [-1, -33.3, -66.7, -1000, 0, 5966.7]) expect(videoBroken(time)).toBe(false);
  });
});

describe('Android video döngüsü', () => {
  const frames = 180;
  const duration = 6000;
  const frameMs = 1000 / 30;

  it('döngünün ilk yarısında sarılmaz (sarmanın ardından çözücünün zamanı eski döngünün sonunu gösterir)', () => {
    expect(videoShouldRewind(1, 0, frames, 5966.7, duration, frameMs, 20)).toBe(false);
    expect(videoShouldRewind(frames / 2 - 1, 40, frames, 5966.7, duration, frameMs, 20)).toBe(false);
    expect(videoShouldRewind(10, 0, frames, 300, duration, frameMs, 2)).toBe(false);
  });

  it('son karenin zamanı görülünce sarılır', () => {
    expect(videoShouldRewind(frames - 1, 0, frames, 5966.7, duration, frameMs, 2)).toBe(true);
    expect(videoShouldRewind(frames - 1, 0, frames, 5900, duration, frameMs, 2)).toBe(false);
  });

  it('son karelerdeyken istek boşuna beklediyse ya da zaman ilerlemiyorsa sarılır', () => {
    // Boşuna bekleyen istek (girdi ve çıktı zaman aşımı) ≥ 15 ms; yalnızca çıktıyı bekleyen olağan istek 10 ms
    expect(videoShouldRewind(frames + 1, 3, frames, 5833, duration, frameMs, 20)).toBe(true);
    expect(videoShouldRewind(frames + 1, 3, frames, 5833, duration, frameMs, 10)).toBe(false);
    expect(videoShouldRewind(frames + 1, VIDEO_TAIL_FRAMES, frames, 5833, duration, frameMs, 1)).toBe(true);
    // Döngünün ortasındaki yavaş istek sarmaz
    expect(videoShouldRewind(100, 3, frames, 3000, duration, frameMs, 20)).toBe(false);
  });

  it('zaman güvenilir değilse çağrı sayısına bakılır; kare sayısı bilinmiyorsa hiç sarılmaz', () => {
    expect(videoShouldRewind(frames + VIDEO_TAIL_FRAMES, 200, frames, 0, 0, frameMs, 20)).toBe(true);
    expect(videoShouldRewind(frames + VIDEO_TAIL_FRAMES, 200, frames, 0, 0, frameMs, 2)).toBe(false);
    expect(videoShouldRewind(frames * 2, 0, frames, 0, 0, frameMs, 0)).toBe(true);
    expect(videoShouldRewind(9999, 0, 0, 0, 0, frameMs, 0)).toBe(false);
  });

  /**
   * Skia'nın Android videosunun (RNSkVideo.java) modeli: her istek, hazır bekleyen kare varsa onu verir (zamanı
   * güncellemeden, girdi vermeden); yoksa çözücüye bir örnek verir ve bir kare bekler. Çözücü `latency` örnek
   * geriden gelir; dosyanın sonu verilince kalan kareleri birden çıkarır, sonra her istek boşuna bekler (20 ms).
   * `slow(i)`: i. örneğin karesi 10 ms'de yetişmez (bir sonraki istekte hazır bekler).
   */
  function simulate(latency: number, loops: number, slow: (sample: number) => boolean = () => false) {
    let fed = 0;
    let eos = false;
    let decoded = 0;
    const pending: number[] = [];
    let late: number | null = null;
    let timeMs = 0;
    const decode = (): void => {
      const available = eos ? fed : Math.max(0, fed - latency);
      while (decoded < available) pending.push(decoded++);
    };
    const feed = (): number => {
      if (eos) return 10;
      if (fed < frames) fed++;
      else eos = true;
      return 0;
    };
    const nextImage = (): { frame: number | null; took: number } => {
      if (late !== null) {
        pending.unshift(late);
        late = null;
      }
      if (pending.length > 0) return { frame: pending.shift()!, took: 0 };
      let took = feed();
      decode();
      if (pending.length === 0) return { frame: null, took: took + 10 };
      const frame = pending.shift()!;
      if (slow(frame)) {
        late = frame;
        return { frame: null, took: took + 10 };
      }
      timeMs = frame * frameMs;
      took += 3;
      return { frame, took };
    };
    const seek = (): void => {
      fed = 0;
      eos = false;
      decoded = 0;
      pending.length = 0;
      late = null;
      feed();
      decode();
    };

    const shown: number[][] = [[]];
    let stalls = 0;
    let calls = 0;
    let idle = 0;
    let last = -1;
    let rewind = false;
    for (let step = 0; step < frames * loops * 3 && shown.length <= loops; step++) {
      if (rewind) {
        seek();
        calls = 0;
        idle = 0;
        rewind = false;
        shown.push([]);
      }
      const { frame, took } = nextImage();
      if (frame !== null) shown[shown.length - 1]!.push(frame);
      if (took >= 20) stalls++;
      calls++;
      if (timeMs === last) idle++;
      else {
        last = timeMs;
        idle = 0;
      }
      rewind = videoShouldRewind(calls, idle, frames, timeMs, duration, frameMs, took);
    }
    return { loops: shown.slice(0, loops), stalls };
  }

  const all = Array.from({ length: frames }, (_, i) => i);

  it('çözücü modeliyle: her döngüde bütün kareler sırayla gösterilir, döngü başına en çok bir boş bekleyiş', () => {
    for (const latency of [0, 1, 3, 8]) {
      const run = simulate(latency, 4);
      expect(run.loops).toHaveLength(4);
      for (const loop of run.loops) expect(loop, `gecikme ${latency}`).toEqual(all);
      expect(run.stalls, `gecikme ${latency}`).toBeLessThanOrEqual(4);
    }
  });

  it('çözücü modeliyle: ara sıra geç kalan karelerde de döngü tam oynar', () => {
    const run = simulate(3, 3, (sample) => sample % 7 === 5);
    for (const loop of run.loops) expect(loop).toEqual(all);
  });

  it('çözücü modeliyle: çok yavaş çözücüde döngü en çok son birkaç karesini yitirir, takılıp kalmaz', () => {
    const run = simulate(4, 3, (sample) => sample % 2 === 0);
    expect(run.loops).toHaveLength(3);
    for (const loop of run.loops) {
      expect(loop.length).toBeGreaterThanOrEqual(frames - VIDEO_TAIL_FRAMES);
      expect(loop).toEqual(all.slice(0, loop.length));
    }
  });
});
