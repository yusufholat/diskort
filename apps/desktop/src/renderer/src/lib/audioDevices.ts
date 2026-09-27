import { useEffect, useState } from 'react';

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface AudioDevices {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

const EMPTY: AudioDevices = { inputs: [], outputs: [] };

/** "Default - Mikrofon (Realtek)" → "Mikrofon (Realtek)" (Windows/Chromium varsayılan aygıt adı) */
export function stripDefaultPrefix(label: string): string {
  return label.replace(/^(Default|Varsayılan)\s*-\s*/i, '');
}

/**
 * Ses giriş/çıkış aygıtları; aygıt takılıp çıkarılınca yenilenir. `enabled` false iken listelenmez
 * (ör. menü kapalıyken). "Varsayılan" aygıt listenin başında kalır.
 */
export function useAudioDevices(enabled = true): AudioDevices {
  const [devices, setDevices] = useState<AudioDevices>(EMPTY);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      let list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      // Aygıt adları için bir kez mikrofon izni gerekir.
      if (list.some((d) => d.kind === 'audioinput' && !d.label)) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
          list = await navigator.mediaDevices.enumerateDevices();
        } catch {
          // izin verilmedi; adsız listele
        }
      }
      if (cancelled) return;
      const map = (kind: MediaDeviceKind): AudioDevice[] =>
        list
          .filter((d) => d.kind === kind && d.deviceId !== 'communications')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Aygıt ${i + 1}`,
          }));
      setDevices({ inputs: map('audioinput'), outputs: map('audiooutput') });
    };
    void load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, [enabled]);

  return devices;
}

/** Seçili aygıtın menüde gösterilecek adı ("Varsayılan" ya da aygıt adı) */
export function deviceLabel(devices: AudioDevice[], deviceId: string): string {
  if (deviceId === 'default') return 'Varsayılan';
  const found = devices.find((d) => d.deviceId === deviceId);
  return found ? found.label : 'Varsayılan';
}
