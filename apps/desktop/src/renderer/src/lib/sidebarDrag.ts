import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import type { ChannelType } from '@diskort/shared';
import { moderation, reorderChannels, reorderedIds, useGuild, useSession } from '@diskort/client-core';
import { voice } from '../features/voice/voiceClient';

/**
 * Kanal listesinde sürükle-bırak (Discord gibi): sesteki üyeyi başka ses kanalına taşıma (kendini
 * sürükleyince kanal değiştirme) ve kanalları sıralama. Yerel HTML5 sürükleme yerine işaretçi olayları
 * kullanılır: hayalet (avatar + ad) istediğimiz gibi çizilir ve canlandırılır, imleç "izin yok"a
 * dönebilir, Esc sürüklemeyi iptal eder. Bırakma hedefleri DOM'da işaretlidir:
 * - `data-drop-voice="<kanal>"`: üye bırakılabilecek ses kanalı (kanal satırı + altındaki üyeler)
 * - `data-drop-channel="<kanal>"` ve `data-channel-type`: sıralamada kanal satırı
 * Kaydırılabilir liste `data-drag-scroll` ile işaretlenir; kenarına yaklaşınca kendiliğinden kayar.
 */

export type DragItem =
  | {
      kind: 'member';
      userId: string;
      fromChannelId: string;
      /** Bırakılabilecek ses kanalları (sürükleme başlarken hesaplanır) */
      targets: ReadonlySet<string>;
    }
  | { kind: 'channel'; channelId: string; channelType: ChannelType; name: string };

/** Sıralamada bırakılacak yer: kanalın önü ya da arkası */
export interface ChannelSlot {
  channelId: string;
  after: boolean;
}

interface DragStore {
  item: DragItem | null;
  /** Üye sürüklenirken üzerinde olunan ses kanalı */
  overVoice: string | null;
  /** Kanal sürüklenirken bırakılacak yer (geçersizse null) */
  slot: ChannelSlot | null;
  /** Bırakma sonrası hayaletin kapanış animasyonu */
  ending: 'drop' | 'cancel' | null;
}

export const useSidebarDrag = create<DragStore>()(() => ({ item: null, overVoice: null, slot: null, ending: null }));

/** Hayaletin konumu: her karede React'e uğramadan güncellenir (bkz. DragGhost) */
export const dragPointer = { x: 0, y: 0, startX: 0, startY: 0, listeners: new Set<() => void>() };

const THRESHOLD = 5;
const EDGE = 36;
const END_MS = 160;

/** Üye sürüklenirken bu ses kanalının durumu (seçici: ilkel değer döner) */
export function voiceDropState(s: DragStore, channelId: string): 'valid' | 'invalid' | 'candidate' | null {
  if (s.item?.kind !== 'member' || s.ending) return null;
  const ok = s.item.targets.has(channelId);
  if (s.overVoice === channelId) return ok ? 'valid' : channelId === s.item.fromChannelId ? null : 'invalid';
  return ok ? 'candidate' : null;
}

/** Kanal sürüklenirken bu kanalın durumu: sürüklenen, önüne ya da arkasına bırakılacak */
export function channelDropState(s: DragStore, channelId: string): 'source' | 'before' | 'after' | null {
  if (s.item?.kind !== 'channel' || s.ending) return null;
  if (s.item.channelId === channelId) return 'source';
  if (s.slot?.channelId === channelId) return s.slot.after ? 'after' : 'before';
  return null;
}

function hitTest(x: number, y: number, item: DragItem): Pick<DragStore, 'overVoice' | 'slot'> {
  const el = document.elementFromPoint(x, y);
  if (item.kind === 'member') {
    const target = el?.closest<HTMLElement>('[data-drop-voice]');
    return { overVoice: target?.dataset.dropVoice ?? null, slot: null };
  }
  const row = el?.closest<HTMLElement>('[data-drop-channel]');
  if (!row || row.dataset.channelType !== item.channelType) return { overVoice: null, slot: null };
  const id = row.dataset.dropChannel!;
  const rect = row.getBoundingClientRect();
  const after = y > rect.top + rect.height / 2;
  // Kendi yerine bırakmak sırayı değiştirmez
  const ids = sameTypeIds(item.channelType);
  const next = reorderedIds(ids, item.channelId, id, after);
  if (next.every((v, i) => v === ids[i])) return { overVoice: null, slot: null };
  return { overVoice: null, slot: { channelId: id, after } };
}

