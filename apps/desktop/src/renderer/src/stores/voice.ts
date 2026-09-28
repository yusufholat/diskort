import { create } from 'zustand';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';
export type ConnectionQualityLabel = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export interface MicLevel {
  db: number;
  threshold: number;
  open: boolean;
}

export interface RemoteStream {
  hasAudio: boolean;
}

interface VoiceStore {
  channelId: string | null;
  status: VoiceStatus;
  /** Konuşan kullanıcılar (userId → true) */
  speaking: Record<string, true>;
  pingMs: number | null;
  quality: ConnectionQualityLabel;
  /** Bulunduğun kanalda yayın yapan kullanıcılar */
  streams: Record<string, RemoteStream>;
  /** İzlediğin yayınlar */
  watching: Record<string, true>;
  /** Yayın izlerken büyük gösterilen kullanıcı */
  focusedStream: string | null;
  /** Abone olunan track'ler değiştikçe artar (video öğelerini yeniden bağlamak için) */
  tracksVersion: number;
  sharing: boolean;
  /**
   * Kendi yayınının önizlemesi yine de gösterilsin mi. Varsayılan kapalı: kaynak tasarrufu ve tüm ekran
   * paylaşılırken sonsuz ayna görüntüsü olmasın diye önizleme duraklatılır. Her yeni yayında sıfırlanır.
   */
  selfPreview: boolean;
  shareHasAudio: boolean;
  pttActive: boolean;
  /** Kanalda konuşma izni var mı (yetki ya da sunucuda susturma; LiveKit izninden gelir) */
  micAllowed: boolean;
  micLevel: MicLevel;
  /** Ayarlarda mikrofon testi sürüyor (görüşmedeyken odaya sessizlik gider, susturulmuş görünürsün) */
  micTesting: boolean;
  error: string | null;
}

export const useVoice = create<VoiceStore>()(() => ({
  channelId: null,
  status: 'idle',
  speaking: {},
  pingMs: null,
  quality: 'unknown',
  streams: {},
  watching: {},
  focusedStream: null,
  tracksVersion: 0,
  sharing: false,
  selfPreview: false,
  shareHasAudio: false,
  pttActive: false,
  micAllowed: true,
  micLevel: { db: -100, threshold: -50, open: false },
  micTesting: false,
  error: null,
}));

export const setVoice = useVoice.setState;
