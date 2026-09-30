// Kesintisizlik denetimi: döngünün hiçbir yerinde "kesme" (tek karede beliren ya da kaybolan görüntü) var mı?
// Ardışık karelerin farkı döngü boyunca (son kare → ilk kare dahil) çıkarılır; bir karenin farkı, çevresindeki
// karelerin ortancasının çok üstündeyse o kare işaretlenir. Bütün setler aynı denetimi kullanır:
//   node scripts/cosmetic-render/render.mjs --set <set> --check
// Değerler alfayla çarpılmış renk ve alfa üzerinden, 0-255. Üç dizi tutulur:
// - düzey (net): karenin ortalama parlaklığı ve alfası bir kareden ötekine ne kadar değişti. Bir şeyin tek
//   karede belirmesi ya da kaybolması burada çok net görünür: hareket eden doku pikselleri değiştirir ama
//   ortalamayı değiştirmez, beliren/kaybolan alan değiştirir. (Buzun eski döngüsündeki kesme: plakada
//   ortalama parlaklık tek karede 4 düzey düşüyordu, çevresindeki karelerde ~0.3.)
// - fark (genel): piksel piksel ortalama mutlak fark; büyük alanın bir anda başka bir şeye dönüşmesi.
// - yerel (4×4 ızgarada en çok değişen bölge): küçük alanda olan şey genel ortalamada kaybolur, burada görünür.
//   Küçük, hızlı ayrıntılar (pırıltı, damla) burada doğal olarak sıçrar: bilgi içindir, kararı etkilemez.

/** İki karenin (düz RGBA) farkı: tüm karenin ortalaması ve 4×4 ızgaradaki en büyük bölge ortalaması */
export function frameDelta(a, b, width, height, grid = 4) {
  const sums = new Float64Array(grid * grid);
  const counts = new Float64Array(grid * grid);
  let total = 0;
  for (let y = 0; y < height; y++) {
    const gy = Math.min(grid - 1, Math.floor((y * grid) / height));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const aa = a[i + 3];
      const ba = b[i + 3];
      const d =
        (Math.abs(a[i] * aa - b[i] * ba) + Math.abs(a[i + 1] * aa - b[i + 1] * ba) + Math.abs(a[i + 2] * aa - b[i + 2] * ba)) / 255 + Math.abs(aa - ba);
      const cell = gy * grid + Math.min(grid - 1, Math.floor((x * grid) / width));
      sums[cell] += d;
      counts[cell] += 4;
      total += d;
    }
  }
  let local = 0;
  for (let c = 0; c < sums.length; c++) if (counts[c] > 0) local = Math.max(local, sums[c] / counts[c]);
  return { mean: total / (width * height * 4), local };
}

/** Karenin düzeyi: ortalama (alfayla çarpılmış) parlaklık ve ortalama alfa; boş mu (tümüyle saydam) */
export function frameLevel(f) {
  let rgb = 0;
  let alpha = 0;
  let any = false;
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    rgb += ((f[i] + f[i + 1] + f[i + 2]) * a) / 765;
    alpha += a;
    if (a > 2) any = true;
  }
  const px = f.length / 4;
  return { rgb: rgb / px, alpha: alpha / px, empty: !any };
}

