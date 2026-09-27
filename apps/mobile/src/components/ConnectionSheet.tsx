import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import {
  describeCandidate,
  formatBitrate,
  formatPercent,
  summarizePings,
  type StreamView,
  type TransportView,
} from '@diskort/client-core';
import { getSettings, useSettings } from '../stores/settings';
import { toast } from '../stores/ui';
import { colors, createStyles, font, radius, ripple, space } from '../theme';
import { APP_VERSION, NATIVE_VERSION } from '../version';
import {
  connectionStats,
  useConnectionStats,
  type ConnectionDetail,
  type VoiceServerInfo,
} from '../voice/connectionStats';
import { BottomSheet } from './BottomSheet';
import { PingChart } from './PingChart';

type Tab = 'connection' | 'debug';

const ms = (v: number | null): string => (v === null ? '—' : `${v} ms`);

/** "lk.ziroo.net · kanal-oda" ve varsa bölge */
function serverLine(server: VoiceServerInfo | null): string {
  if (!server) return 'Ses sunucusu';
  const where = server.region ? `${server.region} · ${server.host}` : server.host;
  return server.roomName ? `${where} · ${server.roomName}` : where;
}

/** Mikrofon işleme ayarları (tanılama bilgisinde ve hata ayıklama sekmesinde) */
function micProcessing() {
  const s = getSettings();
  return {
    noiseSuppression: s.noiseSuppression,
    echoCancellation: s.echoCancellation,
    autoGainControl: s.autoGainControl,
    voiceActivity: s.voiceActivity,
  };
}

/** Hata ayıklama için panoya kopyalanan tanılama bilgisi (hiçbir yere gönderilmez) */
function diagnostics(): string {
  const { samples, quality, server, detail } = useConnectionStats.getState();
  return JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      app: {
        platform: Platform.OS,
        version: APP_VERSION,
        nativeVersion: NATIVE_VERSION,
        os: `${Device.osName ?? Platform.OS} ${Device.osVersion ?? Platform.Version}`,
        device: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || null,
      },
      server,
      quality,
      summary: summarizePings(samples),
      pings: samples.map((s) => ({ at: new Date(s.at).toISOString(), rttMs: s.rttMs, sent: s.sent, lost: s.lost })),
      publisher: detail?.publisher ?? null,
      subscriber: detail?.subscriber ?? null,
      streamLabels: detail?.labels ?? {},
      micProcessing: micProcessing(),
    },
    null,
    2,
  );
}

/**
 * Ses bağlantısı paneli (masaüstündeki "Ses Bağlantısı" kartının telefondaki karşılığı): "Bağlantı"
 * sekmesinde son 5 dakikanın ping grafiği, ortalama/son ping ve giden paket kaybı; "Hata ayıklama"
 * sekmesinde aday türü, bit hızları, titreşim ve akış başına istatistikler. Açıkken ayrıntılı ölçüm yapılır.
 */
export function ConnectionSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('connection');

  // Açıkken ayrıntılı istatistik toplanır
  useEffect(() => {
    if (!visible) return;
    setTab('connection');
    return connectionStats.watchDetail();
  }, [visible]);

  const copy = async (): Promise<void> => {
    try {
      await Clipboard.setStringAsync(diagnostics());
      toast('Bağlantı tanılama bilgisi panoya kopyalandı.');
    } catch {
      toast('Panoya kopyalanamadı.', 'error');
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.tabs} accessibilityRole="tablist">
        <TabButton label="Bağlantı" active={tab === 'connection'} onPress={() => setTab('connection')} />
        <TabButton label="Hata ayıklama" active={tab === 'debug'} onPress={() => setTab('debug')} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} bounces={false}>
        {tab === 'connection' ? <ConnectionTab /> : <DebugTab />}
      </ScrollView>
      <Pressable
        style={styles.copy}
        android_ripple={ripple.strong}
        onPress={() => void copy()}
        accessibilityRole="button"
        accessibilityLabel="Tanılama bilgilerini panoya kopyala"
        accessibilityHint="Hiçbir yere gönderilmez"
      >
        <Ionicons name="copy-outline" size={18} color={colors.head} />
        <Text style={styles.copyText}>Kopyala</Text>
      </Pressable>
    </BottomSheet>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      {active && <View style={styles.tabIndicator} />}
    </Pressable>
  );
}

