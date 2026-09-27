import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bug, Copy, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import {
  baseFeedbackContext,
  describeCandidate,
  formatBitrate,
  formatPercent,
  summarizePings,
  type StreamView,
  type TransportView,
} from '@diskort/client-core';
import { voice } from '../../features/voice/voiceClient';
import { useEscapeLayer } from '../../lib/escape';
import { usePresence } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { useConnectionStats, type ConnectionDetail, type VoiceServerInfo } from '../../stores/connectionStats';
import { toast } from '../../stores/ui';
import { PingChart } from './PingChart';

const MARGIN = 8;
const GAP = 8;

type Tab = 'connection' | 'privacy';

const ms = (v: number | null): string => (v === null ? '—' : `${v} ms`);

/** "lk.ziroo.net · kanal-oda" ve varsa bölge/düğüm */
function serverLine(server: VoiceServerInfo | null): string {
  if (!server) return 'Ses sunucusu';
  const where = server.region ? `${server.region} · ${server.host}` : server.host;
  return server.roomName ? `${where} · ${server.roomName}` : where;
}

/** Hata ayıklama için panoya kopyalanan tanılama bilgisi (hiçbir yere gönderilmez) */
function diagnostics(): string {
  const { samples, quality, server, detail } = useConnectionStats.getState();
  const { platform, appVersion } = baseFeedbackContext();
  return JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      app: { platform, version: appVersion, userAgent: navigator.userAgent },
      server,
      quality,
      summary: summarizePings(samples),
      pings: samples.map((s) => ({ at: new Date(s.at).toISOString(), rttMs: s.rttMs, sent: s.sent, lost: s.lost })),
      publisher: detail?.publisher ?? null,
      subscriber: detail?.subscriber ?? null,
      streamLabels: detail?.labels ?? {},
    },
    null,
    2,
  );
}

/**
 * Discord'daki "Ses Bağlantısı Kuruldu" kartı: ping grafiği, ortalama/son ping, giden paket kaybı,
 * şifreleme bilgisi ve ayrıntılı istatistikler (hata ayıklama). Açıkken ayrıntılı ölçüm yapılır.
 */
export function ConnectionInfoPopover({
  open,
  anchorRef,
  onClose,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { value: shown, closing } = usePresence(open || null, 100);
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('connection');
  const [debug, setDebug] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; maxHeight: number } | null>(null);

  // Açıkken ayrıntılı istatistik toplanır
  useEffect(() => {
    if (!open) return;
    return voice.watchConnectionDetail();
  }, [open]);

  useEffect(() => {
    if (open) {
      setTab('connection');
      setDebug(false);
    }
  }, [open]);

  // Açan etiketin üstünde; sığmazsa ekranın içinde kalır. İçerik büyüyünce (hata ayıklama) yeniden hesaplanır.
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = anchorRef.current;
    if (!shown || !el || !anchor) return;
    const place = (): void => {
      const a = anchor.getBoundingClientRect();
      const { offsetWidth: width, offsetHeight: height } = el;
      const titlebar = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h')) || 0;
      const x = Math.max(MARGIN, Math.min(a.left - 4, window.innerWidth - width - MARGIN));
      // Etiketin üstündeki alan yetiyorsa açan etiketi örtmez; içerik bu yüksekliği aşarsa kaydırılır
      const room = a.top - GAP - MARGIN - titlebar;
      const maxHeight = room >= 320 ? room : window.innerHeight - 2 * MARGIN - titlebar;
      const h = Math.min(height, maxHeight);
      const y = room >= 320 ? a.top - GAP - h : Math.max(MARGIN + titlebar, window.innerHeight - h - MARGIN);
      setPos((p) => (p && p.x === x && p.y === y && p.maxHeight === maxHeight ? p : { x, y, maxHeight }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [shown, anchorRef]);

  // Dışarı tıklayınca kapanır (açan etikete tıklamak onu zaten kapatır)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onClose);
    };
  }, [open, onClose, anchorRef]);
  useEscapeLayer(() => (debug ? setDebug(false) : onClose()), open);

  if (!shown) return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Ses bağlantısı"
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden rounded-lg border border-black/30 bg-bg-side shadow-[0_8px_24px_rgb(0_0_0/0.45)]',
        debug ? 'w-[420px]' : 'w-[340px]',
        closing ? 'anim-pop-out pointer-events-none' : 'anim-pop-in',
      )}
      style={
        pos
          ? { left: pos.x, top: pos.y, maxHeight: pos.maxHeight, transformOrigin: '24px 100%' }
          : { left: -9999, top: -9999, visibility: 'hidden' }
      }
      onContextMenu={(e) => e.preventDefault()}
    >
      {debug ? (
        <DebugView onBack={() => setDebug(false)} />
      ) : (
        <>
          <div className="flex gap-4 border-b border-line/60 px-4 pt-3" role="tablist">
            <TabButton active={tab === 'connection'} onClick={() => setTab('connection')}>
              Bağlantı
            </TabButton>
            <TabButton active={tab === 'privacy'} onClick={() => setTab('privacy')}>
              Gizlilik
            </TabButton>
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            {tab === 'connection' ? <ConnectionTab onDebug={() => setDebug(true)} /> : <PrivacyTab />}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'relative pb-2.5 text-sm font-semibold transition-colors',
        active ? 'text-text-head' : 'text-text-muted hover:text-text-normal',
      )}
      onClick={onClick}
    >
      {children}
      {active && <span className="anim-indicator-in absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />}
    </button>
  );
}

