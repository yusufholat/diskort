import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { Camera, ChevronRight, ImagePlus, X } from 'lucide-react';
import {
  FEEDBACK_BODY_MAX_LENGTH,
  FEEDBACK_MAX_SCREENSHOTS,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_TITLE_MAX_LENGTH,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  type FeedbackContext,
  type FeedbackType,
} from '@diskort/shared';
import { errorMessage, formatBytes, submitFeedback, type LocalFile } from '@diskort/client-core';
import { desktopFeedbackContext } from '../../features/feedback/context';
import { bridge } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import { toast, useUi } from '../../stores/ui';
import { Modal } from '../ui/Modal';
import { Button, TextInput } from '../ui/controls';
import { FormAlert, FormField, focusFirstInvalid, useFormErrors } from '../ui/FormField';
import { Checkbox, ContextTable, Lightbox, TYPE_ICONS } from './common';

const TYPE_HINTS: Record<FeedbackType, string> = {
  hata: 'Bir şey çalışmıyor',
  oneri: 'Bir fikrin var',
  diger: 'Başka bir konu',
};

const PLACEHOLDERS: Record<FeedbackType, string> = {
  hata: 'Ne oldu? Ne yapıyordun, ne olmasını bekliyordun? Tekrar olursa adımları yaz.',
  oneri: 'Neyi, neden istersin? Nasıl çalışmalı?',
  diger: 'Aklındakini yaz…',
};

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface Shot {
  key: number;
  file: LocalFile;
  /** Önizleme için blob adresi (kaldırılınca bırakılır) */
  url: string;
  label: string;
}

let shotKey = 0;

/** Pencerenin yeniden çizilmesini bekler (gizlenen pencere görüntüye girmesin) */
const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))));

/**
 * Geri bildirim gönderme penceresi: tür, başlık, açıklama, en fazla 3 ekran görüntüsü (uygulama
 * penceresinin görüntüsü ya da resim dosyası) ve gönderilecek teknik bilgiler (kapatılabilir).
 */
