import { useState, type ReactNode } from 'react';
import type { User } from '@diskort/shared';
import { cn } from '../../lib/utils';

/**
 * Discord benzeri sade biçimlendirme: **kalın**, *italik*, __altı çizili__, ~~üstü çizili~~,
 * ||sürpriz||, `kod`, ```kod bloğu```, > alıntı, bağlantılar ve @bahsetmeler.
 * HTML hiçbir zaman yorumlanmaz; çıktı yalnızca React öğeleridir.
 */
export interface MarkdownContext {
  usersByName: Record<string, User>;
  selfId: string | undefined;
}

type InlineRule = { name: string; re: RegExp };

// Aynı konumda eşleşen kurallardan listede önce gelen kazanır (** önce *, __ önce _).
const INLINE: InlineRule[] = [
  { name: 'code', re: /`([^`\n]+)`/ },
  { name: 'url', re: /https?:\/\/[^\s<>"]*[^\s<>".,:;'!?)\]]/i },
  { name: 'mention', re: /(?<![\w.@])@([a-z0-9_.]*[a-z0-9_])/i },
  { name: 'bold', re: /\*\*([\s\S]+?)\*\*/ },
  { name: 'underline', re: /__([\s\S]+?)__/ },
  { name: 'italic', re: /\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<![a-z0-9])_([^_\n]+?)_(?![a-z0-9])/i },
  { name: 'strike', re: /~~([\s\S]+?)~~/ },
  { name: 'spoiler', re: /\|\|([\s\S]+?)\|\|/ },
];

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={cn(
        'rounded px-0.5 transition-colors',
        shown ? 'bg-white/10' : 'cursor-pointer bg-[#1e1f22] text-transparent select-none hover:bg-[#232428]',
      )}
      onClick={() => setShown(true)}
      title={shown ? undefined : 'Göstermek için tıkla'}
    >
      <span className={shown ? undefined : 'invisible'}>{children}</span>
    </span>
  );
}

function parseInline(text: string, ctx: MarkdownContext, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { rule: InlineRule; m: RegExpExecArray } | null = null;
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { rule, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { rule, m } = best;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${key}.${n++}`;
    const inner = m[1] ?? m[2] ?? '';
    switch (rule.name) {
      case 'code':
        out.push(
          <code key={k} className="rounded bg-[#1e1f22] px-1 py-px font-mono text-[0.85em] text-text-normal">
            {inner}
          </code>,
        );
        break;
      case 'url':
        out.push(
          <a key={k} href={m[0]} target="_blank" rel="noreferrer" className="text-[#00a8fc] hover:underline">
            {m[0]}
          </a>,
        );
        break;
      case 'mention': {
        const user = ctx.usersByName[inner.toLowerCase()];
        if (!user) {
          out.push(m[0]);
          break;
        }
        out.push(
          <span
            key={k}
            className={cn(
              'rounded-[3px] px-0.5 font-medium',
              user.id === ctx.selfId
                ? 'bg-brand/40 text-white'
                : 'bg-brand/20 text-[#c9cdfb] hover:bg-brand hover:text-white',
            )}
            title={`@${user.username}`}
          >
            @{user.displayName}
          </span>,
        );
        break;
      }
      case 'bold':
        out.push(<strong key={k}>{parseInline(inner, ctx, k)}</strong>);
        break;
      case 'underline':
        out.push(<u key={k}>{parseInline(inner, ctx, k)}</u>);
        break;
      case 'italic':
        out.push(<em key={k}>{parseInline(inner, ctx, k)}</em>);
        break;
      case 'strike':
        out.push(<s key={k}>{parseInline(inner, ctx, k)}</s>);
        break;
      case 'spoiler':
        out.push(<Spoiler key={k}>{parseInline(inner, ctx, k)}</Spoiler>);
        break;
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** Kod bloğu dışındaki metin: "> " ile başlayan ardışık satırlar alıntı bloğu olur. */
function parseText(text: string, ctx: MarkdownContext, key: string): ReactNode[] {
  const groups: { quote: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const q = /^> ?(.*)$/.exec(line);
    const quote = q !== null;
    const last = groups.at(-1);
    if (last && last.quote === quote) last.lines.push(q ? q[1]! : line);
    else groups.push({ quote, lines: [q ? q[1]! : line] });
  }
  return groups.flatMap((g, i): ReactNode[] => {
    const k = `${key}.${i}`;
    const inline = parseInline(g.lines.join('\n'), ctx, k);
    return g.quote
      ? [
          <blockquote key={k} className="my-0.5 border-l-4 border-text-faint/60 pl-3">
            {inline}
          </blockquote>,
        ]
      : inline;
  });
}

const CODE_BLOCK = /```(?:([a-z0-9+#.-]+)\n)?\n?([\s\S]*?)\n?```/gi;

export function renderMarkdown(content: string, ctx: MarkdownContext): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of content.matchAll(CODE_BLOCK)) {
    // Bloğun hemen önündeki/ardındaki satır sonu fazladan boş satır oluşturmasın
    const before = content.slice(last, m.index).replace(/\n$/, '');
    if (before) out.push(...parseText(before, ctx, `t${n++}`));
    out.push(
      <pre
        key={`c${n++}`}
        className="my-1 max-w-full overflow-x-auto rounded border border-black/30 bg-[#2b2d31] p-2 font-mono text-[0.85em] leading-snug whitespace-pre text-text-normal"
      >
        {m[2]}
      </pre>,
    );
    last = m.index + m[0].length;
    if (content[last] === '\n') last++;
  }
  if (last < content.length) out.push(...parseText(content.slice(last), ctx, `t${n}`));
  return out;
}
