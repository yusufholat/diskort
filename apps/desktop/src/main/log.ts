import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

const MAX_BYTES = 1024 * 1024;

export interface Logger {
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  debug(message: unknown): void;
}

/**
 * Kullanıcının bilgisayarındaki sorunları (özellikle güncellemeleri) sonradan inceleyebilmek için
 * basit dosya günlüğü: Windows'ta %APPDATA%\Diskort\logs\<ad>.log (1 MB'ta bir önceki dosyaya döner).
 */
export function createLogger(name: string): Logger {
  let file: string | null = null;

  const write = (level: string, message: unknown): void => {
    const text = message instanceof Error ? (message.stack ?? message.message) : String(message);
    if (!app.isPackaged) console.log(`[${name}] ${level}: ${text}`);
    try {
      if (!file) {
        const dir = app.getPath('logs');
        mkdirSync(dir, { recursive: true });
        file = join(dir, `${name}.log`);
      }
      try {
        if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
      } catch {
        // dosya henüz yok
      }
      appendFileSync(file, `${new Date().toISOString()} ${level.padEnd(5)} ${text}\n`);
    } catch {
      // günlük yazılamıyorsa uygulama çalışmaya devam eder
    }
  };

  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    debug: () => undefined,
  };
}
