import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Gamepad2, Trash2 } from 'lucide-react';
import { errorMessage } from '@diskort/client-core';
import type { ActivityGame, ActivityKnownGame, ActivityProgram, ActivitySettings as Settings } from '../../../../shared/bridge';
import { bridge } from '../../lib/bridge';
import { PresenceProvider, usePresence } from '../../lib/motion';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/ui';
import { Button, SectionTitle, Toggle } from '../ui/controls';
import { Modal } from '../ui/Modal';

const exeName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/**
 * Etkinlik: oynanan oyunun başkalarına gösterilmesi. Oyunları ana süreç algılar (bilinen oyun
 * kitaplıklarından çalışanlar kendiliğinden; diğerleri buradan elle eklenir). Ayarlar bu bilgisayara özgüdür.
 */
export function ActivitySettings() {
  const activity = bridge?.activity;
  const supported = activity?.supported === true;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [game, setGame] = useState<ActivityGame | null>(null);
  const [adding, setAdding] = useState(false);
  const picker = usePresence(adding || null);

  useEffect(() => {
    if (!activity) return;
    let alive = true;
    const refresh = (): void => {
      void activity.getSettings().then((next) => alive && setSettings(next), () => undefined);
    };
    void activity.getState().then((state) => alive && setGame(state.game), () => undefined);
    refresh();
    // Yeni bir oyun algılanınca liste de değişmiş olabilir
    const off = activity.onState((state) => {
      setGame(state.game);
      refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, [activity]);

  const change = useCallback(async (action: Promise<Settings> | undefined): Promise<void> => {
    try {
      const next = await action;
      if (next) setSettings(next);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }, []);

  const enabled = supported && settings?.enabled === true;
  const games = settings?.games ?? [];

  return (
    <div>
      <h2 className="mb-5 text-xl font-bold text-text-head">Etkinlik</h2>
      <Toggle
        label="Oynadığım oyunu göster"
        description={
          supported
            ? 'Oyun oynarken oyunun adı ve ne zamandır oynadığın başkalarına görünür. Görünmezken gösterilmez.'
            : 'Oyun algılama şimdilik yalnızca Windows’ta destekleniyor.'
        }
        checked={enabled}
        disabled={!supported || !settings}
        onChange={(next) => void change(activity?.setEnabled(next))}
      />
      {supported && (
        <>
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-bg-rail px-4 py-3">
            <Gamepad2 size={20} className={cn('shrink-0', game ? 'text-ok' : 'text-text-faint')} aria-hidden />
            <div className="min-w-0 text-sm">
              {!enabled ? (
                <span className="text-text-muted">Oyun algılama kapalı.</span>
              ) : game ? (
                <>
                  <span className="text-text-muted">Şu an: </span>
                  <span className="font-semibold text-text-head">{game.name}</span>
                </>
              ) : (
                <span className="text-text-muted">Şu an bir oyun algılanmadı.</span>
              )}
            </div>
          </div>

          <SectionTitle>Oyunlar</SectionTitle>
          <p className="mb-3 text-sm text-text-muted">
            Steam, Epic Games gibi oyun kitaplıklarından çalışan oyunlar kendiliğinden algılanır. Algılanmayan bir oyunu açıkken
            buradan ekleyebilir, gösterilmesini istemediğini gizleyebilirsin.
          </p>
          <div className="flex flex-col gap-1">
            {games.length === 0 && <div className="text-sm text-text-muted">Henüz bir oyun algılanmadı.</div>}
            {games.map((g) => (
              <GameRow
                key={g.path}
                game={g}
                playing={game?.path.toLowerCase() === g.path.toLowerCase()}
                onHide={(hidden) => void change(activity?.setHidden(g.path, hidden))}
                onRemove={() => void change(activity?.removeGame(g.path))}
              />
            ))}
          </div>
          <div className="mt-3">
            <Button variant="secondary" disabled={!enabled} onClick={() => setAdding(true)}>
              Oyun ekle
            </Button>
          </div>
        </>
      )}
      {/* Pencere kapanırken de animasyonla kaybolur */}
      <PresenceProvider value={picker.closing}>
        {picker.value && activity && (
          <AddGameModal
            list={activity.listPrograms}
            onClose={() => setAdding(false)}
            onPick={(program) => {
              setAdding(false);
              void change(activity.addGame(program.path));
            }}
          />
        )}
      </PresenceProvider>
    </div>
  );
}

function ExeIcon({ icon }: { icon: string | null }) {
  return icon ? (
    <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded object-contain" draggable={false} />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-bg-raised text-text-muted" aria-hidden>
      <Gamepad2 size={18} />
    </span>
  );
}

function GameRow({
  game,
  playing,
  onHide,
  onRemove,
}: {
  game: ActivityKnownGame;
  playing: boolean;
  onHide: (hidden: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded bg-bg-side px-3 py-2">
      <span className={cn('shrink-0', game.hidden && 'opacity-40 grayscale')}>
        <ExeIcon icon={game.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate font-medium', game.hidden ? 'text-text-muted line-through' : 'text-text-head')}>{game.name}</div>
        <div className="truncate text-xs text-text-muted">
          {game.hidden ? 'Gizli · ' : playing ? 'Şu an oynanıyor · ' : ''}
          {game.manual ? 'Elle eklendi · ' : ''}
          {exeName(game.path)}
        </div>
      </div>
      <RowButton label={game.hidden ? 'Göster' : 'Gizle'} onClick={() => onHide(!game.hidden)}>
        {game.hidden ? <EyeOff size={16} /> : <Eye size={16} className="ico-blink" />}
      </RowButton>
      {game.manual && (
        <RowButton label="Listeden çıkar" danger onClick={onRemove}>
          <Trash2 size={16} className="ico-shake" />
        </RowButton>
      )}
    </div>
  );
}

function RowButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      data-tooltip={label}
      aria-label={label}
      onClick={onClick}
      className={cn('press-icon rounded p-1.5 text-text-muted hover:bg-bg-hover', danger ? 'hover:text-danger' : 'hover:text-text-head')}
    >
      {children}
    </button>
  );
}

/** "Oyun ekle": şu an açık olan programlardan biri oyun olarak seçilir */
function AddGameModal({
  list,
  onClose,
  onPick,
}: {
  list: () => Promise<ActivityProgram[]>;
  onClose: () => void;
  onPick: (program: ActivityProgram) => void;
}) {
  const [programs, setPrograms] = useState<ActivityProgram[] | null>(null);

  useEffect(() => {
    let alive = true;
    void list().then(
      (found) => alive && setPrograms(found),
      () => alive && setPrograms([]),
    );
    return () => {
      alive = false;
    };
  }, [list]);

  return (
    <Modal title="Oyun ekle" subtitle="Oyun açıkken listeden seç; bundan sonra oynadığında gösterilir." onClose={onClose}>
      <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
        {programs === null && <div className="py-6 text-center text-sm text-text-muted">Açık programlar aranıyor…</div>}
        {programs?.length === 0 && (
          <div className="py-6 text-center text-sm text-text-muted">Eklenebilecek açık bir program bulunamadı. Oyunu açıp yeniden dene.</div>
        )}
        {programs?.map((program) => (
          <button
            key={program.path}
            onClick={() => onPick(program)}
            className="flex items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-bg-hover"
          >
            <ExeIcon icon={program.icon} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-text-head">{program.name}</span>
              <span className="block truncate text-xs text-text-muted">
                {exeName(program.path)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
