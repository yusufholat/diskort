import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayServerMessage, User } from '@diskort/shared';
import {
  ApiError,
  avatarUrl,
  configureClient,
  gateway,
  removeAvatar,
  uploadAvatar,
  useGuild,
  useSession,
  type KeyValueStorage,
  type UploadRequest,
  type UploadResponse,
} from '../src';

const memory = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

let uploadImpl: (req: UploadRequest) => Promise<UploadResponse> = async () => ({ status: 0, body: '' });

const me: User = {
  id: 'u1',
  username: 'ayse',
  displayName: 'Ayşe',
  avatarColor: '#fff',
  isAdmin: false,
  roles: [],
  removed: false,
};
const withPhoto: User = { ...me, avatarUrl: '/api/avatars/u1/0123456789abcdef0123456789abcdef.webp' };

const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

beforeEach(async () => {
  memory.clear();
  await configureClient({
    platform: 'android',
    version: '9.9.9',
    storage,
    serverUrl: () => 'sunucu.test/',
    notifyError: () => undefined,
    upload: (req) => uploadImpl(req),
  });
  useSession.getState().setSession('jeton', me);
  useGuild.setState({ users: { u1: me } });
});

describe('profil fotoğrafı', () => {
  it('adres sunucu adresiyle tamamlanır; fotoğraf yoksa ya da eski sunucuda null', () => {
    expect(avatarUrl(withPhoto)).toBe('http://sunucu.test/api/avatars/u1/0123456789abcdef0123456789abcdef.webp');
    expect(avatarUrl({ avatarUrl: null })).toBeNull();
    expect(avatarUrl(me)).toBeNull();
    expect(avatarUrl(undefined)).toBeNull();
  });

  it('yükleme ham gövdeyle gider, dönen kullanıcı oturuma ve üye listesine yazılır', async () => {
    const requests: UploadRequest[] = [];
    uploadImpl = async (req) => {
      requests.push(req);
      return { status: 200, body: JSON.stringify(withPhoto) };
    };
    const user = await uploadAvatar({ name: 'kare.jpg', size: 1234, type: 'image/jpeg', uri: 'file:///kare.jpg' });
    expect(user).toEqual(withPhoto);
    expect(requests[0]).toMatchObject({
      url: 'http://sunucu.test/api/me/avatar',
      headers: { Authorization: 'Bearer jeton', 'Content-Type': 'image/jpeg' },
    });
    expect(useSession.getState().user).toEqual(withPhoto);
    expect(useGuild.getState().users.u1).toEqual(withPhoto);
  });

  it('sunucu hatası iletilir; sınırı aşan dosya hiç gönderilmez', async () => {
    uploadImpl = async () => ({
      status: 415,
      body: JSON.stringify({ error: 'unsupported_type', message: 'Yalnızca PNG, JPEG, WebP ya da GIF resim yüklenebilir.' }),
    });
    await expect(uploadAvatar({ name: 'a.txt', size: 3, type: 'text/plain', uri: 'file:///a.txt' })).rejects.toMatchObject({
      status: 415,
      message: 'Yalnızca PNG, JPEG, WebP ya da GIF resim yüklenebilir.',
    });

    const send = vi.fn(uploadImpl);
    uploadImpl = send;
    const big = uploadAvatar({ name: 'dev.png', size: 9 * 1024 * 1024, type: 'image/png', uri: 'file:///dev.png' });
    await expect(big).rejects.toBeInstanceOf(ApiError);
    await expect(big).rejects.toMatchObject({ status: 413, message: 'Resim çok büyük (en fazla 8 MB).' });
    expect(send).not.toHaveBeenCalled();
    expect(useSession.getState().user).toEqual(me);
  });

  it('kaldırma DELETE ile gider ve oturumu günceller', async () => {
    useSession.getState().setUser(withPhoto);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...me, avatarUrl: null }), { status: 200 })));
    await removeAvatar();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect([url, init!.method]).toEqual(['http://sunucu.test/api/me/avatar', 'DELETE']);
    expect(useSession.getState().user?.avatarUrl).toBeNull();
    expect(useGuild.getState().users.u1?.avatarUrl).toBeNull();
  });

  it('başka cihazdaki değişiklik USER_UPDATE ile oturuma ve listeye gelir', () => {
    receive({ t: 'USER_UPDATE', d: withPhoto });
    expect(useSession.getState().user?.avatarUrl).toBe(withPhoto.avatarUrl);
    expect(useGuild.getState().users.u1?.avatarUrl).toBe(withPhoto.avatarUrl);
  });
});