function ConnectionTab() {
  const samples = useConnectionStats((s) => s.samples);
  const server = useConnectionStats((s) => s.server);
  const summary = useMemo(() => summarizePings(samples), [samples]);
  return (
    <View style={styles.stack}>
      <PingChart samples={samples} />
      <Text style={styles.server} numberOfLines={1}>
        {serverLine(server)}
      </Text>
      <View style={styles.summary}>
        <SummaryRow label="Ortalama ping:" value={ms(summary.averageMs)} />
        <SummaryRow label="Son ping:" value={ms(summary.lastMs)} />
        <SummaryRow label="Giden paket kayıp oranı:" value={formatPercent(summary.lossPercent)} />
      </View>
      <Text style={styles.help}>
        250 ms ve üzerinde gecikmede ses sorunu yaşayabilirsin. Paket kaybı oranı %10&apos;un üzerindeyse ses robot gibi
        çıkabilir. Sorun devam ederse bağlantıyı kesip tekrar dene.
      </Text>
      <EncryptionLine />
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function EncryptionLine() {
  const e2ee = useConnectionStats((s) => s.server?.e2ee ?? false);
  const dtls = useConnectionStats((s) => s.detail?.publisher?.dtlsState ?? s.detail?.subscriber?.dtlsState ?? null);
  const secured = dtls === null || dtls === 'connected';
  const color = secured ? colors.ok : colors.warn;
  return (
    <View style={styles.encryption}>
      <Ionicons name={secured ? 'lock-closed' : 'lock-open'} size={16} color={color} />
      <Text style={[styles.encryptionText, { color }]}>
        {secured
          ? e2ee
            ? 'Uçtan uca şifreli bağlantı (LiveKit E2EE)'
            : 'Şifreli bağlantı (DTLS-SRTP)'
          : 'Şifreli bağlantı kuruluyor…'}
      </Text>
    </View>
  );
}

// ---------- Hata ayıklama ----------

function DebugTab() {
  const detail = useConnectionStats((s) => s.detail);
  const server = useConnectionStats((s) => s.server);
  return (
    <View style={styles.stack}>
      <Section title="Sunucu">
        <Row label="Adres" value={server?.host ?? '—'} />
        <Row label="Oda" value={server?.roomName ?? '—'} />
        {server?.region ? <Row label="Bölge" value={server.region} /> : null}
        {server?.nodeId ? <Row label="Düğüm" value={server.nodeId} /> : null}
        {server?.version ? <Row label="LiveKit sürümü" value={server.version} /> : null}
      </Section>
      <MicProcessingSection />
      {!detail ? <Text style={styles.measuring}>Ölçülüyor…</Text> : <DebugDetail detail={detail} />}
    </View>
  );
}

/**
 * Mikrofon işleme: şimdilik yalnızca ayarlar. Telefondaki gürültü engelleyici ölçüm (yük, kare süresi)
 * verdiğinde masaüstündeki gibi burada gösterilecek.
 */
function MicProcessingSection() {
  const noise = useSettings((s) => s.noiseSuppression);
  const echo = useSettings((s) => s.echoCancellation);
  const agc = useSettings((s) => s.autoGainControl);
  const vad = useSettings((s) => s.voiceActivity);
  const onOff = (v: boolean): string => (v ? 'Açık' : 'Kapalı');
  return (
    <Section title="Mikrofon işleme">
      <Row label="Gürültü engelleme" value={onOff(noise)} />
      <Row label="Yankı engelleme" value={onOff(echo)} />
      <Row label="Otomatik kazanç" value={onOff(agc)} />
      <Row label="Ses algılama" value={onOff(vad)} />
      <Text style={styles.sectionNote}>Gürültü engelleyicinin ayrıntılı ölçümleri telefonda henüz yok.</Text>
    </Section>
  );
}

function DebugDetail({ detail }: { detail: ConnectionDetail }) {
  const streams = [...(detail.publisher?.streams ?? []), ...(detail.subscriber?.streams ?? [])];
  const outbound = streams.filter((s) => s.direction === 'out');
  const inbound = streams.filter((s) => s.direction === 'in');
  return (
    <>
      {detail.publisher && <TransportSection title="Gönderme bağlantısı" t={detail.publisher} />}
      {detail.subscriber && <TransportSection title="Alma bağlantısı" t={detail.subscriber} />}
      <Section title="Giden akışlar">
        {outbound.length === 0 ? <Empty /> : outbound.map((s) => <StreamRows key={s.id} s={s} labels={detail.labels} />)}
      </Section>
      <Section title="Gelen akışlar">
        {inbound.length === 0 ? <Empty /> : inbound.map((s) => <StreamRows key={s.id} s={s} labels={detail.labels} />)}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.section}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.rowValue} numberOfLines={1} selectable>
        {value}
      </Text>
    </View>
  );
}

const Empty = () => <Text style={styles.sectionNote}>Yok</Text>;

const address = (c: TransportView['local']): string =>
  c?.address ? `${c.address.includes(':') ? `[${c.address}]` : c.address}${c.port ? `:${c.port}` : ''}` : '—';

