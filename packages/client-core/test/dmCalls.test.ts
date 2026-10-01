import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callMessageText,
  DM_CALL_RING_MS,
  DM_PERMISSIONS,
  formatCallDuration,
  isMissedCall,
  Permission as P,
  type DmCall,
  type DmChannel,
  type GatewayServerMessage,
  type Message,
  type ReadyPayload,
} from '@diskort/shared';
import {
  blockUser,
  callMembers,
  guildVoiceActivity,
  guildVoiceStateOf,
  isDmVoiceChannel,
  isGuildVoiceChannel,
  memberActions,
  voiceDropTargets,
  voiceStateIn,
  canCallDm,
  configureClient,
  declineDmCall,
  DM_CALL_RING_GRACE_MS,
  dmBlockedReason,
  gateway,
  incomingCalls,
  isBlocked,
  isRingingMe,
  permissionsOf,
  unblockUser,
  useGuild,
  useMessages,
  useSession,
} from '../src';
import { toReady, type TestUser } from './fixtures';

// İstemci çekirdeği: DM aramalarının ve engellerin durumu (READY, olaylar), seçiciler, yetkiler ve işlemler.

const user = (id: string): TestUser => ({ id, username: id, displayName: id.toUpperCase(), avatarColor: '#fff', isAdmin: false });

const dm = (id: string, participantIds: string[], extra: Partial<DmChannel> = {}): DmChannel => ({
  id,
  participantIds,
  group: participantIds.length > 2,
  name: null,
  ownerId: null,
  createdAt: 1,
  lastMessageId: null,
  lastActivityAt: 1,
  ...extra,
});

const call = (channelId: string, ringing: string[], extra: Partial<DmCall> = {}): DmCall => ({
  channelId,
  startedBy: 'ali',
  startedAt: 100,
  ringing,
  messageId: '7',
  ...extra,
});

const receive = (msg: GatewayServerMessage): void =>
  (gateway as unknown as { handle: (m: GatewayServerMessage, t: string) => void }).handle(msg, 'jeton');

const ready = (extra: Partial<ReadyPayload> = {}): ReadyPayload => ({
  ...toReady({
    user: user('ben'),
    guild: { id: 'g', name: 'G', ownerId: 'sahip' },
    channels: [{ id: 'genel', guildId: 'g', name: 'genel', type: 'text', position: 0, overwrites: [] }],
    users: [user('ben'), user('ali'), user('veli'), user('sahip')],
    roles: [{ id: 'g', name: '@everyone', color: null, position: 0, hoist: false, permissions: P.VIEW_CHANNEL }],
    voiceStates: [],
    online: [],
    lastMessageIds: {},
    readStates: {},
    mentionCounts: {},
    attachmentMaxBytes: 1,
    dms: [dm('d1', ['ben', 'ali']), dm('d2', ['ben', 'ali', 'veli'])],
  }),
  ...extra,
});

const directs: Message[] = [];
const errors: string[] = [];

beforeEach(async () => {
  directs.length = 0;
  errors.length = 0;
  await configureClient({
    platform: 'desktop',
    version: '9.9.9',
    storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    serverUrl: () => 'http://sunucu.test',
    notifyError: (m) => void errors.push(m),
    onDirectMessage: (m) => void directs.push(m),
  });
  useSession.getState().setSession('jeton', user('ben'));
  useMessages.setState({ channels: {}, mentionCounts: {}, pendingFiles: {} });
  receive({ t: 'READY', d: ready({ dmCalls: [call('d2', ['veli'])], blockedUserIds: ['sahip'] }) });
});

