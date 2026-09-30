import type { RefObject } from 'react';
import { Settings } from 'lucide-react';
import { deviceLabel, stripDefaultPrefix, useAudioDevices, type AudioDevice } from '../../lib/audioDevices';
import { MAX_VOLUME, useSettings, type NoiseMode, type NoiseStrengthDb } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { fallbackLabel, type NoiseFallbackState } from '../../features/voice/noiseFallback';
import {
  MenuHeading,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
  MenuSlider,
  MenuSubmenu,
  PanelMenu,
} from '../ui/PanelMenu';

export const NOISE_LABELS: Record<NoiseMode, string> = {
  dpdfnet: 'DPDFNet',
  standard: 'Standart',
  off: 'Kapalı',
};

const NOISE_HINTS: Record<NoiseMode, string> = {
  dpdfnet: 'Gelişmiş yapay zekâ, en temiz ses',
  standard: 'Tarayıcının yerleşik engellemesi',
  off: 'Stüdyo mikrofonu ya da müzik için',
};

export const NOISE_STRENGTH_LABELS: Record<NoiseStrengthDb, string> = {
  12: 'Hafif',
  24: 'Dengeli',
  40: 'Güçlü',
  100: 'Maksimum',
};

const NOISE_MODES: NoiseMode[] = ['dpdfnet', 'standard', 'off'];
const STRENGTHS: NoiseStrengthDb[] = [12, 24, 40, 100];

export const isAiNoise = (noise: NoiseMode): boolean => noise === 'dpdfnet';

/**
 * "Gürültü engelleme: DPDFNet · Dengeli" gibi kısa özet; görüşmede seçili model çalışmıyorsa gerçekte çalışan:
 * "DPDFNet → Standart (işlemci yoğun)"
 */
export function noiseSummary(noise: NoiseMode, strength: NoiseStrengthDb, fallback?: NoiseFallbackState | null): string {
  if (fallback) return fallbackLabel(fallback);
  return isAiNoise(noise) ? `${NOISE_LABELS[noise]} · ${NOISE_STRENGTH_LABELS[strength]}` : NOISE_LABELS[noise];
}

/** Gürültü engelleme türü ve (yapay zekâ seçiliyse) gücü; seçim menüyü kapatmaz */
export function NoiseMenuItems() {
  const noise = useSettings((s) => s.noise);
  const strength = useSettings((s) => s.noiseStrengthDb);
  const set = useSettings((s) => s.set);
  // Görüşmede seçili model çalışmıyorsa (işlemci yetmedi) seçili satırda gerçekte çalışan gösterilir
  const fallback = useVoice((s) => s.noiseFallback);
  return (
    <>
      <MenuHeading>Gürültü Engelleme</MenuHeading>
      {NOISE_MODES.map((mode) => (
        <MenuRadioItem
          key={mode}
          label={NOISE_LABELS[mode]}
          hint={fallback && noise === mode ? `Şu an: ${fallbackLabel(fallback)}` : NOISE_HINTS[mode]}
          checked={noise === mode}
          onSelect={() => set({ noise: mode })}
        />
      ))}
      {isAiNoise(noise) && (
        <>
          <MenuSeparator />
          <MenuHeading>Engelleme Gücü</MenuHeading>
          {STRENGTHS.map((db) => (
            <MenuRadioItem
              key={db}
              label={NOISE_STRENGTH_LABELS[db]}
              checked={strength === db}
              onSelect={() => set({ noiseStrengthDb: db })}
            />
          ))}
        </>
      )}
    </>
  );
}

/** Ses kartındaki gürültü engelleme düğmesinin menüsü */
export function NoiseMenu({ open, anchorRef, onClose }: MenuProps) {
  return (
    <PanelMenu open={open} anchorRef={anchorRef} onClose={onClose} label="Gürültü engelleme" width={250} align="end">
      <NoiseMenuItems />
      <MenuSeparator />
      <VoiceSettingsItem />
    </PanelMenu>
  );
}

interface MenuProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

