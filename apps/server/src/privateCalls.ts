import { createHmac, randomBytes } from 'node:crypto';

/** Yönetim panelinde DM aramasının adı */
export const PRIVATE_CALL_NAME = 'Özel arama';
/** Yönetim panelinde DM aramasındaki kişinin adı */
export const PRIVATE_PARTICIPANT_NAME = 'Gizli katılımcı';
/** Takma kimliklerin ön eki (kanal ve kullanıcı kimlikleri bu ön ekle başlamaz: nanoid ve kanal kimlikleri farklı) */
export const PRIVATE_ID_PREFIX = 'ozel-';

/** Kimlik bir DM aramasının takma kimliği mi (kanal ya da kullanıcı) */
export const isPrivateId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(PRIVATE_ID_PREFIX);

/**
 * Yönetim paneli gizliliği: DM aramalarının kalite ölçümleri, olay kayıtları ve donma teşhisi tutulur ama
 * yönetici hiçbir yüzde (panel, dışa aktarım, kalıcı JSONL kayıtları, sunucu günlüğü uyarıları) konuşmanın
 * kimliğini, adını ya da katılımcıları göremez. Kayıtlar daha alınırken takma kimliğe çevrilir: kanal
 * `ozel-<…>`, kişi `ozel-<…>` (kişininki konuşma başına ayrı). Takma kimlikler süreç başına rastgele bir anahtarla üretilir (HMAC): aynı
 * süreçte aynı kişi/konuşma aynı takma kimliği alır (bir aramanın ölçümleri birbirine bağlanır), ama anahtar
 * saklanmadığından gerçek kimliğe geri bağlanamaz; sunucu yeniden başlayınca takma kimlikler de değişir.
 * Gerçek kanala dönüş (ör. donma olayında o aramadan olay kaydı istemek) yalnızca bu süreçte görülmüş takma
 * kimlikler için, bellekte yapılır.
 */
export class PrivateCallIds {
  private readonly key: Buffer;
  private readonly rooms = new Map<string, string>();

  constructor(
    private readonly isDm: (channelId: string) => boolean,
    key: Buffer = randomBytes(32),
  ) {
    this.key = key;
  }

  private pseudonym(kind: string, id: string): string {
    return PRIVATE_ID_PREFIX + createHmac('sha256', this.key).update(`${kind}:${id}`).digest('base64url').slice(0, 12);
  }

  /** Kanal bir DM konuşması mı (DM araması) */
  isPrivate(channelId: string | null | undefined): boolean {
    return typeof channelId === 'string' && !isPrivateId(channelId) && this.isDm(channelId);
  }

  /** Yönetim yüzlerine giden kanal kimliği: DM ise takma kimlik, değilse aynısı */
  channel(channelId: string): string;
  channel(channelId: string | null): string | null;
  channel(channelId: string | null): string | null {
    if (!channelId || !this.isPrivate(channelId)) return channelId;
    const id = this.pseudonym('c', channelId);
    if (this.rooms.size > 10_000) this.rooms.clear();
    this.rooms.set(id, channelId);
    return id;
  }

  /**
   * Yönetim yüzlerine giden kullanıcı kimliği: `channelId` bir DM ise takma kimlik, değilse aynısı. Takma
   * kimlik konuşmaya özgüdür (aynı kişi iki ayrı DM aramasında iki ayrı kimlik alır): aramalar kimlikten
   * birbirine bağlanamaz.
   */
  user(userId: string, channelId: string | null): string {
    return channelId && this.isPrivate(channelId) ? this.pseudonym('u', `${channelId}:${userId}`) : userId;
  }

  /** Takma kanal kimliğinin gerçeği (yalnızca bu süreçte görülmüşse); takma değilse aynısı */
  resolve(channelId: string): string | null {
    return isPrivateId(channelId) ? (this.rooms.get(channelId) ?? null) : channelId;
  }
}
