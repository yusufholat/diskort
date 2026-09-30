// Oyun algılamanın süreç tarayıcısı (yalnızca Windows). Yerel modül derlemeden Win32'ye ulaşmak için tek
// bir gizli, uzun ömürlü PowerShell süreci çalıştırılır (scan.ps1): ~15 saniyede bir görünür penceresi olan
// süreçleri yazar, istenince exe ikonunu çıkarır. Süreç ölürse artan beklemeyle yeniden başlatılır; Diskort
// kapanınca (stdin kapanır) kendiliğinden çıkar.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { ScannedProcess } from './classify';
import { iconRequestLine, parseScannerLine } from './protocol';
import scanScript from './scan.ps1?raw';

/**
 * Komut satırında yalnızca bu sabit önyükleyici vardır: stdin'in ilk satırındaki (base64) betiği çalıştırır.
 * Betik komut satırına sığmaz; dosya yolları gibi dış veriler de hiçbir zaman betik metnine eklenmez,
 * stdin'den JSON satırı olarak gider.
 */
const BOOTSTRAP =
  '$stdin=New-Object IO.StreamReader([Console]::OpenStandardInput(),[Text.Encoding]::UTF8);' +
  '. ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($stdin.ReadLine()))))';

const RESTART_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];
/** Bu kadar yaşayan süreç sağlıklı sayılır: sonraki ölümde bekleme baştan başlar */
const HEALTHY_AFTER_MS = 5 * 60_000;
const ICON_TIMEOUT_MS = 10_000;
/** Satır sonu gelmeden bundan fazla veri biriktiyse yardımcı bozulmuştur (en büyük satır: ikon, ~90 KB) */
const MAX_LINE_BYTES = 1024 * 1024;

export interface ScannerEvents {
  /** Yardımcı (yeniden) başladı; `steamPath` kayıt defterindeki Steam klasörü */
  onReady(steamPath: string | null): void;
  onScan(procs: ScannedProcess[]): void;
  onLog(message: string): void;
}

export class ActivityScanner {
  private child: ChildProcessWithoutNullStreams | null = null;
  private running = false;
  private ready = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private startedAt = 0;
  private nextIconId = 1;
  private readonly iconWaiters = new Map<number, (png: Buffer | null | undefined) => void>();
  /** Yardımcı hazır olmadan istenen ikonlar */
  private queued: string[] = [];

  constructor(private readonly events: ScannerEvents) {}

  start(): void {
    if (this.running || process.platform !== 'win32') return;
    this.running = true;
    this.failures = 0;
    this.spawn();
  }

  stop(): void {
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.failPending();
    if (!child) return;
    child.removeAllListeners();
    child.stdout.removeAllListeners();
    child.on('error', () => undefined);
    child.stdin.on('error', () => undefined);
    child.stdin.end(); // betik stdin kapanınca çıkar
    child.kill();
  }

  /** Sıradaki taramayı beklemeden hemen taratır */
  requestScan(): void {
    this.write('scan\n');
  }

  /**
   * Exe'nin ikonu (kare PNG, en fazla 128 px). null: exe'nin kendi ikonu yok; undefined: yardımcı
   * çıkaramadı (çalışmıyor, yanıt vermedi ya da Win32 yardımcıları yok).
   */
  icon(path: string): Promise<Buffer | null | undefined> {
    if (!this.running) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const id = this.nextIconId++;
      const timer = setTimeout(() => this.settleIcon(id, undefined), ICON_TIMEOUT_MS);
      this.iconWaiters.set(id, (png) => {
        clearTimeout(timer);
        resolve(png);
      });
      this.write(iconRequestLine(id, path));
    });
  }

  private write(line: string): void {
    if (!this.child || !this.ready) {
      // Betik satırından önce hiçbir şey yazılmamalı; hazır olunca gönderilir
      if (this.running && this.queued.length < 50 && !this.queued.includes(line)) this.queued.push(line);
      return;
    }
    this.child.stdin.write(line);
  }

  private settleIcon(id: number, png: Buffer | null | undefined): void {
    const waiter = this.iconWaiters.get(id);
    this.iconWaiters.delete(id);
    waiter?.(png);
  }

  private failPending(): void {
    this.queued = [];
    for (const id of [...this.iconWaiters.keys()]) this.settleIcon(id, undefined);
  }

  private spawn(): void {
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        powershell,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(BOOTSTRAP, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (err) {
      this.events.onLog(`Tarayıcı başlatılamadı: ${String(err)}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.ready = false;
    this.startedAt = Date.now();

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) this.handleLine(line);
      }
      if (buffer.length > MAX_LINE_BYTES) {
        this.events.onLog('Tarayıcı bozuk çıktı verdi; yeniden başlatılıyor.');
        child.kill();
      }
    });
    child.stderr.resume(); // PowerShell'in ilerleme kayıtları; okunmazsa boru dolar
    child.stdin.on('error', () => undefined); // süreç ölmüşken yazma
    child.on('error', (err) => this.onExit(child, `hata: ${err.message}`));
    child.on('exit', (code) => this.onExit(child, `çıkış kodu ${code ?? '?'}`));

    child.stdin.write(Buffer.from(scanScript, 'utf8').toString('base64') + '\n');
  }

  private handleLine(line: string): void {
    const msg = parseScannerLine(line);
    if (!msg) return;
    if (msg.t === 'hello') {
      this.ready = true;
      if (!msg.native) this.events.onLog('Win32 yardımcıları yüklenemedi; Get-Process ile taranıyor (ikon çıkarılamaz).');
      this.events.onReady(msg.steam);
      const queued = this.queued;
      this.queued = [];
      for (const queuedLine of queued) this.child?.stdin.write(queuedLine);
    } else if (msg.t === 'scan') this.events.onScan(msg.procs);
    else if (msg.t === 'icon') this.settleIcon(msg.id, msg.png ? Buffer.from(msg.png, 'base64') : msg.ok ? null : undefined);
    else this.events.onLog(`Tarama hatası: ${msg.message}`);
  }

  private onExit(child: ChildProcessWithoutNullStreams, reason: string): void {
    if (this.child !== child) return;
    this.child = null;
    this.ready = false;
    this.failPending();
    if (!this.running) return;
    this.events.onLog(`Tarayıcı kapandı (${reason}).`);
    this.events.onScan([]); // artık izlenemiyor: oynanan oyun bildirilmeye devam etmesin
    if (Date.now() - this.startedAt > HEALTHY_AFTER_MS) this.failures = 0;
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    const delay = RESTART_DELAYS_MS[Math.min(this.failures, RESTART_DELAYS_MS.length - 1)]!;
    this.failures++;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.running) this.spawn();
    }, delay);
  }
}
