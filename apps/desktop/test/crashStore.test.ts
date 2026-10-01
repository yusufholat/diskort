import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildDetail,
  CrashStore,
  DETAIL_MAX,
  listDumps,
  MAX_PENDING,
  MESSAGE_MAX,
  parseCrashContext,
  pruneDumps,
} from '../src/main/crashStore.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'diskort-cokme-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (): string => join(dir, 'profil', 'crash-reports.json');

function dump(name: string, sub: string, ageMs: number, size = 2048): void {
  mkdirSync(join(dir, 'Crashpad', sub), { recursive: true });
  const path = join(dir, 'Crashpad', sub, name);
  writeFileSync(path, Buffer.alloc(size));
  const t = new Date(Date.now() - ageMs);
  utimesSync(path, t, t);
}

describe('çökme bildirimi kuyruğu', () => {
  it('bildirim diske yazılır, yeniden açılışta durur, ulaşınca silinir', () => {
    let now = 1_800_000_000_000;
    const store = new CrashStore(file(), () => now);
    const a = store.add('masaustu-surec', 'GPU süreci sonlandı: crashed (çıkış kodu -1073741819)', '{"app":"0.9.3"}');
    now += 5;
    const b = store.add('masaustu-ana', 'Ana süreçte yakalanmamış hata: x', '{}\nError: x\n    at y');
    expect(a).not.toBe(b);

    // Uygulama yeniden açıldı: bildirimler duruyor
    const reopened = new CrashStore(file(), () => now);
    expect(reopened.pending().map((r) => r.where)).toEqual(['masaustu-surec', 'masaustu-ana']);
    expect(reopened.pending()[0]).toMatchObject({ id: a, at: 1_800_000_000_000, detail: '{"app":"0.9.3"}' });

    reopened.ack([a, 'yok']);
    expect(new CrashStore(file()).pending().map((r) => r.id)).toEqual([b]);
  });

  it('sunucunun sınırlarına kısaltır ve en çok 20 bildirim tutar', () => {
    const store = new CrashStore(file());
    for (let i = 0; i < MAX_PENDING + 5; i++) store.add('w'.repeat(100), `${i} ${'m'.repeat(1000)}`, 'd'.repeat(9000));
    const pending = store.pending();
    expect(pending).toHaveLength(MAX_PENDING);
    expect(pending[0]!.message.startsWith('5 ')).toBe(true);
    expect(pending.every((r) => r.where.length === 64 && r.message.length === MESSAGE_MAX && r.detail.length === DETAIL_MAX)).toBe(true);
  });

  it('bozuk dosya boş kuyruk sayılır', () => {
    mkdirSync(join(dir, 'profil'), { recursive: true });
    writeFileSync(file(), '{bozuk');
    const store = new CrashStore(file());
    expect(store.pending()).toEqual([]);
    store.add('masaustu-surec', 'x', '{}');
    expect(JSON.parse(readFileSync(file(), 'utf8')).reports).toHaveLength(1);
  });

  it('döküm dosyası bekleyen bildirime adı ve boyutuyla eklenir; yolu bildirime girmez', () => {
    dump('abc.dmp', 'reports', 1_000, 3 * 1024);
    const store = new CrashStore(file());
    const id = store.add('masaustu-surec', 'GPU süreci sonlandı: crashed', '{}');
    const [found] = listDumps(join(dir, 'Crashpad'));
    store.attachDump(id, found!);
    const [r] = store.pending();
    expect(r!.message).toBe('GPU süreci sonlandı: crashed · döküm: abc.dmp (3 KB)');
    expect(JSON.stringify(r)).not.toContain(dir.replace(/\\/g, '\\\\'));
    // Aynı döküm sonraki açılışta yeniden bildirilmez
    expect(new CrashStore(file()).reportNewDumps(listDumps(join(dir, 'Crashpad')), '{}')).toBe(0);
  });

  it('önceki oturumdan kalan bildirilmemiş dökümler bir kez bildirilir', () => {
    dump('eski.dmp', 'reports', 60_000);
    dump('yeni.dmp', 'completed', 5_000);
    writeFileSync(join(dir, 'Crashpad', 'metadata'), 'x');
    const dumps = listDumps(join(dir, 'Crashpad'));
    expect(dumps.map((d) => d.name)).toEqual(['yeni.dmp', 'eski.dmp']);
    const store = new CrashStore(file());
    expect(store.reportNewDumps(dumps, '{"type":"previous-session-dump"}')).toBe(2);
    expect(store.pending().map((r) => r.where)).toEqual(['masaustu-surec', 'masaustu-surec']);
    expect(store.pending()[0]!.message).toContain('Önceki oturumdan çökme dökümü: yeni.dmp (2 KB');
    store.ack(store.pending().map((r) => r.id));
    expect(new CrashStore(file()).reportNewDumps(dumps, '{}')).toBe(0);
  });

  it('eski dökümler silinir, en yeniler kalır', () => {
    for (let i = 0; i < 6; i++) dump(`d${i}.dmp`, 'reports', (i + 1) * 10_000);
    pruneDumps(join(dir, 'Crashpad'), 2);
    expect(listDumps(join(dir, 'Crashpad')).map((d) => d.name)).toEqual(['d0.dmp', 'd1.dmp']);
    expect(existsSync(join(dir, 'Crashpad', 'reports', 'd5.dmp'))).toBe(false);
    // Olmayan klasör hata vermez
    expect(listDumps(join(dir, 'yok'))).toEqual([]);
  });
});

describe('ayrıntı ve bağlam', () => {
  it('ayrıntı sunucu sınırını aşmaz; aşacaksa önce büyük alanlar atılır', () => {
    const small = buildDetail({ app: '0.9.3', context: { voice: true } }, 'Error: x\n    at y');
    expect(small).toBe('{"app":"0.9.3","context":{"voice":true}}\nError: x\n    at y');
    const big = buildDetail({ app: '0.9.3', gpu: { a: 'x'.repeat(3000) }, processes: Array.from({ length: 50 }, () => ({ t: 'Utility', memMb: 123 })) });
    expect(big.length).toBeLessThanOrEqual(DETAIL_MAX);
    expect(JSON.parse(big)).toEqual({ app: '0.9.3' });
    expect(buildDetail({ a: 1 }, 's'.repeat(10_000))).toHaveLength(DETAIL_MAX);
  });

  it('arayüzden gelen bağlam yalnızca üç mantıksal alanla kabul edilir', () => {
    expect(parseCrashContext({ voice: true, streaming: false, watching: true, fazla: 'x' })).toEqual({ voice: true, streaming: false, watching: true });
    for (const bad of [null, undefined, 'x', 3, [], { voice: 1, streaming: false, watching: false }, { voice: true }]) {
      expect(parseCrashContext(bad)).toBeNull();
    }
  });
});
