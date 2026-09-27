import { create } from 'zustand';
import type { LinkQuality, PingSample, TransportView } from '@diskort/client-core';

/** Ses sunucusunun kimliği (bağlantı panelinde gösterilir) */
export interface VoiceServerInfo {
  /** ör. lk.ziroo.net */
  host: string;
  roomName: string;
  region: string | null;
  nodeId: string | null;
  version: string | null;
  /** LiveKit uçtan uca şifreleme (E2EE) açık mı */
  e2ee: boolean;
}

/** Akışın kime/neye ait olduğu (track kimliğinden) */
export interface StreamLabel {
  label: string;
  /** Ekran yayını mı */
  screen: boolean;
}

export interface ConnectionDetail {
  at: number;
  publisher: TransportView | null;
  subscriber: TransportView | null;
  labels: Record<string, StreamLabel>;
}

interface ConnectionStatsStore {
  /** Son 5 dakikanın ping ölçümleri (yalnızca bağlıyken) */
  samples: PingSample[];
  /** Son birkaç ölçümün ping ve kaybından hesaplanan kalite (etiket ve simge rengi) */
  quality: LinkQuality;
  server: VoiceServerInfo | null;
  /** Ayrıntılı istatistikler; yalnızca bağlantı paneli açıkken toplanır */
  detail: ConnectionDetail | null;
}

export const EMPTY_CONNECTION_STATS: ConnectionStatsStore = {
  samples: [],
  quality: 'unknown',
  server: null,
  detail: null,
};

export const useConnectionStats = create<ConnectionStatsStore>()(() => EMPTY_CONNECTION_STATS);

export const setConnectionStats = useConnectionStats.setState;
