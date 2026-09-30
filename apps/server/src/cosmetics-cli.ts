// Kozmetik paketlerini sunucuda komut satırından yayınlama ve yönetme aracı.
//
//   docker compose exec -T api node dist/cosmetics-cli.js publish < paket.json
//   docker compose exec -T api node dist/cosmetics-cli.js list [--json]
//   docker compose exec -T api node dist/cosmetics-cli.js remove <kimlik>
//   docker compose exec -T api node dist/cosmetics-cli.js platforms <kimlik> <desktop,android,ios | none>
//   docker compose exec -T api node dist/cosmetics-cli.js order <kimlik,kimlik,…>
//
// Depoyu doğrudan yazar (<DATA_DIR>/cosmetic-packs; ya da --dir <klasör>). Yükleme için HTTP ucu bilerek
// yoktur: yayınlama sunucunun içinden yapılır, dışarıya yeni bir kimlik doğrulamalı yüzey açılmaz. Çalışan
// sunucu değişikliği birkaç saniye içinde kendisi fark eder (yeniden başlatmak gerekmez); istemciler
// bildirimi oturum açarken ve ayarlardaki seçici açılırken tazeler. Biçim: docs/kozmetik-paketleri.md.

import path from 'node:path';
import { COSMETIC_PACK_MAX_BUNDLE_BYTES, COSMETIC_PIECES, COSMETIC_PLATFORMS, isCosmeticSet } from '@diskort/shared';
import { CosmeticPackError, CosmeticPackStore, type StoredPack } from './cosmeticPacks.js';

const USAGE = `Kullanım: node dist/cosmetics-cli.js <komut> [seçenekler]

Komutlar:
  publish                           Paketi yayınlar (yayın paketi JSON'u standart girdiden); aynı kimlik varsa yerine geçer
  list [--json]                     Yayınlanmış paketler, gösterim sırasıyla
  remove <kimlik>                   Paketi yayından kaldırır ve dosyalarını siler
  platforms <kimlik> <liste>        Paketin oynatıldığı platformlar: ${COSMETIC_PLATFORMS.join(',')} (virgüllü) ya da none
  order <kimlik,kimlik,…>           Gösterim sırası: verilenler bu sırayla başa gelir, diğerleri arkada kalır

Seçenek:  --dir <klasör>  (varsayılan: $DATA_DIR/cosmetic-packs)`;

/** Standart girdiden okunacak en fazla bayt: base64 içerik + JSON'un kendisi */
const MAX_STDIN_BYTES = Math.ceil((COSMETIC_PACK_MAX_BUNDLE_BYTES * 4) / 3) + 1024 * 1024;

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json' || arg === '--help' || arg === '-h') {
      flags.set(arg.replace(/^-+/, ''), true);
    } else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
      const value = inline ?? argv[++i];
      if (value === undefined) throw new CosmeticPackError(`--${name} için değer eksik.`);
      flags.set(name, value);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** Standart girdiyi sınırı aşmadan okur */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CosmeticPackError('Paket standart girdiden okunur: publish < paket.json (docker compose exec -T ile).');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > MAX_STDIN_BYTES) throw new CosmeticPackError('Paket çok büyük.');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const formatKb = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

function describe(pack: StoredPack): string {
  const total = pack.files.reduce((sum, f) => sum + f.bytes, 0);
  const pieces = COSMETIC_PIECES.map((piece) => {
    const kinds = pack.files.filter((f) => f.piece === piece).map((f) => f.kind);
    return `${piece}: ${kinds.join(' ')}`;
  }).join('  |  ');
  return [
    `${pack.id}  "${pack.label}"  sürüm ${pack.version}${isCosmeticSet(pack.id) ? '  (yerleşik kimlik)' : ''}`,
    `    platformlar: ${pack.platforms.join(', ') || 'yok (hiçbir yerde oynatılmaz)'}   ${pack.loopSeconds} sn, ${pack.fps} kare/sn   ${pack.files.length} dosya, ${formatKb(total)}`,
    `    ${pieces}`,
  ].join('\n');
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const [command, target, value] = args.positional;
  if (!command || args.flags.has('help') || args.flags.has('h') || command === 'help') {
    console.log(USAGE);
    return;
  }
  const dirFlag = args.flags.get('dir');
  const dir = typeof dirFlag === 'string' ? dirFlag : path.join(path.resolve(process.env.DATA_DIR ?? 'data'), 'cosmetic-packs');
  const store = new CosmeticPackStore(dir, { recheckMs: 0 });
  store.load();

  switch (command) {
    case 'publish': {
      const text = await readStdin();
      let bundle: unknown;
      try {
        // Dosyanın başındaki BOM (Windows'ta kaydedilmiş JSON) yok sayılır
        bundle = JSON.parse(text.replace(/^\ufeff/, ''));
      } catch {
        throw new CosmeticPackError('Paket geçerli bir JSON değil.');
      }
      const replaced = store.list().some((p) => p.id === (bundle as { pack?: { id?: unknown } } | null)?.pack?.id);
      const pack = await store.publish(bundle);
      console.log(`${replaced ? 'Güncellendi' : 'Yayınlandı'}:\n${describe(pack)}`);
      return;
    }
    case 'list': {
      const packs = store.list();
      if (args.flags.has('json')) console.log(JSON.stringify(packs, null, 2));
      else if (packs.length === 0) console.log('Yayınlanmış paket yok.');
      else console.log(packs.map(describe).join('\n'));
      return;
    }
    case 'remove': {
      if (!target) throw new CosmeticPackError('Paket kimliği ver (ör. remove buz).');
      await store.remove(target);
      console.log(`"${target}" yayından kaldırıldı. Bu seti seçmiş kullanıcılarda artık görünmez (seçimleri saklı kalır).`);
      return;
    }
    case 'platforms': {
      if (!target || value === undefined) throw new CosmeticPackError('Kullanım: platforms <kimlik> <desktop,android,ios | none>');
      const list = value === 'none' || value === '-' ? [] : value.split(',').map((p) => p.trim()).filter(Boolean);
      const platforms = await store.setPlatforms(target, list);
      console.log(`"${target}" artık şu platformlarda oynatılıyor: ${platforms.join(', ') || 'hiçbiri'}.`);
      return;
    }
    case 'order': {
      const ids = (target ?? '').split(',').map((id) => id.trim()).filter(Boolean);
      const order = await store.setOrder(ids);
      console.log(`Sıra: ${order.join(', ')}`);
      return;
    }
    default:
      throw new CosmeticPackError(`Bilinmeyen komut "${command}".\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CosmeticPackError) {
    console.error(err.message);
    process.exitCode = 1;
  } else throw err;
});
