import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { usePresence } from '../../lib/motion';
import { cn } from '../../lib/utils';

export interface SelectOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
  /** Değer seçeneklerde yoksa gösterilen metin */
  placeholder?: string;
  'aria-label'?: string;
  id?: string;
}

const LIST_MAX_HEIGHT = 300;
const GAP = 4;
const MARGIN = 8;
const TYPEAHEAD_RESET_MS = 600;

interface Position {
  style: CSSProperties;
  above: boolean;
}

/**
 * Temalı açılır liste (Windows'un beyaz <select> penceresi yerine). Klavye: ok tuşları, Home/End,
 * PageUp/PageDown, Enter/Boşluk ile seçim, Esc ile kapatma ve harf yazarak arama.
 * Odak düğmede kalır; liste aria-activedescendant ile okunur.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
  disabled,
  placeholder = 'Seç',
  'aria-label': ariaLabel,
  id,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const listId = useId();
  const presence = usePresence(open, 90);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const enabledFrom = useCallback(
    (start: number, step: 1 | -1): number => {
      for (let i = start; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
      return -1;
    },
    [options],
  );

  const openList = (): void => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : enabledFrom(0, 1));
    setOpen(true);
  };
  const close = useCallback((): void => setOpen(false), []);
  const choose = (index: number): void => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  // Liste düğmenin altında (sığmazsa üstünde) ve en az düğme genişliğinde açılır
  const measure = useCallback((): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const topLimit = MARGIN + (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h')) || 0);
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const aboveSpace = r.top - GAP - topLimit;
    const wanted = Math.min(LIST_MAX_HEIGHT, options.length * 36 + 12);
    const above = below < wanted && aboveSpace > below;
    const maxHeight = Math.max(120, Math.min(LIST_MAX_HEIGHT, above ? aboveSpace : below));
    const width = Math.max(r.width, 160);
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN));
    setPosition({
      above,
      style: {
        left,
        width,
        maxHeight,
        ...(above ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      },
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  // Dışarı tıklama, pencere değişimi ve dışarıdaki kaydırma listeyi kapatır
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) close();
    };
    const onScroll = (e: Event): void => {
      if (!listRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, close]);

  // Klavyeyle seçilen öğe görünür kalsın
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, position]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const key = e.key;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    const move = (index: number): void => {
      if (index >= 0) setActive(index);
    };
    switch (key) {
      case 'ArrowDown':
        move(enabledFrom(active + 1, 1));
        break;
      case 'ArrowUp':
        move(enabledFrom(active - 1, -1));
        break;
      case 'Home':
        move(enabledFrom(0, 1));
        break;
      case 'End':
        move(enabledFrom(options.length - 1, -1));
        break;
      case 'PageDown':
        move(enabledFrom(Math.min(options.length - 1, active + 6), -1));
        break;
      case 'PageUp':
        move(enabledFrom(Math.max(0, active - 6), 1));
        break;
      case 'Enter':
      case ' ':
        if (key === ' ' && typeahead.current.text && Date.now() - typeahead.current.at < TYPEAHEAD_RESET_MS) {
          search(' ');
          break;
        }
        choose(active);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        close();
        return; // odak normal şekilde ilerlesin
      default:
        if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) search(key);
        else return;
    }
    // Esc gibi tuşlar ayarlar penceresine/modala ulaşıp onu kapatmasın
    e.preventDefault();
    e.stopPropagation();
  };

  // Harf yazınca o harflerle başlayan ilk seçeneğe atla
  const search = (char: string): void => {
    const now = Date.now();
    const state = typeahead.current;
    state.text = now - state.at > TYPEAHEAD_RESET_MS ? char : state.text + char;
    state.at = now;
    const query = state.text.toLocaleLowerCase('tr');
    const start = state.text.length === 1 ? active + 1 : active;
    for (let n = 0; n < options.length; n++) {
      const i = (start + n) % options.length;
      const o = options[i]!;
      if (!o.disabled && o.label.toLocaleLowerCase('tr').startsWith(query)) {
        setActive(i);
        return;
      }
    }
  };

  const optionId = (i: number): string => `${listId}-o${i}`;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        // Odak başka yere giderse (klavye olayları artık buraya gelmez) liste kapanır
        onBlur={close}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-[3px] border bg-bg-input pr-2 pl-2.5 text-left text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          open ? 'border-brand/70' : 'border-transparent hover:border-black/60',
          selected ? 'text-text-normal' : 'text-text-faint',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-text-muted transition-transform duration-200', open && 'rotate-180 text-text-head')}
        />
      </button>
      {presence.value &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            // Odak düğmede kalsın (klavye olayları orada işlenir)
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              'scroll-thin fixed z-[70] overflow-y-auto rounded-md border border-black/40 bg-bg-float p-1 shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
              presence.closing ? 'anim-drop-out pointer-events-none' : 'anim-drop-in',
            )}
            style={{
              ...(position?.style ?? { visibility: 'hidden' }),
              transformOrigin: position?.above ? 'bottom' : 'top',
              ['--drop-from' as string]: position?.above ? '4px' : '-4px',
            }}
          >
            {options.map((o, i) => {
              const isSelected = i === selectedIndex;
              return (
                <div
                  key={String(o.value)}
                  id={optionId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => choose(i)}
                  className={cn(
                    'flex min-h-9 cursor-pointer items-center gap-2 rounded-[3px] px-2.5 py-1.5 text-[15px] transition-colors duration-75',
                    o.disabled && 'cursor-not-allowed opacity-40',
                    i === active ? 'bg-bg-hover text-text-head' : isSelected ? 'text-text-head' : 'text-text-normal',
                  )}
                >
                  <span className="min-w-0 flex-1">{o.label}</span>
                  {isSelected && <Check size={16} className="shrink-0 text-brand" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
