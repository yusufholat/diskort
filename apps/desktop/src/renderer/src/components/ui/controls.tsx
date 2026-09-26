import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand hover:bg-brand-hover text-white',
  secondary: 'bg-[#4e5058] hover:bg-[#6d6f78] text-white',
  danger: 'bg-danger hover:bg-danger-hover text-white',
  success: 'bg-ok hover:bg-[#1a8b4c] text-white',
  ghost: 'bg-transparent hover:underline text-text-normal',
};

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        'h-[38px] rounded-[3px] px-4 text-sm font-medium transition-colors disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span
        className={cn(
          'mb-2 block text-xs font-bold tracking-wide uppercase',
          error ? 'text-danger' : 'text-text-muted',
        )}
      >
        {label}
        {error && <span className="font-normal normal-case italic"> — {error}</span>}
      </span>
      {children}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-[3px] bg-bg-input px-2.5 text-[15px] text-text-normal outline-none placeholder:text-text-faint',
        className,
      )}
      {...rest}
    />
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <select
      className={cn('h-10 w-full rounded-[3px] bg-bg-input px-2 text-[15px] text-text-normal outline-none', className)}
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <div>
        <div className="font-medium text-text-head">{label}</div>
        {description && <div className="mt-0.5 text-sm text-text-muted">{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors',
          checked ? 'bg-ok' : 'bg-[#80848e]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function RadioCards<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; description?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex items-center gap-3 rounded-[3px] px-3 py-2.5 text-left transition-colors',
            value === o.value ? 'bg-bg-active text-text-head' : 'bg-bg-side hover:bg-bg-hover',
          )}
        >
          <span
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
              value === o.value ? 'border-brand' : 'border-text-muted',
            )}
          >
            {value === o.value && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
          </span>
          <span>
            <span className="block font-medium">{o.label}</span>
            {o.description && <span className="block text-sm text-text-muted">{o.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-xs font-bold tracking-wide text-text-muted uppercase">{children}</h3>;
}

export function Divider() {
  return <div className="my-5 h-px bg-line" />;
}
