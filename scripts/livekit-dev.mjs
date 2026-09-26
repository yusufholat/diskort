// Yerel LiveKit sunucusunu geliştirme yapılandırmasıyla başlatır.
// Windows'ta tools/livekit/livekit-server.exe, diğer sistemlerde PATH'teki livekit-server kullanılır.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, 'tools', 'livekit', process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');
const bin = existsSync(local) ? local : 'livekit-server';
const config = path.join(root, 'infra', 'livekit.dev.yaml');

const child = spawn(bin, ['--config', config], { stdio: 'inherit' });
child.on('error', (err) => {
  console.error(`LiveKit başlatılamadı (${bin}):`, err.message);
  console.error('Kurulum: https://docs.livekit.io/home/self-hosting/local/');
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