const sameTypeIds = (type: ChannelType): string[] =>
  useGuild
    .getState()
    .channels.filter((c) => c.type === type)
    .map((c) => c.id);

/** Bırakma geçerli mi (imleç ve bırakma için) */
function canDrop(s: DragStore): boolean {
  if (!s.item) return false;
  return s.item.kind === 'member' ? s.overVoice !== null && s.item.targets.has(s.overVoice) : s.slot !== null;
}

function drop(item: DragItem, s: DragStore): void {
  if (item.kind === 'member') {
    const channelId = s.overVoice!;
    if (item.userId === useSession.getState().user?.id) void voice.join(channelId);
    else void moderation.move(item.userId, channelId);
    return;
  }
  const guildId = useGuild.getState().activeGuildId;
  if (!guildId || !s.slot) return;
  const all = useGuild.getState().channels.map((c) => c.id);
  void reorderChannels(guildId, reorderedIds(all, item.channelId, s.slot.channelId, s.slot.after));
}

function setCursor(state: 'ok' | 'no' | null): void {
  const root = document.documentElement;
  root.classList.toggle('dk-drag-ok', state === 'ok');
  root.classList.toggle('dk-drag-no', state === 'no');
}

/** Sürüklemeden hemen sonra gelen tıklamayı yutar (kanala katılma/açma tetiklenmesin) */
function swallowNextClick(): void {
  const stop = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

let active = false;

/**
 * Birincil düğmeyle basılınca sürüklemeyi hazırlar; imleç birkaç piksel kayınca `begin` çağrılır ve
 * dönen öğe sürüklenir (null dönerse sürükleme olmaz, tıklama olağan çalışır).
 */
export function startSidebarDrag(e: ReactPointerEvent, begin: () => DragItem | null): void {
  if (e.button !== 0 || active || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  active = true;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  const scroller = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-drag-scroll]');
  let item: DragItem | null = null;
  let frame = 0;

  const update = (): void => {
    if (!item) return;
    const s = useSidebarDrag.getState();
    const hit = hitTest(dragPointer.x, dragPointer.y, item);
    if (hit.overVoice !== s.overVoice || hit.slot?.channelId !== s.slot?.channelId || hit.slot?.after !== s.slot?.after) {
      useSidebarDrag.setState(hit);
    }
    setCursor(canDrop(useSidebarDrag.getState()) ? 'ok' : 'no');
  };

  // Liste kenarına yakınken kaydır (her karede biraz)
  const autoScroll = (): void => {
    frame = requestAnimationFrame(autoScroll);
    if (!item || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const y = dragPointer.y;
    if (dragPointer.x < rect.left || dragPointer.x > rect.right) return;
    let dy = 0;
    if (y < rect.top + EDGE) dy = -Math.ceil(((rect.top + EDGE - y) / EDGE) * 10);
    else if (y > rect.bottom - EDGE) dy = Math.ceil(((y - (rect.bottom - EDGE)) / EDGE) * 10);
    if (dy !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollTop += dy;
      if (scroller.scrollTop !== before) update();
    }
  };

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    dragPointer.x = ev.clientX;
    dragPointer.y = ev.clientY;
    if (!item) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      item = begin();
      if (!item) {
        finish(false);
        return;
      }
      dragPointer.startX = startX;
      dragPointer.startY = startY;
      document.getSelection()?.removeAllRanges();
      useSidebarDrag.setState({ item, overVoice: null, slot: null, ending: null });
      frame = requestAnimationFrame(autoScroll);
    }
    ev.preventDefault();
    update();
    for (const l of dragPointer.listeners) l();
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    finish(true);
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !item) return;
    // Esc katmanları (menü, pencere) kapanmasın: yalnızca sürükleme iptal
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };

  const onCancel = (): void => finish(false);

  function finish(commit: boolean): void {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    cancelAnimationFrame(frame);
    setCursor(null);
    active = false;
    if (!item) return;
    swallowNextClick();
    const s = useSidebarDrag.getState();
    const ok = commit && canDrop(s);
    if (ok) drop(item, s);
    const ended = item;
    useSidebarDrag.setState({ ending: ok ? 'drop' : 'cancel' });
    setTimeout(() => {
      if (useSidebarDrag.getState().item === ended) useSidebarDrag.setState({ item: null, overVoice: null, slot: null, ending: null });
    }, END_MS);
  }

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onCancel);
}
