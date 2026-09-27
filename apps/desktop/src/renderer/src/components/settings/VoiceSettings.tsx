import { useEffect, useState } from 'react';
import { voice } from '../../features/voice/voiceClient';
import { bridge } from '../../lib/bridge';
import { errorMessage } from '@diskort/client-core';
import { cn, clamp } from '../../lib/utils';
import { useSettings, type NoiseMode, type NoiseStrengthDb } from '../../stores/settings';
import { useVoice } from '../../stores/voice';
import { Button, Divider, RadioCards, SectionTitle, Segmented, Select, Toggle } from '../ui/controls';
import { Slider } from '../ui/Slider';
import { KeybindInput } from './KeybindInput';

interface Device {
  deviceId: string;
  label: string;
}

function useDevices(): { inputs: Device[]; outputs: Device[] } {
  const [devices, setDevices] = useState<{ inputs: Device[]; outputs: Device[] }>({ inputs: [], outputs: [] });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      let list = await navigator.mediaDevices.enumerateDevices();
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
      const map = (kind: MediaDeviceKind): Device[] =>
        list
          .filter((d) => d.kind === kind && d.deviceId !== 'communications')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.deviceId === 'default' ? `Varsayılan${d.label ? ` — ${d.label.replace(/^Default - /, '')}` : ''}` : d.label || `Aygıt ${i + 1}`,
          }));
      setDevices({ inputs: map('audioinput'), outputs: map('audiooutput') });
    };
    void load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);

  return devices;
}

const NOISE_STRENGTH_OPTIONS: { value: NoiseStrengthDb; label: string }[] = [
  { value: 12, label: 'Hafif' },
  { value: 24, label: 'Dengeli' },
  { value: 40, label: 'Güçlü' },
  { value: 100, label: 'Maksimum' },
];

const NOISE_STRENGTH_HINTS: Record<NoiseStrengthDb, string> = {
  12: 'Gürültüyü en fazla 12 dB kısar; ses en doğal hâlinde kalır, arka plan hafifçe duyulabilir.',
  24: 'Önerilen: gürültünün çoğunu bastırır, sesini doğal bırakır.',
  40: 'Gürültülü ortamlar için; ses biraz daha işlenmiş duyulabilir.',
  100: 'Sınırsız bastırma: gürültü tamamen kesilir ama ses robotik duyulabilir.',
};

/** Discord tarzı seviye göstergesi + hassasiyet eşiği. */
function MicMeter({ editable }: { editable: boolean }) {
  const level = useVoice((s) => s.micLevel);
  const threshold = useSettings((s) => s.vadThresholdDb);
  const set = useSettings((s) => s.set);
  const toPct = (db: number): number => clamp(((db + 100) / 100) * 100, 0, 100);
  const thresholdPct = toPct(editable ? threshold : level.threshold);

  return (
    <div className="relative h-8">
      <div className="absolute inset-x-0 top-3 h-2 overflow-hidden rounded bg-control">
        <div
          className="absolute inset-y-0 left-0 bg-warn transition-[width] duration-75"
          style={{ width: `${Math.min(toPct(level.db), thresholdPct)}%` }}
        />
        <div
          className="absolute inset-y-0 bg-ok transition-[width] duration-75"
          style={{ left: `${thresholdPct}%`, width: `${Math.max(0, toPct(level.db) - thresholdPct)}%` }}
        />
      </div>
      {editable ? (
        <input
          type="range"
          className="slider absolute inset-x-0 top-1.5 w-full bg-transparent"
          style={{ background: 'transparent' }}
          min={-100}
          max={0}
          value={threshold}
          onChange={(e) => set({ vadThresholdDb: Number(e.target.value) })}
        />
      ) : (
        <div className="absolute top-1 h-6 w-0.5 bg-white/70" style={{ left: `${thresholdPct}%` }} />
      )}
    </div>
  );
}

