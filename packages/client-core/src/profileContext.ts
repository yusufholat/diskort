import { useGuild, type GuildStore } from './guild';
import { memberColorOf } from './permissions';

/**
 * Bir kişinin (profil kartı, üye menüsü, adının rengi) hangi bağlamda gösterildiği. Açan yer bildirir;
 * "seçili sunucu"dan çıkarılmaz: DM açıkken de bir sunucu seçili kalır ama DM'de sunucu yoktur.
 * - guild: o sunucudaki hâli (roller, rol rengi, sahiplik, yönetim, ses işlemleri);
 * - dm: yalnızca hesap düzeyi (profil, özel durum, "Mesaj gönder", kullanıcı adı). `channelId`: açıldığı
 *   konuşma (bire bir konuşmada o kişiye "Mesaj gönder" gösterilmesin diye).
 */
export type ProfileContext = { kind: 'guild'; guildId: string } | { kind: 'dm'; channelId?: string };

/** Konuşma dışından açılan DM bağlamı */
export const DM_CONTEXT: ProfileContext = { kind: 'dm' };

type ContextState = Pick<GuildStore, 'dms' | 'channelGuild'>;

/**
 * Bir kanalın bağlamı: direkt mesaj → dm, sunucu kanalı → o sunucu. Bilinmeyen kanal (kapatılmış DM gibi)
 * dm sayılır: sunucu bilgisi yanlış yerde görünmektense hiç görünmesin.
 */
export function contextOfChannel(s: ContextState, channelId: string | null | undefined): ProfileContext {
  if (!channelId) return DM_CONTEXT;
  const guildId = s.dms[channelId] ? undefined : s.channelGuild[channelId];
  return guildId ? { kind: 'guild', guildId } : { kind: 'dm', channelId };
}

/** Seçili sunucunun bağlamı (üye listesi, ses kanalı gibi yalnızca sunucuda açılan yerler için) */
export function activeGuildContext(s: Pick<GuildStore, 'activeGuildId'>): ProfileContext {
  return s.activeGuildId ? { kind: 'guild', guildId: s.activeGuildId } : DM_CONTEXT;
}

/**
 * Bağlamda sunucu bilgisi (roller, rol rengi, sahiplik, yönetim) gösterilir mi: yalnızca sunucu
 * bağlamında ve o sunucu seçiliyken (depodaki `users`, `roles` ve yetkiler seçili sunucunun görünümü).
 */
export function showsGuildInfo(s: Pick<GuildStore, 'activeGuildId'>, context: ProfileContext): boolean {
  return context.kind === 'guild' && context.guildId === s.activeGuildId;
}

/** Bağlamda bir kişiye (kendisi değilse, ortak sunucusu varsa) "Mesaj gönder" gösterilir mi */
export function canMessageIn(
  s: Pick<GuildStore, 'dms' | 'reachable'>,
  context: ProfileContext,
  userId: string,
  selfId: string | undefined,
): boolean {
  if (userId === selfId || !s.reachable[userId]) return false;
  // Zaten onunla bire bir konuşmadayız
  if (context.kind === 'dm' && context.channelId) {
    const dm = s.dms[context.channelId];
    if (dm && !dm.group && dm.participantIds.includes(userId)) return false;
  }
  return true;
}

/** Adın bağlamdaki rengi: sunucuda rol rengi, DM'de hep varsayılan (null) */
export function memberColorIn(
  s: Pick<GuildStore, 'guild' | 'roles' | 'users' | 'activeGuildId'>,
  userId: string | null | undefined,
  context: ProfileContext,
): string | null {
  return showsGuildInfo(s, context) ? memberColorOf(s, userId) : null;
}

/** Adın bir kanaldaki rengi (mesaj yazarı, yanıt, sabitli mesaj): DM'de varsayılan renk */
export function channelMemberColorOf(
  s: Pick<GuildStore, 'guild' | 'roles' | 'users' | 'activeGuildId' | 'dms' | 'channelGuild'>,
  userId: string | null | undefined,
  channelId: string | null | undefined,
): string | null {
  return memberColorIn(s, userId, contextOfChannel(s, channelId));
}

/** Adın bir kanaldaki rengi (rol rengi yoksa ya da DM'deyse null: varsayılan renk kullanılır) */
export function useChannelMemberColor(userId: string | null | undefined, channelId: string | null | undefined): string | null {
  return useGuild((s) => channelMemberColorOf(s, userId, channelId));
}

/**
 * Bağlam nesneleri anahtarına göre tek kopya tutulur: bileşenlere verilen bağlam, sunucu ya da konuşma
 * değişmedikçe aynı nesne kalır (gereksiz yeniden çizim olmasın). Sunucu ve konuşma sayısı kadar kayıt.
 */
const contexts = new Map<string, ProfileContext>();

function contextFor(guildId: string | null, channelId: string | null | undefined): ProfileContext {
  if (!guildId && !channelId) return DM_CONTEXT;
  const key = guildId ? `g:${guildId}` : `d:${channelId}`;
  let context = contexts.get(key);
  if (!context) {
    context = guildId ? { kind: 'guild', guildId } : { kind: 'dm', channelId: channelId! };
    contexts.set(key, context);
  }
  return context;
}

/** Kanalın bağlamı (bileşenlerde; kanal ya da sunucusu değişmedikçe aynı nesne) */
export function useChannelContext(channelId: string | null | undefined): ProfileContext {
  const guildId = useGuild((s) => (channelId && !s.dms[channelId] ? (s.channelGuild[channelId] ?? null) : null));
  return contextFor(guildId, channelId);
}

/** Seçili sunucunun bağlamı (bileşenlerde; üye listesi, ses kanalı, sunucu ayarları) */
export function useActiveGuildContext(): ProfileContext {
  const guildId = useGuild((s) => s.activeGuildId);
  return contextFor(guildId, null);
}
