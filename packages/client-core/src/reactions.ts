import { create } from 'zustand';
import type { User } from '@diskort/shared';
import { api } from './api';

// Bir mesajda belirli bir emojiyle tepki verenler (ipucu ve "Tepkiler" penceresi için). Mesaj yükü
// yalnızca sayıları taşır; kişiler istenince sunucudan sayfa sayfa alınır ve burada saklanır. Tepki
// eklenip kaldırıldıkça ilgili kayıt atılır, ekrandaki bileşen yeniden ister.

export interface ReactionUsersEntry {
  users: User[];
  /** Sonraki sayfanın imleci; null: hepsi alındı */
  next: string | null;
  loading: boolean;
  error: boolean;
}

interface ReactionUsersStore {
  entries: Record<string, ReactionUsersEntry>;
}

export const useReactionUsers = create<ReactionUsersStore>()(() => ({ entries: {} }));

export const reactionUsersKey = (messageId: string, emoji: string): string => `${messageId}\u0000${emoji}`;

const setEntry = (key: string, entry: ReactionUsersEntry | undefined): void =>
  useReactionUsers.setState((s) => {
    const entries = { ...s.entries };
    if (entry) entries[key] = entry;
    else delete entries[key];
    return { entries };
  });

/** Kayıt değiştikçe artar: bu arada atılan kaydın eski isteği yeni kaydın üstüne yazmasın */
const generations = new Map<string, number>();

/**
 * Tepki verenlerin ilk sayfasını (ya da `more` ile sonraki sayfayı) yükler. Zaten yükleniyorsa ya da
 * istenen sayfa elde varsa bir şey yapmaz.
 */
export async function loadReactionUsers(messageId: string, emoji: string, more = false): Promise<void> {
  const key = reactionUsersKey(messageId, emoji);
  const current = useReactionUsers.getState().entries[key];
  if (current?.loading) return;
  if (current && !current.error && (!more || !current.next)) return;
  const after = more && current ? current.next : null;
  const base = after && current ? current.users : [];
  const generation = generations.get(key) ?? 0;
  setEntry(key, { users: base, next: after, loading: true, error: false });
  try {
    const page = await api.reactionUsers(messageId, emoji, after ?? undefined);
    if ((generations.get(key) ?? 0) !== generation) return;
    const seen = new Set(base.map((u) => u.id));
    setEntry(key, {
      users: [...base, ...page.users.filter((u) => !seen.has(u.id))],
      next: page.next,
      loading: false,
      error: false,
    });
  } catch {
    if ((generations.get(key) ?? 0) !== generation) return;
    setEntry(key, { users: base, next: after, loading: false, error: true });
  }
}

/** Tepki değişti: saklanan liste eskidi (ekrandaysa bileşen yeniden yükler) */
export function forgetReactionUsers(messageId: string, emoji: string): void {
  const key = reactionUsersKey(messageId, emoji);
  generations.set(key, (generations.get(key) ?? 0) + 1);
  if (useReactionUsers.getState().entries[key]) setEntry(key, undefined);
}

/**
 * Discord'daki ipucu: "Ali, Veli ve 3 kişi daha 👍 ile tepki verdi". `names` bilinen ilk adlar
 * (tepki sırasıyla), `total` toplam tepki sayısı.
 */
export function reactionSummary(names: string[], total: number, emoji: string): string {
  const shown = names.slice(0, 3);
  const others = Math.max(0, total - shown.length);
  let who: string;
  if (shown.length === 0) who = `${total} kişi`;
  else if (others > 0) who = `${shown.join(', ')} ve ${others} kişi daha`;
  else if (shown.length === 1) who = shown[0]!;
  else who = `${shown.slice(0, -1).join(', ')} ve ${shown.at(-1)!}`;
  return `${who} ${emoji} ile tepki verdi`;
}
