import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_TRACE_PENDING_MAX_MS, type VoiceTraceUpload } from '@diskort/shared';
import { configureClient, type KeyValueStorage } from '../src';
import { ServerClock } from '../src/serverClock';
import { useSession } from '../src/session';
import type { TraceCapture } from '../src/voiceTrace';
import { VoiceTraceUploader } from '../src/voiceTraceUpload';

const memory = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

const capture = (id = 'kesit-1'): TraceCapture => ({
  id,
  channelId: 'kanal',
  reason: 'stun',
  reasons: ['stun'],
  eventId: null,
  triggerAt: 1_000,
  more: false,
  intervalMs: 1000,
  samples: [{ q: 1, t: 1_000, dt: 1000, x: null, up: [] }],
  marks: [],
});

/** Sunucu saati istemciden bu kadar ileride */
const SERVER_AHEAD_MS = 4_200;

let fetchMock: ReturnType<typeof vi.fn>;
/** /api/telemetry/voice-trace yanıtları sırayla (bitince 204) */
let traceReplies: (Response | Error)[];
let timeStatus = 200;

const uploads = (): VoiceTraceUpload[] =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).endsWith('/api/telemetry/voice-trace'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string) as VoiceTraceUpload);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  memory.clear();
  traceReplies = [];
  timeStatus = 200;
  await configureClient({
    platform: 'desktop',
    version: '0.9.3',
    storage,
    serverUrl: () => 'http://sunucu.test',
    notifyError: () => undefined,
  });
  useSession.getState().setSession('jeton', { id: 'u1', username: 'ben', displayName: 'Ben', avatarColor: '#fff', avatarUrl: null, isAdmin: false });
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/time')) {
      if (timeStatus !== 200) return new Response(null, { status: timeStatus });
      return new Response(JSON.stringify({ now: Date.now() + SERVER_AHEAD_MS }), { status: 200 });
    }
    const reply = traceReplies.shift() ?? new Response(null, { status: 204 });
    if (reply instanceof Error) throw reply;
    return reply;
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('olay kaydı gönderimi', () => {
  it('kesit, gönderim anı ve ölçülen saat farkıyla gönderilir', async () => {
    const up = new VoiceTraceUploader(new ServerClock());
    up.enqueue(capture());
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0]).toMatchObject({
      v: 1,
      id: 'kesit-1',
      platform: 'desktop',
      version: '0.9.3',
      channelId: 'kanal',
      reason: 'stun',
      attempt: 1,
      sentAt: 1_700_000_000_000,
      offsetMs: SERVER_AHEAD_MS,
    });
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/voice-trace'))!;
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jeton' });
    expect(up.pending).toBe(0);
  });

  it('sunucuya ulaşılamazsa bellekte tutulur ve aralıklarla yeniden denenir; ulaşınca gider', async () => {
    traceReplies = [new TypeError('ağ yok'), new Response(null, { status: 503 }), new Response(null, { status: 429 })];
    const up = new VoiceTraceUploader(new ServerClock());
    up.enqueue(capture());
    await vi.advanceTimersByTimeAsync(0);
    expect(up.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(up.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(up.pending).toBe(0);
    const sent = uploads();
    expect(sent.map((u) => u.attempt)).toEqual([1, 2, 3, 4]);
    // Aynı kesit (aynı kimlik), her denemede güncel gönderim anı
    expect(new Set(sent.map((u) => u.id)).size).toBe(1);
    expect(sent[3]!.sentAt - sent[0]!.sentAt).toBe(17_000);
  });

  it('5 dakikayı geçen kesit atılır', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('ağ yok');
    });
    const up = new VoiceTraceUploader(new ServerClock());
    up.enqueue(capture());
    await vi.advanceTimersByTimeAsync(VOICE_TRACE_PENDING_MAX_MS + 60_000);
    expect(up.pending).toBe(0);
    const attempts = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/voice-trace')).length;
    expect(attempts).toBeGreaterThan(5);
    expect(attempts).toBeLessThan(20);
  });

  it('eski sunucu (404) desteklemiyorsa bir daha denenmez; geçersiz gövde (400) yeniden denenmez', async () => {
    traceReplies = [new Response(null, { status: 400 })];
    const up = new VoiceTraceUploader(new ServerClock());
    up.enqueue(capture('a'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(uploads()).toHaveLength(1);
    expect(up.pending).toBe(0);

    traceReplies = [new Response(null, { status: 404 })];
    up.enqueue(capture('b'));
    up.enqueue(capture('c'));
    await vi.advanceTimersByTimeAsync(60_000);
    up.enqueue(capture('d'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(uploads().map((u) => u.id)).toEqual(['a', 'b']);
    expect(up.pending).toBe(0);
  });

  it('saat farkı ölçülemiyorsa (eski sunucu) fark null gider; sunucu gönderim anından tahmin eder', async () => {
    timeStatus = 404;
    const clock = new ServerClock();
    const up = new VoiceTraceUploader(clock);
    up.enqueue(capture());
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads()[0]!.offsetMs).toBeNull();
    // Desteklenmeyen uç bir daha sorulmaz
    up.enqueue(capture('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/time'))).toHaveLength(1);
  });

  it('bekleyen kesit, bu arada başka hesapla giriş yapıldıysa o hesabın adına gönderilmez', async () => {
    traceReplies = [new TypeError('ağ yok')];
    const up = new VoiceTraceUploader(new ServerClock());
    up.enqueue(capture('benim'));
    await vi.advanceTimersByTimeAsync(0);
    expect(up.pending).toBe(1);
    // Çıkış yapıldı: beklenir (gönderilmez)
    useSession.getState().logout();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(uploads()).toHaveLength(1);
    expect(up.pending).toBe(1);
    // Başka hesap girdi: kesit atılır
    useSession.getState().setSession('baska-jeton', { id: 'u2', username: 'o', displayName: 'O', avatarColor: '#fff', avatarUrl: null, isAdmin: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(uploads()).toHaveLength(1);
    expect(up.pending).toBe(0);
    // Yeni hesabın kendi kesiti gider
    up.enqueue(capture('onun'));
    await vi.advanceTimersByTimeAsync(0);
    const last = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/voice-trace')).at(-1)!;
    expect((last[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer baska-jeton' });
    expect(uploads().map((u) => u.id)).toEqual(['benim', 'onun']);
  });

  it('aynı hesap yeniden giriş yaparsa bekleyen kesit gider; oturum yokken alınan kesit kuyruğa girmez', async () => {
    traceReplies = [new TypeError('ağ yok')];
    const up = new VoiceTraceUploader(new ServerClock());
    up.enqueue(capture('benim'));
    await vi.advanceTimersByTimeAsync(0);
    useSession.getState().logout();
    useSession.getState().setSession('yeni-jeton', { id: 'u1', username: 'ben', displayName: 'Ben', avatarColor: '#fff', avatarUrl: null, isAdmin: false });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(uploads().map((u) => u.attempt)).toEqual([1, 2]);
    expect(up.pending).toBe(0);

    useSession.getState().logout();
    up.enqueue(capture('sahipsiz'));
    expect(up.pending).toBe(0);
  });

  it('bağlantı geri gelince (kick) bekleyen kesit beklemeden denenir', async () => {
    traceReplies = [new TypeError('ağ yok'), new TypeError('ağ yok'), new TypeError('ağ yok')];
    const up = new VoiceTraceUploader(new ServerClock());
    up.enqueue(capture());
    await vi.advanceTimersByTimeAsync(7_000);
    expect(uploads()).toHaveLength(3);
    expect(up.pending).toBe(1);
    up.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads()).toHaveLength(4);
    expect(up.pending).toBe(0);
  });
});

describe('saat farkı', () => {
  it('gidiş-dönüşün ortasına göre hesaplanır ve 10 dakikada birden sık ölçülmez', async () => {
    const clock = new ServerClock();
    expect(clock.offsetMs).toBeNull();
    await clock.refresh();
    expect(clock.offsetMs).toBe(SERVER_AHEAD_MS);
    await clock.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await clock.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
