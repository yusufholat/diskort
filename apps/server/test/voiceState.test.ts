import { describe, expect, it } from 'vitest';
import { VoiceStateStore } from '../src/voiceState.js';

describe('ses durumu', () => {
  it('aynı hesap aynı kanala başka cihazdan girince eski oturumun ayrılması yok sayılır', () => {
    const voice = new VoiceStateStore();
    const deleted: string[] = [];
    voice.on('delete', (d) => deleted.push(d.userId));

    voice.join('u1', 'c1', false, 'PA_telefon');
    // Bilgisayardan aynı kanala: LiveKit önce yeni oturumu açar, sonra eskisini kapatır
    voice.join('u1', 'c1', false, 'PA_bilgisayar');
    expect(voice.leave('u1', 'c1', 'PA_telefon')).toBe(false);
    expect(voice.get('u1')?.channelId).toBe('c1');
    expect(deleted).toEqual([]);

    // Güncel oturum ayrılınca çıkar
    expect(voice.leave('u1', 'c1', 'PA_bilgisayar')).toBe(true);
    expect(voice.get('u1')).toBeUndefined();
  });

  it('oturum kimliği bilinmiyorsa (sunucu yeniden başladı) ayrılma kabul edilir', () => {
    const voice = new VoiceStateStore();
    voice.join('u1', 'c1');
    expect(voice.leave('u1', 'c1', 'PA_herhangi')).toBe(true);
  });

  it('başka kanaldan gelen geç ayrılma bildirimi yok sayılır', () => {
    const voice = new VoiceStateStore();
    voice.join('u1', 'c1', false, 'PA_1');
    voice.join('u1', 'c2', false, 'PA_2');
    expect(voice.leave('u1', 'c1', 'PA_1')).toBe(false);
    expect(voice.get('u1')?.channelId).toBe('c2');
  });
});
