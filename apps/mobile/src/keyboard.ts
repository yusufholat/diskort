import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, type View } from 'react-native';
import { animateNextLayout } from './motion';

/**
 * Klavyenin bir görünümün altını ne kadar örttüğü. KeyboardAvoidingView'in sabit başlık payı
 * (keyboardVerticalOffset) yerine görünümün ekrandaki gerçek yeri ölçülür: başlık ya da durum
 * çubuğu yüksekliği ne olursa olsun yazma kutusu klavyenin tam üstüne oturur. Pencere klavyeyle
 * küçülüyorsa (adjustResize) örtme 0 çıkar, çift boşluk olmaz. Değişim yumuşak bir yerleşim
 * animasyonuyla uygulanır (sıçrama yerine kayma).
 *
 * Görünüm `flex: 1` olmalı ve boşluğu kendi `paddingBottom`'una almalı: böylece dış yüksekliği
 * boşluktan bağımsızdır ve ölçüm tek adımda doğru çıkar.
 */
export function useKeyboardInset(): {
  ref: RefObject<View | null>;
  onLayout: () => void;
  /** Klavye açık mı */
  open: boolean;
  /** Görünümün altına eklenecek boşluk (klavye kapalıyken 0) */
  inset: number;
} {
  const ref = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [state, setState] = useState({ open: false, inset: 0 });

  const apply = useCallback((next: { open: boolean; inset: number }, animate: boolean) => {
    setState((s) => {
      if (s.open === next.open && Math.abs(s.inset - next.inset) < 2) return s;
      if (animate) animateNextLayout(220, false);
      return next;
    });
  }, []);

  const measure = useCallback(
    (animate: boolean) => {
      const top = keyboardTop.current;
      const node = ref.current;
      if (top === null || !node) {
        apply({ open: false, inset: 0 }, animate);
        return;
      }
      node.measureInWindow((_x, y, _width, height) => {
        if (keyboardTop.current === null) return;
        apply({ open: true, inset: Math.max(0, Math.round(y + height - top)) }, animate);
      });
    },
    [apply],
  );

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      measure(true);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      measure(true);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [measure]);

  // Klavye açıkken yerleşim değişirse (pencere küçüldü, ekran döndü) yeniden ölç
  const onLayout = useCallback(() => {
    if (keyboardTop.current !== null) measure(false);
  }, [measure]);

  return { ref, onLayout, open: state.open, inset: state.inset };
}
