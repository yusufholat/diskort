import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Image, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  FEEDBACK_BODY_MAX_LENGTH,
  FEEDBACK_MAX_SCREENSHOTS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TITLE_MAX_LENGTH,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  type Feedback,
  type FeedbackContext,
  type FeedbackStatus,
  type FeedbackType,
} from '@diskort/shared';
import {
  baseFeedbackContext,
  errorMessage,
  feedbackImageHeaders,
  feedbackScreenshotUrl,
  loadMyFeedback,
  submitFeedback,
  useFeedback,
  type LocalFile,
} from '@diskort/client-core';
import { PressableScale } from '../components/PressableScale';
import { Button, FadeIn, Field, SectionTitle, ui } from '../components/ui';
import { animateNextLayout } from '../motion';
import { toast } from '../stores/ui';
import { colors, radius } from '../theme';
import { NATIVE_VERSION } from '../version';
import { useVoice } from '../voice/voice';

const TYPE_ICONS: Record<FeedbackType, keyof typeof Ionicons.glyphMap> = {
  hata: 'bug-outline',
  oneri: 'bulb-outline',
  diger: 'chatbubble-outline',
};

const STATUS_COLORS: Record<FeedbackStatus, { bg: string; fg: string }> = {
  yeni: { bg: 'rgba(88,101,242,0.2)', fg: '#949cf7' },
  incelendi: { bg: 'rgba(0,168,252,0.15)', fg: colors.link },
  planlandi: { bg: 'rgba(240,178,50,0.15)', fg: colors.warn },
  tamamlandi: { bg: 'rgba(35,165,90,0.15)', fg: '#2dc770' },
  reddedildi: { bg: 'rgba(255,255,255,0.08)', fg: colors.muted },
};

const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

/** Telefonun teknik bilgileri (kullanıcı gönderimden önce görür ve kapatabilir) */
function mobileContext(): FeedbackContext {
  const screen = Dimensions.get('screen');
  const window = Dimensions.get('window');
  const release = (Platform.constants as { Release?: string }).Release;
  return {
    ...baseFeedbackContext(),
    nativeVersion: NATIVE_VERSION,
    os: Platform.OS,
    osVersion: release ? `${release} (API ${Platform.Version})` : String(Platform.Version),
    device: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || undefined,
    screen: `${Math.round(screen.width * PixelRatio.get())}×${Math.round(screen.height * PixelRatio.get())} @${PixelRatio.get()}x`,
    window: `${Math.round(window.width)}×${Math.round(window.height)} dp`,
    view: 'ayarlar',
    inVoice: useVoice.getState().status !== 'idle',
  };
}

const CONTEXT_LABELS: [keyof FeedbackContext, string][] = [
  ['platform', 'Platform'],
  ['appVersion', 'Uygulama sürümü'],
  ['nativeVersion', 'APK sürümü'],
  ['os', 'İşletim sistemi'],
  ['osVersion', 'Sistem sürümü'],
  ['device', 'Cihaz'],
  ['screen', 'Ekran'],
  ['window', 'Pencere'],
  ['inVoice', 'Seste'],
];

