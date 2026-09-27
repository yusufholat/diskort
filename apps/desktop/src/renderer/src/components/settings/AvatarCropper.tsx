import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { clamp } from '../../lib/utils';
import { Button } from '../ui/controls';
import { Modal } from '../ui/Modal';

/** Kırpma alanının kenarı (ekranda, piksel) */
const VIEW = 280;
/** Sunucuya gönderilen kare resmin kenarı; sunucu 256×256'ya küçültür */
const OUTPUT = 512;
const MAX_ZOOM = 5;
const PREVIEWS = [80, 40];

interface Loaded {
  url: string;
  img: HTMLImageElement;
  /** Resim kırpma alanını tam kaplarken (yakınlaştırma 1) ölçek */
  base: number;
}

interface Props {
  file: File;
  onCancel: () => void;
  /** Kırpılmış kare resim (PNG); kaydedilirken pencere açık kalır */
  onSave: (image: Blob) => Promise<void>;
}

/**
 * Profil fotoğrafı kırpma penceresi: resim sürüklenerek konumlandırılır, kaydırıcı ya da fare
 * tekerleğiyle yakınlaştırılır. Yuvarlak alan fotoğrafın görüneceği kısmı gösterir.
 */
export function AvatarCropper({ file, onCancel, onSave }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Resmin sol üst köşesinin kırpma alanına göre konumu (her zaman ≤ 0: alan hep dolu kalır)
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let alive = true;
    img.src = url;
    img
      .decode()
      .then(() => {
        if (!alive) return;
        const base = VIEW / Math.min(img.naturalWidth, img.naturalHeight);
        setLoaded({ url, img, base });
        setOffset({ x: (VIEW - img.naturalWidth * base) / 2, y: (VIEW - img.naturalHeight * base) / 2 });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Esc yalnızca bu pencereyi kapatsın (arkadaki ayarlar penceresini değil)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!saving) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, saving]);

  const scale = loaded ? loaded.base * zoom : 1;
  const width = loaded ? loaded.img.naturalWidth * scale : VIEW;
  const height = loaded ? loaded.img.naturalHeight * scale : VIEW;

  const place = (x: number, y: number, w = width, h = height): { x: number; y: number } => ({
    x: clamp(x, VIEW - w, 0),
    y: clamp(y, VIEW - h, 0),
  });

  /** Kırpma alanının ortası sabit kalacak şekilde yakınlaştırır. */
  const zoomTo = (next: number): void => {
    if (!loaded) return;
    const z = clamp(next, 1, MAX_ZOOM);
    const s = loaded.base * z;
    const cx = (VIEW / 2 - offset.x) / scale;
    const cy = (VIEW / 2 - offset.y) / scale;
    setZoom(z);
    setOffset(place(VIEW / 2 - cx * s, VIEW / 2 - cy * s, loaded.img.naturalWidth * s, loaded.img.naturalHeight * s));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!loaded || saving || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d?.id === e.pointerId) setOffset(place(e.clientX - d.x, e.clientY - d.y));
  };
  const endDrag = (): void => {
    drag.current = null;
  };

  const save = async (): Promise<void> => {
    if (!loaded || saving) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.imageSmoothingQuality = 'high';
    g.drawImage(loaded.img, -offset.x / scale, -offset.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUTPUT, OUTPUT);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    setSaving(true);
    try {
      await onSave(blob);
    } finally {
      setSaving(false);
    }
  };

  const picture = (factor: number) =>
    loaded && (
      <img
        src={loaded.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{ left: offset.x * factor, top: offset.y * factor, width: width * factor, height: height * factor }}
      />
    );

  return createPortal(
    // Ayarlar penceresinin üstünde açılsın
    <div className="relative z-[60]">
      <Modal
        title="Profil fotoğrafını düzenle"
        subtitle="Sürükleyerek konumlandır, kaydırıcıyla yakınlaştır."
        onClose={() => !saving && onCancel()}
        className="w-[460px]"
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={onCancel}>
              Vazgeç
            </Button>
            <Button disabled={!loaded || saving} onClick={() => void save()}>
              {saving ? 'Yükleniyor…' : 'Kaydet'}
            </Button>
          </>
        }
      >
        {failed ? (
          <p className="py-10 text-center text-sm text-[#fa777c]">Bu resim açılamadı. Başka bir dosya dene.</p>
        ) : (
          <div className="flex items-center justify-center gap-6">
            <div
              className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-md bg-bg-deep active:cursor-grabbing"
              style={{ width: VIEW, height: VIEW }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
            >
              {picture(1)}
              {/* Yuvarlak alanın dışı karartılır */}
              <div
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80"
                style={{ boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)' }}
              />
            </div>
            <div className="flex flex-col items-center gap-3">
              {PREVIEWS.map((size) => (
                <div key={size} className="relative overflow-hidden rounded-full bg-bg-deep" style={{ width: size, height: size }}>
                  {picture(size / VIEW)}
                </div>
              ))}
              <span className="text-xs text-text-muted">Önizleme</span>
            </div>
          </div>
        )}
        {!failed && (
          <div className="mt-4 flex items-center gap-3 px-2 text-text-muted">
            <button aria-label="Uzaklaştır" disabled={!loaded} onClick={() => zoomTo(zoom / 1.25)}>
              <ZoomOut size={18} />
            </button>
            <input
              type="range"
              className="slider flex-1"
              aria-label="Yakınlaştırma"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!loaded}
              onChange={(e) => zoomTo(Number(e.target.value))}
            />
            <button aria-label="Yakınlaştır" disabled={!loaded} onClick={() => zoomTo(zoom * 1.25)}>
              <ZoomIn size={18} />
            </button>
          </div>
        )}
      </Modal>
    </div>,
    document.body,
  );
}
