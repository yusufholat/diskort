// DM aramalarının telefondaki saf kuralları (src/calls.ts): hangi arama sesinin döngüyle çalacağı, sohbetteki
// arama kaydı satırının metni ve ses ekranındaki "aramada değil" listesi.

import { describe, expect, it } from 'vitest';
import type { DmCall, Message } from '@diskort/shared';
import { absentParticipants, callRecordView, callSoundFor } from '../src/calls';

const call = (ringing: string[], startedBy = 'a'): DmCall => ({
  channelId: 'dm1',
  startedBy,
  startedAt: 1_000,
  ringing,
  messageId: 'm1',
});

describe('callSoundFor', () => {
  const base = { incoming: 0, appActive: true, myCall: undefined, othersInCall: 0, selfId: 'me' };

  it('sesiz: arama yok', () => {
    expect(callSoundFor(base)).toBeNull();
  });

  it('gelen arama varken ve uygulama öndeyken zil', () => {
    expect(callSoundFor({ ...base, incoming: 1 })).toBe('ring');
  });

  it('uygulama arkadayken zil çalmaz (telefon bildirimi var)', () => {
    expect(callSoundFor({ ...base, incoming: 2, appActive: false })).toBeNull();
  });

  it('sen arıyorsun, odada kimse yok, çalınan var: bekleme sesi', () => {
    expect(callSoundFor({ ...base, myCall: call(['b']) })).toBe('ringback');
  });

  it('bekleme sesi uygulama arkadayken de sürer', () => {
    expect(callSoundFor({ ...base, appActive: false, myCall: call(['b']) })).toBe('ringback');
  });

  it('biri katılınca bekleme sesi durur', () => {
    expect(callSoundFor({ ...base, myCall: call(['c']), othersInCall: 1 })).toBeNull();
  });

  it('çalınan kalmadıysa (reddetti, süre doldu) bekleme sesi durur', () => {
    expect(callSoundFor({ ...base, myCall: call([]) })).toBeNull();
    // Yalnızca kendin çalınıyorsan (eski durum) bekleme sesi yok
    expect(callSoundFor({ ...base, myCall: call(['me']) })).toBeNull();
  });

  it('aramadayken başka bir konuşmadan gelen arama: zil önce gelir', () => {
    expect(callSoundFor({ ...base, incoming: 1, myCall: call(['b']) })).toBe('ring');
  });
});

describe('callRecordView', () => {
  const msg = (over: Partial<Message>): Pick<Message, 'type' | 'call' | 'createdAt' | 'authorId' | 'content'> => ({
    type: 'call',
    call: { participantIds: ['a', 'b'], endedAt: 1_000 + 12 * 60_000 },
    createdAt: 1_000,
    authorId: 'a',
    content: '📞 Arama başlattı.',
    ...over,
  });

  it('biten arama: başlatanın adı ve süresi', () => {
    expect(callRecordView(msg({}), 'Ali', 'me')).toEqual({
      text: 'Ali arama başlattı',
      detail: '12 dk',
      missed: false,
      live: false,
    });
  });

  it('kendi araman: "Arama başlattın"', () => {
    expect(callRecordView(msg({ authorId: 'me' }), 'Ben', 'me').text).toBe('Arama başlattın');
  });

  it('cevapsız arama: başkasınınsa arayanın adı, kendininse ad yok', () => {
    const missed = msg({ call: { participantIds: ['a'], endedAt: 31_000 } });
    expect(callRecordView(missed, 'Ali', 'me')).toEqual({ text: 'Cevapsız arama', detail: 'Ali', missed: true, live: false });
    expect(callRecordView({ ...missed, authorId: 'me' }, 'Ben', 'me').detail).toBeNull();
  });

  it('süren arama: "sürüyor"', () => {
    const view = callRecordView(msg({ call: { participantIds: ['a'], endedAt: null } }), 'Ali', 'me');
    expect(view).toEqual({ text: 'Ali arama başlattı', detail: 'sürüyor', missed: false, live: true });
  });

  it('yeniden açılan kayıt (arayan 30 sn içinde yeniden aradı: MESSAGE_UPDATE endedAt null) yeniden sürüyor görünür', () => {
    const missed = msg({ call: { participantIds: ['a'], endedAt: 20_000 } });
    expect(callRecordView(missed, 'Ali', 'me').missed).toBe(true);
    const reopened = { ...missed, call: { participantIds: ['a'], endedAt: null } };
    expect(callRecordView(reopened, 'Ali', 'me')).toEqual({ text: 'Ali arama başlattı', detail: 'sürüyor', missed: false, live: true });
    // Sonra biri katılıp biterse süresi baştan (kaydın createdAt'inden) sayılır
    const ended = { ...missed, call: { participantIds: ['a', 'me'], endedAt: 1_000 + 5 * 60_000 } };
    expect(callRecordView(ended, 'Ali', 'me')).toMatchObject({ detail: '5 dk', missed: false, live: false });
  });

  it('silinmiş yazar', () => {
    expect(callRecordView(msg({ authorId: null }), undefined, 'me').text).toBe('Silinmiş Kullanıcı arama başlattı');
  });

  it('arama bilgisi yoksa içerik metni (telefon simgesi atılır)', () => {
    expect(callRecordView(msg({ call: null }), 'Ali', 'me')).toEqual({
      text: 'Arama başlattı.',
      detail: null,
      missed: false,
      live: false,
    });
  });
});

describe('absentParticipants', () => {
  it('aramada olmayanlar, sen hariç; çalınanlar önce', () => {
    expect(absentParticipants(['me', 'a', 'b', 'c'], ['me', 'a'], call(['c']), 'me')).toEqual([
      { userId: 'c', ringing: true },
      { userId: 'b', ringing: false },
    ]);
  });

  it('herkes aramadaysa boş', () => {
    expect(absentParticipants(['me', 'a'], ['a', 'me'], call([]), 'me')).toEqual([]);
  });

  it('arama bilgisi yoksa kimse çalınmıyor sayılır', () => {
    expect(absentParticipants(['me', 'a'], ['me'], undefined, 'me')).toEqual([{ userId: 'a', ringing: false }]);
  });
});
