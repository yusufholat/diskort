// Geri bildirimleri sunucuda komut satırından okuma ve güncelleme aracı (yönetici/yardımcı için).
//
//   docker compose exec api node dist/feedback-cli.js list [--status yeni] [--type hata] [--limit 50] [--json]
//   docker compose exec api node dist/feedback-cli.js show <id> [--json]
//   docker compose exec api node dist/feedback-cli.js set <id> <durum> [not]
//   docker compose exec api node dist/feedback-cli.js note <id> <not>      (boş not "" siler)
//   docker compose exec api node dist/feedback-cli.js stats [--json]
//
// Veritabanını doğrudan açar (<DATA_DIR>/diskort.db; ya da --db <dosya>). Sunucu çalışırken de güvenlidir
// (WAL). Yalnızca geri bildirim verisi yazdırılır; ortam değişkenleri ya da gizli anahtarlar okunmaz.
// Buradan yapılan değişiklik bağlı istemcilere anında iletilmez; listeler yeniden açılınca güncellenir.

import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  FEEDBACK_NOTE_MAX_LENGTH,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  type FeedbackStatus,
  type FeedbackType,
} from '@diskort/shared';
import { FeedbackStore, type FeedbackWithAuthor } from './feedbackStore.js';

const USAGE = `Kullanım: node dist/feedback-cli.js <komut> [seçenekler]

Komutlar:
  list [--status <durum>] [--type <tür>] [--limit <n>] [--json]   En yeniler önce (varsayılan 50)
  show <id> [--json]                                              Ayrıntılar, teknik bilgiler, ekran görüntüleri
  set <id> <durum> [not]                                          Durumu (ve verilirse notu) değiştirir
  note <id> <not>                                                 Yalnızca notu değiştirir ("" siler)
  stats [--json]                                                  Duruma göre sayılar

Durumlar: ${FEEDBACK_STATUSES.join(', ')}
Türler:   ${FEEDBACK_TYPES.join(', ')}
Seçenek:  --db <dosya>  (varsayılan: $DATA_DIR/diskort.db)`;

class CliError extends Error {}

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json' || arg === '--help' || arg === '-h') {
      flags.set(arg.replace(/^-+/, ''), true);
    } else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
      const value = inline ?? argv[++i];
      if (value === undefined) throw new CliError(`--${name} için değer eksik.`);
      flags.set(name, value);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const flag = (args: Args, name: string): string | undefined => {
  const v = args.flags.get(name);
  return typeof v === 'string' ? v : undefined;
};

