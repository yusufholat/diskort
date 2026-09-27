import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureClient, gateway, useGuild, useSession, type KeyValueStorage } from '../src';

const memory = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

const me = { id: 'u1', username: 'ayse', displayName: 'Ayşe', avatarColor: '#fff', isAdmin: false, roles: [], removed: false };

/** Açılan bağlantıları kaydeden sahte WebSocket */
class FakeSocket {
  static OPEN = 1;
  static opened: FakeSocket[] = [];
  readyState = 0;
  closed = false;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }
  send(): void {}
  close(code = 1000): void {
    this.closed = true;
    this.onclose?.({ code });
  }
}

beforeEach(async () => {
  FakeSocket.opened = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  await configureClient({
    platform: 'android',
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
  vi.useRealTimers();
});

describe('gateway bağlantısı', () => {
  it('zaten bağlıyken yeniden connect() çağrılınca çalışan bağlantı bozulmaz, ikinci bağlantı açılmaz', () => {
    gateway.connect();
    expect(FakeSocket.opened).toHaveLength(1);
    useGuild.setState({ status: 'ready' });

    // Telefonda Android ekranı yeniden kuruldu: kök yerleşim baştan çizilir ve yine connect() çağırır
    gateway.connect();
    gateway.resume();
    expect(FakeSocket.opened).toHaveLength(1);
    expect(FakeSocket.opened[0]!.closed).toBe(false);
    expect(useGuild.getState().status).toBe('ready');
  });

  it('kopmuş bağlantıyı beklemeden yeniden açar; oturum kapanınca kapatır', () => {
    vi.useFakeTimers();
    gateway.connect();
    FakeSocket.opened[0]!.close(4000);
    // Yeniden bağlanma zamanlayıcısı beklerken connect()/resume() hemen bağlanır
    gateway.connect();
    expect(FakeSocket.opened).toHaveLength(2);
    // Bekleyen zamanlayıcı ikinci bir bağlantı açmaz
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.opened).toHaveLength(2);

    gateway.disconnect();
    expect(FakeSocket.opened[1]!.closed).toBe(true);
    // Çıkıştan sonra yeniden giriş: yeni bağlantı
    gateway.connect();
    expect(FakeSocket.opened).toHaveLength(3);
  });
});
