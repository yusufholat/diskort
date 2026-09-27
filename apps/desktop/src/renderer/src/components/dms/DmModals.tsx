import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Search } from 'lucide-react';
import { DM_GROUP_MAX_PARTICIPANTS, DM_NAME_MAX_LENGTH } from '@diskort/shared';
import { addDmParticipant, createDm, dmTitle, renameDm, useGuild, useSession } from '@diskort/client-core';
import { cn } from '../../lib/utils';
import { useUi } from '../../stores/ui';
import { Avatar } from '../ui/Avatar';
import { Button, TextInput } from '../ui/controls';
import { FormField } from '../ui/FormField';
import { Modal } from '../ui/Modal';

const NOBODY: string[] = [];

/**
 * Kişi seçerek direkt mesaj başlatmak: tek kişi bire bir konuşma, birden çok kişi grup. `addTo`
 * verilirse seçilenler o gruba eklenir.
 */
export function NewDmModal({ addTo }: { addTo?: string }) {
  const close = useUi((s) => s.closeModal);
  const setView = useUi((s) => s.setView);
  const selfId = useSession((s) => s.user?.id);
  const users = useGuild((s) => s.users);
  const reachable = useGuild((s) => s.reachable);
  const online = useGuild((s) => s.online);
  const group = useGuild((s) => (addTo ? s.dms[addTo] : undefined));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const existing = group?.participantIds ?? NOBODY;
  // Seçilebilecek en fazla kişi: grubun boş yeri ya da (yeni konuşmada) kendin hariç sınır
  const capacity = group ? DM_GROUP_MAX_PARTICIPANTS - existing.length : DM_GROUP_MAX_PARTICIPANTS - 1;
  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return Object.values(users)
      .filter((u) => reachable[u.id] && u.id !== selfId && !existing.includes(u.id))
      .filter((u) => !q || u.username.includes(q) || u.displayName.toLocaleLowerCase('tr').includes(q))
      .sort(
        (a, b) =>
          Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) ||
          a.displayName.localeCompare(b.displayName, 'tr'),
      );
  }, [users, reachable, online, selfId, existing, query]);

  const toggle = (id: string): void =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length < capacity ? [...current, id] : current,
    );

  const makesGroup = !group && selected.length > 1;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      if (group) {
        for (const id of selected) if (!(await addDmParticipant(group.id, id))) return;
        close();
        return;
      }
      const dm = await createDm(selected, makesGroup ? name.trim() || null : null);
      if (dm) {
        close();
        setView({ kind: 'dm', channelId: dm.id });
      }
    } finally {
      setBusy(false);
    }
  };

  const title = group ? 'Kişi Ekle' : 'Yeni Mesaj';
  const subtitle = group
    ? `${dmTitle(group, users, selfId)} grubuna eklenecek kişileri seç. Eklenenler geçmiş mesajları da görür.`
    : `Bir kişi seçersen bire bir konuşma, birden çok kişi seçersen grup başlar (en fazla ${DM_GROUP_MAX_PARTICIPANTS} kişi).`;

  return (
    <Modal title={title} subtitle={subtitle} onClose={close} className="w-[480px]">
      <form onSubmit={submit} noValidate>
        <div className="relative mb-2">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kullanıcı ara"
            aria-label="Kullanıcı ara"
            className="pl-8"
            autoFocus
            onKeyDown={(e) => {
              // Aramada tek kişi kaldıysa Enter onu seçer
              if (e.key === 'Enter' && candidates.length === 1 && !selected.includes(candidates[0]!.id)) {
                e.preventDefault();
                toggle(candidates[0]!.id);
                setQuery('');
              }
            }}
          />
        </div>
        <div className="mb-1 flex justify-between px-1 text-xs text-text-muted">
          <span>{selected.length > 0 ? `${selected.length} kişi seçildi` : 'Kişi seç'}</span>
          {selected.length >= capacity && <span className="text-warn">Daha fazla kişi eklenemez</span>}
        </div>
        <div className="mb-4 max-h-72 overflow-y-auto rounded-md bg-bg-side p-1" role="listbox" aria-multiselectable>
          {candidates.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-text-muted">
              {query ? 'Eşleşen kimse yok.' : 'Eklenebilecek kimse yok.'}
            </p>
          ) : (
            candidates.map((u) => {
              const on = selected.includes(u.id);
              const disabled = !on && selected.length >= capacity;
              return (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={disabled}
                  onClick={() => toggle(u.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors duration-75',
                    on ? 'bg-bg-active' : 'hover:bg-bg-hover',
                    disabled && 'opacity-40',
                  )}
                >
                  <Avatar user={u} size={32} online={Boolean(online[u.id])} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-medium text-text-normal">{u.displayName}</span>
                    <span className="block truncate text-xs text-text-muted">@{u.username}</span>
                  </span>
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors duration-100',
                      on ? 'border-brand bg-brand text-white' : 'border-text-muted',
                    )}
                  >
                    {on && <Check size={14} strokeWidth={3} />}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {makesGroup && (
          <FormField label="Grup adı" hint="İsteğe bağlı; boş bırakılırsa üyelerin adları görünür.">
            <TextInput
              value={name}
              maxLength={DM_NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder="ör. Hafta sonu"
            />
          </FormField>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={selected.length === 0 || busy}>
            {group ? 'Ekle' : makesGroup ? 'Grup Oluştur' : 'Mesaj Gönder'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Grup konuşmasının adını değiştirmek (boş bırakılırsa üyelerin adları görünür) */
export function RenameDmModal({ channelId }: { channelId: string }) {
  const close = useUi((s) => s.closeModal);
  const dm = useGuild((s) => s.dms[channelId]);
  const [name, setName] = useState(dm?.name ?? '');
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!dm || busy) return;
    setBusy(true);
    const ok = await renameDm(dm.id, name);
    setBusy(false);
    if (ok) close();
  };

  return (
    <Modal title="Grubun Adı" onClose={close}>
      <form ref={formRef} onSubmit={submit} noValidate>
        <FormField label="Ad" hint="Boş bırakılırsa üyelerin adları görünür.">
          <TextInput
            value={name}
            maxLength={DM_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. Hafta sonu"
            autoFocus
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || !dm}>
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
}
