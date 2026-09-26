import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, shell } from 'electron';
import { DOWNLOAD_PAGE_URL } from '../shared/distribution';
import type { Splash } from './splash';
import { updateLog, type UpdateManager } from './updater';

/** Yavaş ağda açılışı sonsuza dek bekletmemek için; aşılırsa uygulama açılır, sunucu yine denetler. */
const CHECK_TIMEOUT_MS = 15_000;

export type GateResult = 'continue' | 'installing' | 'quit';

/**
 * Açılış güncelleme kapısı: yeni sürüm varsa uygulama açılmadan önce indirilip kurulur.
 * İnternet yoksa ya da denetim zaman aşımına uğrarsa uygulama açılır; sunucuya bağlanınca eski
 * sürüm yine reddedileceği için güncelleme atlanmış olmaz.
 */
export async function runStartupGate(updates: UpdateManager, splash: Splash | null): Promise<GateResult> {
  if (updates.support === 'none') return 'continue';
  const unsubscribe = splash ? updates.onState((state) => splash.setState(state)) : () => undefined;
  const userClosed = new Promise<GateResult>((resolve) => splash?.onClosed(() => resolve('quit')));

  try {
    for (;;) {
      let version: string | null;
      try {
        version = await Promise.race([updates.check(), timeout(CHECK_TIMEOUT_MS)]);
      } catch (err) {
        updateLog.warn(`Açılış denetimi yapılamadı, uygulama açılıyor: ${String(err)}`);
        return 'continue';
      }
      if (!version) return 'continue';

      if (updates.support === 'manual') {
        splash?.setState({ kind: 'manual', version });
        const action = await Promise.race([splash?.waitForAction() ?? Promise.resolve('quit' as const), userClosed]);
        if (action === 'download') void shell.openExternal(DOWNLOAD_PAGE_URL);
        return 'quit';
      }

      try {
        await Promise.race([updates.downloadUpdate(), userClosed.then(() => Promise.reject(new Error('kapatıldı')))]);
        // Görünür açılışta kurulum ilerlemesi gösterilir; tepside açılışta sessiz kurulur
        updates.install(!splash);
        return 'installing';
      } catch (err) {
        if (!splash || splash.closed) return splash ? 'quit' : 'continue';
        updateLog.warn(`Açılışta indirme başarısız: ${String(err)}`);
        const action = await Promise.race([splash.waitForAction(), userClosed]);
        if (action === 'skip') return 'continue';
        if (action !== 'retry') return 'quit';
      }
    }
  } finally {
    unsubscribe();
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('zaman aşımı')), ms));
}

// ---------- Güncellemeden sonra pencerenin eski hâliyle açılması ----------

export type LaunchMode = 'normal' | 'hidden' | 'minimized';

const launchModeFile = (): string => join(app.getPath('userData'), 'launch-mode');

/** Boştayken yapılan sessiz güncellemeden sonra uygulama tepside/simge durumunda açılsın. */
export function rememberLaunchMode(mode: LaunchMode): void {
  try {
    writeFileSync(launchModeFile(), mode);
  } catch {
    // önemli değil
  }
}

export function consumeLaunchMode(): LaunchMode {
  const file = launchModeFile();
  if (!existsSync(file)) return 'normal';
  try {
    const mode = readFileSync(file, 'utf8').trim();
    rmSync(file, { force: true });
    return mode === 'hidden' || mode === 'minimized' ? mode : 'normal';
  } catch {
    return 'normal';
  }
}
