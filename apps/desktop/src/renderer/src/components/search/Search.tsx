import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type UIEvent } from 'react';
import { Hash, Loader2, Paperclip, Search, SearchX, X } from 'lucide-react';
import {
  foldSearchText,
  SEARCH_HAS_LABELS,
  SEARCH_HAS_VALUES,
  type SearchResult,
  type SearchScope,
  type SearchSnippet,
  type User,
} from '@diskort/shared';
import {
  clearSearchResults,
  dmTitle,
  jumpToSearchResult,
  loadMoreSearch,
  runSearch,
  searchScopeKey,
  useGuild,
  useMemberColor,
  useSearch,
  useSession,
} from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { formatFull, formatStamp } from '../text/format';

// Discord'daki gibi mesaj araması: kanal başlığının sağında arama kutusu (Ctrl+F), sonuçlar sağdaki panelde.
// Kapsam seçili sunucu ya da açık direkt mesaj konuşmasıdır. İşleçler: from:, in:, has:, önce:, sonra:, tarih:.

/** Kutunun altındaki arama seçenekleri (boşken) */
const OPTIONS: { op: string; hint: string; dm?: boolean }[] = [
  { op: 'from:', hint: 'kullanıcı', dm: true },
  { op: 'in:', hint: 'kanal' },
  { op: 'has:', hint: 'bağlantı, resim, video ya da dosya', dm: true },
  { op: 'önce:', hint: 'GG.AA.YYYY', dm: true },
  { op: 'sonra:', hint: 'GG.AA.YYYY', dm: true },
  { op: 'tarih:', hint: 'GG.AA.YYYY, bugün, dün', dm: true },
];

interface Suggestion {
  key: string;
  /** Son sözcüğün yerine yazılacak */
  insert: string;
  label: string;
  detail?: string;
  user?: User;
}

const SUGGESTION_LIMIT = 8;

