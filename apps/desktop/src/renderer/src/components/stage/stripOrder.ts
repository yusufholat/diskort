/**
 * Odaklanmış yayının altındaki katılımcı şeridinin sırası. Amaç: şerit taşınca görünen kısımda konuşanlar
 * olsun, ama kutucuklar yerinde sıçramasın. Bu yüzden sıralama "en son konuşan başa" diye her an yeniden
 * yapılmaz; yalnızca görünmeyen yerde konuşan biri, görünen ilk yere alınır. Zaten görünenler yerinde kalır.
 *
 * - `pinned` (büyük gösterilen yayının sahibi) her zaman başta,
 * - kendin her zaman sonda (kendini görmen gerekmez, konuşunca da öne alınmazsın),
 * - yeni gelenler sona (kendinden önce) eklenir.
 */
export interface StripOrderOptions {
  pinned?: string | null;
  selfId?: string | null;
  /** Görünmeyen yerde konuşmuş olanlar (en son konuşan önce) */
  promote?: readonly string[];
  /** Şu an görünen ilk kişinin sıradaki yeri (öne alınanlar buraya girer) */
  firstVisible?: number;
}

export function orderStrip(prev: readonly string[], users: readonly string[], opts: StripOrderOptions = {}): string[] {
  const { pinned, selfId, promote = [], firstVisible = 0 } = opts;
  const present = new Set(users);
  const fixed = (id: string): boolean => id === pinned || id === selfId;

  // Önceki sıra korunur; yeni gelenler sona
  const seen = new Set<string>();
  const middle: string[] = [];
  for (const id of [...prev, ...users]) {
    if (seen.has(id) || !present.has(id)) continue;
    seen.add(id);
    if (!fixed(id)) middle.push(id);
  }

  const lifted = promote.filter((id, i) => present.has(id) && !fixed(id) && promote.indexOf(id) === i);
  if (lifted.length > 0) {
    const rest = middle.filter((id) => !lifted.includes(id));
    // Sabitlenen baştaysa görünen yer ondan sonrasıdır
    const offset = pinned && present.has(pinned) ? 1 : 0;
    // Görünen ilk yerin önünde kalanlardan kaç tanesi yerinden çıktı, ona göre kaydır
    const before = middle.slice(0, Math.max(0, firstVisible - offset));
    const at = before.filter((id) => !lifted.includes(id)).length;
    rest.splice(Math.min(at, rest.length), 0, ...lifted);
    middle.splice(0, middle.length, ...rest);
  }

  const out: string[] = [];
  if (pinned && present.has(pinned)) out.push(pinned);
  out.push(...middle);
  if (selfId && present.has(selfId) && selfId !== pinned) out.push(selfId);
  return out;
}
