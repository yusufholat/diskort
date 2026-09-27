import { powerMonitor } from 'electron';

/** Bu kadar süre klavye/fare girdisi yoksa "boşta" (Discord gibi 10 dakika) */
const IDLE_AFTER_SECONDS = 10 * 60;
const POLL_MS = 15_000;

/**
 * Bilgisayarın boşta olup olmadığını izler: işletim sisteminin son girdiden beri geçen süresi, ekran
 * kilidi ve uyku. Değişince bildirir; arayüz bunu sunucuya iletir (otomatik "Boşta" durumu).
 */
export class IdleMonitor {
  private idle = false;
  private locked = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly onChange: (idle: boolean) => void) {}

  get current(): boolean {
    return this.idle;
  }

  start(): void {
    powerMonitor.on('lock-screen', this.lock);
    powerMonitor.on('suspend', this.lock);
    powerMonitor.on('unlock-screen', this.unlock);
    powerMonitor.on('resume', this.unlock);
    this.timer = setInterval(() => this.check(), POLL_MS);
    this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    powerMonitor.off('lock-screen', this.lock);
    powerMonitor.off('suspend', this.lock);
    powerMonitor.off('unlock-screen', this.unlock);
    powerMonitor.off('resume', this.unlock);
  }

  private readonly lock = (): void => {
    this.locked = true;
    this.check();
  };

  private readonly unlock = (): void => {
    this.locked = false;
    this.check();
  };

  private check(): void {
    let idle = this.locked;
    if (!idle) {
      try {
        idle = powerMonitor.getSystemIdleTime() >= IDLE_AFTER_SECONDS;
      } catch {
        idle = false; // bazı Linux masaüstlerinde ölçülemiyor: hep etkin say
      }
    }
    if (idle === this.idle) return;
    this.idle = idle;
    this.onChange(idle);
  }
}
