import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { encryptDevices } from './iosDevicesCrypto.js';
import type { UdidRecord } from './routes/udid.js';

/**
 * iPhone cihaz onayı ve otomatik Ad Hoc derlemesi (bkz. docs/ios.md, "Otomatik cihaz ekleme").
 *
 * Kayıtlar `udids.jsonl`'de kalır (herkese açık uç yazar, dokunulmaz); onay durumları ayrı bir dosyada:
 * `<dataDir>/udid-status.json`. Dosyada durumu olmayan kayıt "bekliyor" sayılır (eski kayıtlar dahil).
 *
 * Durumlar: bekliyor → onaylandi → eklendi, ya da reddedildi. Onaylanan cihazlar kısa bir süre toplanır
 * (IOS_DISPATCH_DELAY_SEC, varsayılan 180 sn; aynı anda birkaç onay tek derleme olsun), sonra GitHub'daki
 * ios.yml iş akışı workflow_dispatch ile başlatılır (GITHUB_DISPATCH_TOKEN). Sunucu çalıştırmayı adındaki
 * istek kimliğiyle bulur ve durumunu GitHub API'sinden izler; başarıyla biterse o çalıştırmadaki cihazlar
 * "eklendi" olur. Belirteç yoksa panel elle çalıştırılacak `gh workflow run` komutunu gösterir.
 * Cihaz listesi iş akışına IOS_DEVICES_KEY ile şifreli gider (depo herkese açık); anahtar yoksa derleme
 * başlatılmaz.
 */

export const IOS_DEVICE_STATUSES = ['bekliyor', 'onaylandi', 'eklendi', 'reddedildi'] as const;
export type IosDeviceStatus = (typeof IOS_DEVICE_STATUSES)[number];

export interface IosDevice extends UdidRecord {
  status: IosDeviceStatus;
  /** Durumun son değiştiği an (hiç değişmediyse null) */
  statusAt: string | null;
}

/** Başlatılan son derleme */
export interface IosCiRun {
  /** Çalıştırmanın adına yazılan kimlik (run-name), GitHub'daki çalıştırmayı bulmak için */
  requestId: string;
  dispatchedAt: string;
  udids: string[];
  runId: number | null;
  url: string | null;
  /** GitHub'daki durum (queued, in_progress, completed …); "bulunamadi": çalıştırma görünmedi; "hata": başlatılamadı */
  status: string;
  conclusion: string | null;
  checkedAt: string | null;
  error: string | null;
}

interface StateFile {
  v: 1;
  statuses: Record<string, { status: IosDeviceStatus; at: string }>;
  ci: IosCiRun | null;
  /** Toplanmakta olan onayların ilki (sunucu yeniden başlarsa bekleme sürer) */
  pendingSince: string | null;
}

export interface IosDeviceOptions {
  dataDir: string;
  /** sahip/ad */
  repo: string;
  /** GitHub ince taneli erişim belirteci (Actions: write); yoksa otomatik derleme kapalı */
  token: string | null;
  /**
   * Cihaz listesinin şifrelenme anahtarı (IOS_DEVICES_KEY). Depo herkese açık: iş akışı girdisi UDID ya da ad
   * göstermemeli. Yoksa belirteç olsa bile derleme başlatılmaz (açık metne asla düşülmez).
   */
  devicesKey?: Buffer | null;
  delayMs: number;
  /** Etkin çalıştırmanın yoklanma aralığı */
  pollMs?: number;
  fetch?: typeof fetch;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  workflow?: string;
  ref?: string;
}

const FINAL = new Set(['completed', 'bulunamadi', 'hata']);
/** Bu kadar süre sonra hâlâ görünmeyen çalıştırma "bulunamadi" sayılır */
const RUN_LOOKUP_TIMEOUT_MS = 15 * 60_000;
/** Etkin çalıştırma bundan uzun sürerse yoklama bırakılır (panel açılınca yine bakılır) */
const MAX_POLL_MS = 4 * 3_600_000;
const UDID_RE = /^([0-9A-F]{40}|[0-9A-F]{8}-[0-9A-F]{16})$/;

export const isUdid = (s: string): boolean => UDID_RE.test(s);

export class IosDeviceService {
  private readonly recordsFile: string;
  private readonly stateFile: string;
  private state: StateFile;
  private dispatchTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly fetchImpl: typeof fetch;
  private readonly workflow: string;
  private readonly ref: string;
  private readonly pollMs: number;
  private closed = false;

  constructor(private readonly opts: IosDeviceOptions) {
    this.recordsFile = path.join(opts.dataDir, 'udids.jsonl');
    this.stateFile = path.join(opts.dataDir, 'udid-status.json');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.workflow = opts.workflow ?? 'ios.yml';
    this.ref = opts.ref ?? 'main';
    this.pollMs = opts.pollMs ?? 60_000;
    this.state = this.load();
  }

