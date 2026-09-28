import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ChevronDown,
  Eye,
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  UserPlus,
  Users,
  Volume2,
} from 'lucide-react';
import { Permission, type VoiceState } from '@diskort/shared';
import { voice } from '../../features/voice/voiceClient';
import { memberMenuItems } from '../../lib/memberMenu';
import { animate, usePresence, usePresenceList, type PresenceEntry, type PresencePhase } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { channelById, membersOf, useCan, useGuild, useMemberColor, useSession } from '@diskort/client-core';
import { useSettings } from '../../stores/settings';
import { useUi } from '../../stores/ui';
import { useVoice } from '../../stores/voice';
import { Avatar } from '../ui/Avatar';
import { SwapIcon } from '../ui/SwapIcon';
import { LiveBadge, openVoiceProfile, VoiceStateIcons, WatchLiveBadge } from '../sidebar/VoiceMemberRow';
import { StreamView } from './StreamView';
import { StreamViewers } from './StreamViewers';
import { orderStrip } from './stripOrder';

type Tile = { kind: 'user'; state: VoiceState } | { kind: 'stream'; userId: string };

/** Ses kanalına bağlıyken ana alan: katılımcı kutucukları, yayınlar ve arama kontrolleri. */
export function VoiceStage() {
  const channelId = useVoice((s) => s.channelId)!;
  const status = useVoice((s) => s.status);
  const channel = useGuild((s) => channelById(s, channelId));
  const voiceStates = useGuild((s) => s.voiceStates);
  const streams = useVoice((s) => s.streams);
  const watching = useVoice((s) => s.watching);
  const focused = useVoice((s) => s.focusedStream);
  const sharing = useVoice((s) => s.sharing);
  const selfId = useSession((s) => s.user?.id);

  const members = useMemo(() => membersOf(voiceStates, channelId), [voiceStates, channelId]);

  const tiles: Tile[] = useMemo(() => {
    const list: Tile[] = [];
    for (const m of members) {
      const streaming = m.userId === selfId ? sharing : Boolean(streams[m.userId]);
      if (streaming) list.push({ kind: 'stream', userId: m.userId });
      list.push({ kind: 'user', state: m });
    }
    return list;
  }, [members, streams, sharing, selfId]);

  const focusedVisible = focused && (watching[focused] || (focused === selfId && sharing)) ? focused : null;
  // Katılan kutucuk büyüyerek belirir, ayrılan küçülerek kaybolur
  const entries = usePresenceList(tiles, tileKey, 180);

  // Görüntü (yayın) varken üst başlık, alt kontroller ve ad etiketleri fare durunca kaybolur
  const rootRef = useRef<HTMLDivElement>(null);
  const videoShown = sharing || Object.keys(watching).length > 0;
  const chromeIdle = useStageChrome(rootRef, videoShown && status === 'connected');
  // Kanalda yalnızken davet kutucuğu
  const alone = members.length === 1 && members[0]?.userId === selfId && tiles.length === 1;

  return (
    <div
      ref={rootRef}
      data-idle={chromeIdle ? '' : undefined}
      className="group/stage flex h-full min-w-0 flex-1 flex-col bg-bg-deep"
    >
      <header data-stage-chrome className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4', CHROME)}>
        <Volume2 size={22} className="text-text-muted" />
        <span className="font-semibold text-text-head">{channel?.name}</span>
        <span className="text-sm text-text-muted">· {members.length} kişi</span>
        {status !== 'connected' && (
          <span className="ml-2 text-sm text-warn">
            {status === 'reconnecting' ? 'Yeniden bağlanıyor…' : 'Bağlanıyor…'}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 p-4">
        {focusedVisible ? (
          <FocusedStage focused={focusedVisible} entries={entries} />
        ) : (
          <TileGrid entries={entries} extra={alone ? <InviteTile channelId={channelId} /> : null} />
        )}
      </div>

      <div data-stage-chrome className={CHROME}>
        <CallControls />
      </div>
    </div>
  );
}

/** Fare durunca gizlenen sahne öğeleri (başlık, kontroller, ad etiketleri); animasyon azaltılmışsa anında */
const CHROME =
  'transition-opacity duration-300 ease-out motion-reduce:transition-none group-data-[idle]/stage:pointer-events-none group-data-[idle]/stage:opacity-0';
/** Fare hareketsiz kalınca sahne öğeleri bu kadar sonra gizlenir */
const CHROME_IDLE_MS = 2500;
/** Fare sahneden çıkınca */
const CHROME_LEAVE_MS = 400;

/**
 * Sahnenin "boşta" durumu (Discord gibi): fare sahnede hareket edince ya da klavye kullanılınca öğeler
 * belirir, hareketsiz kalınca veya fare sahneden çıkınca kaybolur. Kontrollerde klavye odağı varken ya da
 * bir menü/pencere açıkken gizlenmez.
 */
function useStageChrome(rootRef: RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    let timer = 0;
    const held = (): boolean => {
      const ui = useUi.getState();
      return (
        ui.contextMenu !== null ||
        ui.modal !== null ||
        root.querySelector('[data-stage-chrome] :focus-visible') !== null ||
        root.querySelector('[data-stage-chrome] [aria-expanded="true"]') !== null
      );
    };
    const hideAfter = (ms: number): void => {
      window.clearTimeout(timer);
      const check = (): void => {
        if (held()) timer = window.setTimeout(check, 500);
        else setIdle(true);
      };
      timer = window.setTimeout(check, ms);
    };
    const wake = (): void => {
      setIdle(false);
      hideAfter(CHROME_IDLE_MS);
    };
    const leave = (): void => hideAfter(CHROME_LEAVE_MS);
    root.addEventListener('pointermove', wake);
    root.addEventListener('pointerdown', wake);
    root.addEventListener('keydown', wake);
    root.addEventListener('focusin', wake);
    root.addEventListener('pointerleave', leave);
    hideAfter(CHROME_IDLE_MS);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener('pointermove', wake);
      root.removeEventListener('pointerdown', wake);
      root.removeEventListener('keydown', wake);
      root.removeEventListener('focusin', wake);
      root.removeEventListener('pointerleave', leave);
      setIdle(false);
    };
  }, [enabled, rootRef]);
  return enabled && idle;
}

