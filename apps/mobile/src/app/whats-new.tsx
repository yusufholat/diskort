import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage, parseReleaseNotes, type NotePart } from '@diskort/client-core';
import type { ReleaseNotes } from '@diskort/shared';
import { Bone, Pulse, TextSkeleton } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useAppear } from '../motion';
import { colors, font, radius, space } from '../theme';
import { APP_VERSION } from '../version';

const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

/**
 * Ayarlar → Yenilikler: yayınlanmış sürümlerin notları, en yenisi üstte. Açılışta açılır pencere ya
 * da bildirim olarak gösterilmez; isteyen buradan okur. Aşağı çekince yenilenir.
 */
export default function WhatsNewScreen() {
  const [releases, setReleases] = useState<ReleaseNotes[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.releaseNotes();
      setReleases(next);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = (): void => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  const retry = (): void => {
    setError(null);
    setReleases(null);
    void load();
  };

  return (
    <SafeAreaView style={styles.page} edges={['bottom']}>
      {releases === null && error ? (
        <ErrorState text={`Sürüm notları yüklenemedi. ${error}`} onRetry={retry} />
      ) : releases === null ? (
        <View style={styles.list}>
          {[0, 1].map((i) => (
            <View key={i} style={styles.card}>
              <Pulse label="Sürüm notları yükleniyor" style={styles.cardHead}>
                <Bone style={{ width: 130, height: 16 }} />
              </Pulse>
              <TextSkeleton lines={i === 0 ? 5 : 3} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={releases}
          keyExtractor={(r) => r.version}
          contentContainerStyle={[styles.list, releases.length === 0 && { flexGrow: 1 }]}
          renderItem={({ item, index }) => <ReleaseCard release={item} latest={index === 0} />}
          initialNumToRender={3}
          windowSize={5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              colors={[colors.brand]}
              progressBackgroundColor={colors.side}
            />
          }
          ListHeaderComponent={
            error ? <Text style={styles.inlineError}>Yenilenemedi: {error}</Text> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="sparkles-outline"
              tone="muted"
              title="Henüz sürüm notu yok"
              text="Yeni bir sürüm yayınlandığında neler değiştiği burada görünecek."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const ReleaseCard = memo(function ReleaseCard({ release, latest }: { release: ReleaseNotes; latest: boolean }) {
  const blocks = useMemo(() => parseReleaseNotes(release.notes), [release.notes]);
  const installed = release.version === APP_VERSION;
  const appear = useAppear(true, 240);
  return (
    <Animated.View
      style={[
        styles.card,
        latest && styles.cardLatest,
        { opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.version}>Diskort {release.version}</Text>
        {latest && (
          <View style={[styles.tag, { backgroundColor: colors.brand }]}>
            <Text style={styles.tagText}>Son</Text>
          </View>
        )}
        {installed && (
          <View style={[styles.tag, { backgroundColor: colors.okSoft }]}>
            <Text style={[styles.tagText, { color: '#2dc770' }]}>Yüklü</Text>
          </View>
        )}
        <Text style={styles.date}>{formatDate(release.publishedAt)}</Text>
      </View>
      {blocks.length === 0 ? (
        <Text style={[styles.text, { color: colors.muted }]}>Bu sürüm için not yazılmamış.</Text>
      ) : (
        blocks.map((b, i) =>
          b.kind === 'heading' ? (
            <Text key={i} style={[styles.heading, i === 0 && { marginTop: 0 }]}>
              {b.text}
            </Text>
          ) : b.kind === 'item' ? (
            <View key={i} style={styles.item}>
              <View style={styles.bullet} />
              <Text style={[styles.text, { flex: 1 }]}>
                <Parts parts={b.parts} />
              </Text>
            </View>
          ) : (
            <Text key={i} style={[styles.text, styles.paragraph]}>
              <Parts parts={b.parts} />
            </Text>
          ),
        )
      )}
    </Animated.View>
  );
});

function Parts({ parts }: { parts: NotePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <Text key={i} style={styles.bold}>
            {p.text}
          </Text>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.main },
  list: { padding: space.md, gap: space.md },
  card: {
    backgroundColor: colors.side,
    borderRadius: radius.lg - 4,
    padding: space.lg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardLatest: { borderColor: 'rgba(88,101,242,0.45)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm + 2 },
  version: { color: colors.head, fontSize: font.title + 1, fontWeight: '800' },
  tag: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { color: '#fff', fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  date: { marginLeft: 'auto', color: colors.muted, fontSize: font.caption },
  heading: {
    color: colors.muted,
    fontSize: font.caption,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  item: { flexDirection: 'row', gap: space.sm + 2, marginVertical: 3 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, marginTop: 9 },
  text: { color: colors.text, fontSize: font.body - 0.5, lineHeight: 22 },
  paragraph: { marginVertical: 3 },
  bold: { color: colors.head, fontWeight: '700' },
  inlineError: { color: colors.dangerText, fontSize: font.small, textAlign: 'center', marginBottom: space.xs },
});
