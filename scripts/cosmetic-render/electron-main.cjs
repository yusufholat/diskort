// Çizim aracının Electron tarafı: GİZLİ bir pencerede (ekranda hiçbir şey açılmaz) page.js'i yükler, işleri
// sırayla çizdirir, sonuçları bir JSON dosyasına yazar ve kapanır. render.mjs başlatır:
//   electron electron-main.cjs <işler.json> <sonuç.json>

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [jobsFile, resultFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const spec = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));

// Uygulamanın kendi ayar klasörüne dokunulmaz
app.setPath('userData', path.join(spec.workDir, 'electron-data'));
// Gizli pencerede zamanlayıcılar ve çizim yavaşlatılmasın
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

function finish(result, code) {
  fs.writeFileSync(resultFile, JSON.stringify(result));
  app.exit(code);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  // Sayfanın hataları ve uyarıları buraya; bilinen iki zararsız uyarı dışında (yerel dosyada içerik güvenliği
  // ilkesi yok; getImageData'yı sık çağırıyoruz ama tuval uygulamadaki gibi hızlandırılmış kalsın diye
  // willReadFrequently bilerek verilmiyor)
  win.webContents.on('console-message', (event) => {
    if (event.level !== 'warning' && event.level !== 'error') return;
    if (/Electron Security Warning|willReadFrequently/.test(event.message)) return;
    console.error(`[sayfa] ${event.message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => finish({ error: `çizim süreci kapandı: ${details.reason}` }, 1));
  try {
    await win.loadFile(spec.page);
    const results = [];
    for (const job of spec.jobs) {
      const r = await win.webContents.executeJavaScript(`window.cosmeticRender(${JSON.stringify(job)})`);
      results.push(r);
      console.log(`  çizildi: ${path.basename(job.out)} ${r.width}x${r.height} × ${r.frames} kare, ${r.ms} ms`);
    }
    finish({ results }, 0);
  } catch (err) {
    finish({ error: String(err && err.stack ? err.stack : err) }, 1);
  }
});

app.on('window-all-closed', () => {});