  /** Otomatik derleme: GitHub belirteci ve şifreleme anahtarı birlikte gerekir */
  get automationEnabled(): boolean {
    return this.opts.token !== null && !!this.opts.devicesKey;
  }

  /** Belirteç var ama şifreleme anahtarı yok: derleme başlatılmaz, panel uyarır */
  get keyMissing(): boolean {
    return this.opts.token !== null && !this.opts.devicesKey;
  }

  /** Sunucu açılınca: yarım kalan toplama ya da izleme sürdürülür */
  start(): void {
    if (!this.automationEnabled) return;
    if (this.state.pendingSince) {
      const left = Date.parse(this.state.pendingSince) + this.opts.delayMs - Date.now();
      this.armDispatch(Math.max(0, left));
    }
    if (this.state.ci && !FINAL.has(this.state.ci.status)) this.armPoll();
  }

  stop(): void {
    this.closed = true;
    if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.dispatchTimer = this.pollTimer = null;
  }

  private load(): StateFile {
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<StateFile>;
      return { v: 1, statuses: raw.statuses ?? {}, ci: raw.ci ?? null, pendingSince: raw.pendingSince ?? null };
    } catch {
      return { v: 1, statuses: {}, ci: null, pendingSince: null };
    }
  }

  /** Durum dosyası sırayla ve bütün olarak (geçici dosya + yeniden adlandırma) yazılır */
  private save(): Promise<void> {
    const text = `${JSON.stringify(this.state, null, 2)}\n`;
    const write = async (): Promise<void> => {
      await mkdir(path.dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.${process.pid}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, this.stateFile);
    };
    this.writing = this.writing.then(write, write);
    return this.writing;
  }

  private async records(): Promise<UdidRecord[]> {
    const text = await readFile(this.recordsFile, 'utf8').catch(() => '');
    const out: UdidRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as UdidRecord;
        if (typeof r.udid === 'string') out.push(r);
      } catch {
        // bozuk satır atlanır
      }
    }
    return out;
  }

  async list(): Promise<IosDevice[]> {
    const records = await this.records();
    return records
      .map((r) => {
        const s = this.state.statuses[r.udid];
        return { ...r, status: s?.status ?? 'bekliyor', statusAt: s?.at ?? null };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  get ci(): IosCiRun | null {
    return this.state.ci;
  }

  get pendingDispatchAt(): string | null {
    if (!this.state.pendingSince || !this.automationEnabled) return null;
    return new Date(Date.parse(this.state.pendingSince) + this.opts.delayMs).toISOString();
  }

  /**
   * Elle çalıştırma komutu (otomatik derleme kapalıyken). UDID'ler komutta hiçbir zaman açık yazılmaz:
   * anahtar varsa cihaz listesi şifreli verilir; yoksa komut cihazsız çalışır (ASC yalnızca Apple'da zaten
   * kayıtlı/açık cihazlarla profili yeniler, yani cihaz önce Apple Developer'da elle eklenmeli).
   */
  async manualCommand(): Promise<{ command: string; encrypted: boolean } | null> {
    const approved = (await this.list()).filter((d) => d.status === 'onaylandi');
    if (approved.length === 0) return null;
    const base = `gh workflow run ${this.workflow} --repo ${this.opts.repo} -f simulator=false -f signed=true -f attach-latest=true`;
    if (!this.opts.devicesKey) return { command: base, encrypted: false };
    return { command: `${base} -f devices=${encryptDevices(this.devicesOf(approved), this.opts.devicesKey)}`, encrypted: true };
  }

  private devicesOf(list: IosDevice[]): { udid: string; name: string }[] {
    return list.map((d) => ({ udid: d.udid, name: (d.name || d.deviceName || 'iPhone').slice(0, 50) }));
  }

  /** Durumu değiştirir; bilinmeyen UDID için null. Onayda otomatik derleme zamanlanır. */
  async setStatus(udid: string, status: IosDeviceStatus): Promise<IosDevice | null> {
    const device = (await this.list()).find((d) => d.udid === udid);
    if (!device) return null;
    const at = new Date().toISOString();
    if (device.status !== status) this.state.statuses[udid] = { status, at };
    if (status === 'onaylandi' && this.automationEnabled && !this.state.pendingSince) {
      this.state.pendingSince = at;
      this.armDispatch(this.opts.delayMs);
    }
    await this.save();
    const s = this.state.statuses[udid];
    return { ...device, status, statusAt: s?.at ?? device.statusAt };
  }

  private armDispatch(ms: number): void {
    if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      void this.dispatch().catch((err: unknown) => this.opts.log?.error({ err }, 'iOS derlemesi başlatılamadı'));
    }, ms);
    this.dispatchTimer.unref?.();
  }

  private github(method: string, apiPath: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`https://api.github.com/repos/${this.opts.repo}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'diskort-server',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  /**
   * Onaylı cihazlarla ios.yml'i hemen başlatır (toplama beklemesi atlanır). Onaylı cihaz yoksa ya da
   * belirteç yoksa null.
   */
  async dispatch(): Promise<IosCiRun | null> {
    if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
    this.dispatchTimer = null;
    this.state.pendingSince = null;
    if (!this.automationEnabled || this.closed) {
      await this.save();
      return null;
    }
    const approved = (await this.list()).filter((d) => d.status === 'onaylandi');
    if (approved.length === 0) {
      await this.save();
      return null;
    }
    const requestId = randomBytes(4).toString('hex');
    const devices = this.devicesOf(approved);
    const run: IosCiRun = {
      requestId,
      dispatchedAt: new Date().toISOString(),
      udids: devices.map((d) => d.udid),
      runId: null,
      url: null,
      status: 'queued',
      conclusion: null,
      checkedAt: null,
      error: null,
    };
    try {
      const res = await this.github('POST', `/actions/workflows/${this.workflow}/dispatches`, {
        ref: this.ref,
        inputs: {
          simulator: 'false',
          signed: 'true',
          'attach-latest': 'true',
          // Şifreli: herkese açık depoda girdiler görülebilir (bkz. iosDevicesCrypto.ts)
          devices: encryptDevices(devices, this.opts.devicesKey!),
          'request-id': requestId,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GitHub ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      this.opts.log?.info({ requestId, devices: devices.length }, 'iOS derlemesi başlatıldı');
    } catch (err) {
      run.status = 'hata';
      run.error = err instanceof Error ? err.message : String(err);
      this.opts.log?.warn({ requestId, err: run.error }, 'iOS derlemesi başlatılamadı');
    }
    this.state.ci = run;
    await this.save();
    if (run.status !== 'hata') this.armPoll();
    return run;
  }

  private armPoll(): void {
    if (this.pollTimer || this.closed) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.refreshCi(true)
        .catch((err: unknown) => this.opts.log?.warn({ err }, 'iOS derleme durumu okunamadı'))
        .finally(() => {
          const ci = this.state.ci;
          if (ci && !FINAL.has(ci.status) && Date.now() - Date.parse(ci.dispatchedAt) < MAX_POLL_MS) this.armPoll();
        });
    }, this.pollMs);
    this.pollTimer.unref?.();
  }

  /**
   * Son çalıştırmanın durumunu GitHub'dan okur (etkinse). `force` değilse en çok 20 sn'de bir.
   * Başarıyla bittiyse çalıştırmadaki, hâlâ "onaylandi" olan cihazlar "eklendi" olur. Başarısız biten çalıştırma
   * GitHub'da yeniden denenebilir (aynı çalıştırma, yeni deneme): gönderimden sonraki takip süresince okunmaya devam
   * eder (yönetim paneli açıldıkça), başarıyla biterse cihazlar yine "eklendi" olur.
   */
  async refreshCi(force = false): Promise<IosCiRun | null> {
    const ci = this.state.ci;
    if (!ci || !this.automationEnabled) return ci;
    const retriable =
      ci.status === 'completed' && ci.conclusion !== 'success' && Date.now() - Date.parse(ci.dispatchedAt) < MAX_POLL_MS;
    if (FINAL.has(ci.status) && !retriable) return ci;
    if (!force && ci.checkedAt && Date.now() - Date.parse(ci.checkedAt) < 20_000) return ci;
    const res = await this.github('GET', `/actions/workflows/${this.workflow}/runs?event=workflow_dispatch&per_page=30`);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const data = (await res.json()) as {
      workflow_runs?: { id: number; html_url: string; status: string; conclusion: string | null; display_title?: string; name?: string }[];
    };
    const run = data.workflow_runs?.find((r) => (r.display_title ?? r.name ?? '').includes(ci.requestId));
    ci.checkedAt = new Date().toISOString();
    if (run) {
      ci.runId = run.id;
      ci.url = run.html_url;
      ci.status = run.status;
      ci.conclusion = run.conclusion;
      if (run.status === 'completed' && run.conclusion === 'success') {
        for (const udid of ci.udids) {
          if (this.state.statuses[udid]?.status === 'onaylandi') this.state.statuses[udid] = { status: 'eklendi', at: ci.checkedAt };
        }
        this.opts.log?.info({ requestId: ci.requestId, devices: ci.udids.length }, 'iOS derlemesi bitti: cihazlar eklendi');
      }
    } else if (Date.now() - Date.parse(ci.dispatchedAt) > RUN_LOOKUP_TIMEOUT_MS) {
      ci.status = 'bulunamadi';
    }
    await this.save();
    // Yeniden denenen çalıştırma sürüyor: bitene kadar yine kendiliğinden izlenir
    if (!FINAL.has(ci.status)) this.armPoll();
    return ci;
  }
}
