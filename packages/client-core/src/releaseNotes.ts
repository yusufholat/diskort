/**
 * Sürüm notlarını ("Yenilikler" sayfası) ekranda gösterilecek bloklara ayırır. Notlar kısa Markdown'dır:
 * "## Başlık", "**Bölüm**" satırları, "- madde" listeleri ve **kalın** yazı. Diğer her şey düz metindir.
 */
export type NotePart = { text: string; bold: boolean };
export type NoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; parts: NotePart[] }
  | { kind: 'text'; parts: NotePart[] };

function inline(text: string): NotePart[] {
  const parts: NotePart[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), bold: false });
    parts.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}

export function parseReleaseNotes(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    // Sürüm başlığı ("## Diskort 0.5.0") sayfada zaten sürüm olarak gösterilir
    if (heading) {
      if (!/^Diskort\s+\d/.test(heading[1]!)) blocks.push({ kind: 'heading', text: heading[1]! });
      continue;
    }
    const bolded = /^\*\*(.+?)\*\*:?$/.exec(line.trim());
    if (bolded) {
      blocks.push({ kind: 'heading', text: bolded[1]!.replace(/:$/, '') });
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) blocks.push({ kind: 'item', parts: inline(item[1]!) });
    else blocks.push({ kind: 'text', parts: inline(line.trim()) });
  }
  return blocks;
}
