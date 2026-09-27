import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  FEEDBACK_NOTE_MAX_LENGTH,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_LABELS,
  type Feedback,
  type FeedbackContext,
  type FeedbackStatus,
} from '@diskort/shared';
import {
  deleteFeedback,
  errorMessage,
  feedbackImageHeaders,
  feedbackScreenshotUrl,
  loadAllFeedback,
  updateFeedback,
  useFeedback,
  useFeedbackAuthor,
  useSession,
} from '@diskort/client-core';
import { TextSkeleton } from '../components/Skeleton';
import { Button } from '../components/ui';
import { animateNextLayout } from '../motion';
import { toast } from '../stores/ui';
import { brandTint, colors, createStyles, radius, ripple, tint } from '../theme';

/** Durum etiketinin renkleri (çizim sırasında okunur: tema değişince güncel) */
const statusColors = (): Record<FeedbackStatus, { bg: string; fg: string }> => ({
  yeni: { bg: brandTint(0.2), fg: colors.brandText },
  incelendi: { bg: 'rgba(0,168,252,0.15)', fg: colors.link },
  planlandi: { bg: colors.warnSoft, fg: colors.warn },
  tamamlandi: { bg: colors.okSoft, fg: colors.okText },
  reddedildi: { bg: tint(0.08), fg: colors.muted },
});

const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

const CONTEXT_LABELS: [Exclude<keyof FeedbackContext, 'recentErrors'>, string][] = [
  ['platform', 'Platform'],
  ['appVersion', 'Uygulama sürümü'],
  ['nativeVersion', 'APK sürümü'],
  ['os', 'İşletim sistemi'],
  ['osVersion', 'Sistem sürümü'],
  ['device', 'Cihaz'],
  ['screen', 'Ekran'],
  ['window', 'Pencere'],
  ['view', 'Görünüm'],
  ['inVoice', 'Seste'],
];

type Filter = FeedbackStatus | 'all';

/**
 * Ayarlar > Geri bildirimler (yönetim), yalnızca hesap yöneticilerine (hiçbir sunucuya bağlı değil):
 * gelen geri bildirimler, durum süzgeci; dokununca ayrıntı, durum, yanıt notu ve silme.
 */