/** Son sözcük bir işleç değeriyse öneriler (kullanıcılar, kanallar, has: değerleri) */
function useSuggestions(text: string, dm: boolean): Suggestion[] {
  const users = useGuild((s) => s.users);
  const channels = useGuild((s) => s.channels);
  return useMemo(() => {
    const last = text.split(/\s/).at(-1) ?? '';
    const m = last.match(/^([^:\s]+):(.*)$/);
    if (!m) return [];
    const key = foldSearchText(m[1]!);
    const value = foldSearchText(m[2]!.replace(/^[@#]/, ''));
    if (key === 'from' || key === 'kimden') {
      return Object.values(users)
        .filter((u) => !u.removed)
        .filter((u) => foldSearchText(u.username).startsWith(value) || foldSearchText(u.displayName).startsWith(value))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'))
        .slice(0, SUGGESTION_LIMIT)
        .map((u) => ({ key: u.id, insert: `${m[1]}:${u.username} `, label: u.displayName, detail: u.username, user: u }));
    }
    if (!dm && (key === 'in' || key === 'kanal')) {
      return channels
        .filter((c) => c.type === 'text' && foldSearchText(c.name).startsWith(value))
        .slice(0, SUGGESTION_LIMIT)
        .map((c) => ({ key: c.id, insert: `${m[1]}:${c.name} `, label: `#${c.name}` }));
    }
    if (key === 'has' || key === 'iceren' || key === 'icerir') {
      return SEARCH_HAS_VALUES.map((h) => SEARCH_HAS_LABELS[h])
        .filter((label) => foldSearchText(label).startsWith(value))
        .map((label) => ({ key: label, insert: `${m[1]}:${label} `, label }));
    }
    return [];
  }, [text, dm, users, channels]);
}

/** Kanal başlığındaki arama kutusu */
export function SearchBox({ scope, placeholder }: { scope: SearchScope; placeholder: string }) {
  const key = searchScopeKey(scope);
  const current = useSearch((s) => (searchScopeKey(s.scope) === key ? s.query : ''));
  const [text, setText] = useState(current);
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dm = 'dmId' in scope;
  const suggestions = useSuggestions(text, dm);
  const showOptions = focused && (text === '' || /\s$/.test(text)) && suggestions.length === 0;
  const showSuggestions = focused && suggestions.length > 0;

  // Arama başka yerden kapatılınca (panelin X'i) kutu da boşalır
  useEffect(() => {
    setText(current);
  }, [current]);
  useEffect(() => setSelected(0), [suggestions]);

  // Ctrl+F: arama kutusuna odaklan
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      if (useUi.getState().modal) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const replaceLast = (insert: string): void => {
    const parts = text.split(/(\s)/);
    parts[parts.length - 1] = insert;
    setText(parts.join(''));
    input.current?.focus();
  };

  const submit = (): void => {
    if (!text.trim()) {
      clearSearchResults();
      return;
    }
    void runSearch(scope, text);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (showSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = suggestions.length;
      setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      return;
    }
    if (showSuggestions && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      replaceLast(suggestions[selected]!.insert);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      // Esc katmanlarına (ör. açık bir menüye) gitmesin
      e.preventDefault();
      if (text) {
        setText('');
        clearSearchResults();
      } else input.current?.blur();
    }
  };

  const wide = focused || text !== '';
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <div
        className={cn(
          'flex h-7 items-center gap-1 rounded bg-bg-deep px-2 text-sm transition-[width] duration-150',
          wide ? 'w-60' : 'w-36',
        )}
      >
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Mesajlarda ara"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-text-normal outline-none placeholder:text-text-muted"
        />
        {text ? (
          <button
            aria-label="Aramayı temizle"
            className="press-icon text-text-muted hover:text-text-normal"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText('');
              clearSearchResults();
            }}
          >
            <X size={16} />
          </button>
        ) : (
          <Search size={16} className="shrink-0 text-text-muted" />
        )}
      </div>
      {(showOptions || showSuggestions) && (
        <div
          className="anim-pop-in absolute top-9 right-0 z-40 w-72 overflow-hidden rounded-lg border border-edge bg-bg-float py-2 shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
          style={{ transformOrigin: '100% 0' }}
          // Tıklama kutudan odağı almasın
          onMouseDown={(e) => e.preventDefault()}
        >
          {showSuggestions ? (
            suggestions.map((s, i) => (
              <button
                key={s.key}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                  i === selected ? 'bg-bg-hover text-text-head' : 'text-text-normal hover:bg-bg-hover',
                )}
                onMouseEnter={() => setSelected(i)}
                onClick={() => replaceLast(s.insert)}
              >
                {s.user && <Avatar user={s.user} size={20} />}
                <span className="truncate">{s.label}</span>
                {s.detail && <span className="truncate text-xs text-text-muted">{s.detail}</span>}
              </button>
            ))
          ) : (
            <>
              <div className="px-3 pb-1 text-xs font-bold text-text-muted uppercase">Arama seçenekleri</div>
              {OPTIONS.filter((o) => !dm || o.dm).map((o) => (
                <button
                  key={o.op}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-hover"
                  onClick={() => {
                    setText((t) => `${t}${o.op}`);
                    input.current?.focus();
                  }}
                >
                  <span className="font-semibold text-text-head">{o.op}</span>
                  <span className="truncate text-text-muted">{o.hint}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Bu kapsamın arama sonuçları açık mı (sağdaki panel üye listesinin yerini alır) */
export function useSearchOpen(scope: SearchScope): boolean {
  const key = searchScopeKey(scope);
  return useSearch((s) => s.status !== 'idle' && searchScopeKey(s.scope) === key);
}

/** Özet: eşleşen sözcükler vurgulu */
function Highlighted({ snippet }: { snippet: SearchSnippet }) {
  const parts: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [a, b] of snippet.highlights) {
    if (a > at) parts.push({ text: snippet.text.slice(at, a), mark: false });
    parts.push({ text: snippet.text.slice(a, b), mark: true });
    at = b;
  }
  if (at < snippet.text.length) parts.push({ text: snippet.text.slice(at), mark: false });
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-sm bg-warn/30 px-px text-text-head">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function ResultCard({ result, onOpen }: { result: SearchResult; onOpen: (r: SearchResult) => void }) {
  const { message } = result;
  const author = useGuild((s) => (message.authorId ? s.users[message.authorId] : undefined));
  const fallback = useSearch((s) => (message.authorId ? s.users[message.authorId] : undefined));
  const user = author ?? fallback;
  const color = useMemberColor(message.authorId);
  const files = message.attachments.length;
  return (
    <button
      className="group/res flex w-full min-w-0 gap-3 rounded-lg border border-edge bg-bg-main p-3 text-left transition-colors hover:border-line hover:bg-msg-hover"
      onClick={() => onOpen(result)}
    >
      <Avatar user={user} size={32} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 leading-snug">
          <span
            className={cn('truncate font-medium', user ? 'text-text-head' : 'text-text-muted italic')}
            style={color ? { color } : undefined}
          >
            {user?.displayName ?? 'Silinmiş Kullanıcı'}
          </span>
          <span className="shrink-0 text-xs text-text-faint" data-tooltip={formatFull(message.createdAt)}>
            {formatStamp(message.createdAt)}
          </span>
          <span className="ml-auto shrink-0 rounded bg-bg-side px-1.5 text-xs font-medium text-text-muted opacity-0 transition-opacity group-hover/res:opacity-100">
            Atla
          </span>
        </div>
        {result.snippet.text && (
          <div className="line-clamp-4 text-[15px] leading-[1.375rem] break-words text-text-normal">
            <Highlighted snippet={result.snippet} />
          </div>
        )}
        {files > 0 && (
          <div className="mt-0.5 flex items-center gap-1 text-sm text-text-muted">
            <Paperclip size={14} />
            {files === 1 ? message.attachments[0]!.name : `${files} dosya`}
          </div>
        )}
      </div>
    </button>
  );
}

/** Kanal başlığı: arka arkaya aynı kanaldan gelen sonuçlar bir grupta */
function ChannelLabel({ result }: { result: SearchResult }) {
  const selfId = useSession((s) => s.user?.id);
  const dmName = useGuild((s) => {
    const dm = s.dms[result.channel.id];
    return dm ? dmTitle(dm, s.users, selfId) : '';
  });
  return (
    <div className="flex items-center gap-1 px-1 pt-2 pb-1 text-xs font-bold text-text-muted">
      {result.channel.guildId ? <Hash size={14} /> : null}
      <span className="truncate">{result.channel.guildId ? result.channel.name : dmName}</span>
    </div>
  );
}

/** Sağdaki arama sonuçları paneli */
export function SearchPanel() {
  const status = useSearch((s) => s.status);
  const results = useSearch((s) => s.results);
  const total = useSearch((s) => s.total);
  const capped = useSearch((s) => s.totalCapped);
  const more = useSearch((s) => s.nextCursor !== null);
  const loadingMore = useSearch((s) => s.loadingMore);
  const error = useSearch((s) => s.error);
  const list = useRef<HTMLDivElement>(null);
  const query = useSearch((s) => s.query);

  // Yeni aramada başa dön
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
  }, [query]);

  const onScroll = (e: UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) void loadMoreSearch();
  };

  const open = (r: SearchResult): void => {
    const ui = useUi.getState();
    if (r.channel.guildId === null) {
      if (!(ui.view.kind === 'dm' && ui.view.channelId === r.channel.id)) ui.setView({ kind: 'dm', channelId: r.channel.id });
    } else if (!(ui.view.kind === 'text' && ui.view.channelId === r.channel.id)) {
      ui.setView({ kind: 'text', channelId: r.channel.id });
    }
    void jumpToSearchResult(r);
  };

  return (
    <aside
      className="anim-fade-in flex h-full w-[420px] shrink-0 flex-col border-l border-edge bg-bg-side"
      aria-label="Arama sonuçları"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
        <span className="font-semibold text-text-head">
          {status === 'loading'
            ? 'Aranıyor…'
            : status === 'done'
              ? `${total}${capped ? '+' : ''} sonuç`
              : 'Arama'}
        </span>
        <span className="flex-1" />
        <button
          data-tooltip="Aramayı kapat"
          aria-label="Aramayı kapat"
          className="press-icon rounded p-1 text-text-muted hover:text-text-normal"
          onClick={() => clearSearchResults()}
        >
          <X size={20} />
        </button>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" onScroll={onScroll}>
        {status === 'loading' ? (
          <div className="flex flex-col gap-2 pt-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-bg-main" />
            ))}
          </div>
        ) : status === 'error' ? (
          <div className="px-4 py-10 text-center text-sm text-danger-text">{error}</div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-main text-text-muted">
              <SearchX size={26} />
            </div>
            <div className="font-semibold text-text-head">Sonuç bulunamadı</div>
            <div className="text-sm text-text-muted">Başka sözcükler dene ya da süzgeçleri kaldır.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map((r, i) => (
              <div key={r.message.id} className="flex flex-col gap-1">
                {results[i - 1]?.channel.id !== r.channel.id && <ChannelLabel result={r} />}
                <ResultCard result={r} onOpen={open} />
              </div>
            ))}
            {more && (
              <button
                className="press flex items-center justify-center gap-2 rounded py-2 text-sm text-link hover:underline"
                disabled={loadingMore}
                onClick={() => void loadMoreSearch()}
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                {loadingMore ? 'Yükleniyor…' : 'Daha fazla sonuç'}
              </button>
            )}
            {!more && error && <div className="py-2 text-center text-sm text-danger-text">{error}</div>}
          </div>
        )}
      </div>
    </aside>
  );
}
