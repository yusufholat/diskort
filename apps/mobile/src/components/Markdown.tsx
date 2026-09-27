import { Fragment, useState, type ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';
import { broadcastMention, parseMarkdown, type MdInline } from '@diskort/client-core';
import type { Message, User } from '@diskort/shared';
import { colors, createStyles } from '../theme';

/** Ortak çekirdeğin ayrıştırdığı biçimlendirmeyi React Native metnine çizer. */
export interface MarkdownContext {
  usersByName: Record<string, User>;
  selfId: string | undefined;
  /** Çizilen mesajın @everyone / @here bayrakları: yalnızca bildirim olduysa vurgulanır (yoksa düz metin) */
  flags?: Pick<Message, 'mentionEveryone' | 'mentionHere'>;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <Text
      onPress={() => setShown(true)}
      style={shown ? styles.spoilerShown : styles.spoilerHidden}
      suppressHighlighting
    >
      {children}
    </Text>
  );
}

function inline(nodes: MdInline[], ctx: MarkdownContext, key: string): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}.${i}`;
    switch (node.type) {
      case 'text':
        return <Fragment key={k}>{node.text}</Fragment>;
      case 'code':
        return (
          <Text key={k} style={styles.code}>
            {node.text}
          </Text>
        );
      case 'link':
        return (
          <Text key={k} style={styles.link} onPress={() => void Linking.openURL(node.url)}>
            {node.url}
          </Text>
        );
      case 'mention': {
        const broadcast = broadcastMention(node.username, ctx.flags);
        if (broadcast) {
          return (
            <Text key={k} style={styles.mention}>
              @{broadcast}
            </Text>
          );
        }
        const user = ctx.usersByName[node.username];
        if (!user) return <Fragment key={k}>{node.raw}</Fragment>;
        return (
          <Text key={k} style={[styles.mention, user.id === ctx.selfId && styles.mentionSelf]}>
            @{user.displayName}
          </Text>
        );
      }
      case 'bold':
        return (
          <Text key={k} style={styles.bold}>
            {inline(node.children, ctx, k)}
          </Text>
        );
      case 'italic':
        return (
          <Text key={k} style={styles.italic}>
            {inline(node.children, ctx, k)}
          </Text>
        );
      case 'underline':
        return (
          <Text key={k} style={styles.underline}>
            {inline(node.children, ctx, k)}
          </Text>
        );
      case 'strike':
        return (
          <Text key={k} style={styles.strike}>
            {inline(node.children, ctx, k)}
          </Text>
        );
      case 'spoiler':
        return <Spoiler key={k}>{inline(node.children, ctx, k)}</Spoiler>;
    }
  });
}

export function Markdown({ content, ctx, dim }: { content: string; ctx: MarkdownContext; dim?: boolean }) {
  const blocks = parseMarkdown(content);
  return (
    <View style={dim && styles.dim}>
      {blocks.map((block, i) => {
        const k = `b${i}`;
        switch (block.type) {
          case 'paragraph':
            return (
              <Text key={k} style={styles.text} selectable>
                {inline(block.children, ctx, k)}
              </Text>
            );
          case 'quote':
            return (
              <View key={k} style={styles.quote}>
                <Text style={styles.text} selectable>
                  {inline(block.children, ctx, k)}
                </Text>
              </View>
            );
          case 'codeblock':
            return (
              <View key={k} style={styles.codeBlock}>
                <Text style={styles.codeBlockText} selectable>
                  {block.text}
                </Text>
              </View>
            );
        }
      })}
    </View>
  );
}

const mono = 'monospace';

const styles = createStyles(() => ({
  text: { color: colors.text, fontSize: 15.5, lineHeight: 22 },
  dim: { opacity: 0.5 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
  code: { fontFamily: mono, fontSize: 13.5, backgroundColor: colors.code },
  link: { color: colors.link },
  mention: { color: '#c9cdfb', backgroundColor: 'rgba(88,101,242,0.3)', fontWeight: '500' },
  mentionSelf: { color: '#fff', backgroundColor: 'rgba(88,101,242,0.55)' },
  spoilerHidden: { backgroundColor: colors.code, color: colors.code },
  spoilerShown: { backgroundColor: 'rgba(255,255,255,0.1)' },
  quote: { borderLeftWidth: 4, borderLeftColor: colors.faint, paddingLeft: 10, marginVertical: 2 },
  codeBlock: {
    backgroundColor: colors.side,
    borderColor: colors.edge,
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    marginVertical: 4,
  },
  codeBlockText: { fontFamily: mono, fontSize: 13, color: colors.text, lineHeight: 18 },
}));