function ConnectionTab({ onDebug }: { onDebug: () => void }) {
  const samples = useConnectionStats((s) => s.samples);
  const server = useConnectionStats((s) => s.server);
  const summary = useMemo(() => summarizePings(samples), [samples]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(diagnostics());
      toast('Bağlantı tanılama bilgisi panoya kopyalandı.', 'success');
    } catch {
      toast('Panoya kopyalanamadı.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PingChart samples={samples} />
      <div className="truncate text-xs text-text-muted" data-tooltip={server?.nodeId ? `Düğüm: ${server.nodeId}` : undefined}>
        {serverLine(server)}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">Ortalama ping:</dt>
        <dd className="text-right font-semibold text-text-head tabular-nums">{ms(summary.averageMs)}</dd>
        <dt className="text-text-muted">Son ping:</dt>
        <dd className="text-right font-semibold text-text-head tabular-nums">{ms(summary.lastMs)}</dd>
        <dt className="text-text-muted">Giden paket kayıp oranı:</dt>
        <dd className="text-right font-semibold text-text-head tabular-nums">{formatPercent(summary.lossPercent)}</dd>
      </dl>
      <p className="text-xs leading-relaxed text-text-muted">
        250 ms ve üzerinde gecikmede ses sorunu yaşayabilirsin. Paket kaybı oranı %10&apos;un üzerindeyse ses robot gibi
        çıkabilir. Sorun devam ederse bağlantıyı kesip tekrar dene.
      </p>
      <EncryptionLine />
      <div className="flex gap-2">
        <button
          type="button"
          className="press flex flex-1 items-center justify-center gap-1.5 rounded bg-bg-active px-3 py-2 text-sm font-medium text-text-head hover:bg-bg-hover"
          onClick={onDebug}
        >
          <Bug size={16} />
          Hata ayıklama
        </button>
        <button
          type="button"
          className="press flex flex-1 items-center justify-center gap-1.5 rounded bg-bg-active px-3 py-2 text-sm font-medium text-text-head hover:bg-bg-hover"
          data-tooltip="Tanılama bilgilerini panoya kopyala (hiçbir yere gönderilmez)"
          onClick={() => void copy()}
        >
          <Copy size={16} />
          Kopyala
        </button>
      </div>
    </div>
  );
}

function EncryptionLine() {
  const e2ee = useConnectionStats((s) => s.server?.e2ee ?? false);
  const dtls = useConnectionStats((s) => s.detail?.publisher?.dtlsState ?? s.detail?.subscriber?.dtlsState ?? null);
  const secured = dtls === null || dtls === 'connected';
  const Icon = secured ? Lock : LockOpen;
  return (
    <div className={cn('flex items-center gap-2 text-sm font-medium', secured ? 'text-ok' : 'text-warn')}>
      <Icon size={16} className="shrink-0" />
      {secured
        ? e2ee
          ? 'Uçtan uca şifreli bağlantı (LiveKit E2EE)'
          : 'Şifreli bağlantı (DTLS-SRTP)'
        : 'Şifreli bağlantı kuruluyor…'}
    </div>
  );
}

function PrivacyTab() {
  const e2ee = useConnectionStats((s) => s.server?.e2ee ?? false);
  const transport = useConnectionStats((s) => s.detail?.publisher ?? s.detail?.subscriber ?? null);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-start gap-3 rounded-md bg-bg-deep p-3">
        <ShieldCheck size={22} className="mt-0.5 shrink-0 text-ok" />
        <div>
          <div className="font-semibold text-text-head">Şifreli bağlantı (DTLS-SRTP)</div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            Sesin ve yayınların bilgisayarınla ses sunucusu arasında DTLS-SRTP ile şifrelenir; aradaki ağlar içeriği
            göremez.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-md bg-bg-deep p-3">
        {e2ee ? (
          <Lock size={22} className="mt-0.5 shrink-0 text-ok" />
        ) : (
          <LockOpen size={22} className="mt-0.5 shrink-0 text-text-muted" />
        )}
        <div>
          <div className="font-semibold text-text-head">
            {e2ee ? 'Uçtan uca şifreleme açık' : 'Uçtan uca şifreleme kapalı'}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {e2ee
              ? 'Medya yalnızca kanaldaki katılımcılarca çözülebilir; ses sunucusu içeriği göremez.'
              : 'Ses sunucusu, sesi diğer katılımcılara iletmek için şifreyi çözer. Sunucu Diskort yöneticilerine aittir.'}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <Row label="DTLS durumu" value={transport?.dtlsState ?? '—'} />
        <Row label="SRTP şifresi" value={transport?.srtpCipher ?? '—'} />
        <Row label="DTLS şifresi" value={transport?.dtlsCipher ?? '—'} />
      </dl>
    </div>
  );
}