const median = (list) => {
  const s = [...list].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Bir dizide (döngüsel: son eleman son kare → ilk kare) çevresine göre sıçrayan kareleri bulur.
 * Oran = değer / çevredeki (±window kare, kendisi hariç) ortanca. Ortanca sıfıra yakınken (neredeyse durağan
 * sahne) oran anlamsızlaşmasın diye alt sınır: dizinin genel ortancasının beşte biri, en az `floor`.
 * İşaret (kesme): oran ≥ threshold, değer ortancayı en az `minJump` kadar aşıyor VE sıçrama tek karelik
 * (iki yanındaki karelerin en az `isolation` katı). Son koşul hızlı ama birkaç kareye yayılan olayları (parlayıp
 * sönen bir pırıltı) kesmeden ayırır: kesme tek karede olur, öncesi ve sonrası sakindir.
 */
export function findJumps(series, { window = 8, threshold = 4, minJump = 0.12, floor = 0.02, isolation = 2 } = {}) {
  const n = series.length;
  const low = Math.max(floor, median(series) * 0.2);
  const flagged = [];
  // belirgin sıçrayan bütün kareler (tek karelik olma koşulu aranmadan, yarı eşikle): kodlanmış dosyanın
  // denetiminde "kaynakta zaten vardı" demek için kullanılır
  const hot = [];
  let worst = { ratio: 0, frame: 0, diff: 0, around: 0 };
  for (let i = 0; i < n; i++) {
    const near = [];
    for (let k = 1; k <= window; k++) near.push(series[(i + k) % n], series[(i - k + n * window) % n]);
    const around = median(near);
    const ratio = series[i] / Math.max(around, low);
    if (ratio > worst.ratio) worst = { ratio, frame: i, diff: series[i], around };
    if (ratio >= threshold / 2 && series[i] - around >= minJump / 2) hot.push(i);
    const single = series[i] >= isolation * Math.max(series[(i + 1) % n], series[(i - 1 + n) % n]);
    if (ratio >= threshold && series[i] - around >= minJump && single) {
      flagged.push({ frame: i, ratio: Number(ratio.toFixed(2)), diff: Number(series[i].toFixed(3)), around: Number(around.toFixed(3)) });
    }
  }
  return {
    worstRatio: Number(worst.ratio.toFixed(2)),
    worstFrame: worst.frame,
    worstDiff: Number(worst.diff.toFixed(3)),
    worstAround: Number(worst.around.toFixed(3)),
    flagged,
    hot,
  };
}

/**
 * Bir parçanın kareleri için denetim. Dönen: üç dizinin en kötü oranı, işaretlenen kareler (kare i: i → i+1
 * geçişi; son kare: döngünün dikişi) ve boş kare sayısı (tümüyle saydam kareler: döngü "bitip yeniden
 * başlıyor" gibi okunur). `ok`: düzey ve fark dizilerinde işaret yok.
 */
export function continuityCheck(frames, width, height, fps, options = {}) {
  const n = frames.length;
  const threshold = options.threshold ?? 4;
  const levels = frames.map(frameLevel);
  const mean = new Array(n);
  const local = new Array(n);
  const level = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = frameDelta(frames[i], frames[j], width, height);
    mean[i] = d.mean;
    local[i] = d.local;
    level[i] = Math.abs(levels[j].rgb - levels[i].rgb) + Math.abs(levels[j].alpha - levels[i].alpha);
  }
  const time = (r) => ({ ...r, worstTime: Number((r.worstFrame / fps).toFixed(3)), flagged: r.flagged.map((f) => ({ ...f, time: Number((f.frame / fps).toFixed(3)) })) });
  const result = {
    frames: n,
    emptyFrames: levels.filter((l) => l.empty).length,
    level: time(findJumps(level, { threshold, minJump: 0.2, floor: 0.01 })),
    global: time(findJumps(mean, { threshold, minJump: 0.12, floor: 0.02 })),
    local: time(findJumps(local, { threshold: threshold * 1.5, minJump: 0.5, floor: 0.02 })),
  };
  result.ok = result.level.flagged.length === 0 && result.global.flagged.length === 0;
  return result;
}

/**
 * Hazır dizilerden (kodlanmış dosyanın tarayıcıda çözülen kareleri: verify.html) aynı karar. Yerel dizi yoktur.
 * `known`: kaynak karelerde zaten işaretli olan kareler (setin bilerek koyduğu ani olaylar); bunlar sayılmaz,
 * geriye kalan işaretler sıkıştırmanın eklediği kesmelerdir (ör. döngü başındaki anahtar karenin "nabzı").
 */
export function continuityFromSeries(mean, level, fps, options = {}, known = []) {
  const threshold = options.threshold ?? 4;
  const skip = new Set(known);
  const time = (r) => ({
    ...r,
    worstTime: Number((r.worstFrame / fps).toFixed(3)),
    flagged: r.flagged.filter((f) => !skip.has(f.frame)).map((f) => ({ ...f, time: Number((f.frame / fps).toFixed(3)) })),
  });
  const result = {
    frames: mean.length,
    level: time(findJumps(level, { threshold, minJump: 0.2, floor: 0.01 })),
    global: time(findJumps(mean, { threshold, minJump: 0.12, floor: 0.02 })),
  };
  result.ok = result.level.flagged.length === 0 && result.global.flagged.length === 0;
  return result;
}

/** Sonucun tek satırlık özeti */
export function continuitySummary(c) {
  const list = (r) => `${r.flagged.slice(0, 5).map((f) => `${f.time} sn ×${f.ratio}`).join(', ')}${r.flagged.length > 5 ? ', …' : ''}`;
  const flags = [];
  if (c.level.flagged.length) flags.push(`düzeyde ${c.level.flagged.length} kare (${list(c.level)})`);
  if (c.global.flagged.length) flags.push(`farkta ${c.global.flagged.length} kare (${list(c.global)})`);
  const part = (name, r) => `${name} ×${r.worstRatio} (${r.worstTime} sn: ${r.worstDiff}, çevresi ${r.worstAround})`;
  return (
    `${flags.length ? `KESME: ${flags.join('; ')}` : 'kesme yok'}; en kötü oranlar: ${part('düzey', c.level)}, ${part('fark', c.global)}` +
    (c.local ? `, ${part('yerel', c.local)}` + (c.local.flagged.length ? ` [yerelde ${c.local.flagged.length} kare işaretli]` : '') : '') +
    (c.emptyFrames ? `; boş kare ${c.emptyFrames}` : '')
  );
}