function TransportSection({ title, t }: { title: string; t: TransportView }) {
  return (
    <Section title={title}>
      <Row label="Ping" value={ms(t.rttMs)} />
      <Row label="Yerel aday" value={describeCandidate(t.local)} />
      <Row label="Yerel adres" value={address(t.local)} />
      <Row label="Uzak aday" value={describeCandidate(t.remote)} />
      <Row label="Uzak adres" value={address(t.remote)} />
      {t.local?.networkType ? <Row label="Ağ türü" value={t.local.networkType} /> : null}
      <Row label="Giden bit hızı" value={formatBitrate(t.bitrateOut)} />
      <Row label="Gelen bit hızı" value={formatBitrate(t.bitrateIn)} />
      {t.availableOutgoingBitrate !== null && (
        <Row label="Kullanılabilir giden" value={formatBitrate(t.availableOutgoingBitrate)} />
      )}
      {t.availableIncomingBitrate !== null && (
        <Row label="Kullanılabilir gelen" value={formatBitrate(t.availableIncomingBitrate)} />
      )}
    </Section>
  );
}

function codecText(s: StreamView): string {
  if (!s.codec) return '—';
  const name = s.codec.split('/')[1] ?? s.codec;
  const khz = s.clockRate && s.kind === 'audio' ? ` ${s.clockRate / 1000} kHz` : '';
  const ch = s.channels === 2 ? ' stereo' : '';
  return `${name}${khz}${ch}`;
}

const QUALITY_LIMIT: Record<string, string> = {
  cpu: 'İşlemci',
  bandwidth: 'Bant genişliği',
  other: 'Diğer',
};

function StreamRows({ s, labels }: { s: StreamView; labels: ConnectionDetail['labels'] }) {
  const label = (s.trackId && labels[s.trackId]?.label) || (s.kind === 'audio' ? 'Ses' : 'Görüntü');
  const concealed =
    s.concealedSamples !== null && s.totalSamplesReceived ? (s.concealedSamples / s.totalSamplesReceived) * 100 : null;
  return (
    <View style={styles.stream}>
      <Text style={styles.streamTitle} numberOfLines={1}>
        {label}
      </Text>
      <Row label="Kodek" value={codecText(s)} />
      <Row label="Bit hızı" value={formatBitrate(s.bitrate)} />
      <Row label="Paket kaybı" value={`${formatPercent(s.lossPercent)} (toplam ${s.packetsLost ?? '—'})`} />
      <Row label="Titreşim (jitter)" value={ms(s.jitterMs)} />
      {s.rttMs !== null && <Row label="RTCP gidiş-dönüş" value={ms(s.rttMs)} />}
      {s.kind === 'video' && (
        <Row
          label="Görüntü"
          value={`${s.frameWidth ?? '?'}×${s.frameHeight ?? '?'}${s.framesPerSecond !== null ? ` · ${Math.round(s.framesPerSecond)} fps` : ''}`}
        />
      )}
      {s.implementation ? <Row label={s.direction === 'out' ? 'Kodlayıcı' : 'Çözücü'} value={s.implementation} /> : null}
      {s.qualityLimitationReason && s.qualityLimitationReason !== 'none' ? (
        <Row label="Kısıtlama" value={QUALITY_LIMIT[s.qualityLimitationReason] ?? s.qualityLimitationReason} />
      ) : null}
      {concealed !== null && <Row label="Gizlenen ses" value={formatPercent(concealed)} />}
    </View>
  );
}

const styles = createStyles(() => ({
  tabs: {
    flexDirection: 'row',
    gap: space.xl,
    paddingHorizontal: space.lg + 2,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  tab: { paddingTop: space.xs, paddingBottom: space.md },
  tabText: { color: colors.muted, fontSize: font.body, fontWeight: '700' },
  tabTextActive: { color: colors.head },
  tabIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.brand,
  },
  scroll: { flexShrink: 1, flexGrow: 0 },
  content: { padding: space.lg },
  stack: { gap: space.md },
  server: { color: colors.muted, fontSize: font.caption },
  summary: { gap: space.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  summaryLabel: { color: colors.muted, fontSize: font.small + 0.5 },
  summaryValue: { color: colors.head, fontSize: font.small + 0.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  help: { color: colors.muted, fontSize: font.caption + 0.5, lineHeight: 18 },
  encryption: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  encryptionText: { fontSize: font.small, fontWeight: '600', flexShrink: 1 },
  measuring: { color: colors.muted, fontSize: font.small, textAlign: 'center', paddingVertical: space.xl },
  sectionTitle: {
    color: colors.muted,
    fontSize: font.caption - 0.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: space.xs + 2,
  },
  section: { backgroundColor: colors.deep, borderRadius: radius.md, padding: space.sm + 2, gap: 3 },
  sectionNote: { color: colors.muted, fontSize: font.caption, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowLabel: { color: colors.muted, fontSize: font.caption, flexShrink: 0, maxWidth: '50%' },
  rowValue: {
    flex: 1,
    color: colors.text,
    fontSize: font.caption,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  stream: { gap: 3, marginTop: space.xs },
  streamTitle: { color: colors.head, fontSize: font.caption, fontWeight: '700' },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.xs,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.active,
    overflow: 'hidden',
  },
  copyText: { color: colors.head, fontSize: font.body, fontWeight: '600' },
}));
