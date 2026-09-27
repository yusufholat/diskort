import { beforeEach, describe, expect, it } from 'vitest';
import type { Embed, GatewayServerMessage, LinkEmbed, Message } from '@diskort/shared';
import {
  configureClient,
  embedColor,
  embedHost,
  embedMediaUrl,
  gateway,
  gifOf,
  useMessages,
  useSession,
  visibleLinkEmbeds,
  youtubePlayerUrl,
} from '../src';

const memory = new Map<string, string>();
const me = { id: 'u1', username: 'ayse', displayName: 'Ayşe', avatarColor: '#fff', isAdmin: false };
const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

const link = (overrides: Partial<LinkEmbed> = {}): LinkEmbed => ({
  type: 'link',
  kind: 'article',
  url: 'https://www.ornek.com/yazi',
  siteName: 'Örnek',
  title: 'Başlık',
  description: null,
  author: null,
  color: '#abcdef',
  image: { url: `/api/embed-media/${'a'.repeat(32)}/aHR0cHM6Ly9vcm5law`, width: 100, height: 50 },
  largeImage: false,
  ...overrides,
});

const message = (embeds: Embed[], extra: Partial<Message> = {}): Message => ({
  id: '1',
  channelId: 'c1',
  authorId: 'u1',
  content: 'https://www.ornek.com/yazi',
  createdAt: 1,
  editedAt: null,
  attachments: [],
  reactions: [],
  embeds,
  mentionEveryone: false,
  ...extra,
});

beforeEach(async () => {
  memory.clear();
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
  useSession.getState().setSession('jeton', me);
  useMessages.setState({ channels: { c1: { messages: [], hasMore: false, loading: false, loaded: true } }, pendingFiles: {} });
});

describe('bağlantı önizlemeleri', () => {
  it('kaldırılmış ya da bozuk önizlemeler gösterilmez; GIF sayılmaz', () => {
    const good = link();
    const bad = link({ url: 'javascript:alert(1)' });
    const badYoutube = link({ kind: 'youtube', youtubeId: '"><script>' });
    expect(visibleLinkEmbeds(message([good, bad, badYoutube]))).toEqual([good]);
    expect(visibleLinkEmbeds(message([good], { suppressEmbeds: true }))).toEqual([]);
    expect(gifOf(message([good]))).toBeNull();
  });

  it('resim yalnızca sunucumuzdan; YouTube çerezsiz alan adından oynar', () => {
    expect(embedMediaUrl(link().image)).toBe(`http://sunucu.test/api/embed-media/${'a'.repeat(32)}/aHR0cHM6Ly9vcm5law`);
    expect(embedMediaUrl({ url: 'https://baska.com/x.png', width: 1, height: 1 })).toBeNull();
    expect(youtubePlayerUrl({ youtubeId: 'dQw4w9WgXcQ', youtubeStart: 42 })).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=42',
    );
    expect(youtubePlayerUrl({ youtubeId: 'kötü', youtubeStart: null })).toBeNull();
    expect(embedHost('https://www.Ornek.com:8080/a')).toBe('ornek.com');
    expect(embedColor(link({ color: 'red' }))).toBeNull();
  });

  it('MESSAGE_UPDATE önizlemeleri ekrandaki mesaja ekler', () => {
    const original = message([]);
    useMessages.setState({ channels: { c1: { messages: [original], hasMore: false, loading: false, loaded: true } } });
    const { reactions: _r, ...update } = message([link()]);
    receive({ t: 'MESSAGE_UPDATE', d: update });
    expect(visibleLinkEmbeds(useMessages.getState().channels.c1!.messages[0]!)).toHaveLength(1);
  });
});
