import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { EMOJI_CATEGORIES } from '@diskort/client-core';
import { colors, createStyles } from '../theme';

const COLUMNS = 8;
const PADDING = 12;

/** Kategorili emoji ızgarası (tepki seçici); satırda sekiz emoji. */
export function EmojiGrid({ onPick }: { onPick: (emoji: string) => void }) {
  const { width, height } = useWindowDimensions();
  const cell = Math.floor((width - PADDING * 2) / COLUMNS);
  return (
    <ScrollView style={{ maxHeight: height * 0.5 }} contentContainerStyle={{ paddingHorizontal: PADDING, paddingBottom: 8 }}>
      {EMOJI_CATEGORIES.map((category) => (
        <View key={category.id}>
          <Text style={styles.title}>{category.label}</Text>
          <View style={styles.grid}>
            {category.emojis.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onPick(emoji)}
                style={({ pressed }) => [styles.cell, { width: cell, height: cell }, pressed && styles.pressed]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = createStyles(() => ({
  title: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  pressed: { backgroundColor: colors.hover },
  emoji: { fontSize: 30 },
}));
