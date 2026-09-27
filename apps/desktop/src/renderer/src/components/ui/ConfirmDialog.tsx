import { closeDialog, useDialog } from '../../lib/dialog';
import { PresenceProvider, usePresence } from '../../lib/motion';
import { Button } from './controls';
import { Modal } from './Modal';

/** confirmDialog() ile açılan onay penceresi; uygulamanın kökünde bir kez bulunur. */
export function ConfirmDialogHost() {
  const { value: current, closing } = usePresence(useDialog((s) => s.current));
  if (!current) return null;
  return (
    // Diğer pencerelerin (ayarlar, kanal düzenleme) üstünde açılsın
    <div className="relative z-[60]">
      <PresenceProvider value={closing}>
        <Modal
          title={current.title}
          onClose={() => closeDialog(false)}
          className="w-[400px]"
          footer={
            <>
              <Button variant="ghost" onClick={() => closeDialog(false)}>
                {current.cancelLabel ?? 'Vazgeç'}
              </Button>
              <Button variant={current.danger ? 'danger' : 'primary'} autoFocus onClick={() => closeDialog(true)}>
                {current.confirmLabel ?? 'Tamam'}
              </Button>
            </>
          }
        >
          {current.message && <p className="text-center text-[15px] leading-relaxed text-text-normal">{current.message}</p>}
          {current.preview && <div className="mt-4">{current.preview}</div>}
        </Modal>
      </PresenceProvider>
    </div>
  );
}
