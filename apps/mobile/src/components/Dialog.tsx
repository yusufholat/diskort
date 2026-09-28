import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { create } from 'zustand';
import { usePresence } from '../motion';
import { brandTint, colors, createStyles, font, radius, space, useTheme } from '../theme';
import { useKeyboardOverlap } from './BottomSheet';
import { renderIcon, type Icon } from './icons';
import { Button } from './ui';


interface DialogOptions {
  title: string;
  message?: string;
  /** Açıklamanın altında gösterilen içerik (ör. sabitlenecek mesajın önizlemesi) */
  preview?: ReactNode;
  /** Başlığın üstündeki simge (tehlikeli işlemde kırmızı) */
  icon?: Icon;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Geri alınamaz işlem: onay düğmesi kırmızı */
  danger?: boolean;
}

export interface ConfirmOptions extends DialogOptions {
  /**
   * Onay için aynen yazılması gereken metin (ör. silinecek sunucunun adı): yazılana kadar onay düğmesi
   * kapalı kalır.
   */
  requireText?: string;
}

export interface PromptOptions extends DialogOptions {
  /** Kutunun üstündeki etiket */
  label?: string;
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  /** Boş bırakılabilir (ör. yasaklama sebebi); değilse boşken onay düğmesi kapalı */
  optional?: boolean;
  /** Yazılanı kutuda dönüştürür (ör. metin kanalı adı: küçük harf, boşluk yerine tire) */
  transform?: (text: string) => string;
}

type Request =
  | { kind: 'confirm'; id: number; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; id: number; options: PromptOptions; resolve: (value: string | null) => void };

const useDialog = create<{ current: Request | null }>(() => ({ current: null }));

let nextId = 0;

/** Açık bir pencere varsa vazgeçilmiş sayar (yenisi onun yerine açılır) */
function dismissCurrent(): void {
  const current = useDialog.getState().current;
  if (!current) return;
  useDialog.setState({ current: null });
  if (current.kind === 'confirm') current.resolve(false);
  else current.resolve(null);
}

/**
 * Uygulamanın temasında onay penceresi (Android'in gri Alert kutusu yerine). Onaylanırsa true;
 * vazgeçilirse ("Vazgeç", geri tuşu, dışarı dokunma) false döner.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  dismissCurrent();
  return new Promise((resolve) => useDialog.setState({ current: { kind: 'confirm', id: ++nextId, options, resolve } }));
}

/** Temada tek satırlık metin sorar (ör. kanalın yeni adı). Vazgeçilirse null döner. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  dismissCurrent();
  return new Promise((resolve) => useDialog.setState({ current: { kind: 'prompt', id: ++nextId, options, resolve } }));
}

const CLOSE_MS = 160;

/** Uygulamada bir kez çizilir (bkz. app/_layout.tsx); confirmDialog() / promptDialog() ile açılır */
export function DialogHost() {
  const current = useDialog((s) => s.current);
  // Kapanış animasyonu sürerken son pencerenin içeriği görünmeye devam eder
  const last = useRef(current);
  if (current) last.current = current;
  const shown = current ?? last.current;
  const mounted = usePresence(current !== null, CLOSE_MS);
  // Tema değişince pencere yeni renklerle çizilsin
  useTheme((s) => s.version);
  if (!mounted || !shown) return null;
  return <DialogView key={shown.id} request={shown} open={current !== null && current.id === shown.id} />;
}

function finish(request: Request, value: boolean | string | null): void {
  if (useDialog.getState().current?.id !== request.id) return;
  useDialog.setState({ current: null });
  if (request.kind === 'confirm') request.resolve(value === true);
  else request.resolve(typeof value === 'string' ? value : null);
}