function MicTestControls() {
  const connected = useVoice((s) => s.status !== 'idle');
  const [loopback, setLoopback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputDeviceId = useSettings((s) => s.inputDeviceId);
  const noise = useSettings((s) => s.noise);

  useEffect(() => {
    if (connected) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    voice
      .startMicTest(loopback)
      .then((fn) => {
        if (cancelled) fn();
        else stop = fn;
      })
      .catch((err) => setError(errorMessage(err)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [connected, loopback, inputDeviceId, noise]);

  if (connected) return <p className="mt-2 text-xs text-text-muted">Ses kanalına bağlısın; gösterge canlı mikrofonunu gösteriyor.</p>;
  return (
    <div className="mt-3 flex items-center gap-3">
      <Button variant={loopback ? 'danger' : 'primary'} onClick={() => setLoopback(!loopback)}>
        {loopback ? 'Testi Durdur' : 'Kendini Dinle'}
      </Button>
      <span className="text-xs text-text-muted">
        {error ?? 'Mikrofonunun başkalarına nasıl gittiğini (gürültü engelleme dahil) duy.'}
      </span>
    </div>
  );
}

export function VoiceSettings() {
  const s = useSettings();
  const { inputs, outputs } = useDevices();
  const [hotkeysAvailable, setHotkeysAvailable] = useState(true);

  useEffect(() => {
    void bridge?.hotkeys.available().then(setHotkeysAvailable);
  }, []);

  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Ses Ayarları</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-2 text-xs font-bold text-text-muted uppercase">Giriş Aygıtı</div>
          <Select
            aria-label="Giriş aygıtı"
            value={s.inputDeviceId}
            onChange={(inputDeviceId) => s.set({ inputDeviceId })}
            options={inputs.length ? inputs.map((d) => ({ value: d.deviceId, label: d.label })) : [{ value: 'default', label: 'Varsayılan' }]}
          />
        </div>
        <div>
          <div className="mb-2 text-xs font-bold text-text-muted uppercase">Çıkış Aygıtı</div>
          <Select
            aria-label="Çıkış aygıtı"
            value={s.outputDeviceId}
            onChange={(outputDeviceId) => s.set({ outputDeviceId })}
            options={outputs.length ? outputs.map((d) => ({ value: d.deviceId, label: d.label })) : [{ value: 'default', label: 'Varsayılan' }]}
          />
        </div>
      </div>

      <SectionTitle>Mikrofon Testi</SectionTitle>
      <MicMeter editable={false} />
      <MicTestControls />

      <Divider />

      <SectionTitle>Giriş Modu</SectionTitle>
      <RadioCards
        value={s.inputMode}
        onChange={(inputMode) => s.set({ inputMode })}
        options={[
          { value: 'vad', label: 'Ses Aktivitesi', description: 'Konuştuğunda mikrofon otomatik açılır.' },
          { value: 'ptt', label: 'Bas-Konuş', description: 'Yalnızca atadığın tuşa basılıyken konuşursun.' },
        ]}
      />

      {s.inputMode === 'vad' ? (
        <>
          <SectionTitle>Giriş Hassasiyeti</SectionTitle>
          <Toggle
            label="Giriş hassasiyetini otomatik belirle"
            checked={s.vadAuto}
            onChange={(vadAuto) => s.set({ vadAuto })}
          />
          <div className={cn('mt-2', s.vadAuto && 'pointer-events-none opacity-60')}>
            <MicMeter editable={!s.vadAuto} />
            <p className="mt-1 text-xs text-text-muted">
              Yeşil bölgeye geçtiğinde sesin iletilir. Eşik: {s.vadAuto ? 'otomatik' : `${s.vadThresholdDb} dB`}
            </p>
          </div>
        </>
      ) : (
        <>
          <SectionTitle>Bas-Konuş Kısayolu</SectionTitle>
          <KeybindInput
            value={s.hotkeys.pushToTalk}
            onChange={(pushToTalk) => s.set({ hotkeys: { ...s.hotkeys, pushToTalk } })}
          />
          {!bridge || !hotkeysAvailable ? (
            <p className="mt-2 text-xs text-warn">Global kısayollar bu sistemde kullanılamıyor.</p>
          ) : null}
          <SectionTitle>Bırakma Gecikmesi — {s.pttReleaseMs} ms</SectionTitle>
          <Slider
            className="w-full"
            aria-label="Bırakma gecikmesi"
            min={0}
            max={1000}
            step={10}
            value={s.pttReleaseMs}
            onValueChange={(pttReleaseMs) => s.set({ pttReleaseMs })}
          />
        </>
      )}

      <Divider />

      <SectionTitle>Gürültü Engelleme</SectionTitle>
      <RadioCards<NoiseMode>
        value={s.noise}
        onChange={(noise) => s.set({ noise })}
        options={[
          {
            value: 'dpdfnet',
            label: 'Gelişmiş yapay zekâ (DPDFNet)',
            description:
              'En temiz ses: klavye, fan, arkadaki konuşmalar ve TV sesini daha iyi ayırır. DeepFilterNet’ten yaklaşık 3 kat fazla işlemci kullanır ve ~20 ms daha gecikmelidir; işlemci yetmezse DeepFilterNet’e geçilir.',
          },
          {
            value: 'deepfilter',
            label: 'Yapay zekâ (DeepFilterNet 3)',
            description: 'Klavye, fan, köpek havlaması gibi arka plan seslerini bastırır, sesini doğal bırakır.',
          },
          { value: 'standard', label: 'Standart', description: 'Tarayıcı motorunun yerleşik gürültü engellemesi; daha az işlemci kullanır.' },
          { value: 'off', label: 'Kapalı', description: 'Stüdyo mikrofonları veya müzik için.' },
        ]}
      />
      {(s.noise === 'deepfilter' || s.noise === 'dpdfnet') && (
        <>
          <SectionTitle>Gürültü engelleme gücü</SectionTitle>
          <Segmented<NoiseStrengthDb>
            aria-label="Gürültü engelleme gücü"
            value={s.noiseStrengthDb}
            onChange={(noiseStrengthDb) => s.set({ noiseStrengthDb })}
            options={NOISE_STRENGTH_OPTIONS}
          />
          <p className="mt-2 text-xs text-text-muted">{NOISE_STRENGTH_HINTS[s.noiseStrengthDb]}</p>
        </>
      )}
      <div className="mt-3">
        <Toggle
          label="Yankı engelleme"
          description="Hoparlörden gelen sesin mikrofona geri girmesini önler."
          checked={s.echoCancellation}
          onChange={(echoCancellation) => s.set({ echoCancellation })}
        />
        <Toggle
          label="Otomatik kazanç kontrolü"
          description="Ses seviyeni otomatik olarak dengeler."
          checked={s.autoGainControl}
          onChange={(autoGainControl) => s.set({ autoGainControl })}
        />
      </div>

      <SectionTitle>Ses Kalitesi</SectionTitle>
      <Select
        aria-label="Ses kalitesi"
        value={s.audioBitrateKbps}
        onChange={(audioBitrateKbps) => s.set({ audioBitrateKbps })}
        options={[
          { value: 32, label: '32 kbps — düşük bant' },
          { value: 64, label: '64 kbps — önerilen' },
          { value: 96, label: '96 kbps — yüksek' },
          { value: 128, label: '128 kbps — müzik' },
        ]}
      />

      <Divider />
      <Toggle
        label="Arayüz sesleri"
        description="Katılma/ayrılma, susturma ve yayın sesleri."
        checked={s.sounds}
        onChange={(sounds) => s.set({ sounds })}
      />
    </div>
  );
}
