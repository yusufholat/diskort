import { useEffect, useRef } from 'react';

/**
 * Esc tuşu katmanları: yalnızca en son açılan katman (onay penceresi, sağ tık menüsü, ayarlar…)
 * kapanır. Önceden her katman pencereyi ayrı dinlediği için ayarların üstündeki onay penceresinde
 * Esc'e basınca ikisi birden kapanıyordu.
 */
const layers: { close: () => void }[] = [];

function onKeyDown(e: KeyboardEvent): void {
  // Metin kutusu gibi bir öğe Esc'i zaten kullandıysa (ör. öneri listesini kapattıysa) dokunma
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = layers.at(-1);
  if (!top) return;
  e.preventDefault();
  top.close();
}

/** `enabled` iken bu katmanı Esc yığınının en üstüne koyar. */
export function useEscapeLayer(onClose: () => void, enabled = true): void {
  const handler = useRef(onClose);
  useEffect(() => {
    handler.current = onClose;
  });

  useEffect(() => {
    if (!enabled) return;
    const layer = { close: () => handler.current() };
    if (layers.length === 0) window.addEventListener('keydown', onKeyDown);
    layers.push(layer);
    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      if (layers.length === 0) window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