export function FeedbackModal() {
  const close = useUi((s) => s.closeModal);
  const [type, setType] = useState<FeedbackType>('hata');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Shot | null>(null);
  const form = useFormErrors<'body'>();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  useEffect(() => {
    void desktopFeedbackContext().then(setContext);
  }, []);

  // Kapanınca önizleme adresleri bırakılır
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const full = shots.length >= FEEDBACK_MAX_SCREENSHOTS;

  const addShots = (files: LocalFile[]): void => {
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (images.length < files.length) toast('Yalnızca PNG, JPEG, WebP ya da GIF resim eklenebilir.', 'error');
    const tooLarge = images.filter((f) => f.size > FEEDBACK_SCREENSHOT_MAX_BYTES);
    if (tooLarge.length) toast(`Resim çok büyük (en fazla ${formatBytes(FEEDBACK_SCREENSHOT_MAX_BYTES)}).`, 'error');
    const accepted = images.filter((f) => f.size <= FEEDBACK_SCREENSHOT_MAX_BYTES);
    const room = FEEDBACK_MAX_SCREENSHOTS - shotsRef.current.length;
    if (accepted.length > room) toast(`En fazla ${FEEDBACK_MAX_SCREENSHOTS} ekran görüntüsü eklenebilir.`, 'error');
    const added = accepted.slice(0, Math.max(0, room)).map((file) => ({
      key: ++shotKey,
      file,
      url: URL.createObjectURL(file.blob!),
      label: file.name,
    }));
    if (added.length) setShots((current) => [...current, ...added]);
  };

  const removeShot = (key: number): void => {
    setShots((current) => {
      const shot = current.find((s) => s.key === key);
      if (shot) URL.revokeObjectURL(shot.url);
      return current.filter((s) => s.key !== key);
    });
  };

  /** Yalnızca Diskort penceresinin görüntüsü: bu pencere bir anlığına gizlenir, altındaki uygulama çekilir. */
  const capture = async (): Promise<void> => {
    if (!bridge?.feedback || full || capturing) return;
    setCapturing(true);
    try {
      await nextPaint();
      const image = await bridge.feedback.capture();
      const extension = image.type === 'image/png' ? 'png' : 'jpg';
      const blob = new Blob([image.data as Uint8Array<ArrayBuffer>], { type: image.type });
      addShots([{ name: `diskort-ekran.${extension}`, size: blob.size, type: image.type, blob }]);
    } catch (err) {
      toast(`Ekran görüntüsü alınamadı: ${errorMessage(err)}`, 'error');
    } finally {
      setCapturing(false);
    }
  };

  const onPaste = (e: ClipboardEvent): void => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    addShots(files.map((f) => ({ name: f.name, size: f.size, type: f.type, blob: f })));
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!form.validate({ body: !body.trim() && 'Ne olduğunu kısaca anlat.' })) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      await submitFeedback({
        type,
        title,
        body,
        context: includeContext ? (context ?? (await desktopFeedbackContext())) : null,
        screenshots: shots.map((s) => s.file),
      });
      toast('Geri bildirimin gönderildi, teşekkürler!', 'success');
      close();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remaining = FEEDBACK_BODY_MAX_LENGTH - body.length;

  return (
    // Görüntü alınırken pencere (ve karartılmış arka planı) bir anlığına gizlenir
    <div className={cn(capturing && 'invisible')} aria-hidden={capturing || undefined}>
      <Modal
        title="Geri Bildirim Gönder"
        subtitle="Bir hata mı buldun, bir fikrin mi var? Yaz, birlikte düzeltelim."
        onClose={close}
        className="w-[560px]"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close}>
              Vazgeç
            </Button>
            <Button type="submit" form="feedback-form" disabled={busy}>
              {busy ? 'Gönderiliyor…' : 'Gönder'}
            </Button>
          </>
        }
      >
        <form
          id="feedback-form"
          ref={formRef}
          onSubmit={(e) => void submit(e)}
          onPaste={onPaste}
          noValidate
          className="max-h-[calc(100vh-260px)] overflow-y-auto pr-1"
        >
          <FormAlert message={error} />

          <div className="mb-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tür">
            {FEEDBACK_TYPES.map((t) => {
              const Icon = TYPE_ICONS[t];
              const selected = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setType(t)}
                  className={cn(
                    'press flex flex-col items-center gap-1 rounded-md px-2 py-2.5 transition-colors',
                    selected ? 'bg-bg-active text-text-head ring-2 ring-brand ring-inset' : 'bg-bg-side text-text-normal hover:bg-bg-hover',
                  )}
                >
                  <Icon size={20} className={cn('ico-pop', selected ? 'text-text-head' : 'text-text-muted')} />
                  <span className="text-sm font-semibold">{FEEDBACK_TYPE_LABELS[t]}</span>
                  <span className="text-xs text-text-muted">{TYPE_HINTS[t]}</span>
                </button>
              );
            })}
          </div>

          <FormField label="Başlık (isteğe bağlı)">
            <TextInput
              value={title}
              maxLength={FEEDBACK_TITLE_MAX_LENGTH}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === 'hata' ? 'ör. Ekran paylaşımında ses gelmiyor' : 'Kısa bir başlık'}
            />
          </FormField>

          <FormField
            label="Açıklama"
            error={form.errors.body}
            shakeKey={form.attempt}
            hint={remaining < 500 ? `${remaining} karakter kaldı` : 'Resim yapıştırabilirsin (Ctrl+V).'}
          >
            <textarea
              value={body}
              autoFocus
              rows={4}
              maxLength={FEEDBACK_BODY_MAX_LENGTH}
              onChange={(e) => {
                setBody(e.target.value);
                form.clear('body');
              }}
              placeholder={PLACEHOLDERS[type]}
              className="block max-h-[40vh] min-h-24 w-full resize-y rounded-[3px] border border-transparent bg-bg-input px-2.5 py-2 text-[15px] leading-snug text-text-normal outline-none transition-colors placeholder:text-text-faint hover:border-edge-strong focus:border-brand/70"
            />
          </FormField>

          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between text-xs font-bold tracking-wide text-text-muted uppercase">
              <span>Ekran görüntüleri</span>
              <span className="font-medium normal-case">
                {shots.length}/{FEEDBACK_MAX_SCREENSHOTS}
              </span>
            </div>
            {shots.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {shots.map((s) => (
                  <div key={s.key} className="anim-pop-in group relative h-20 w-32 overflow-hidden rounded-md bg-bg-rail">
                    <button
                      type="button"
                      className="h-full w-full"
                      onClick={() => setPreview(s)}
                      data-tooltip="Önizle"
                    >
                      <img src={s.url} alt={s.label} draggable={false} className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeShot(s.key)}
                      aria-label="Kaldır"
                      data-tooltip="Kaldır"
                      className="press-icon absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white hover:bg-danger"
                    >
                      <X size={14} className="ico-rotate" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {bridge?.feedback && (
                <Button
                  type="button"
                  variant="secondary"
                  className="flex items-center gap-2"
                  disabled={full || capturing}
                  data-tooltip={full ? `En fazla ${FEEDBACK_MAX_SCREENSHOTS} ekran görüntüsü` : 'Yalnızca Diskort penceresi çekilir'}
                  onClick={() => void capture()}
                >
                  <Camera size={16} className="ico-pop" />
                  Uygulamanın ekran görüntüsünü ekle
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                className="flex items-center gap-2"
                disabled={full}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus size={16} className="ico-lift" />
                Resim ekle
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  addShots(files.map((f) => ({ name: f.name, size: f.size, type: f.type, blob: f })));
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="rounded-md bg-bg-side px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <Checkbox checked={includeContext} onChange={setIncludeContext}>
                Teknik bilgileri ekle
              </Checkbox>
              <button
                type="button"
                aria-expanded={showContext}
                onClick={() => setShowContext((v) => !v)}
                className="flex items-center gap-1 text-sm text-text-muted hover:text-text-normal"
              >
                Gönderilecek teknik bilgiler
                <ChevronRight size={16} className={cn('ico-nudge-r', showContext && 'rotate-90')} />
              </button>
            </div>
            {showContext && (
              <div className={cn('anim-slide-down mt-2.5', !includeContext && 'opacity-40')}>
                {context ? <ContextTable context={context} /> : <div className="text-sm text-text-muted">Toplanıyor…</div>}
                <p className="mt-2 text-xs text-text-muted">
                  Mesajların, kanal adların ya da şifren gönderilmez. {includeContext ? '' : 'Bu bilgiler gönderilmeyecek.'}
                </p>
              </div>
            )}
          </div>
        </form>
      </Modal>
      {preview && <Lightbox url={preview.url} onClose={() => setPreview(null)} />}
    </div>
  );
}