/** Ayarlar > Geri bildirim gönder: form ve "Geri bildirimlerim" (durum ve yanıtlar). */
export default function FeedbackScreen() {
  const router = useRouter();
  const [type, setType] = useState<FeedbackType>('hata');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [shots, setShots] = useState<LocalFile[]>([]);
  const [includeContext, setIncludeContext] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const context = useMemo(mobileContext, []);

  const pick = async (): Promise<void> => {
    const room = FEEDBACK_MAX_SCREENSHOTS - shots.length;
    if (room <= 0) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: room > 1,
        selectionLimit: room,
        quality: 1,
      });
      if (result.canceled) return;
      const files = result.assets.slice(0, room).map((a) => ({
        name: a.fileName ?? 'ekran.jpg',
        size: a.fileSize ?? 0,
        type: a.mimeType ?? 'image/jpeg',
        uri: a.uri,
      }));
      animateNextLayout(180);
      setShots((current) => [...current, ...files].slice(0, FEEDBACK_MAX_SCREENSHOTS));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const submit = async (): Promise<void> => {
    if (!body.trim()) {
      setError('Ne olduğunu kısaca anlat.');
      setAttempt((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({ type, title, body, context: includeContext ? context : null, screenshots: shots });
      toast('Geri bildirimin gönderildi, teşekkürler!');
      animateNextLayout(200);
      setTitle('');
      setBody('');
      setShots([]);
    } catch (err) {
      setError(errorMessage(err));
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>Bir hata mı buldun, bir fikrin mi var? Yaz, birlikte düzeltelim.</Text>

      <View style={styles.types}>
        {FEEDBACK_TYPES.map((t) => {
          const selected = type === t;
          return (
            <PressableScale
              key={t}
              scaleTo={0.96}
              onPress={() => setType(t)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              containerStyle={{ flex: 1 }}
              style={[styles.type, selected && styles.typeSelected]}
            >
              <Ionicons name={TYPE_ICONS[t]} size={20} color={selected ? colors.head : colors.muted} />
              <Text style={[styles.typeText, selected && { color: colors.head }]}>{FEEDBACK_TYPE_LABELS[t]}</Text>
            </PressableScale>
          );
        })}
      </View>

      <Field
        label="Başlık (isteğe bağlı)"
        value={title}
        onChangeText={setTitle}
        maxLength={FEEDBACK_TITLE_MAX_LENGTH}
        placeholder="Kısa bir başlık"
      />

      <Text style={styles.label}>Açıklama</Text>
      <TextInput
        value={body}
        onChangeText={(text) => {
          setBody(text);
          if (error) setError(null);
        }}
        multiline
        maxLength={FEEDBACK_BODY_MAX_LENGTH}
        placeholder={type === 'hata' ? 'Ne oldu? Ne yapıyordun, ne olmasını bekliyordun?' : 'Aklındakini yaz…'}
        placeholderTextColor={colors.faint}
        selectionColor={colors.brand}
        cursorColor={colors.head}
        textAlignVertical="top"
        style={styles.body}
      />
      {FEEDBACK_BODY_MAX_LENGTH - body.length < 500 && (
        <Text style={styles.hint}>{FEEDBACK_BODY_MAX_LENGTH - body.length} karakter kaldı</Text>
      )}

      <View style={styles.shotsHeader}>
        <Text style={styles.label}>Ekran görüntüleri</Text>
        <Text style={styles.hint}>
          {shots.length}/{FEEDBACK_MAX_SCREENSHOTS}
        </Text>
      </View>
      {shots.length > 0 && (
        <View style={styles.shots}>
          {shots.map((s, i) => (
            <View key={`${s.uri}-${i}`} style={styles.shot}>
              <Image source={{ uri: s.uri }} style={styles.shotImage} />
              <Pressable
                onPress={() => {
                  animateNextLayout(160);
                  setShots((current) => current.filter((_, j) => j !== i));
                }}
                accessibilityLabel="Kaldır"
                hitSlop={8}
                style={styles.shotRemove}
              >
                <Ionicons name="close" size={16} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Button
        title="Galeriden resim ekle"
        variant="secondary"
        disabled={shots.length >= FEEDBACK_MAX_SCREENSHOTS}
        onPress={() => void pick()}
      />

      <View style={styles.contextBox}>
        <Pressable
          style={styles.checkRow}
          onPress={() => setIncludeContext((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: includeContext }}
        >
          <View style={[styles.checkbox, includeContext && styles.checkboxOn]}>
            {includeContext && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Text style={styles.checkText}>Teknik bilgileri ekle</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            animateNextLayout(180);
            setShowContext((v) => !v);
          }}
          style={styles.contextToggle}
        >
          <Text style={styles.contextToggleText}>Gönderilecek teknik bilgiler</Text>
          <Ionicons name={showContext ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.muted} />
        </Pressable>
        {showContext && (
          <View style={[styles.contextTable, !includeContext && { opacity: 0.4 }]}>
            {CONTEXT_LABELS.filter(([key]) => context[key] !== undefined).map(([key, label]) => (
              <View key={key} style={styles.contextRow}>
                <Text style={styles.contextLabel}>{label}</Text>
                <Text style={styles.contextValue} selectable>
                  {typeof context[key] === 'boolean' ? (context[key] ? 'Evet' : 'Hayır') : String(context[key])}
                </Text>
              </View>
            ))}
            <View style={styles.contextRow}>
              <Text style={styles.contextLabel}>Son hatalar</Text>
              <View style={{ flex: 1 }}>
                {(context.recentErrors ?? []).length === 0 ? (
                  <Text style={[styles.contextValue, { color: colors.faint }]}>Yok</Text>
                ) : (
                  context.recentErrors!.map((e, i) => (
                    <Text key={i} style={[styles.contextValue, { color: '#fa777c', fontSize: 12 }]} selectable>
                      {e}
                    </Text>
                  ))
                )}
              </View>
            </View>
            <Text style={styles.hint}>Mesajların, kanal adların ya da şifren gönderilmez.</Text>
          </View>
        )}
      </View>

      {error && (
        <FadeIn style={ui.errorBox} shakeKey={attempt}>
          <Text style={ui.errorText}>{error}</Text>
        </FadeIn>
      )}
      <Button title="Gönder" busy={busy} onPress={() => void submit()} />
      <View style={{ marginTop: 8 }}>
        <Button title="Vazgeç" variant="ghost" onPress={() => router.back()} />
      </View>

      <MyFeedback />
    </ScrollView>
  );
}

function MyFeedback() {
  const mine = useFeedback((s) => s.mine);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    loadMyFeedback().catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  return (
    <View>
      <SectionTitle>Geri bildirimlerim</SectionTitle>
      {error ? (
        <Text style={ui.errorText}>{error}</Text>
      ) : mine === null ? (
        <Text style={styles.hint}>Yükleniyor…</Text>
      ) : mine.length === 0 ? (
        <Text style={styles.hint}>Henüz geri bildirim göndermedin.</Text>
      ) : (
        mine.map((f) => (
          <MyFeedbackItem
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
    </View>
  );
}

function MyFeedbackItem({ item, open, onToggle }: { item: Feedback; open: boolean; onToggle: () => void }) {
  const status = STATUS_COLORS[item.status];
  const headers = feedbackImageHeaders();
  return (
    <View style={styles.item}>
      <Pressable onPress={onToggle} style={styles.itemHeader} accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle} numberOfLines={open ? undefined : 1}>
            {item.title ?? item.body.replace(/\s+/g, ' ')}
          </Text>
          <Text style={styles.itemMeta}>
            {FEEDBACK_TYPE_LABELS[item.type]} · #{item.id} · {dateFormat.format(new Date(item.createdAt))}
            {item.adminNote ? ' · Yanıt var' : ''}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeText, { color: status.fg }]}>{FEEDBACK_STATUS_LABELS[item.status]}</Text>
        </View>
      </Pressable>
      {open && (
        <View style={styles.itemBody}>
          <Text style={styles.itemText} selectable>
            {item.body}
          </Text>
          {item.screenshots.length > 0 && (
            <View style={[styles.shots, { marginTop: 10 }]}>
              {item.screenshots.map((s) => (
                <Image key={s.id} source={{ uri: feedbackScreenshotUrl(s), headers }} style={styles.shotImageSmall} />
              ))}
            </View>
          )}
          {item.adminNote && (
            <View style={styles.note}>
              <Text style={styles.noteLabel}>Yanıt</Text>
              <Text style={styles.itemText} selectable>
                {item.adminNote}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.main },
  content: { padding: 16, paddingBottom: 48 },
  intro: { color: colors.muted, fontSize: 14.5, lineHeight: 20, marginBottom: 14 },
  types: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  type: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.side,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeSelected: { backgroundColor: colors.active, borderColor: colors.brand },
  typeText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  body: {
    minHeight: 120,
    maxHeight: 260,
    borderRadius: radius.sm,
    backgroundColor: colors.input,
    color: colors.text,
    padding: 12,
    fontSize: 16,
  },
  hint: { color: colors.muted, fontSize: 12.5, marginTop: 6 },
  shotsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16 },
  shots: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  shot: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.rail },
  shotImage: { width: '100%', height: '100%' },
  shotImageSmall: { width: 96, height: 72, borderRadius: radius.sm, backgroundColor: colors.rail },
  shotRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextBox: { backgroundColor: colors.side, borderRadius: radius.md, padding: 12, marginVertical: 16 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkText: { color: colors.text, fontSize: 15 },
  contextToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  contextToggleText: { color: colors.muted, fontSize: 14 },
  contextTable: { backgroundColor: colors.rail, borderRadius: radius.sm, padding: 10, gap: 4 },
  contextRow: { flexDirection: 'row', gap: 12 },
  contextLabel: { color: colors.muted, fontSize: 13, width: 118 },
  contextValue: { color: colors.text, fontSize: 13, flexShrink: 1 },
  item: { backgroundColor: colors.side, borderRadius: radius.md, marginBottom: 8, overflow: 'hidden' },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  itemTitle: { color: colors.head, fontSize: 15, fontWeight: '600' },
  itemMeta: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  itemBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, padding: 12 },
  itemText: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  note: { marginTop: 10, borderLeftWidth: 3, borderLeftColor: colors.brand, backgroundColor: colors.rail, padding: 10, borderRadius: radius.sm },
  noteLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
});
