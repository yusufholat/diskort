import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronRight, Link2, Sparkles } from 'lucide-react';
import { GUILD_NAME_MAX_LENGTH, parseInviteCode, type InvitePreview } from '@diskort/shared';
import { api, createGuild, errorMessage, joinGuild, useSession } from '@diskort/client-core';
import { openGuildSection } from '../../lib/mainView';
import { toast, useUi } from '../../stores/ui';
import { GuildIcon } from '../ui/GuildIcon';
import { Modal } from '../ui/Modal';
import { Button, TextInput } from '../ui/controls';
import { FormField, REQUIRED, focusFirstInvalid, useFormErrors } from '../ui/FormField';

type Step = 'choose' | 'create' | 'join';

/** Sunucu ekle (Discord gibi): kendi sunucunu kur ya da davet bağlantısıyla bir sunucuya katıl. */
export function AddGuildModal({ tab, code }: { tab?: 'create' | 'join'; code?: string }) {
  const close = useUi((s) => s.closeModal);
  const [step, setStep] = useState<Step>(tab ?? 'choose');

  if (step === 'create') {
    return (
      <Modal title="Sunucunu kur" subtitle="Arkadaşlarınla buluşacağın yer. Adını ve simgesini sonra da değiştirebilirsin." onClose={close}>
        <CreateForm onBack={tab ? undefined : () => setStep('choose')} onDone={close} />
      </Modal>
    );
  }
  if (step === 'join') {
    return (
      <Modal title="Sunucuya katıl" subtitle="Arkadaşının gönderdiği davet bağlantısını ya da kodunu yapıştır." onClose={close}>
        <JoinForm initial={code} onBack={tab ? undefined : () => setStep('choose')} onDone={close} />
      </Modal>
    );
  }
  return (
    <Modal title="Sunucu ekle" subtitle="Kendi sunucunu kur ya da bir davetle arkadaşlarının sunucusuna katıl." onClose={close}>
      <div className="flex flex-col gap-2">
        <ChoiceButton
          icon={<Sparkles size={22} className="ico-twinkle" />}
          title="Kendi sunucunu kur"
          hint="Metin ve ses kanalıyla hazır gelir"
          onClick={() => setStep('create')}
        />
        <ChoiceButton
          icon={<Link2 size={22} className="ico-tilt" />}
          title="Sunucuya katıl"
          hint="Davet bağlantın ya da kodun var"
          onClick={() => setStep('join')}
        />
      </div>
    </Modal>
  );
}

function ChoiceButton({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex items-center gap-3 rounded-lg border border-line bg-bg-side px-4 py-3 text-left transition-colors hover:bg-bg-hover"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-text-head">{title}</span>
        <span className="block text-sm text-text-muted">{hint}</span>
      </span>
      <ChevronRight size={20} className="ico-nudge-r text-text-muted" />
    </button>
  );
}

function CreateForm({ onBack, onDone }: { onBack?: () => void; onDone: () => void }) {
  const displayName = useSession((s) => s.user?.displayName ?? '');
  const [name, setName] = useState(displayName ? `${displayName} sunucusu`.slice(0, GUILD_NAME_MAX_LENGTH) : '');
  const [busy, setBusy] = useState(false);
  const form = useFormErrors<'name'>();
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.validate({ name: !name.trim() && REQUIRED })) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    const guild = await createGuild(name);
    setBusy(false);
    if (!guild) return;
    openGuildSection(guild.id);
    toast(`"${guild.name}" kuruldu. Sunucu menüsünden arkadaşlarını davet edebilirsin.`, 'success');
    onDone();
  };

  return (
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)}>
      <FormField label="Sunucu adı" error={form.errors.name} shakeKey={form.attempt}>
        <TextInput autoFocus value={name} maxLength={GUILD_NAME_MAX_LENGTH} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="flex justify-between gap-2">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            Geri
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={busy}>
          Oluştur
        </Button>
      </div>
    </form>
  );
}

function JoinForm({ initial, onBack, onDone }: { initial?: string; onBack?: () => void; onDone: () => void }) {
  const [value, setValue] = useState(initial ?? '');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useFormErrors<'code'>();
  const formRef = useRef<HTMLFormElement>(null);
  const code = parseInviteCode(value);

  // Geçerli görünen kod yazılınca hangi sunucuya davet edildiği gösterilir
  useEffect(() => {
    setPreview(null);
    if (!code) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .previewInvite(code)
        .then((p) => !cancelled && setPreview(p))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.validate({ code: !code && (value.trim() ? 'Davet bağlantısı ya da kodu geçersiz.' : REQUIRED) })) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const guild = await joinGuild(value);
      toast(`"${guild.name}" sunucusuna katıldın.`, 'success');
      onDone();
      // Sunucu gateway'den gelince seçilir; kanal görünümü de ona geçer
      window.setTimeout(() => openGuildSection(guild.id), 300);
    } catch (err) {
      form.validate({ code: errorMessage(err) });
      focusFirstInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)}>
      <FormField
        label="Davet bağlantısı ya da kodu"
        error={form.errors.code}
        shakeKey={form.attempt}
        hint="Örnek: https://diskort.ziroo.net/davet/AB12CD34 ya da AB12CD34"
      >
        <TextInput autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Bağlantıyı yapıştır" />
      </FormField>
      {preview?.guild && (
        <div className="anim-rise-in mb-4 flex items-center gap-3 rounded-md bg-bg-side px-3 py-2">
          <GuildIcon guild={preview.guild} size={40} className="rounded-2xl" />
          <div className="min-w-0">
            <div className="truncate font-semibold text-text-head">{preview.guild.name}</div>
            <div className="text-xs text-text-muted">{preview.memberCount} üye</div>
          </div>
        </div>
      )}
      <div className="flex justify-between gap-2">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            Geri
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={busy}>
          Katıl
        </Button>
      </div>
    </form>
  );
}
