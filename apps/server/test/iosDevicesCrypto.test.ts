import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as script from '../../../scripts/ios-devices-crypto.mjs';
import { decryptDevices, encryptDevices, parseDevicesKey } from '../src/iosDevicesCrypto.js';

// iOS iş akışına giden şifreli cihaz listesi: sunucu (iosDevicesCrypto.ts) şifreler, iş akışı
// (scripts/ios-devices-crypto.mjs) çözer; ikisi aynı biçimi konuşmalı.

const key = randomBytes(32);
const keyB64 = key.toString('base64');
const devices = [
  { udid: '00008110-001A2B3C4D5E6F70', name: 'Ayşe' },
  { udid: 'A'.repeat(40), name: 'Ali' },
];
const SCRIPT = fileURLToPath(new URL('../../../scripts/ios-devices-crypto.mjs', import.meta.url));

describe('iOS cihaz listesi şifreleme', () => {
  it('sunucu ↔ iş akışı betiği iki yönde de çözer; UDID ve ad açık görünmez', () => {
    const payload = encryptDevices(devices, key);
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(payload).not.toContain('00008110');
    // base64 metninde kısa dizgiler (ör. "Ay") rastgele çıkabilir; düz metni şifreli baytlarda ara
    const cipherBytes = Buffer.from(payload.split('.')[2]!, 'base64url');
    for (const d of devices) {
      expect(cipherBytes.includes(Buffer.from(d.udid))).toBe(false);
      expect(cipherBytes.includes(Buffer.from(d.name))).toBe(false);
    }
    expect(script.decryptDevices(payload, script.parseKey(keyB64))).toEqual(devices);
    expect(decryptDevices(script.encryptDevices(devices, key), parseDevicesKey(keyB64)!)).toEqual(devices);
    // Her şifreleme farklı (rastgele iv)
    expect(encryptDevices(devices, key)).not.toBe(payload);
  });

  it('değiştirilmiş veri, yanlış anahtar ve bozuk biçim reddedilir', () => {
    const payload = encryptDevices(devices, key);
    const [v, iv, body] = payload.split('.');
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => script.decryptDevices(`${v}.${iv}.${flipped.toString('base64url')}`, key)).toThrow(/çözülemedi/);
    expect(() => script.decryptDevices(payload, randomBytes(32))).toThrow(/çözülemedi/);
    expect(() => decryptDevices(payload, randomBytes(32))).toThrow();
    expect(() => script.decryptDevices('00008110-001A2B3C4D5E6F70', key)).toThrow(/şifreli biçimde değil/);
    expect(() => script.decryptDevices(`v2.${iv}.${body}`, key)).toThrow(/şifreli biçimde değil/);
  });

  it('anahtar 32 bayt olmalı', () => {
    expect(parseDevicesKey(undefined)).toBeNull();
    expect(parseDevicesKey('  ')).toBeNull();
    expect(() => parseDevicesKey(randomBytes(16).toString('base64'))).toThrow(/32/);
    expect(() => script.parseKey('kısa')).toThrow(/32/);
  });

  // Alt süreç başlatır; yüklü makinede varsayılan 5 sn'yi aşabilir
  it('iş akışı komutu: önce gizler, dosyaya yazar, açık metni başka yerde basmaz; anahtar yoksa açık hata', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ios-cihaz-sifre-'));
    try {
      const out = path.join(dir, 'd.json');
      const stdout = execFileSync(process.execPath, [SCRIPT, 'decrypt', '--out', out], {
        env: { ...process.env, IOS_DEVICES_KEY: keyB64, IOS_DEVICES_PAYLOAD: encryptDevices(devices, key) },
        encoding: 'utf8',
        timeout: 30_000,
      });
      const lines = stdout.trim().split('\n');
      expect(lines.slice(0, 4)).toEqual([
        '::add-mask::00008110-001A2B3C4D5E6F70',
        '::add-mask::Ayşe',
        `::add-mask::${'A'.repeat(40)}`,
        '::add-mask::Ali',
      ]);
      expect(lines.slice(4).join('\n')).not.toMatch(/00008110|Ayşe|AAAA/);
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(devices);

      let failed: { status: number; stderr: string } | null = null;
      try {
        execFileSync(process.execPath, [SCRIPT, 'decrypt', '--out', out], {
          env: { ...process.env, IOS_DEVICES_KEY: '', IOS_DEVICES_PAYLOAD: 'v1.x.y' },
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 30_000,
        });
      } catch (err) {
        failed = err as { status: number; stderr: string };
      }
      expect(failed?.status).toBe(1);
      expect(failed?.stderr).toContain('IOS_DEVICES_KEY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
