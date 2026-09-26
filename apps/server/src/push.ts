import { readFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';
import type { Message } from '@diskort/shared';
import type { Store } from './db.js';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface PushLogger {
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const BODY_MAX = 180;

/**
 * Telefonlara bildirim: Google'ın FCM HTTP v1 arayüzüne doğrudan istek (Firebase sunucu kütüphanesi
 * gerekmez). Firebase yalnızca teslimatı yapar; kime, ne zaman, ne gideceğine bu sunucu karar verir.
 * Hizmet hesabı anahtarı yoksa sessizce devre dışıdır.
 */
export class PushService {
  private readonly account: ServiceAccount | null;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly store: Store,
    serviceAccountFile: string | null,
    private readonly log: PushLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.account = serviceAccountFile ? PushService.load(serviceAccountFile, log) : null;
  }

  get enabled(): boolean {
    return this.account !== null;
  }

  private static load(file: string, log: PushLogger): ServiceAccount | null {
    try {
      const account = JSON.parse(readFileSync(file, 'utf8')) as ServiceAccount;
      if (!account.project_id || !account.client_email || !account.private_key) throw new Error('eksik alan');
      log.info({ project: account.project_id }, 'telefon bildirimleri açık (FCM)');
      return account;
    } catch (err) {
      log.warn({ err: String(err) }, 'FCM hizmet hesabı okunamadı; telefon bildirimleri kapalı');
      return null;
    }
  }

  /** Bahsedilen kullanıcıların telefonlarına bildirim gönderir. */
  async notifyMention(message: Message, mentionedUserIds: string[], channelName: string): Promise<void> {
    if (!this.account || mentionedUserIds.length === 0) return;
    const tokens = this.store.pushTokens(mentionedUserIds);
    if (tokens.length === 0) return;

    const author = message.authorId ? this.store.getUser(message.authorId) : null;
    const body = this.readable(message.content);
    await Promise.all(
      tokens.map((t) =>
        this.send(t.token, {
          notification: {
            title: `${author?.displayName ?? 'Biri'} · #${channelName}`,
            body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}…` : body,
          },
          data: { type: 'mention', channelId: message.channelId, messageId: message.id },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'diskort-mentions',
              // Aynı kanaldaki bildirimler üst üste biner, bildirim çubuğu dolmaz
              tag: `channel-${message.channelId}`,
              color: '#5865f2',
            },
          },
        }),
      ),
    );
  }

  /** @kullanıcıadı yerine görünen ad */
  private readable(content: string): string {
    return content.replace(/(?<![\w.@])@([a-z0-9_.]*[a-z0-9_])/gi, (raw, name: string) => {
      const user = this.store.getUserAuthByUsername(name.toLowerCase());
      return user ? `@${user.displayName}` : raw;
    });
  }

  private async send(token: string, message: Record<string, unknown>): Promise<void> {
    try {
      const res = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${this.account!.project_id}/messages:send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${await this.getAccessToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { token, ...message } }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.ok) return;
      const text = await res.text();
      // Uygulama kaldırılmış ya da jeton yenilenmiş: artık geçersiz jetonu unut
      if (res.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/.test(text)) {
        this.store.removePushToken(token);
        return;
      }
      if (res.status === 401) this.accessToken = null;
      this.log.warn({ status: res.status, body: text.slice(0, 300) }, 'FCM bildirimi gönderilemedi');
    } catch (err) {
      this.log.warn({ err: String(err) }, 'FCM bildirimi gönderilemedi');
    }
  }

  /** Hizmet hesabıyla imzalanmış JWT karşılığında Google'dan 1 saatlik erişim jetonu alır (önbellekli). */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60_000) return this.accessToken.value;
    const account = this.account!;
    const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const key = await importPKCS8(account.private_key, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.client_email)
      .setAudience(tokenUri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const res = await this.fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google erişim jetonu alınamadı (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