/** Kanalda yalnızken: arkadaş davet etme çağrısı (yetki varsa) */
function InviteTile({ channelId }: { channelId: string }) {
  const sameGuild = useGuild((s) => s.channelGuild[channelId] === s.activeGuildId);
  const canCreate = useCan(Permission.CREATE_INVITE);
  const canManage = useCan(Permission.MANAGE_INVITES);
  const openModal = useUi((s) => s.openModal);
  const canInvite = sameGuild && (canCreate || canManage);
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-dashed border-edge bg-bg-rail/40 p-4 text-center">
      {/* Kendi çizimimiz: ortadaki simgeden yayılan halkalar */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-brand/25" />
        <span className="absolute inset-3 rounded-full border border-brand/40" />
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-brand/15 text-brand">
          <UserPlus size={22} aria-hidden />
        </span>
      </div>
      <div className="space-y-1">
        <div className="font-semibold text-text-head">Burada şimdilik yalnızsın</div>
        <div className="text-sm text-text-muted">
          {canInvite ? 'Arkadaşlarını sohbete çağır.' : 'Biri katılınca burada görünecek.'}
        </div>
      </div>
      {canInvite && (
        <button
          type="button"
          onClick={() => openModal({ type: 'invite' })}
          className="press flex items-center gap-2 rounded bg-bg-raised px-4 py-2 text-sm font-medium text-text-head transition-colors hover:bg-bg-raised-hover"
        >
          <UserPlus size={16} aria-hidden /> Sesli Sohbete Davet Et
        </button>
      )}
    </div>
  );
}

/** Şeridin yüksekliği (px, h-28) */
const STRIP_HEIGHT = 112;
/** Şerit en çok bu sıklıkta yeniden sıralanır (kutucuklar sıçramasın) */
const STRIP_SORT_MS = 1500;

function tileUser(t: Tile): string {
  return t.kind === 'user' ? t.state.userId : t.userId;
}

/**
 * Bir yayın büyük gösterilirken: üstte yayın, altta katılımcı şeridi. Aradaki küçük düğme şeridi gizler;
 * gizliyken yayın tüm yüksekliği kaplar (tercih saklanır).
 */