describe('DM aramaları (istemci)', () => {
  it("READY'deki aramalar ve engeller depoya gelir; eski sunucuda alanlar yoksa boş", () => {
    const s = useGuild.getState();
    expect(s.dmCalls).toEqual({ d2: call('d2', ['veli']) });
    expect(s.blockedIds).toEqual({ sahip: true });
    receive({ t: 'READY', d: ready() });
    expect(useGuild.getState().dmCalls).toEqual({});
    expect(useGuild.getState().blockedIds).toEqual({});
  });

  it('DM_CALL_UPDATE / DELETE: gelen aramalar seçicisi, kendi aramandaki konuşma hariç', () => {
    receive({ t: 'DM_CALL_UPDATE', d: call('d1', ['ben'], { startedAt: 200 }) });
    receive({ t: 'DM_CALL_UPDATE', d: call('d2', ['veli', 'ben'], { startedAt: 150 }) });
    let s = useGuild.getState();
    expect(incomingCalls(s, 'ben').map((c) => c.channelId)).toEqual(['d1', 'd2']);
    expect(isRingingMe(s.dmCalls.d1, 'ben')).toBe(true);
    expect(isRingingMe(s.dmCalls.d1, 'veli')).toBe(false);
    expect(incomingCalls(s, undefined)).toEqual([]);

    // d2 aramasına katıldın (sunucu çalmayı da bitirir; ses durumu önce gelebilir)
    receive({ t: 'VOICE_STATE_UPDATE', d: { userId: 'ben', channelId: 'd2', selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, streaming: false, joinedAt: 1 } });
    s = useGuild.getState();
    expect(incomingCalls(s, 'ben').map((c) => c.channelId)).toEqual(['d1']);

    receive({ t: 'DM_CALL_DELETE', d: { channelId: 'd1' } });
    expect(useGuild.getState().dmCalls.d1).toBeUndefined();
    // Bilinmeyen aramanın silinmesi zararsız
    const before = useGuild.getState();
    receive({ t: 'DM_CALL_DELETE', d: { channelId: 'yok' } });
    expect(useGuild.getState().dmCalls).toBe(before.dmCalls);
  });

  it('reddetme: bu cihazda hemen susar ve sunucuya bildirilir', async () => {
    receive({ t: 'DM_CALL_UPDATE', d: call('d1', ['ben']) });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await declineDmCall('d1');
    expect(useGuild.getState().dmCalls.d1?.ringing).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('http://sunucu.test/api/dms/d1/call/decline', expect.objectContaining({ method: 'POST' }));
    expect(errors).toEqual([]);
  });

  it('arama kaydı okunmamış sayılır ama mesaj bildirimi olmaz (zil sesi ve pencere ayrı)', () => {
    const record: Message = {
      id: '9',
      channelId: 'd1',
      authorId: 'ali',
      content: '📞 Arama başlattı.',
      createdAt: 500,
      editedAt: null,
      attachments: [],
      reactions: [],
      mentionEveryone: false,
      type: 'call',
      call: { participantIds: ['ali'], endedAt: null },
    };
    receive({ t: 'MESSAGE_CREATE', d: record });
    expect(useMessages.getState().mentionCounts.d1).toBe(1);
    expect(directs).toEqual([]);
    expect(isMissedCall(record)).toBe(false);
    expect(isMissedCall({ type: 'call', call: { participantIds: ['ali'], endedAt: 900 } })).toBe(true);
    expect(isMissedCall({ type: 'call', call: { participantIds: ['ali', 'ben'], endedAt: 900 } })).toBe(false);
    expect(callMessageText({ participantIds: ['ali', 'ben'], endedAt: 500 + 65 * 60_000 }, 500)).toBe('📞 Arama başlattı · 1 sa 5 dk sürdü.');
    expect(formatCallDuration(42_000)).toBe('42 sn');
  });

  it('arama yetkisi: katılımcı arayabilir; salt okunur (engel ya da sunucunun bildirdiği) konuşmada arayamaz', () => {
    let s = useGuild.getState();
    expect(permissionsOf(s, 'ben', 'd1')).toBe(DM_PERMISSIONS);
    expect(canCallDm(s, 'ben', 'd1')).toBe(true);
    expect(canCallDm(s, 'ben', 'genel')).toBe(false);

    // Seni engellediler: sunucu konuşmayı salt okunur bildirir (yönü söylemez)
    receive({ t: 'DM_CHANNEL_UPDATE', d: dm('d1', ['ben', 'ali'], { readOnly: true }) });
    s = useGuild.getState();
    expect(permissionsOf(s, 'ben', 'd1')).toBe(P.VIEW_CHANNEL);
    expect(canCallDm(s, 'ben', 'd1')).toBe(false);
    expect(dmBlockedReason(s.dms.d1!, s.users, 'ben', s.reachable, s.blockedIds)).toBe('Bu konuşmaya artık mesaj gönderemezsin.');

    // Sen engelledin: neden açıkça söylenir; grup etkilenmez
    receive({ t: 'DM_CHANNEL_UPDATE', d: dm('d1', ['ben', 'ali']) });
    receive({ t: 'USER_BLOCKS_UPDATE', d: { userIds: ['ali'] } });
    s = useGuild.getState();
    expect(isBlocked(s, 'ali')).toBe(true);
    expect(isBlocked(s, 'sahip')).toBe(false);
    expect(permissionsOf(s, 'ben', 'd1')).toBe(P.VIEW_CHANNEL);
    expect(dmBlockedReason(s.dms.d1!, s.users, 'ben', s.reachable, s.blockedIds)).toContain('engelledin');
    expect(permissionsOf(s, 'ben', 'd2')).toBe(DM_PERMISSIONS);
    expect(dmBlockedReason(s.dms.d2!, s.users, 'ben', s.reachable, s.blockedIds)).toBeNull();
  });

  it('engelle / engeli kaldır: REST yanıtıyla liste hemen güncellenir; hata gösterilir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await blockUser('veli')).toBe(true);
    expect(useGuild.getState().blockedIds).toEqual({ sahip: true, veli: true });
    expect(await unblockUser('sahip')).toBe(true);
    expect(useGuild.getState().blockedIds).toEqual({ veli: true });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_body', message: 'Kendini engelleyemezsin.' }), { status: 400 })),
    );
    expect(await blockUser('ben')).toBe(false);
    expect(errors).toEqual(['Kendini engelleyemezsin.']);
    expect(useGuild.getState().blockedIds).toEqual({ veli: true });
  });
});

