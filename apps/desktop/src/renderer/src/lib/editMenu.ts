import type { EditCommand } from '../../../shared/bridge';
import { useUi, type ContextMenuItem } from '../stores/ui';
import { bridge, isMac } from './bridge';

type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUT_TYPES = new Set(['text', 'password', 'search', 'url', 'email', 'tel', 'number', '']);

/** Sağ tıklanan öğe düzenlenebilir bir metin kutusu mu */
export function editableField(target: EventTarget | null): TextField | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('input, textarea');
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)) return el;
  return null;
}

function run(command: EditCommand, el: TextField): void {
  el.focus();
  if (bridge) {
    bridge.edit(command);
    return;
  }
  // Düz tarayıcı: yapıştırma yalnızca pano izniyle yapılabilir
  if (command === 'paste') {
    void navigator.clipboard
      .readText()
      .then((text) => document.execCommand('insertText', false, text))
      .catch(() => undefined);
    return;
  }
  document.execCommand(command);
}

const key = (letter: string): string => (isMac ? `⌘${letter}` : `Ctrl+${letter}`);

/** Metin kutuları için temalı Kes/Kopyala/Yapıştır menüsü (Chromium'un kendi menüsü yerine). */
export function openEditMenu(e: MouseEvent, el: TextField): void {
  const hasSelection = (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0);
  const secret = el instanceof HTMLInputElement && el.type === 'password';
  const locked = el.readOnly || el.disabled;
  const items: ContextMenuItem[] = [
    { label: 'Geri Al', hint: key('Z'), disabled: locked, onClick: () => run('undo', el) },
    { label: 'Kes', hint: key('X'), disabled: locked || secret || !hasSelection, onClick: () => run('cut', el) },
    { label: 'Kopyala', hint: key('C'), disabled: secret || !hasSelection, onClick: () => run('copy', el) },
    { label: 'Yapıştır', hint: key('V'), disabled: locked, onClick: () => run('paste', el) },
    { label: 'Tümünü Seç', hint: key('A'), disabled: !el.value, onClick: () => run('selectAll', el) },
  ];
  useUi.getState().openContextMenu({ x: e.clientX, y: e.clientY, items });
}