function DeviceItems({
  devices,
  value,
  onSelect,
}: {
  devices: AudioDevice[];
  value: string;
  onSelect: (deviceId: string) => void;
}) {
  const list = devices.length ? devices : [{ deviceId: 'default', label: 'Varsayılan' }];
  return (
    <>
      {list.map((d) => (
        <MenuRadioItem
          key={d.deviceId}
          label={d.deviceId === 'default' ? 'Varsayılan' : d.label}
          hint={d.deviceId === 'default' && d.label !== 'Varsayılan' ? stripDefaultPrefix(d.label) : undefined}
          checked={value === d.deviceId || (d.deviceId === 'default' && !list.some((x) => x.deviceId === value))}
          onSelect={() => onSelect(d.deviceId)}
        />
      ))}
    </>
  );
}

function VoiceSettingsItem() {
  const openModal = useUi((s) => s.openModal);
  return (
    <MenuItem
      label="Ses Ayarları"
      icon={<Settings size={16} className="ico-rotate" />}
      onSelect={() => openModal({ type: 'settings', section: 'voice' })}
    />
  );
}

const toPercent = (v: number): number => Math.round(v * 100);
const fromPercent = (p: number): number => Math.min(MAX_VOLUME, Math.max(0, p / 100));

/** Mikrofon düğmesinin yanındaki oktan açılan menü: giriş aygıtı, gürültü engelleme, giriş ses seviyesi */
export function MicMenu({ open, anchorRef, onClose }: MenuProps) {
  const { inputs } = useAudioDevices(open);
  const inputDeviceId = useSettings((s) => s.inputDeviceId);
  const inputVolume = useSettings((s) => s.inputVolume);
  const noise = useSettings((s) => s.noise);
  const strength = useSettings((s) => s.noiseStrengthDb);
  const set = useSettings((s) => s.set);
  const fallback = useVoice((s) => s.noiseFallback);
  return (
    <PanelMenu open={open} anchorRef={anchorRef} onClose={onClose} label="Mikrofon seçenekleri">
      <MenuSubmenu label="Giriş Cihazı" hint={deviceLabel(inputs, inputDeviceId)}>
        <DeviceItems devices={inputs} value={inputDeviceId} onSelect={(id) => set({ inputDeviceId: id })} />
      </MenuSubmenu>
      <MenuSubmenu label="Gürültü Engelleme" hint={noiseSummary(noise, strength, fallback)} width={250}>
        <NoiseMenuItems />
      </MenuSubmenu>
      <MenuSeparator />
      <MenuSlider
        label="Giriş ses seviyesi"
        value={toPercent(inputVolume)}
        max={toPercent(MAX_VOLUME)}
        onChange={(p) => set({ inputVolume: fromPercent(p) })}
      />
      <MenuSeparator />
      <VoiceSettingsItem />
    </PanelMenu>
  );
}

/** Kulaklık düğmesinin yanındaki oktan açılan menü: çıkış aygıtı ve çıkış ses seviyesi */
export function OutputMenu({ open, anchorRef, onClose }: MenuProps) {
  const { outputs } = useAudioDevices(open);
  const outputDeviceId = useSettings((s) => s.outputDeviceId);
  const outputVolume = useSettings((s) => s.outputVolume);
  const set = useSettings((s) => s.set);
  return (
    <PanelMenu open={open} anchorRef={anchorRef} onClose={onClose} label="Ses çıkışı seçenekleri">
      <MenuSubmenu label="Çıkış Cihazı" hint={deviceLabel(outputs, outputDeviceId)}>
        <DeviceItems devices={outputs} value={outputDeviceId} onSelect={(id) => set({ outputDeviceId: id })} />
      </MenuSubmenu>
      <MenuSeparator />
      <MenuSlider
        label="Çıkış ses seviyesi"
        value={toPercent(outputVolume)}
        max={toPercent(MAX_VOLUME)}
        onChange={(p) => set({ outputVolume: fromPercent(p) })}
      />
      <MenuSeparator />
      <VoiceSettingsItem />
    </PanelMenu>
  );
}
