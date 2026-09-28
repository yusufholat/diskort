import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayClientMessage, ReadyPayload, VoiceState } from '@diskort/shared';
import { configureClient, gateway, streamViewers, useGuild, useSession, type KeyValueStorage } from '../src';
import { toReady } from './fixtures';

const vs = (userId: string, channelId: string, extra: Partial<VoiceState> = {}): VoiceState => ({
  userId,
  channelId,
  selfMute: false,
  selfDeaf: false,
  serverMute: false,
  serverDeaf: false,
  streaming: false,
  joinedAt: 0,
  ...extra,
});

const index = (...states: VoiceState[]): Record<string, VoiceState> =>
  Object.fromEntries(states.map((s) => [s.userId, s]));

describe('yayın izleyicileri', () => {
  it('aynı kanalda yayını izleyenler katılma sırasıyla; yayıncı kendisi sayılmaz', () => {
    const states = index(
      vs('yayinci', 'c1', { streaming: true, watching: ['yayinci'] }),
      vs('b', 'c1', { joinedAt: 2, watching: ['yayinci'] }),
      vs('a', 'c1', { joinedAt: 1, watching: ['baska', 'yayinci'] }),
      vs('c', 'c1', { joinedAt: 3 }),
      // Eski/başka kanaldaki bir durum yanlışlıkla işaret etse de sayılmaz
      vs('d', 'c2', { watching: ['yayinci'] }),
    );
    expect(streamViewers(states, 'yayinci')).toEqual(['a', 'b']);
  });

  it('yayın yoksa ya da yayıncı seste değilse izleyici yok', () => {
    expect(streamViewers(index(vs('y', 'c1'), vs('a', 'c1', { watching: ['y'] })), 'y')).toEqual([]);
    expect(streamViewers(index(vs('a', 'c1', { watching: ['y'] })), 'y')).toEqual([]);
  });

  it('VOICE_STATE_UPDATE ile gelen izleme listesi durumda tutulur', () => {
    useGuild.setState({ voiceStates: index(vs('y', 'c1', { streaming: true }), vs('a', 'c1')) });
    useGuild.getState().apply({ t: 'VOICE_STATE_UPDATE', d: vs('a', 'c1', { watching: ['y'] }) });
    expect(streamViewers(useGuild.getState().voiceStates, 'y')).toEqual(['a']);
    useGuild.getState().apply({ t: 'VOICE_STATE_UPDATE', d: vs('a', 'c1') });
    expect(streamViewers(useGuild.getState().voiceStates, 'y')).toEqual([]);
  });
});

describe('izleme bildirimi (gateway)', () => {
  const memory = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  };
  const me = { id: 'ben', username: 'ben', displayName: 'Ben', avatarColor: '#fff', isAdmin: false };

  class FakeSocket {
    static OPEN = 1;
    static opened: FakeSocket[] = [];
    readyState = 0;
    sent: GatewayClientMessage[] = [];
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    constructor(readonly url: string) {
      FakeSocket.opened.push(this);
    }
    send(data: string): void {
      this.sent.push(JSON.parse(data) as GatewayClientMessage);
    }
    close(code = 1000): void {
      this.onclose?.({ code });
    }
    receive(msg: object): void {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
    watches(): string[][] {
      return this.sent.flatMap((m) => (m.t === 'STREAM_WATCH_SET' ? [m.d.userIds] : []));
    }
  }

  const ready = (): ReadyPayload =>
    toReady({
      user: me,
      guild: { id: 'g', name: 'G', ownerId: 'ben' },
      channels: [],
      users: [me],
      roles: [],
      voiceStates: [],
      online: [],
      lastMessageIds: {},
      readStates: {},
      mentionCounts: {},
      attachmentMaxBytes: 1,
    });

  const open = (): FakeSocket => {
    gateway.connect();
    const ws = FakeSocket.opened.at(-1)!;
    ws.readyState = FakeSocket.OPEN;
    ws.receive({ t: 'HELLO', d: { heartbeatInterval: 60_000 } });
    ws.receive({ t: 'READY', d: ready() });
    return ws;
  };

  beforeEach(async () => {
    FakeSocket.opened = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    await configureClient({
      platform: 'desktop',
      version: '9.9.9',
      storage,
      serverUrl: () => 'http://sunucu.test',
      notifyError: () => undefined,
      upload: async () => ({ status: 0, body: '' }),
    });
    useSession.getState().setSession('jeton', me);
  });

  afterEach(() => {
    gateway.disconnect();
    vi.unstubAllGlobals();
  });

  it('yalnızca değişince gönderir; yeniden bağlanınca boş değilse yeniden bildirir', () => {
    const first = open();
    expect(first.watches()).toEqual([]);
    gateway.setWatching(['b', 'a', 'a']);
    gateway.setWatching(['a', 'b']);
    expect(first.watches()).toEqual([['a', 'b']]);

    first.close(4000);
    gateway.connect();
    const second = FakeSocket.opened.at(-1)!;
    second.readyState = FakeSocket.OPEN;
    second.receive({ t: 'HELLO', d: { heartbeatInterval: 60_000 } });
    second.receive({ t: 'READY', d: ready() });
    expect(second.watches()).toEqual([['a', 'b']]);

    gateway.setWatching([]);
    expect(second.watches()).toEqual([['a', 'b'], []]);
  });

  it('izleme yokken yeniden bağlanınca bir şey göndermez (sesteki başka cihazın listesini ezmez)', () => {
    const ws = open();
    expect(ws.watches()).toEqual([]);
  });
});
