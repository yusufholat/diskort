// Çizim aracının Electron tarafı: GİZLİ bir pencerede (ekranda hiçbir şey açılmaz; hata kutusu da) işi yapar,
// sonucu bir JSON dosyasına yazar ve kapanır. render.mjs başlatır:
//   electron electron-main.cjs <iş.json> <sonuç.json>
// İki iş türü (iş.json'daki mode):
//   render: page.js'i yükler, kareleri çizdirir (ham dosyalara);
//   verify: verify.html'i yükler, kodlanan dosyaları oynatıp ölçer (ekran dışı çizimle: pencere gizliyken de
//           kareler üretilir, görüntüsü alınabilir).

const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// ---------- Ekranda HİÇBİR ŞEY gösterilmez ----------
// Bu süreç kullanıcının masaüstünde pencere açmamalı; Electron'un "ana süreçte hata" kutusu da buna dahil.
// (Yaşandı: çıktının okunduğu boru kapanınca console.log EPIPE ile patladı, Electron hata kutusu gösterdi.)
// Bu yüzden: hata kutusu kapatılır, yakalanmamış her hata sessizce sıfırdan farklı kodla çıkar, çıktı boruya
// korumalı yazılır, boru ya da başlatan süreç gidince süreç de kapanır.
dialog.showErrorBox = () => {};

const [jobsFile, resultFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let done = false;

function quit(code) {
  if (done) return;
  done = true;
  try {
    app.exit(code);
  } catch {
    process.exit(code);
  }
}

function finish(result, code) {
  if (done) return;
  try {
    fs.writeFileSync(resultFile, JSON.stringify(result));
  } catch {
    // sonuç yazılamıyorsa yapılacak bir şey yok: başlatan, dosya yokluğunu hata sayar
  }
  quit(code);
}

/** Çıktı satırı: boru kapalıysa atılan hata yutulur (başlatan gitmiştir, süreç zaten kapanacak) */
function log(text, stream = process.stdout) {
  if (done) return;
  try {
    stream.write(`${text}\n`);
  } catch {
    quit(1);
  }
}

for (const stream of [process.stdout, process.stderr]) stream.on('error', () => quit(1));
process.on('uncaughtException', (err) => finish({ error: String(err && err.stack ? err.stack : err) }, 1));
process.on('unhandledRejection', (err) => finish({ error: String(err && err.stack ? err.stack : err) }, 1));
// Başlatan süreçle aradaki kanal kapandı (render.mjs çıktı ya da öldürüldü)
process.on('disconnect', () => quit(1));

const spec = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));

// Kanal kapanışını kaçırsak bile: başlatan süreç artık yoksa kapan (zorla öldürülen başlatan haber veremez)
if (spec.parentPid) {
  setInterval(() => {
    try {
      process.kill(spec.parentPid, 0);
    } catch {
      quit(1);
    }
  }, 1000);
}

// Uygulamanın kendi ayar klasörüne dokunulmaz
app.setPath('userData', path.join(spec.workDir, 'electron-data'));
// Gizli pencerede zamanlayıcılar ve çizim yavaşlatılmasın; sessiz video kendiliğinden oynasın
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function watch(win) {
  // Sayfanın hataları ve uyarıları buraya; bilinen iki zararsız uyarı dışında (yerel dosyada içerik güvenliği
  // ilkesi yok; getImageData'yı sık çağırıyoruz ama tuval uygulamadaki gibi hızlandırılmış kalsın diye
  // willReadFrequently bilerek verilmiyor)
  win.webContents.on('console-message', (event) => {
    if (event.level !== 'warning' && event.level !== 'error') return;
    if (/Electron Security Warning|willReadFrequently/.test(event.message)) return;
    log(`[sayfa] ${event.message}`, process.stderr);
  });
  win.webContents.on('render-process-gone', (_e, details) => finish({ error: `çizim süreci kapandı: ${details.reason}` }, 1));
}

async function render() {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  watch(win);
  await win.loadFile(spec.page);
  const results = [];
  for (const job of spec.jobs) {
    const r = await win.webContents.executeJavaScript(`window.cosmeticRender(${JSON.stringify(job)})`);
    results.push(r);
    log(`  çizildi: ${path.basename(job.out)} ${r.width}x${r.height} × ${r.frames} kare, ${r.ms} ms`);
  }
  return results;
}

/** İki görüntünün bir dikdörtgendeki ortalama mutlak farkı (0-255) */
function regionDiff(a, b, rect) {
  const size = a.getSize();
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(size.width, rect.x + rect.width);
  const y1 = Math.min(size.height, rect.y + rect.height);
  if (x1 <= x0 || y1 <= y0) return -1;
  const pa = a.toBitmap();
  const pb = b.toBitmap();
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * size.width + x) * 4;
      sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
      n += 3;
    }
  }
  return Number((sum / n).toFixed(3));
}

async function verify() {
  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1100,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  watch(win);
  await win.loadFile(spec.page);
  const run = (code) => win.webContents.executeJavaScript(code);
  const items = JSON.stringify(spec.items);
  // 1) kareleri çöz, kaynakla karşılaştır
  const results = await run(`window.cosmeticVerify.decode(${items})`);
  const byFile = new Map(results.map((r) => [r.file, r]));
  // 2) sayfada oynat: iki ayrı anda alınan görüntü farklı mı
  const rects = await run(`window.cosmeticVerify.show(${items})`);
  await sleep(1700);
  const first = await win.webContents.capturePage();
  await sleep(1300);
  const second = await win.webContents.capturePage();
  for (const rect of rects) {
    const r = byFile.get(rect.file);
    if (r) r.onScreenDiff = regionDiff(first, second, rect);
  }
  // 3) video döngüsünün zamanlaması
  const timed = spec.items.filter((i) => i.timing);
  if (timed.length > 0) {
    const timings = await run(`window.cosmeticVerify.timing(${JSON.stringify(timed)}, ${spec.loopSeconds})`);
    for (const t of timings) {
      const r = byFile.get(t.file);
      if (r) r.timing = t.timing;
    }
  }
  return results;
}

/** Döngü biçimi olan setler (sayfa, client-core'un COSMETIC_LOOP_SHADERS anahtarlarını bildirir) */
async function info() {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  watch(win);
  await win.loadFile(spec.page);
  return win.webContents.executeJavaScript('window.cosmeticLoopSets');
}

app.whenReady().then(async () => {
  try {
    finish({ results: spec.mode === 'verify' ? await verify() : spec.mode === 'info' ? await info() : await render() }, 0);
  } catch (err) {
    finish({ error: String(err && err.stack ? err.stack : err) }, 1);
  }
});

app.on('window-all-closed', () => {});
