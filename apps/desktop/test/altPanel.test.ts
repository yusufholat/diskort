import { describe, expect, it } from 'vitest';
import { formatElapsed } from '../src/renderer/src/components/sidebar/ElapsedTime.js';
import { deviceLabel, stripDefaultPrefix } from '../src/renderer/src/lib/audioDevices.js';

describe('formatElapsed', () => {
  it('dakika:saniye, bir saati geçince saat:dakika:saniye', () => {
    expect(formatElapsed(28_000)).toBe('0:28');
    expect(formatElapsed(65_400)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });
  it('saat farkından eksiye düşmez', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});

describe('ses aygıtı adları', () => {
  const devices = [
    { deviceId: 'default', label: 'Default - Mikrofon (Realtek)' },
    { deviceId: 'abc', label: 'USB Mikrofon' },
  ];
  it('seçili aygıtın adı; bilinmeyen ya da varsayılan aygıtta "Varsayılan"', () => {
    expect(deviceLabel(devices, 'abc')).toBe('USB Mikrofon');
    expect(deviceLabel(devices, 'default')).toBe('Varsayılan');
    expect(deviceLabel(devices, 'çıkarılmış')).toBe('Varsayılan');
  });
  it('Chromium\'un "Default - " önekini atar', () => {
    expect(stripDefaultPrefix('Default - Mikrofon (Realtek)')).toBe('Mikrofon (Realtek)');
  });
});
