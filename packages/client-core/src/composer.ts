// Ekrandaki yazma kutularına dışarıdan erişim: mesajın yazarının adına tıklayınca bahsetme eklemek,
// "Yanıtla" deyince kutuya odaklanmak gibi. Metnin kendisi platformun yazma kutusunda durur; kutu
// açılınca registerComposer ile kendini kaydeder.

export interface ComposerHandle {
  /** Kutuya odaklanır (klavye açılır) */
  focus(): void;
  /** Metni imlecin olduğu yere ekler ve odaklanır */
  insert(text: string): void;
}

const composers: { channelId: string; handle: ComposerHandle }[] = [];

/** Kanalın yazma kutusunu kaydeder; dönen işlev kaydı siler. Aynı kanalda en son açılan kullanılır. */
export function registerComposer(channelId: string, handle: ComposerHandle): () => void {
  const entry = { channelId, handle };
  composers.push(entry);
  return () => {
    const index = composers.indexOf(entry);
    if (index >= 0) composers.splice(index, 1);
  };
}

function composerOf(channelId: string): ComposerHandle | undefined {
  for (let i = composers.length - 1; i >= 0; i--) if (composers[i]!.channelId === channelId) return composers[i]!.handle;
  return undefined;
}

/** Kanalın yazma kutusu ekrandaysa ona odaklanır */
export function focusComposer(channelId: string): boolean {
  const composer = composerOf(channelId);
  composer?.focus();
  return composer !== undefined;
}

/** Kullanıcıdan bahsetmeyi (`@kullanıcıadı `) kanalın yazma kutusuna, imlecin olduğu yere ekler. */
export function mentionInComposer(channelId: string, username: string): boolean {
  const composer = composerOf(channelId);
  composer?.insert(`@${username} `);
  return composer !== undefined;
}

/** Yazma kutusu açık mı (ör. "Bahset" düğmesi yalnızca o zaman gösterilir) */
export function hasComposer(channelId: string): boolean {
  return composerOf(channelId) !== undefined;
}

/**
 * Metni seçimin yerine ekler. Eklenen bahsetme önceki sözcüğe yapışmasın diye (yoksa bahsetme
 * sayılmaz) gerekirse önüne boşluk konur; sonrası zaten boşlukla başlıyorsa iki boşluk yan yana gelmez.
 */
export function insertText(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  text: string,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const before = value.slice(0, start);
  let after = value.slice(end);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  if (text.endsWith(' ') && after.startsWith(' ')) after = after.slice(1);
  const head = before + pad + text;
  return { value: head + after, caret: head.length };
}