function FocusedStage({ focused, entries }: { focused: string; entries: PresenceEntry<Tile>[] }) {
  const collapsed = useUi((s) => s.stageStripCollapsed);
  const toggleStrip = useUi((s) => s.toggleStageStrip);
  const selfId = useSession((s) => s.user?.id);
  const stripRef = useRef<HTMLDivElement>(null);
  // Kapanırken kutucuklar animasyon bitene kadar kalır, sonra çizilmez (şeritteki yayınlar da durur)
  const { value: stripShown } = usePresence(collapsed ? null : true, 220);

  const stripEntries = useMemo(
    () => entries.filter(({ item: t }) => !(t.kind === 'stream' && t.userId === focused)),
    [entries, focused],
  );
  const userIds = useMemo(() => {
    const ids: string[] = [];
    for (const e of stripEntries) {
      const id = tileUser(e.item);
      if (e.phase !== 'exit' && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [stripEntries]);
  const order = useStripOrder(userIds, focused, selfId, stripRef, !collapsed);
  const sorted = useMemo(() => {
    const rank = new Map(order.map((id, i) => [id, i]));
    // Aynı kişinin yayını ve kutucuğu yan yana kalır (sıralama kararlı). Ayrılanın kutucuğu kapanırken
    // listede önündeki kutucuğun hemen arkasında kalır.
    let prevRank = -1;
    const ranked = stripEntries.map((e) => {
      const r = rank.get(tileUser(e.item)) ?? prevRank + 0.5;
      prevRank = r;
      return { e, r };
    });
    return ranked.sort((a, b) => a.r - b.r).map(({ e }) => e);
  }, [stripEntries, order]);
  useStripFlip(stripRef);

  const label = collapsed ? 'Katılımcıları göster' : 'Katılımcıları gizle';
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <StreamView userId={focused} large />
      </div>
      <div data-stage-chrome className={cn('flex h-7 shrink-0 items-center justify-center', CHROME)}>
        <button
          type="button"
          data-tooltip={label}
          aria-label={label}
          aria-expanded={!collapsed}
          onClick={toggleStrip}
          className="press flex h-6 items-center gap-1 rounded-full px-2.5 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-head"
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('transition-transform duration-200', collapsed && 'rotate-180')}
          />
          <Users size={16} aria-hidden />
          {collapsed && <span className="anim-pill-in text-xs font-semibold tabular-nums">{userIds.length}</span>}
        </button>
      </div>
      <div
        className="shrink-0 overflow-hidden transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ height: collapsed ? 0 : STRIP_HEIGHT, opacity: collapsed ? 0 : 1 }}
        inert={collapsed}
      >
        <div
          ref={stripRef}
          className="relative flex gap-3 overflow-x-auto overflow-y-hidden"
          style={{ height: STRIP_HEIGHT }}
          // Dikey tekerlek yatay kaydırır
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {stripShown &&
            sorted.map(({ key, item: t, phase }) => (
              <div
                key={key}
                data-strip-key={key}
                data-strip-user={tileUser(t)}
                className={cn('aspect-video h-full shrink-0', tileAnimation(phase))}
              >
                <TileView tile={t} compact />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Şeridin kişi sırası (bkz. stripOrder). Kim ne zaman konuştu kaydedilir; en çok STRIP_SORT_MS'de bir,
 * şeridin görünmeyen yerinde konuşmuş olan görünen ilk yere alınır.
 */
function useStripOrder(
  users: string[],
  pinned: string,
  selfId: string | undefined,
  stripRef: RefObject<HTMLDivElement | null>,
  active: boolean,
): string[] {
  const [base, setBase] = useState<string[]>([]);
  const order = useMemo(() => orderStrip(base, users, { pinned, selfId }), [base, users, pinned, selfId]);
  const orderRef = useRef(order);
  useLayoutEffect(() => {
    orderRef.current = order;
  }, [order]);

  // Konuşmaya başlama anları (yeniden çizim gerektirmez)
  const spokeAt = useRef(new Map<string, number>());
  useEffect(() => {
    const mark = (speaking: Record<string, true>): void => {
      const now = Date.now();
      for (const id of Object.keys(speaking)) spokeAt.current.set(id, now);
    };
    mark(useVoice.getState().speaking);
    return useVoice.subscribe((s, prev) => {
      if (s.speaking !== prev.speaking) mark(s.speaking);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const timer = window.setInterval(() => {
      const since = last;
      last = Date.now();
      const speakingNow = useVoice.getState().speaking;
      const recent = [...spokeAt.current]
        .filter(([id, at]) => at >= since || speakingNow[id])
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
      const strip = stripRef.current;
      if (recent.length === 0 || !strip) return;
      // Kutucuğunun çoğu görünen kişiler (şerit kaydırılmış olabilir)
      const box = strip.getBoundingClientRect();
      const visible = new Set<string>();
      for (const el of strip.querySelectorAll<HTMLElement>('[data-strip-user]')) {
        const r = el.getBoundingClientRect();
        const shown = Math.min(r.right, box.right) - Math.max(r.left, box.left);
        if (el.dataset.stripUser && shown >= r.width * 0.6) visible.add(el.dataset.stripUser);
      }
      const current = orderRef.current;
      const promote = recent.filter((id) => current.includes(id) && !visible.has(id));
      if (promote.length === 0) return;
      const firstVisible = Math.max(0, current.findIndex((id) => visible.has(id)));
      setBase(orderStrip(current, current, { pinned, selfId, promote, firstVisible }));
    }, STRIP_SORT_MS);
    return () => window.clearInterval(timer);
  }, [active, pinned, selfId, stripRef]);

  return order;
}

/** Şeritte yeri değişen kutucuk eski yerinden yenisine kayar (FLIP) */
function useStripFlip(stripRef: RefObject<HTMLDivElement | null>): void {
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const next = new Map<string, number>();
    if (strip) {
      for (const el of strip.querySelectorAll<HTMLElement>(':scope > [data-strip-key]')) {
        const key = el.dataset.stripKey!;
        const left = el.offsetLeft;
        next.set(key, left);
        const old = positions.current.get(key);
        if (old !== undefined && old !== left) {
          animate(el, [{ transform: `translateX(${old - left}px)` }, { transform: 'translateX(0)' }], {
            duration: 260,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          });
        }
      }
    }
    positions.current = next;
  });
}

function tileKey(t: Tile): string {
  return t.kind === 'user' ? `u:${t.state.userId}` : `s:${t.userId}`;
}

function tileAnimation(phase: PresencePhase): string | undefined {
  return phase === 'enter' ? 'anim-tile-in' : phase === 'exit' ? 'anim-tile-out' : undefined;
}

function TileGrid({ entries, extra }: { entries: PresenceEntry<Tile>[]; extra?: ReactNode }) {
  // Kapanmakta olanlar sütun sayısını etkilemesin
  const count = entries.filter((e) => e.phase !== 'exit').length + (extra ? 1 : 0);
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  return (
    <div
      className="grid h-full content-center gap-3"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {entries.map(({ key, item: t, phase }) => (
        <div key={key} className={cn('mx-auto aspect-video w-full max-w-[720px]', tileAnimation(phase))}>
          <TileView tile={t} />
        </div>
      ))}
      {extra && <div className="anim-tile-in mx-auto aspect-video w-full max-w-[720px]">{extra}</div>}
    </div>
  );
}

function TileView({ tile, compact }: { tile: Tile; compact?: boolean }) {
  return tile.kind === 'user' ? (
    <ParticipantTile state={tile.state} compact={compact} />
  ) : (
    <StreamTile userId={tile.userId} compact={compact} />
  );
}

function tileCenter(el: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  return { left: x, right: x, top: y, bottom: y };
}

function ParticipantTile({ state, compact }: { state: VoiceState; compact?: boolean }) {
  const user = useGuild((s) => s.users[state.userId]);
  const color = useMemberColor(state.userId);
  const speaking = useVoice((s) => s.speaking[state.userId] === true);
  const selfId = useSession((s) => s.user?.id);
  const localMuted = useSettings((s) => s.localMutes[state.userId] === true);
  const openContextMenu = useUi((s) => s.openContextMenu);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${user?.displayName ?? 'Üye'} profili`}
      className={cn(
        'tile-ring relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg',
        speaking && 'tile-speaking',
      )}
      style={{ background: `color-mix(in srgb, ${user?.avatarColor ?? '#5865f2'} 35%, var(--color-bg-rail))` }}
      // Kutucuğa tıklamak profil kartını kutucuğun ortasının yanında açar (yeniden tıklamak kapatır)
      onClick={(e) => openVoiceProfile(state.userId, tileCenter(e.currentTarget))}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openVoiceProfile(state.userId, tileCenter(e.currentTarget));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const isSelf = state.userId === selfId;
        const items = memberMenuItems(state.userId);
        if (!isSelf || items.length > 0) {
          openContextMenu({ x: e.clientX, y: e.clientY, userId: isSelf ? undefined : state.userId, items });
        }
      }}
    >
      {/* Hareketli dekorasyon sahnede hafif çizilir: yalnızca konuşurken oynar */}
      <Avatar
        user={user}
        size={compact ? 44 : 80}
        speaking={speaking}
        decoration={user?.avatarDecoration}
        liteDecoration
      />
      <div
        className={cn(
          'absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded bg-black/50 px-2 py-0.5 text-sm text-white',
          CHROME,
        )}
      >
        <VoiceStateIcons state={state} localMuted={localMuted} size={14} />
        <span className="truncate" style={color ? { color } : undefined}>
          {user?.displayName}
        </span>
        {state.streaming && <WatchLiveBadge userId={state.userId} channelId={state.channelId} />}
      </div>
    </div>
  );
}

function StreamTile({ userId, compact }: { userId: string; compact?: boolean }) {
  const user = useGuild((s) => s.users[userId]);
  const selfId = useSession((s) => s.user?.id);
  const isWatching = useVoice((s) => s.watching[userId] === true);
  const isSelf = userId === selfId;

  if (isSelf || isWatching) {
    return <StreamView userId={userId} onClick={() => voice.focusStream(userId)} />;
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-bg-rail">
      <div className="absolute top-2 left-2 flex items-center gap-2">
        <LiveBadge />
      </div>
      <StreamViewers userId={userId} className="absolute top-2 right-2" />
      {!compact && <div className="text-sm text-text-muted">{user?.displayName} ekranını paylaşıyor</div>}
      <button
        className="press flex items-center gap-2 rounded bg-control px-4 py-2 text-sm font-medium text-on-control hover:bg-control-hover"
        onClick={() => voice.watchStream(userId)}
      >
        <Eye size={16} className="ico-blink" /> Yayını İzle
      </button>
    </div>
  );
}

function CallControls() {
  const selfMute = useSettings((s) => s.selfMute);
  const selfDeaf = useSettings((s) => s.selfDeaf);
  const sharing = useVoice((s) => s.sharing);
  const connected = useVoice((s) => s.status === 'connected');
  const micAllowed = useVoice((s) => s.micAllowed);
  const channelId = useVoice((s) => s.channelId);
  const canStream = useCan(Permission.STREAM, channelId ?? undefined);
  const openModal = useUi((s) => s.openModal);
  const muted = selfMute || selfDeaf || !micAllowed;

  return (
    <div className="flex h-20 shrink-0 items-center justify-center gap-3">
      <RoundButton
        title={!micAllowed ? 'Konuşma iznin yok' : muted ? 'Sesi Aç' : 'Sustur'}
        danger={muted}
        motion="ico-nod"
        onClick={() => voice.toggleMute()}
      >
        {muted ? <MicOff size={22} /> : <Mic size={22} />}
      </RoundButton>
      <RoundButton
        title={selfDeaf ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}
        danger={selfDeaf}
        motion="ico-wiggle"
        onClick={() => voice.toggleDeafen()}
      >
        {selfDeaf ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
      </RoundButton>
      <RoundButton
        title={sharing ? 'Yayını Durdur' : canStream ? 'Ekranını Paylaş' : 'Bu kanalda ekran paylaşma iznin yok'}
        active={sharing}
        disabled={!connected || (!sharing && !canStream)}
        motion="ico-lift"
        onClick={() => (sharing ? void voice.stopScreenShare() : openModal({ type: 'screenPicker' }))}
      >
        {sharing ? <MonitorOff size={22} /> : <Monitor size={22} />}
      </RoundButton>
      <RoundButton title="Bağlantıyı Kes" hangup motion="ico-hangup" onClick={() => void voice.leave()}>
        <PhoneOff size={22} />
      </RoundButton>
    </div>
  );
}

function RoundButton({
  title,
  onClick,
  children,
  danger,
  active,
  hangup,
  disabled,
  motion,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  hangup?: boolean;
  disabled?: boolean;
  /** Üstüne gelince simgenin hareketi (styles/hover.css) */
  motion: string;
}) {
  return (
    <button
      data-tooltip={title}
      aria-label={title}
      aria-pressed={hangup ? undefined : Boolean(danger || active)}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'press-icon flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-40',
        hangup
          ? 'w-16 bg-danger text-white hover:bg-danger-hover'
          : danger
            ? 'bg-text-head text-bg-rail hover:opacity-85'
            : active
              ? 'bg-ok text-white hover:bg-ok-hover'
              : 'bg-bg-raised text-text-head hover:bg-bg-raised-hover',
      )}
    >
      {/* Simge değişince kısa bir dönüşle yenisine geçer */}
      <SwapIcon swapKey={title} motion={motion}>
        {children}
      </SwapIcon>
    </button>
  );
}
