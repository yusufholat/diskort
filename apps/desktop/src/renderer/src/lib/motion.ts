import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Hareket yardımcıları. Animasyonların kendisi styles/motion.css'te; burada yalnızca kapanış
 * animasyonu bitene kadar öğeyi ekranda tutan kancalar ve Web Animations API ile tek seferlik
 * efektler var. Sistemde "animasyonları azalt" açıksa hepsi anında sonuçlanır.
 */

/** CSS'teki --dur-* değerleriyle aynı (ms) */
export const DURATION = { fast: 120, base: 180, slow: 240, exit: 140 } as const;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const reducedQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED_QUERY) : null;

export function prefersReducedMotion(): boolean {
  return reducedQuery?.matches ?? false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      reducedQuery?.addEventListener('change', onChange);
      return () => reducedQuery?.removeEventListener('change', onChange);
    },
    prefersReducedMotion,
  );
}

// ---------- Kapanış animasyonu için gecikmeli kaldırma ----------

/**
 * Değer boşalınca (null/undefined/false) son değeri `ms` boyunca `closing: true` ile tutar; böylece
 * bileşen kapanış animasyonunu oynatabilir. Yeni değer gelince hemen gösterilir.
 */
export function usePresence<T>(
  value: T | null | undefined | false,
  ms: number = DURATION.exit,
): { value: T | null; closing: boolean } {
  const current = value || null;
  const [kept, setKept] = useState<T | null>(current);
  const [prev, setPrev] = useState<T | null>(current);
  // Render sırasında türetilen durum (React'in önerdiği kalıp): açılış beklemeden gösterilir
  if (current !== prev) {
    setPrev(current);
    if (current !== null) setKept(current);
  }
  const closing = current === null && kept !== null;

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setKept(null), prefersReducedMotion() ? 0 : ms);
    return () => window.clearTimeout(timer);
  }, [closing, ms]);

  return { value: current ?? kept, closing };
}

/** Kapanmakta olan bir katmanın içindekilere (Modal gibi) bunu bildirir. */
const PresenceContext = createContext(false);
export const PresenceProvider = PresenceContext.Provider;
export function usePresenceClosing(): boolean {
  return useContext(PresenceContext);
}

export type PresencePhase = 'static' | 'enter' | 'exit';

export interface PresenceEntry<T> {
  key: string;
  item: T;
  /** static: ilk çizimden beri var (animasyon yok), enter: sonradan eklendi, exit: kaldırıldı, kapanıyor */
  phase: PresencePhase;
}

interface Gone<T> {
  key: string;
  item: T;
  index: number;
  until: number;
}

/**
 * Liste için usePresence: kaldırılan öğeler eski yerlerinde `ms` boyunca `exit` evresinde kalır.
 * İlk çizimde var olan öğeler `static` döner ki sayfa açılırken her şey birden oynamasın.
 */
export function usePresenceList<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  ms: number = DURATION.exit,
): PresenceEntry<T>[] {
  const [prev, setPrev] = useState(items);
  const [gone, setGone] = useState<Gone<T>[]>([]);
  // İlk çizimde var olanlar (çıkıp yeniden girerse artık animasyonlu girer)
  const initial = useRef<Set<string> | null>(null);
  const initialKeys = (initial.current ??= new Set(items.map(getKey)));

  if (items !== prev) {
    const keys = new Set(items.map(getKey));
    const now = Date.now();
    const removed: Gone<T>[] = [];
    prev.forEach((item, index) => {
      const key = getKey(item);
      if (!keys.has(key)) {
        removed.push({ key, item, index, until: now + ms });
        initialKeys.delete(key);
      }
    });
    setPrev(items);
    if (removed.length || gone.some((g) => keys.has(g.key))) {
      const reduce = prefersReducedMotion();
      setGone((list) => [
        ...list.filter((g) => !keys.has(g.key) && !removed.some((r) => r.key === g.key)),
        ...(reduce ? [] : removed),
      ]);
    }
  }

  useEffect(() => {
    if (gone.length === 0) return;
    const next = Math.min(...gone.map((g) => g.until));
    const timer = window.setTimeout(
      () => setGone((list) => list.filter((g) => g.until > Date.now() + 10)),
      Math.max(0, next - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [gone]);

  const entries: PresenceEntry<T>[] = items.map((item) => {
    const key = getKey(item);
    return { key, item, phase: initialKeys.has(key) ? 'static' : 'enter' };
  });
  for (const g of [...gone].sort((a, b) => a.index - b.index)) {
    entries.splice(Math.min(g.index, entries.length), 0, { key: g.key, item: g.item, phase: 'exit' });
  }
  return entries;
}

/** usePresenceList evresine göre açılıp kapanan satır sınıfı (styles/motion.css: .collapse-*) */
export function collapseClass(phase: PresencePhase): string {
  return phase === 'enter' ? 'collapse-in' : phase === 'exit' ? 'collapse-out' : 'collapse-static';
}

// ---------- Tek seferlik efektler ----------

/** Web Animations API ile kısa bir efekt; animasyonlar azaltılmışsa hiçbir şey yapmaz. */
export function animate(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): void {
  if (!el || prefersReducedMotion() || typeof el.animate !== 'function') return;
  el.animate(keyframes, options);
}

/** Hatalı form alanı ya da başarısız giriş için yatay sallanma */
export function shake(el: Element | null | undefined): void {
  animate(
    el,
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-7px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 360, easing: 'ease-out' },
  );
}

/** Yeni gelen öğe için hafif belirip yükselme */
export function riseIn(el: Element | null | undefined): void {
  animate(
    el,
    [
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
}

/** Sayı değişince zıplama (tepki sayacı gibi) */
export function bump(el: Element | null | undefined): void {
  animate(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], {
    duration: 260,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  });
}

/** Bileşen ilk kez çizildikten sonra true olur (ilk çizimde animasyon oynatmamak için). */
export function useMountedRef(): RefObject<boolean> {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
