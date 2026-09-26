import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { UpdateState } from '../shared/bridge';

export type SplashState = UpdateState | { kind: 'starting' } | { kind: 'manual'; version: string };
export type SplashAction = 'retry' | 'skip' | 'download' | 'quit';

/** Açılışta güncelleme durumunu gösteren küçük pencere (Discord'un açılış ekranı gibi). */
export class Splash {
  private readonly window: BrowserWindow;
  private readonly ready: Promise<void>;
  private last: SplashState = { kind: 'starting' };
  private actionHandler: ((action: SplashAction) => void) | null = null;

  constructor() {
    this.window = new BrowserWindow({
      width: 300,
      height: 340,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      center: true,
      title: 'Diskort',
      backgroundColor: '#1e1f22',
      icon: join(__dirname, '../../resources/icon.png'),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    this.window.setMenu(null);
    this.window.once('ready-to-show', () => this.window.show());
    // Düğmeler adresin # kısmını değiştirir: "#retry-1727..."
    this.window.webContents.on('did-navigate-in-page', (_e, url) => {
      const action = /#(retry|skip|download|quit)-/.exec(url)?.[1] as SplashAction | undefined;
      if (action) this.actionHandler?.(action);
    });
    this.window.webContents.on('will-navigate', (e) => e.preventDefault());
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.ready = this.window
      .loadFile(join(__dirname, '../../resources/splash/index.html'))
      .then(() => this.render())
      .catch(() => undefined);
  }

  get closed(): boolean {
    return this.window.isDestroyed();
  }

  onClosed(cb: () => void): void {
    this.window.on('closed', cb);
  }

  setState(state: SplashState): void {
    this.last = state;
    void this.ready.then(() => this.render());
  }

  /** Kullanıcının düğmelerden birine basmasını bekler. */
  waitForAction(): Promise<SplashAction> {
    return new Promise((resolve) => {
      this.actionHandler = (action) => {
        this.actionHandler = null;
        resolve(action);
      };
    });
  }

  close(): void {
    if (!this.window.isDestroyed()) this.window.destroy();
  }

  private render(): void {
    if (this.window.isDestroyed()) return;
    void this.window.webContents
      .executeJavaScript(`window.setState && window.setState(${JSON.stringify(this.last)})`)
      .catch(() => undefined);
  }
}
