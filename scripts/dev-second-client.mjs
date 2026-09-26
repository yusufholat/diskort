// Aynı bilgisayarda ikinci bir Diskort istemcisi açar (ayrı profil). Önce `pnpm dev:desktop` çalışıyor olmalı.
// Kullanım: pnpm dev:desktop2 [profil-adı]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop');
const electronPath = createRequire(path.join(desktopDir, 'package.json'))('electron');

const child = spawn(electronPath, ['.'], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DISKORT_PROFILE: process.argv[2] ?? '2',
    ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