export default function FeedbackAdminScreen() {
  const isAdmin = useSession((s) => s.user?.isAdmin === true);
  const all = useFeedback((s) => s.all);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (): Promise<void> => {
    setError(null);
    try {
      await loadAllFeedback();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<FeedbackStatus, number>;
    for (const f of all ?? []) result[f.status]++;
    return result;
  }, [all]);
  const visible = useMemo(() => (all ?? []).filter((f) => filter === 'all' || f.status === filter), [all, filter]);

  if (!isAdmin) {
    return (
      <View style={[styles.page, styles.center]}>
        <Ionicons name="lock-closed-outline" size={28} color={colors.muted} />
        <Text style={styles.hint}>Geri bildirimleri yalnızca hesap yöneticileri yönetebilir.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          colors={[colors.brand]}
          progressBackgroundColor={colors.side}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Text style={styles.intro}>
        Üyelerin gönderdiği hata ve öneriler. Durumu değiştirince gönderen görür; yanıt notunu da okuyabilir.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {(['all', ...FEEDBACK_STATUSES] as Filter[]).map((f) => {
          const selected = filter === f;
          const label = f === 'all' ? `Tümü (${all?.length ?? 0})` : `${FEEDBACK_STATUS_LABELS[f]} (${counts[f]})`;
          return (
            <Pressable
              key={f}
              onPress={() => {
                animateNextLayout(160);
                setFilter(f);
              }}
              android_ripple={ripple.row}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && { color: colors.head }]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error && all === null ? (
        <View style={[styles.item, styles.stateBox]}>
          <Ionicons name="cloud-offline-outline" size={22} color={colors.dangerText} />
          <Text style={[styles.errorText, { flex: 1 }]}>Yüklenemedi: {error}</Text>
          <Pressable onPress={() => void load()} hitSlop={8} accessibilityRole="button">
            <Text style={styles.retry}>Tekrar dene</Text>
          </Pressable>
        </View>
      ) : all === null ? (
        <View style={[styles.item, { padding: 12 }]}>
          <TextSkeleton lines={4} />
        </View>
      ) : visible.length === 0 ? (
        <View style={[styles.item, styles.stateBox]}>
          <Ionicons name="mail-open-outline" size={22} color={colors.muted} />
          <Text style={[styles.hint, { marginTop: 0, flex: 1 }]}>
            {all.length === 0 ? 'Henüz geri bildirim yok.' : 'Bu süzgece uyan geri bildirim yok.'}
          </Text>
        </View>
      ) : (
        visible.map((f) => (
          <FeedbackItem
            key={f.id}
            item={f}
            open={openId === f.id}
            onToggle={() => {
              animateNextLayout(180);
              setOpenId(openId === f.id ? null : f.id);
            }}
          />
        ))
      )}
    </ScrollView>
  );
}

function FeedbackItem({ item, open, onToggle }: { item: Feedback; open: boolean; onToggle: () => void }) {
  const status = statusColors()[item.status];
  const author = useFeedbackAuthor(item.userId);
  const authorName = author ? author.displayName : item.userId ? 'Bilinmeyen kullanıcı' : 'Silinmiş kullanıcı';
  return (
    <View style={[styles.item, item.status === 'yeni' && styles.itemNew]}>
      <Pressable onPress={onToggle} android_ripple={ripple.row} style={styles.itemHeader} accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemTitle, item.status === 'yeni' && { fontWeight: '800' }]} numberOfLines={open ? undefined : 1}>
            {item.title ?? item.body.replace(/\s+/g, ' ')}
          </Text>
          <Text style={styles.itemMeta} numberOfLines={1}>
            {FEEDBACK_TYPE_LABELS[item.type]} · #{item.id} · {authorName} · {dateFormat.format(new Date(item.createdAt))}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeText, { color: status.fg }]}>{FEEDBACK_STATUS_LABELS[item.status]}</Text>
        </View>
      </Pressable>
      {open && <FeedbackDetail item={item} authorUsername={author?.username} />}
    </View>
  );
}

function FeedbackDetail({ item, authorUsername }: { item: Feedback; authorUsername?: string }) {
  const [note, setNote] = useState(item.adminNote ?? '');
  const [saving, setSaving] = useState<FeedbackStatus | 'note' | null>(null);
  const headers = feedbackImageHeaders();
  const noteChanged = note.trim() !== (item.adminNote ?? '');

  const setStatus = async (next: FeedbackStatus): Promise<void> => {
    if (next === item.status) return;
    setSaving(next);
    try {
      await updateFeedback(item.id, { status: next });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(null);
    }
  };

  const saveNote = async (): Promise<void> => {
    setSaving('note');
    try {
      await updateFeedback(item.id, { adminNote: note.trim() || null });
      toast('Not kaydedildi.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(null);
    }
  };

  const remove = (): void => {
    Alert.alert('Geri bildirimi sil', `#${item.id} ve ekran görüntüleri kalıcı olarak silinir. Gönderenin listesinden de kalkar.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => void deleteFeedback(item.id).catch((err: unknown) => toast(errorMessage(err), 'error')),
      },
    ]);
  };

  const context = item.context;
  const rows = context
    ? CONTEXT_LABELS.filter(([key]) => context[key] !== undefined && context[key] !== '').map(([key, label]) => {
        const value = context[key];
        return [label, typeof value === 'boolean' ? (value ? 'Evet' : 'Hayır') : String(value)] as const;
      })
    : [];

  return (
    <View style={styles.itemBody}>
      {authorUsername && <Text style={styles.itemMeta}>@{authorUsername}</Text>}
      <Text style={[styles.itemText, { marginTop: authorUsername ? 6 : 0 }]} selectable>
        {item.body}
      </Text>
      {item.screenshots.length > 0 && (
        <View style={styles.shots}>
          {item.screenshots.map((s) => (
            <Image key={s.id} source={{ uri: feedbackScreenshotUrl(s), headers }} style={styles.shotImage} resizeMode="cover" />
          ))}
        </View>
      )}
      {rows.length > 0 && (
        <View style={styles.contextTable}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.contextRow}>
              <Text style={styles.contextLabel}>{label}</Text>
              <Text style={styles.contextValue} selectable>
                {value}
              </Text>
            </View>
          ))}
          {(context?.recentErrors?.length ?? 0) > 0 && (
            <View style={{ marginTop: 4 }}>
              <Text style={styles.contextLabel}>Son hatalar</Text>
              {context!.recentErrors!.map((e, i) => (
                <Text key={i} style={styles.errorLine} selectable>
                  {e}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      <Text style={styles.label}>Durum</Text>
      <View style={styles.statusRow}>
        {FEEDBACK_STATUSES.map((s) => {
          const selected = item.status === s;
          const c = statusColors()[s];
          return (
            <Pressable
              key={s}
              onPress={() => void setStatus(s)}
              disabled={saving !== null}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.statusChip, selected ? { backgroundColor: c.bg, borderColor: c.fg } : null, saving === s && { opacity: 0.5 }]}
            >
              <Text style={[styles.chipText, selected && { color: c.fg, fontWeight: '700' }]}>{FEEDBACK_STATUS_LABELS[s]}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Yanıt notu (gönderen görür)</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={FEEDBACK_NOTE_MAX_LENGTH}
        placeholder="Ör. 0.5.4 ile düzeltildi"
        placeholderTextColor={colors.faint}
        selectionColor={colors.brand}
        style={styles.note}
      />
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button title="Notu kaydet" busy={saving === 'note'} disabled={!noteChanged || saving !== null} onPress={() => void saveNote()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Sil" variant="danger" disabled={saving !== null} onPress={remove} />
        </View>
      </View>
    </View>
  );
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: colors.main },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  content: { padding: 16, paddingBottom: 48 },
  intro: { color: colors.muted, fontSize: 14.5, lineHeight: 20, marginBottom: 12 },
  hint: { color: colors.muted, fontSize: 13.5, textAlign: 'center' },
  errorText: { color: colors.dangerText, fontSize: 14 },
  filters: { gap: 8, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.side,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  chipSelected: { backgroundColor: colors.active, borderColor: colors.brand },
  chipText: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  item: { backgroundColor: colors.side, borderRadius: radius.lg - 4, marginBottom: 8, overflow: 'hidden' },
  itemNew: { borderLeftWidth: 4, borderLeftColor: colors.brand },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  retry: { color: colors.link, fontSize: 14, fontWeight: '600' },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  itemTitle: { color: colors.head, fontSize: 15, fontWeight: '600' },
  itemMeta: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  itemBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, padding: 12 },
  itemText: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  shots: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  shotImage: { width: 120, height: 90, borderRadius: radius.sm, backgroundColor: colors.rail },
  contextTable: { backgroundColor: colors.rail, borderRadius: radius.sm, padding: 10, gap: 4, marginTop: 10 },
  contextRow: { flexDirection: 'row', gap: 12 },
  contextLabel: { color: colors.muted, fontSize: 12.5, width: 112 },
  contextValue: { color: colors.text, fontSize: 12.5, flexShrink: 1 },
  errorLine: { color: colors.dangerText, fontSize: 12, marginTop: 2 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 8, textTransform: 'uppercase' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.main,
  },
  note: {
    minHeight: 80,
    maxHeight: 200,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    color: colors.text,
    padding: 10,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
}));
