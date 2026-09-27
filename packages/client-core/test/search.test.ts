import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EVERYONE_PERMISSIONS, Permission as P, type Channel, type GatewayServerMessage, type Role } from '@diskort/shared';
import {
  configureClient,
  gateway,
  onlineViewerCount,
  replaceLastWord,
  searchScopeKey,
  searchSuggestions,
  useGuild,
  useSession,
} from '../src';
import { profile, toReady, type TestUser } from './fixtures';

const role = (id: string, position: number, permissions: number): Role => ({
  id,
  name: id,
  color: null,
  position,
  hoist: false,
  permissions,
});

const user = (id: string, roles: string[] = [], extra: Partial<TestUser> = {}): TestUser => ({
  id,
  username: id,
  displayName: id === 'ali' ? 'Ali Işık' : id.toUpperCase(),
  avatarColor: '#fff',
  isAdmin: false,
  roles,
  removed: false,
  ...extra,
});

const channel = (id: string, overwrites: Channel['overwrites'] = []): Channel => ({
  id,
  guildId: 'g',
  name: id,
  type: 'text',
  position: 0,
  overwrites,
});

const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

beforeEach(async () => {
  const memory = new Map<string, string>();
  await configureClient({
    platform: 'desktop',
    version: '9.9.9',
    storage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    },
    serverUrl: () => 'http://sunucu.test',
    notifyError: () => undefined,
  });
  useSession.getState().setSession('jeton', profile(user('veli')));
  receive({
    t: 'READY',
    d: toReady({
      user: user('veli'),
      guild: { id: 'g', name: 'Test', ownerId: 'sahip' },
      channels: [channel('genel'), channel('gizli', [{ roleId: 'g', allow: 0, deny: P.VIEW_CHANNEL }, { roleId: 'dj', allow: P.VIEW_CHANNEL, deny: 0 }])],
      users: [user('sahip'), user('ali', ['dj']), user('veli'), user('eski', [], { removed: true })],
      roles: [role('dj', 1, 0), role('g', 0, DEFAULT_EVERYONE_PERMISSIONS)],
      voiceStates: [],
      online: ['sahip', 'ali', 'veli', 'eski'],
      lastMessageIds: {},
      readStates: {},
      mentionCounts: {},
      attachmentMaxBytes: 1,
    }),
  });
});

describe('arama', () => {
  it('çevrimiçi sayısı yalnızca kanalı görebilen üyeler', () => {
    const s = useGuild.getState();
    expect(onlineViewerCount(s, 'genel')).toBe(3);
    // Sahip her kanalı görür, ali dj rolüyle; veli göremez; eski üye sayılmaz
    expect(onlineViewerCount(s, 'gizli')).toBe(2);
  });

  it('işleç önerileri: from: üyeler (Türkçe harf duyarsız), in: kanallar, has: türler', () => {
    const s = useGuild.getState();
    expect(searchSuggestions('merhaba from:ali ISI', s, false)).toEqual([]);
    expect(searchSuggestions('merhaba from:', s, false).map((x) => x.key)).toEqual(['ali', 'sahip', 'veli']);
    expect(searchSuggestions('from:@ALI', s, false).map((x) => x.insert)).toEqual(['from:ali ']);
    expect(searchSuggestions('kimden:ali ı', s, false)).toEqual([]);
    expect(searchSuggestions('from:ali-isik', s, false)).toEqual([]);
    expect(searchSuggestions('in:#g', s, false).map((x) => x.label)).toEqual(['#genel', '#gizli']);
    expect(searchSuggestions('in:g', s, true)).toEqual([]);
    expect(searchSuggestions('has:r', s, true).map((x) => x.insert)).toEqual(['has:resim ']);
    expect(replaceLastWord('kitap from:al', 'from:ali ')).toBe('kitap from:ali ');
  });

  it('kapsam anahtarı', () => {
    expect(searchScopeKey({ guildId: 'g' })).toBe('g:g:');
    expect(searchScopeKey({ dmId: 'd' })).toBe('dm:d');
    expect(searchScopeKey(null)).toBe('');
  });
});
