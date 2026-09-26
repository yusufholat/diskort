import type { ClientPlatform, Message } from '@diskort/shared';

/** Oturum gibi kalıcı verilerin saklandığı yer (masaüstü: localStorage, mobil: güvenli depolama). */
export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/**
 * Çekirdeğin platforma bıraktığı işler. Masaüstü ve mobil uygulama açılışta configureClient() ile
 * kendi karşılıklarını verir; çekirdek pencere, bildirim, ses gibi platform ayrıntılarını bilmez.
 */
export interface ClientEnvironment {
  platform: ClientPlatform;
  /** Uygulama sürümü (sunucu eski sürümleri reddeder) */
  version: string;
  storage: KeyValueStorage;
  /** Bağlanılan sohbet sunucusunun adresi */
  serverUrl(): string;
  /** Kullanıcıya kısa bir hata göster (ör. mesaj gönderilemedi) */
  notifyError(message: string): void;
  /** Kullanıcı bu metin kanalını şu an gerçekten görüyor mu (uygulama önde ve kanal açık) */
  isViewingChannel?(channelId: string): boolean;
  /** Görülmeyen bir kanalda kullanıcıdan bahsedildi */
  onMention?(message: Message): void;
  /** Sunucu bu sürümü artık kabul etmiyor */
  onUpdateRequired?(version: string): void;
  /** Yeni sürüm yayınlandı */
  onUpdateAvailable?(version: string): void;
}

let current: ClientEnvironment | null = null;

export function env(): ClientEnvironment {
  if (!current) throw new Error('İstemci yapılandırılmadı: önce configureClient() çağrılmalı.');
  return current;
}

export function setEnvironment(environment: ClientEnvironment): void {
  current = environment;
}