describe('DM aramasının ses durumu sunucu bağlamına sızmaz', () => {
  const state = (userId: string, channelId: string, streaming = false) => ({
    userId,
    channelId,
    selfMute: false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    streaming,
    joinedAt: 1,
  });

  beforeEach(() => {
    // Sahip olarak bağlan (her yetki): sesteki yönetim düğmeleri hesaplanabilsin
    useSession.getState().setSession('jeton', user('sahip'));
    const base = ready({
      voiceStates: [state('ali', 'ses'), state('veli', 'd2', true)],
      dmCalls: [call('d2', [])],
    });
    base.user = { ...base.user, id: 'sahip', username: 'sahip', displayName: 'SAHIP' };
    base.guilds[0]!.channels.push({ id: 'ses', guildId: 'g', name: 'Genel', type: 'voice', position: 1, overwrites: [] });
    receive({ t: 'READY', d: base });
  });

  it('sunucu bağlamı yalnızca sunucu kanalındaki durumu görür; DM bağlamı yalnızca o konuşmanın aramasını', () => {
    const s = useGuild.getState();
    expect(isGuildVoiceChannel(s, 'ses')).toBe(true);
    expect(isGuildVoiceChannel(s, 'd2')).toBe(false);
    expect(isDmVoiceChannel(s, 'd2')).toBe(true);
    expect(isDmVoiceChannel(s, 'ses')).toBe(false);
    expect(guildVoiceStateOf(s, 'ali')?.channelId).toBe('ses');
    expect(guildVoiceStateOf(s, 'veli')).toBeUndefined();
    expect(voiceStateIn(s, { kind: 'guild', guildId: 'g' }, 'veli')).toBeUndefined();
    expect(voiceStateIn(s, { kind: 'guild', guildId: 'g' }, 'ali')?.channelId).toBe('ses');
    expect(voiceStateIn(s, { kind: 'dm', channelId: 'd2' }, 'veli')?.streaming).toBe(true);
    expect(voiceStateIn(s, { kind: 'dm', channelId: 'd1' }, 'veli')).toBeUndefined();
    expect(voiceStateIn(s, { kind: 'dm', channelId: 'd2' }, 'ali')).toBeUndefined();
    // DM bağlamındaki arama listesi çalışmaya devam eder
    expect(callMembers(s, 'd2').map((v) => v.userId)).toEqual(['veli']);
  });

  it('sunucu ses rozeti DM aramasındaki yayını saymaz; sesteki yönetim DM aramasındakine uygulanmaz', () => {
    const s = useGuild.getState();
    expect(guildVoiceActivity(s, 'g', 'sahip')).toBe('voice');
    // Veli DM aramasında: sunucuda seste değil gibi (taşıma yok, bırakma hedefi yok); Ali sunucu kanalında
    expect(memberActions('veli').move).toBe(false);
    // Susturma sunucu genelinde hesaplanır (seste olmayan üye gibi), DM'nin yetkileriyle değil
    expect(memberActions('veli').mute).toBe(true);
    expect(memberActions('ali').move).toBe(true);
    expect(voiceDropTargets('veli').size).toBe(0);
  });
});

