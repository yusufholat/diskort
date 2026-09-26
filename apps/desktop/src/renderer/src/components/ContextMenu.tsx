import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGuild } from '@diskort/client-core';
import { useSettings } from '../stores/settings';
import { useUi } from '../stores/ui';
import { cn } from '../lib/utils';

/** Sağ tık menüsü: basit öğeler veya kullanıcı ses ayarları (seviye + yerel susturma). */
export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - rect.width - 8),
      y: Math.min(menu.y, window.innerHeight - rect.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu, close]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="animate-pop fixed z-50 min-w-[200px] rounded-md bg-bg-float p-1.5 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.userId && <UserAudioControls userId={menu.userId} />}
      {menu.items?.map((item) => (
        <button
          key={item.label}
          className={cn(
            'block w-full rounded-[3px] px-2 py-1.5 text-left text-sm',
            item.danger ? 'text-danger hover:bg-danger hover:text-white' : 'hover:bg-brand hover:text-white',
          )}
          onClick={() => {
            close();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function UserAudioControls({ userId }: { userId: string }) {
  const user = useGuild((s) => s.users[userId]);
  const volume = useSettings((s) => s.userVolumes[userId] ?? 1);
  const muted = useSettings((s) => s.localMutes[userId] === true);
  const set = useSettings((s) => s.set);

  return (
    <div className="w-[220px] px-2 py-1.5">
      <div className="mb-2 truncate text-sm font-semibold text-text-head">{user?.displayName}</div>
      <div className="mb-1 flex justify-between text-xs font-bold text-text-muted uppercase">
        <span>Kullanıcı Ses Seviyesi</span>
        <span>{Math.round(volume * 100)}%</span>
      </div>
      <input
        type="range"
        className="slider w-full"
        min={0}
        max={200}
        value={Math.round(volume * 100)}
        onChange={(e) => {
          const userVolumes = { ...useSettings.getState().userVolumes, [userId]: Number(e.target.value) / 100 };
          set({ userVolumes });
        }}
      />
      <label className="mt-2 flex cursor-pointer items-center justify-between rounded-[3px] px-1 py-1.5 text-sm hover:bg-bg-hover">
        <span>Sustur (yalnızca senin için)</span>
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand"
          checked={muted}
          onChange={(e) => {
            const localMutes = { ...useSettings.getState().localMutes };
            if (e.target.checked) localMutes[userId] = true;
            else delete localMutes[userId];
            set({ localMutes });
          }}
        />
      </label>
    </div>
  );
}
