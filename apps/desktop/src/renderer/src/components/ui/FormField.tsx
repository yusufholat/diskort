import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { shake } from '../../lib/motion';
import { cn } from '../../lib/utils';

/**
 * Etiketli form alanı. Hata varsa alanın kenarı kırmızı olur (styles/controls.css: .field-invalid),
 * altında kısa bir mesaj belirir ve alan sallanır. Formlar `noValidate` ile Chromium'un
 * "Lütfen bu alanı doldurun." baloncuğunu kapatıp denetimi useFormErrors ile yapar.
 */
export function FormField({
  label,
  error,
  hint,
  shakeKey,
  className,
  children,
}: {
  label: ReactNode;
  error?: string | null;
  /** Hata yokken alanın altında gösterilen açıklama */
  hint?: ReactNode;
  /** Her gönderim denemesinde değişen sayı: hata aynı kalsa da alan yeniden sallanır */
  shakeKey?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLLabelElement>(null);
  const last = useRef({ error, shakeKey });

  useEffect(() => {
    const prev = last.current;
    last.current = { error, shakeKey };
    if (error && (error !== prev.error || shakeKey !== prev.shakeKey)) shake(ref.current);
  }, [error, shakeKey]);

  return (
    <label ref={ref} className={cn('mb-4 block', error && 'field-invalid', className)}>
      <span
        className={cn(
          'mb-2 block text-xs font-bold tracking-wide uppercase transition-colors',
          error ? 'text-danger-text' : 'text-text-muted',
        )}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span key={error} role="alert" className="anim-slide-down mt-1.5 flex items-center gap-1.5 text-xs font-medium text-danger-text">
          <CircleAlert size={14} className="shrink-0" />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-text-muted">{hint}</span>
      )}
    </label>
  );
}

type Checks<K extends string> = Partial<Record<K, string | false | null | undefined>>;

/**
 * Formun istemci tarafı denetimi: `validate({ alan: koşul && 'mesaj' })` hata varsa false döner.
 * `attempt` her başarısız denemede artar (FormField'ın shakeKey'ine verilir).
 */
export function useFormErrors<K extends string>() {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const validate = useCallback((checks: Checks<K>): boolean => {
    const next: Partial<Record<K, string>> = {};
    for (const key of Object.keys(checks) as K[]) {
      const message = checks[key];
      if (typeof message === 'string' && message) next[key] = message;
    }
    setErrors(next);
    const ok = Object.keys(next).length === 0;
    if (!ok) setAttempt((n) => n + 1);
    return ok;
  }, []);

  /** Kullanıcı alanı düzeltmeye başlayınca o alanın hatası kalkar */
  const clear = useCallback((key: K): void => {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback((): void => setErrors({}), []);

  return { errors, attempt, validate, clear, reset };
}

/** Hatalı ilk alana odaklanır (hata durumu çizildikten sonra). */
export function focusFirstInvalid(root: HTMLElement | null): void {
  requestAnimationFrame(() => {
    root?.querySelector<HTMLElement>('.field-invalid :is(input, textarea, [role="combobox"])')?.focus();
  });
}

/** Sık kullanılan doğrulama mesajları */
export const REQUIRED = 'Bu alan zorunlu.';

/**
 * Formun geneline ait hata (ör. sunucunun reddi): kayarak belirir, her denemede sallanır.
 * `shakeKey` her başarısız gönderimde değişmeli.
 */
export function FormAlert({ message, shakeKey, className }: { message: string | null | undefined; shakeKey?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) shake(ref.current);
  }, [message, shakeKey]);
  if (!message) return null;
  return (
    <div
      ref={ref}
      role="alert"
      className={cn('anim-slide-down mb-4 flex items-start gap-2 rounded-[3px] bg-danger/15 px-3 py-2 text-sm text-danger-text', className)}
    >
      <CircleAlert size={16} className="mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}