describe('gelen arama: bağlantı ve yerel süre', () => {
  it('bağlantı hazır değilken gelen arama gösterilmez; aramanın kendisi depoda kalır', () => {
    receive({ t: 'DM_CALL_UPDATE', d: call('d1', ['ben']) });
    expect(incomingCalls(useGuild.getState(), 'ben')).toHaveLength(1);
    useGuild.getState().setStatus('reconnecting');
    expect(incomingCalls(useGuild.getState(), 'ben')).toEqual([]);
    expect(useGuild.getState().dmCalls.d1).toBeDefined();
    useGuild.getState().setStatus('ready');
    expect(incomingCalls(useGuild.getState(), 'ben')).toHaveLength(1);
  });

  it('çalma istemcide de süre dolunca biter; sunucu yeniden çalınca süre yenilenir', () => {
    vi.useFakeTimers();
    try {
      const limit = DM_CALL_RING_MS + DM_CALL_RING_GRACE_MS;
      receive({ t: 'DM_CALL_UPDATE', d: call('d1', ['ben'], { ringStartedAt: { ben: 1 } }) });
      vi.advanceTimersByTime(limit - 1000);
      expect(isRingingMe(useGuild.getState().dmCalls.d1, 'ben')).toBe(true);
      // Başka bir değişiklik (aynı çalma) süreyi uzatmaz; yeniden çalma uzatır
      receive({ t: 'DM_CALL_UPDATE', d: call('d1', ['ben'], { ringStartedAt: { ben: 2 } }) });
      vi.advanceTimersByTime(limit - 1000);
      expect(isRingingMe(useGuild.getState().dmCalls.d1, 'ben')).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(isRingingMe(useGuild.getState().dmCalls.d1, 'ben')).toBe(false);
      expect(useGuild.getState().dmCalls.d1).toBeDefined();
      // Süresi dolan aynı çalmayla gelen sonraki olay yeniden çaldırmaz
      receive({ t: 'DM_CALL_UPDATE', d: call('d1', ['ben', 'veli'], { ringStartedAt: { ben: 2, veli: 3 } }) });
      expect(isRingingMe(useGuild.getState().dmCalls.d1, 'ben')).toBe(false);
      // Yeniden çalınınca yine çalar
      receive({ t: 'DM_CALL_UPDATE', d: call('d1', ['ben'], { ringStartedAt: { ben: 4 } }) });
      expect(incomingCalls(useGuild.getState(), 'ben').map((c) => c.channelId)).toEqual(['d1']);
    } finally {
      vi.useRealTimers();
    }
  });
});