function parseId(raw: string | undefined): number {
  const id = Number(raw?.replace(/^#/, ''));
  if (!raw || !Number.isInteger(id) || id <= 0) throw new CliError('Geçerli bir geri bildirim numarası ver (ör. 12).');
  return id;
}

function parseStatus(raw: string | undefined): FeedbackStatus {
  if (!raw || !FEEDBACK_STATUSES.includes(raw as FeedbackStatus)) {
    throw new CliError(`Geçersiz durum "${raw ?? ''}". Durumlar: ${FEEDBACK_STATUSES.join(', ')}`);
  }
  return raw as FeedbackStatus;
}

function parseType(raw: string | undefined): FeedbackType | undefined {
  if (raw === undefined) return undefined;
  if (!FEEDBACK_TYPES.includes(raw as FeedbackType)) {
    throw new CliError(`Geçersiz tür "${raw}". Türler: ${FEEDBACK_TYPES.join(', ')}`);
  }
  return raw as FeedbackType;
}

const date = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const oneLine = (text: string, max: number): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const author = (f: FeedbackWithAuthor): string =>
  f.username ? `${f.displayName ?? f.username} (@${f.username})` : f.userId ? `(kullanıcı ${f.userId})` : '(silinmiş hesap)';

/** JSON çıktısı: ekran görüntülerinin sunucudaki dosya yolları da verilir */
function toJson(f: FeedbackWithAuthor, dir: string) {
  return {
    ...f,
    screenshots: f.screenshots.map((s) => ({ ...s, file: path.posix.join(dir.replace(/\\/g, '/'), `${s.id}.webp`) })),
  };
}

function printDetails(f: FeedbackWithAuthor, dir: string): void {
  const out: string[] = [];
  out.push(`#${f.id} · ${FEEDBACK_TYPE_LABELS[f.type]} · ${FEEDBACK_STATUS_LABELS[f.status]} (${f.status})`);
  out.push(`Gönderen:     ${author(f)}`);
  out.push(`Gönderildi:   ${date(f.createdAt)}`);
  if (f.updatedAt !== f.createdAt) out.push(`Güncellendi:  ${date(f.updatedAt)}`);
  if (f.title) out.push(`Başlık:       ${f.title}`);
  out.push('', '--- Açıklama ---', f.body);
  out.push('', '--- Teknik bilgiler ---');
  if (!f.context) out.push('(kullanıcı göndermedi)');
  else {
    for (const [key, value] of Object.entries(f.context)) {
      if (key === 'recentErrors') continue;
      out.push(`${key.padEnd(14)}${String(value)}`);
    }
    const errors = f.context.recentErrors ?? [];
    out.push(`recentErrors  ${errors.length === 0 ? '(yok)' : ''}`);
    for (const e of errors) out.push(`  - ${e}`);
  }
  if (f.screenshots.length) {
    out.push('', '--- Ekran görüntüleri ---');
    for (const s of f.screenshots) {
      const file = path.posix.join(dir.replace(/\\/g, '/'), `${s.id}.webp`);
      out.push(`${file}  (${s.width}×${s.height}, ${Math.round(s.size / 1024)} KB)`);
    }
    out.push('Bilgisayara almak için (infra klasöründe): docker compose cp api:<dosya> .');
  }
  out.push('', '--- Yönetici notu ---', f.adminNote ?? '(yok)');
  console.log(out.join('\n'));
}

function main(argv: string[]): void {
  const args = parseArgs(argv);
  const [command, ...rest] = args.positional;
  if (!command || args.flags.has('help') || args.flags.has('h') || command === 'help') {
    console.log(USAGE);
    return;
  }

  const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
  const dbFile = flag(args, 'db') ?? path.join(dataDir, 'diskort.db');
  const screenshotDir = path.join(path.dirname(dbFile), 'feedback');
  if (!fs.existsSync(dbFile)) throw new CliError(`Veritabanı bulunamadı: ${dbFile}`);
  const db = new DatabaseSync(dbFile);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    const store = new FeedbackStore(db);
    if (!store.ready()) throw new CliError('Geri bildirim tablosu yok: sunucu henüz bu özelliği içeren sürüme güncellenmemiş.');
    const json = args.flags.has('json');

    switch (command) {
      case 'list': {
        const limit = Number(flag(args, 'limit') ?? 50);
        if (!Number.isInteger(limit) || limit <= 0) throw new CliError('--limit pozitif bir sayı olmalı.');
        const status = flag(args, 'status');
        const items = store.withAuthors(
          store.list({ status: status === undefined ? undefined : parseStatus(status), type: parseType(flag(args, 'type')), limit }),
        );
        if (json) {
          console.log(JSON.stringify(items.map((f) => toJson(f, screenshotDir)), null, 2));
          return;
        }
        if (items.length === 0) {
          console.log('Geri bildirim yok.');
          return;
        }
        for (const f of items) {
          const who = f.username ? `@${f.username}` : '(silinmiş)';
          const summary = oneLine(f.title ? `${f.title} — ${f.body}` : f.body, 70);
          const shots = f.screenshots.length ? ` [${f.screenshots.length} resim]` : '';
          console.log(
            `#${String(f.id).padEnd(4)} ${f.status.padEnd(10)} ${f.type.padEnd(5)} ${date(f.createdAt)}  ${who.padEnd(16)} ${summary}${shots}`,
          );
        }
        return;
      }
      case 'show': {
        const item = store.get(parseId(rest[0]));
        if (!item) throw new CliError('Geri bildirim bulunamadı.');
        const [f] = store.withAuthors([item]);
        if (json) console.log(JSON.stringify(toJson(f!, screenshotDir), null, 2));
        else printDetails(f!, screenshotDir);
        return;
      }
      case 'set':
      case 'note': {
        const id = parseId(rest[0]);
        const status = command === 'set' ? parseStatus(rest[1]) : undefined;
        const noteArgs = command === 'set' ? rest.slice(2) : rest.slice(1);
        if (command === 'note' && noteArgs.length === 0) throw new CliError('Not metni eksik ("" notu siler).');
        const note = noteArgs.length ? noteArgs.join(' ').trim() : undefined;
        if (note !== undefined && note.length > FEEDBACK_NOTE_MAX_LENGTH) {
          throw new CliError(`Not en fazla ${FEEDBACK_NOTE_MAX_LENGTH} karakter olabilir.`);
        }
        const updated = store.update(id, { status, adminNote: note === undefined ? undefined : note || null });
        if (!updated) throw new CliError('Geri bildirim bulunamadı.');
        if (json) console.log(JSON.stringify(updated, null, 2));
        else console.log(`#${updated.id} → ${FEEDBACK_STATUS_LABELS[updated.status]}${updated.adminNote ? ` · not: ${oneLine(updated.adminNote, 60)}` : ''}`);
        return;
      }
      case 'stats': {
        const counts = store.countByStatus();
        if (json) console.log(JSON.stringify(counts, null, 2));
        else for (const s of FEEDBACK_STATUSES) console.log(`${FEEDBACK_STATUS_LABELS[s].padEnd(12)}${counts[s]}`);
        return;
      }
      default:
        throw new CliError(`Bilinmeyen komut "${command}".\n\n${USAGE}`);
    }
  } finally {
    db.close();
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exitCode = 1;
  } else throw err;
}
