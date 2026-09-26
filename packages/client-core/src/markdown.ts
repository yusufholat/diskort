/**
 * Discord benzeri sade biçimlendirmenin ayrıştırıcısı: **kalın**, *italik*, __altı çizili__,
 * ~~üstü çizili~~, ||sürpriz||, `kod`, ```kod bloğu```, > alıntı, bağlantılar ve @bahsetmeler.
 * Çıktı platformdan bağımsız bir ağaçtır; masaüstü React DOM'a, mobil React Native'e çizer.
 * HTML hiçbir zaman yorumlanmaz.
 */

export type MdStyle = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; url: string }
  /** Kullanıcı adı küçük harfle; böyle bir kullanıcı yoksa çizici `raw` metni gösterir */
  | { type: 'mention'; username: string; raw: string }
  | { type: MdStyle; children: MdInline[] };

export type MdBlock =
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'quote'; children: MdInline[] }
  | { type: 'codeblock'; lang: string | null; text: string };

type InlineRule = { name: 'code' | 'url' | 'mention' | MdStyle; re: RegExp };

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

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  const pushText = (t: string): void => {
    const last = out.at(-1);
    if (last?.type === 'text') last.text += t;
    else out.push({ type: 'text', text: t });
  };
  let rest = text;
  while (rest) {
    let best: { rule: InlineRule; m: RegExpExecArray } | null = null;
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { rule, m };
    }
    if (!best) {
      pushText(rest);
      break;
    }
    const { rule, m } = best;
    if (m.index > 0) pushText(rest.slice(0, m.index));
    const inner = m[1] ?? m[2] ?? '';
    switch (rule.name) {
      case 'code':
        out.push({ type: 'code', text: inner });
        break;
      case 'url':
        out.push({ type: 'link', url: m[0] });
        break;
      case 'mention':
        out.push({ type: 'mention', username: inner.toLowerCase(), raw: m[0] });
        break;
      default:
        out.push({ type: rule.name, children: parseInline(inner) });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** Kod bloğu dışındaki metin: "> " ile başlayan ardışık satırlar alıntı bloğu olur. */
function parseText(text: string): MdBlock[] {
  const groups: { quote: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const q = /^> ?(.*)$/.exec(line);
    const quote = q !== null;
    const last = groups.at(-1);
    if (last && last.quote === quote) last.lines.push(q ? q[1]! : line);
    else groups.push({ quote, lines: [q ? q[1]! : line] });
  }
  return groups.map((g) => ({ type: g.quote ? 'quote' : 'paragraph', children: parseInline(g.lines.join('\n')) }));
}

const CODE_BLOCK = /```(?:([a-z0-9+#.-]+)\n)?\n?([\s\S]*?)\n?```/gi;

export function parseMarkdown(content: string): MdBlock[] {
  const out: MdBlock[] = [];
  let last = 0;
  for (const m of content.matchAll(CODE_BLOCK)) {
    // Bloğun hemen önündeki/ardındaki satır sonu fazladan boş satır oluşturmasın
    const before = content.slice(last, m.index).replace(/\n$/, '');
    if (before) out.push(...parseText(before));
    out.push({ type: 'codeblock', lang: m[1]?.toLowerCase() ?? null, text: m[2] ?? '' });
    last = m.index + m[0].length;
    if (content[last] === '\n') last++;
  }
  if (last < content.length) out.push(...parseText(content.slice(last)));
  return out;
}
