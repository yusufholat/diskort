// iOS iş akışına giden cihaz listesinin şifrelenmesi (depo herkese açık: workflow_dispatch girdileri
// UDID ya da ad göstermemeli). Biçim: v1.<iv (12 bayt) base64url>.<şifreli metin + etiket (16 bayt) base64url>,
// AES-256-GCM, anahtar 32 bayt (base64; sunucuda ve GitHub'da IOS_DEVICES_KEY). Açık metin:
// [{"udid":"…","name":"…"}]. Sunucudaki eşi: apps/server/src/iosDevicesCrypto.ts (aynı biçim, testle bağlı).
//
//   node scripts/ios-devices-crypto.mjs decrypt --out cihazlar.json
//       IOS_DEVICES_KEY ve IOS_DEVICES_PAYLOAD ortam değişkenlerinden çözer, her UDID ve adı GitHub
//       günlüğünde gizler (::add-mask::), dosyaya yazar. Açık metni ekrana basmaz.
//   node scripts/ios-devices-crypto.mjs encrypt --key-file ios-devices.key UDID1,UDID2
//       Elle çalıştırma için şifreli "devices" değeri üretir.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const VERSION = 'v1';
const AAD = Buffer.from('diskort-ios-devices-v1');

/** base64 anahtarı okur; 32 bayt değilse hata */
export function parseKey(text) {
  const key = Buffer.from(String(text ?? '').trim(), 'base64');
  if (key.length !== 32) throw new Error('IOS_DEVICES_KEY 32 baytlık base64 bir anahtar olmalı');
  return key;
}

export function encryptDevices(devices, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(devices), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/** Çözer; biçim bozuksa, anahtar yanlışsa ya da değer değiştirilmişse hata */
export function decryptDevices(payload, key) {
  const parts = String(payload ?? '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error('Cihaz listesi şifreli biçimde değil (v1.<iv>.<veri>)');
  const iv = Buffer.from(parts[1], 'base64url');
  const body = Buffer.from(parts[2], 'base64url');
  if (iv.length !== 12 || body.length < 17) throw new Error('Şifreli cihaz listesi bozuk');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(body.subarray(body.length - 16));
  let text;
  try {
    text = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Cihaz listesi çözülemedi (anahtar yanlış ya da veri değiştirilmiş)');
  }
  const devices = JSON.parse(text);
  if (!Array.isArray(devices)) throw new Error('Çözülen cihaz listesi dizi değil');
  return devices;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, 'key-file': { type: 'string' } },
  });
  const fail = (msg) => {
    console.error(`::error::${msg}`);
    process.exit(1);
  };
  const [command, list] = positionals;
  if (command === 'decrypt') {
    if (!process.env.IOS_DEVICES_KEY) fail('IOS_DEVICES_KEY gizli değişkeni yok: şifreli cihaz listesi çözülemez (bkz. docs/ios.md)');
    if (!values.out) fail('--out gerekli');
    let devices;
    try {
      devices = decryptDevices(process.env.IOS_DEVICES_PAYLOAD, parseKey(process.env.IOS_DEVICES_KEY));
    } catch (err) {
      fail(err.message);
    }
    // Açık değerler günlüğe hiç düşmesin: önce gizle
    for (const d of devices) {
      for (const v of [d?.udid, d?.name]) if (typeof v === 'string' && v.trim().length >= 3) console.log(`::add-mask::${v.trim()}`);
    }
    writeFileSync(values.out, JSON.stringify(devices));
    console.log(`Cihaz listesi çözüldü: ${devices.length} cihaz.`);
  } else if (command === 'encrypt') {
    if (!values['key-file'] || !list) fail('Kullanım: encrypt --key-file ios-devices.key UDID1,UDID2');
    const key = parseKey(readFileSync(values['key-file'], 'utf8'));
    const devices = list.split(',').map((s) => s.trim()).filter(Boolean).map((udid) => ({ udid: udid.toUpperCase() }));
    console.log(encryptDevices(devices, key));
  } else {
    console.error('Kullanım: decrypt --out dosya | encrypt --key-file anahtar UDID1,UDID2');
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
