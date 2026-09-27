import { reportClientError } from '@diskort/client-core';
import { create } from 'zustand';
import { NoiseFilter, type NoiseFilterStatus } from '../../modules/noise-filter';
import { getSettings, useSettings, type NoiseMode } from '../stores/settings';

/**
 * DPDFNet gürültü engelleme (modules/noise-filter): masaüstündeki modelin aynısı telefonda, WebRTC'nin ses
 * işleme hattının sonunda çalışır. DPDFNet açıkken WebRTC'nin kendi (standart) gürültü engellemesi kapatılır;
 * model yüklenemez, telefon yetişemez ya da hata olursa standart engellemeye dönülür.
 */

/** Bu APK'da DPDFNet var mı: eski APK'larda (kablosuz güncellemeyle yeni JS almış) yerel modül yoktur */
export const dpdfnetAvailable: boolean = (() => {
  try {
    return NoiseFilter?.isSupported() ?? false;
  } catch {
    return false;
  }
})();

interface NoiseFilterStore {
  /** Son katılışta DPDFNet'in durumu (DPDFNet seçili değilse null) */
  status: NoiseFilterStatus | null;
}

export const useNoiseFilter = create<NoiseFilterStore>()(() => ({ status: null }));

/** DPDFNet şu an mikrofonu işliyor mu (standart engelleme kapalı kalmalı mı) */
let running = false;

/** Ayardaki tür, bu telefonda geçerli olana çevrilir (DPDFNet yoksa standart) */
export function effectiveNoiseMode(mode: NoiseMode = getSettings().noiseMode): NoiseMode {
  return mode === 'dpdfnet' && !dpdfnetAvailable ? 'standard' : mode;
}

/** WebRTC'nin kendi gürültü engellemesi açık mı olmalı */
export function webrtcNoiseSuppression(): boolean {
  const mode = effectiveNoiseMode();
  return mode === 'standard' || (mode === 'dpdfnet' && !running);
}

function report(reason: string): void {
  reportClientError(new Error(`DPDFNet çalışmıyor: ${reason}`), 'dpdfnet');
}

/**
 * Sesli sohbete katılırken, mikrofon açılmadan önce: DPDFNet seçiliyse modeli yükler ve WebRTC'ye takar,
 * değilse kapatır. Sonuç webrtcNoiseSuppression() ile mikrofonun ayarlarına yansır.
 */
export async function prepareNoiseFilter(): Promise<void> {
  running = false;
  if (!NoiseFilter) return;
  const s = getSettings();
  const want = effectiveNoiseMode(s.noiseMode) === 'dpdfnet';
  try {
    const status = await NoiseFilter.configure(want, s.noiseStrengthDb);
    running = want && status.active;
    useNoiseFilter.setState({ status: want ? status : null });
    if (want && !status.active && status.reason) report(status.reason);
  } catch (err) {
    reportClientError(err, 'dpdfnet');
    useNoiseFilter.setState({ status: null });
  }
}

/** Sesli sohbetten ayrılınca: model bellekten atılır */
export async function releaseNoiseFilter(): Promise<void> {
  running = false;
  useNoiseFilter.setState({ status: null });
  await NoiseFilter?.configure(false, 100).catch(() => undefined);
}

/** Anlık ölçümler (sesli sohbet ekranındaki satır) */
export function noiseFilterStats(): NoiseFilterStatus | null {
  const last = useNoiseFilter.getState().status;
  if (!running && !last) return null;
  try {
    const now = NoiseFilter?.getStats() ?? null;
    // Yüklenemediyse neden yalnızca katılıştaki sonuçta vardır
    return now && !now.active && !now.reason ? { ...now, reason: last?.reason ?? null } : now;
  } catch {
    return null;
  }
}

/**
 * DPDFNet sesli sohbet sırasında kendini devre dışı bıraktığında (telefon yetişemedi ya da hata) çağrılır.
 * Çağrıldığında webrtcNoiseSuppression() artık true döner; mikrofon standart engellemeyle yeniden açılmalı.
 */
export function onNoiseFilterBypass(listener: (reason: string) => void): void {
  NoiseFilter?.addListener('onBypass', ({ reason }) => {
    if (!running) return;
    running = false;
    const status = useNoiseFilter.getState().status;
    if (status) useNoiseFilter.setState({ status: { ...status, active: false, reason } });
    report(reason);
    listener(reason);
  });
}

// Güç ayarı sesli sohbetteyken de anında uygulanır
useSettings.subscribe((next, prev) => {
  if (next.noiseStrengthDb !== prev.noiseStrengthDb) {
    try {
      NoiseFilter?.setAttenLimit(next.noiseStrengthDb);
    } catch {
      // model yüklü değilse bir sonraki katılışta uygulanır
    }
  }
});