function DialogView({ request, open }: { request: Request; open: boolean }) {
  const { options } = request;
  const reduce = useReducedMotion();
  const progress = useSharedValue(0);
  const keyboard = useKeyboardOverlap(request.kind === 'prompt' || Boolean((options as ConfirmOptions).requireText));
  const [text, setText] = useState(request.kind === 'prompt' ? (request.options.initial ?? '') : '');

  useEffect(() => {
    if (reduce) {
      progress.value = open ? 1 : 0;
      return;
    }
    progress.value = open
      ? withSpring(1, { damping: 20, stiffness: 320, mass: 0.8 })
      : withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) });
  }, [open, reduce, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.value) }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value),
    transform: [{ scale: 0.92 + 0.08 * progress.value }, { translateY: (1 - progress.value) * 16 }],
  }));

  const cancel = (): void => finish(request, request.kind === 'confirm' ? false : null);
  const required = request.kind === 'confirm' ? request.options.requireText : undefined;
  const confirmDisabled =
    request.kind === 'prompt'
      ? !request.options.optional && text.trim() === ''
      : required !== undefined && text.trim() !== required.trim();
  const confirm = (): void => {
    if (confirmDisabled) return;
    finish(request, request.kind === 'confirm' ? true : text.trim());
  };

  const danger = options.danger === true;
  const showInput = request.kind === 'prompt' || required !== undefined;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={cancel}>
      <View style={StyleSheet.absoluteFill} onLayout={(e) => keyboard.setWindowHeight(e.nativeEvent.layout.height)}>
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel="Kapat" />
        </Reanimated.View>
        <View pointerEvents="box-none" style={[styles.center, { paddingBottom: keyboard.overlap + space.xl }]}>
          <Reanimated.View
            style={[styles.card, cardStyle]}
            accessibilityViewIsModal
            accessibilityRole="alert"
            accessibilityLabel={options.title}
          >
            {options.icon ? (
              <View style={[styles.icon, danger && { backgroundColor: colors.dangerSoft }]}>
                {renderIcon(options.icon, 26, danger ? colors.danger : colors.brandText)}
              </View>
            ) : null}
            <Text style={styles.title}>{options.title}</Text>
            {options.message ? <Text style={styles.message}>{options.message}</Text> : null}
            {options.preview ? (
              <View style={styles.preview} accessible={false}>
                {options.preview}
              </View>
            ) : null}
            {showInput ? (
              <DialogInput
                label={
                  request.kind === 'prompt'
                    ? request.options.label
                    : `Onaylamak için “${required}” yaz`
                }
                value={text}
                onChangeText={(value) =>
                  setText(request.kind === 'prompt' && request.options.transform ? request.options.transform(value) : value)
                }
                placeholder={request.kind === 'prompt' ? request.options.placeholder : required}
                maxLength={request.kind === 'prompt' ? request.options.maxLength : undefined}
                onSubmit={confirm}
                danger={danger}
              />
            ) : null}
            <View style={styles.buttons}>
              <View style={styles.button}>
                <Button title={options.cancelLabel ?? 'Vazgeç'} variant="secondary" onPress={cancel} />
              </View>
              <View style={styles.button}>
                <Button
                  title={options.confirmLabel ?? (request.kind === 'prompt' ? 'Kaydet' : 'Tamam')}
                  variant={danger ? 'danger' : 'primary'}
                  disabled={confirmDisabled}
                  onPress={confirm}
                />
              </View>
            </View>
          </Reanimated.View>
        </View>
      </View>
    </Modal>
  );
}

function DialogInput({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  onSubmit,
  danger,
}: {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  onSubmit: () => void;
  danger: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        selectionColor={colors.brand}
        cursorColor={colors.head}
        maxLength={maxLength}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, focused && { borderColor: danger ? colors.danger : brandTint(0.7) }]}
      />
    </View>
  );
}

const styles = createStyles(() => ({
  backdrop: { backgroundColor: colors.backdrop },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.side,
    borderRadius: radius.xl,
    padding: space.xl,
    // Siyah temada gölge görünmez: ince kenar pencereyi arkadan ayırır
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.edge,
    elevation: 24,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.md,
  },
  title: { color: colors.head, fontSize: font.heading, fontWeight: '800', textAlign: 'center' },
  message: { color: colors.muted, fontSize: font.body - 0.5, lineHeight: 21, textAlign: 'center', marginTop: space.sm },
  preview: {
    marginTop: space.lg,
    maxHeight: 220,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.main,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.edge,
    padding: space.md,
  },
  field: { marginTop: space.lg },
  label: { color: colors.muted, fontSize: font.caption, fontWeight: '700', marginBottom: space.sm, textTransform: 'uppercase' },
  input: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  buttons: { flexDirection: 'row', gap: space.sm + 2, marginTop: space.xl },
  button: { flex: 1 },
}));
