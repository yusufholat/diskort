import { useState, type ReactNode } from 'react';
import { parseMarkdown, type MdInline } from '@diskort/client-core';
import type { User } from '@diskort/shared';
import { cn } from '../../lib/utils';

/**
 * Ortak çekirdeğin ayrıştırdığı biçimlendirme ağacını React DOM öğelerine çizer.
 * HTML hiçbir zaman yorumlanmaz; bağlantılar varsayılan tarayıcıda açılır.
 */
export interface MarkdownContext {
  usersByName: Record<string, User>;
  selfId: string | undefined;
}

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

function renderInline(nodes: MdInline[], ctx: MarkdownContext, key: string): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}.${i}`;
    switch (node.type) {
      case 'text':
        return node.text;
      case 'code':
        return (
          <code key={k} className="rounded bg-[#1e1f22] px-1 py-px font-mono text-[0.85em] text-text-normal">
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a key={k} href={node.url} target="_blank" rel="noreferrer" className="text-[#00a8fc] hover:underline">
            {node.url}
          </a>
        );
      case 'mention': {
        const user = ctx.usersByName[node.username];
        if (!user) return node.raw;
        return (
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
          </span>
        );
      }
      case 'bold':
        return <strong key={k}>{renderInline(node.children, ctx, k)}</strong>;
      case 'italic':
        return <em key={k}>{renderInline(node.children, ctx, k)}</em>;
      case 'underline':
        return <u key={k}>{renderInline(node.children, ctx, k)}</u>;
      case 'strike':
        return <s key={k}>{renderInline(node.children, ctx, k)}</s>;
      case 'spoiler':
        return <Spoiler key={k}>{renderInline(node.children, ctx, k)}</Spoiler>;
    }
  });
}

export function renderMarkdown(content: string, ctx: MarkdownContext): ReactNode[] {
  return parseMarkdown(content).flatMap((block, i): ReactNode[] => {
    const k = `b${i}`;
    switch (block.type) {
      case 'paragraph':
        return renderInline(block.children, ctx, k);
      case 'quote':
        return [
          <blockquote key={k} className="my-0.5 border-l-4 border-text-faint/60 pl-3">
            {renderInline(block.children, ctx, k)}
          </blockquote>,
        ];
      case 'codeblock':
        return [
          <pre
            key={k}
            className="my-1 max-w-full overflow-x-auto rounded border border-black/30 bg-[#2b2d31] p-2 font-mono text-[0.85em] leading-snug whitespace-pre text-text-normal"
          >
            {block.text}
          </pre>,
        ];
    }
  });
}
