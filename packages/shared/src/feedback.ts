// Uygulama içi geri bildirim: arkadaşların hata/öneri bildirmesi, yöneticilerin incelemesi.

import type { ClientPlatform } from './index';

export type FeedbackType = 'hata' | 'oneri' | 'diger';

export type FeedbackStatus = 'yeni' | 'incelendi' | 'planlandi' | 'tamamlandi' | 'reddedildi';

export const FEEDBACK_TYPES: readonly FeedbackType[] = ['hata', 'oneri', 'diger'];
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ['yeni', 'incelendi', 'planlandi', 'tamamlandi', 'reddedildi'];

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  hata: 'Hata',
  oneri: 'Öneri',
  diger: 'Diğer',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  yeni: 'Yeni',
  incelendi: 'İncelendi',
  planlandi: 'Planlandı',
  tamamlandi: 'Tamamlandı',
  reddedildi: 'Reddedildi',
};

export const FEEDBACK_TITLE_MAX_LENGTH = 120;
export const FEEDBACK_BODY_MAX_LENGTH = 4000;
export const FEEDBACK_NOTE_MAX_LENGTH = 2000;
/** Bir geri bildirimdeki en fazla ekran görüntüsü */
export const FEEDBACK_MAX_SCREENSHOTS = 3;
/** Yüklenen tek ekran görüntüsünün en büyük boyutu (sunucu WebP'ye çevirip küçültür) */
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 12 * 1024 * 1024;
/** Kullanıcı başına saatte en fazla geri bildirim */
export const FEEDBACK_PER_HOUR = 5;
/** Teknik bilgilerde gönderilen en fazla son hata */
export const FEEDBACK_MAX_ERRORS = 10;

/**
 * Otomatik eklenen teknik bilgiler (kullanıcı gönderimden önce görür ve kapatabilir). Mesaj içerikleri,
 * jetonlar ya da kişisel veriler yoktur; sunucu bilinmeyen alanları atar.
 */
export interface FeedbackContext {
  platform?: ClientPlatform;
  /** Uygulama (arayüz) sürümü */
  appVersion?: string;
  /** Android: yüklü APK sürümü (arayüz kablosuz güncellemeyle yeni olabilir) */
  nativeVersion?: string;
  /** win32, darwin, linux, android… */
  os?: string;
  osVersion?: string;
  /** Cihaz modeli (Android) ya da işlemci mimarisi (masaüstü) */
  device?: string;
  /** Ekran boyutu, ör. "1920×1080 @1.25x" */
  screen?: string;
  /** Pencere/görünüm boyutu */
  window?: string;
  /** Açık olan görünüm: ör. "metin kanalı", "ses sahnesi", "ayarlar" (mesaj içeriği değil) */
  view?: string;
  /** Sese bağlı mı */
  inVoice?: boolean;
  /** Bu oturumdaki son uygulama hataları (yalnızca mesajları) */
  recentErrors?: string[];
}

/** Geri bildirime eklenmiş ekran görüntüsü */
export interface FeedbackScreenshot {
  /** 128 bit rastgele kimlik (32 onaltılık karakter) */
  id: string;
  width: number;
  height: number;
  size: number;
  /**
   * Sunucu köküne göre adres: /api/feedback/screenshots/<id>. Herkese açık DEĞİLDİR: yalnızca yöneticiler
   * ve gönderen, Authorization başlığıyla alabilir (masaüstü blob adresi, mobil başlıklı <Image> kullanır).
   */
  url: string;
}

export interface Feedback {
  /** Artan sayı (#12) */
  id: number;
  /** Gönderen; hesap silindiyse null */
  userId: string | null;
  type: FeedbackType;
  title: string | null;
  body: string;
  /** Kullanıcı teknik bilgileri göndermediyse null */
  context: FeedbackContext | null;
  screenshots: FeedbackScreenshot[];
  status: FeedbackStatus;
  /** Yöneticinin notu; gönderen de görür */
  adminNote: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateFeedbackRequest {
  type: FeedbackType;
  title?: string | null;
  body: string;
  context?: FeedbackContext | null;
  /** Önce POST /api/feedback/screenshots ile yüklenen resimler */
  screenshotIds?: string[];
}

export interface UpdateFeedbackRequest {
  status?: FeedbackStatus;
  /** null ya da boş: not silinir */
  adminNote?: string | null;
}

/** POST /api/feedback/screenshots yanıtı (henüz bir geri bildirime bağlı değil) */
export type UploadedFeedbackScreenshot = FeedbackScreenshot;
