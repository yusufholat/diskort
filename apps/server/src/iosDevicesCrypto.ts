import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * iOS iş akışına giden cihaz listesinin şifrelenmesi: depo herkese açık, workflow_dispatch girdileri UDID
 * ya da ad göstermemeli. Biçim scripts/ios-devices-crypto.mjs ile aynı (iş akışı onunla çözer; testler
 * ikisini birbirine bağlar): v1.<iv base64url>.<şifreli metin + GCM etiketi base64url>, AES-256-GCM.
 */

const VERSION = 'v1';
const AAD = Buffer.from('diskort-ios-devices-v1');

/** IOS_DEVICES_KEY: 32 baytlık base64 anahtar; boşsa null, bozuksa hata */
export function parseDevicesKey(text: string | undefined): Buffer | null {
  if (!text?.trim()) return null;
  const key = Buffer.from(text.trim(), 'base64');
  if (key.length !== 32) throw new Error('IOS_DEVICES_KEY 32 baytlık base64 bir anahtar olmalı');
  return key;
}

export function encryptDevices(devices: unknown[], key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(devices), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

export function decryptDevices(payload: string, key: Buffer): unknown[] {
  const parts = payload.trim().split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error('Cihaz listesi şifreli biçimde değil');
  const iv = Buffer.from(parts[1]!, 'base64url');
  const body = Buffer.from(parts[2]!, 'base64url');
  if (iv.length !== 12 || body.length < 17) throw new Error('Şifreli cihaz listesi bozuk');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const text = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  const devices = JSON.parse(text) as unknown;
  if (!Array.isArray(devices)) throw new Error('Çözülen cihaz listesi dizi değil');
  return devices;
}