function Row({ label, value, tip }: { label: string; value: ReactNode; tip?: string }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-text-normal tabular-nums select-text" data-tooltip={tip}>
        {value}
      </dd>
    </>
  );
}

// ---------- Hata ayıklama ----------

function DebugView({ onBack }: { onBack: () => void }) {
  const detail = useConnectionStats((s) => s.detail);
  const server = useConnectionStats((s) => s.server);
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2.5">
        <button
          type="button"
          className="press-icon rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-head"
          aria-label="Geri"
          data-tooltip="Geri"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-text-head">Hata ayıklama</span>
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        <Section title="Sunucu">
          <Row label="Adres" value={server?.host ?? '—'} />
          <Row label="Oda" value={server?.roomName ?? '—'} />
          {server?.region && <Row label="Bölge" value={server.region} />}
          {server?.nodeId && <Row label="Düğüm" value={server.nodeId} />}
          {server?.version && <Row label="LiveKit sürümü" value={server.version} />}
        </Section>
        {!detail ? (
          <div className="py-6 text-center text-sm text-text-muted">Ölçülüyor…</div>
        ) : (
          <DebugDetail detail={detail} />
        )}
      </div>
    </>
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
    <section>
      <h3 className="mb-1.5 text-xs font-bold text-text-muted uppercase">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-bg-deep p-2.5 text-xs">{children}</dl>
    </section>
  );
}

const Empty = () => <div className="col-span-2 text-text-muted">Yok</div>;

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

function StreamRows({ s, labels }: { s: StreamView; labels: ConnectionDetail['labels'] }) {
  const label = (s.trackId && labels[s.trackId]?.label) ?? (s.kind === 'audio' ? 'Ses' : 'Görüntü');
  const concealed =
    s.concealedSamples !== null && s.totalSamplesReceived
      ? (s.concealedSamples / s.totalSamplesReceived) * 100
      : null;
  return (
    <>
      <dt className="col-span-2 mt-1 truncate font-semibold text-text-head first:mt-0">{label}</dt>
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
      {s.implementation && <Row label={s.direction === 'out' ? 'Kodlayıcı' : 'Çözücü'} value={s.implementation} />}
      {s.qualityLimitationReason && s.qualityLimitationReason !== 'none' && (
        <Row label="Kısıtlama" value={QUALITY_LIMIT[s.qualityLimitationReason] ?? s.qualityLimitationReason} />
      )}
      {concealed !== null && <Row label="Gizlenen ses" value={formatPercent(concealed)} tip="Kayıp paketler yüzünden tahminle doldurulan ses oranı" />}
    </>
  );
}

const QUALITY_LIMIT: Record<string, string> = {
  cpu: 'İşlemci',
  bandwidth: 'Bant genişliği',
  other: 'Diğer',
};
