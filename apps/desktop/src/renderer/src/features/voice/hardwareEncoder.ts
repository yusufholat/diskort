import type { ScreenCodec } from '../../stores/settings';
import type { ScreenPreset } from './screenPresets';

/**
 * Ekran paylaşımını ekran kartının kodlayıcısına (NVENC / AMF / Quick Sync; Windows'ta Media Foundation üzerinden)
 * yönlendirir. Chromium (Electron 44 / Chromium 152) bunları WebRTC'de kullanabiliyor, ancak LiveKit ile iki engel var:
 *
 * - H.264: SFU yanıtında H.264 kodekleri tarayıcının teklif sırasıyla gelir ve ilk sırada Constrained Baseline
 *   (profile-level-id=42e01f) olur. Chromium Windows'ta CBP'yi donanımla kodlamıyor (PlatformH264CbpEncoding kapalı;
 *   NVIDIA'da hiç denenmiyor, crbug.com/1088650), bu yüzden yayın OpenH264 ile işlemcide kodlanıyordu. Donanım
 *   kodlayıcısı High profili (64xxxx) sunuyor ve LiveKit sunucusu bunu da kabul ediyor: teklifte High öne alınır.
 *   İzleyiciler: LiveKit kodek eşleşmesinde yalnızca MIME'a bakar, akışı izleyicinin anlaştığı H.264 yük türüyle
 *   (çoğunlukla 42e01f) iletir. Kod çözücüler profili akışın kendisinden (SPS) okur: masaüstünde D3D11 ile sorunsuz
 *   çözüldüğü ölçüldü; Android'de MediaCodec H.264 çözücüleri High profili donanımla çözer.
 * - AV1: LiveKit ekran paylaşımında L1T3 (zamansal katman) istiyor; NVIDIA'nın AV1 kodlayıcısı zamansal katman
 *   desteklemediği için Chromium libaom'a (yazılım) düşüyordu. Donanım varsa baştan L1T1 istenir. (Ayrıca ana
 *   süreçte WebRtcAV1HWEncode açılır.)
 *
 * Seçim yayın başlamadan (SDP anlaşmasından önce) yapılmalı: LiveKit sunucusu yayın ortasında yük türü (payload
 * type) değişince alıcıyı geçersiz sayıp izleyicilere iletimi keser. Bu yüzden LiveKit'in yayın için oluşturduğu
 * transceiver'a, yalnızca kayıtlı parçalar (track) için, kodek tercihi uygulanır.
 */
export type HwEncoderChoice = 'h264-high' | 'av1-l1t1';

interface TransceiverTweak {
  /** Teklifteki kodek sırası (ilk uygun olan kullanılır) */
  codecs?: RTCRtpCodec[];
  /** Tek katmanlı kodlamanın ölçeklenebilirlik kipi */
  scalabilityMode?: string;
}

type EncodingInit = RTCRtpEncodingParameters & { scalabilityMode?: string };

const tweaks = new WeakMap<MediaStreamTrack, TransceiverTweak>();
let hookInstalled = false;

/**
 * LiveKit yayın göndericisini `addTransceiver(track, init)` ile oluşturup hemen anlaşma başlatıyor; arada araya
 * girmenin tek yolu bu. Kaydı olmayan parçalara dokunulmaz.
 */
function installTransceiverHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  const original = RTCPeerConnection.prototype.addTransceiver;
  RTCPeerConnection.prototype.addTransceiver = function (
    this: RTCPeerConnection,
    trackOrKind: MediaStreamTrack | string,
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver {
    const tweak = typeof trackOrKind === 'string' ? undefined : tweaks.get(trackOrKind);
    const encodings = init?.sendEncodings as EncodingInit[] | undefined;
    if (tweak?.scalabilityMode && encodings?.length === 1) {
      const first: EncodingInit = { ...encodings[0], scalabilityMode: tweak.scalabilityMode };
      init = { ...init, sendEncodings: [first] };
    }
    const transceiver = original.call(this, trackOrKind, init);
    if (tweak?.codecs) {
      try {
        transceiver.setCodecPreferences(tweak.codecs);
      } catch (err) {
        console.warn('[yayın] kodek tercihi uygulanamadı', err);
      }
    }
    return transceiver;
  } as RTCPeerConnection['addTransceiver'];
}

/** Bu kodek/çözünürlük için WebRTC'de verimli (donanım) kodlayıcı var mı? */
async function hasHardwareEncoder(contentType: string, preset: ScreenPreset, scalabilityMode?: string): Promise<boolean> {
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: {
        contentType,
        width: preset.width,
        height: preset.height,
        framerate: preset.fps,
        bitrate: preset.bitrate,
        ...(scalabilityMode ? { scalabilityMode } : {}),
      },
    });
    return info.supported && info.powerEfficient;
  } catch {
    return false;
  }
}

const isH264High = (c: RTCRtpCodec) => c.mimeType.toLowerCase() === 'video/h264' && /profile-level-id=64/i.test(c.sdpFmtpLine ?? '');

/**
 * Yayın yayımlanmadan önce çağrılır: donanım kodlayıcısı varsa bu parça için gereken ayarı kaydeder ve seçilen
 * yolu döner; yoksa null (Chromium'un varsayılanı: çoğunlukla yazılım). Kayıt, yeniden bağlanmada LiveKit parçayı
 * tekrar yayımladığında da geçerlidir; yayın bitince `releaseHardwareEncoder` ile silinir.
 */
export async function prepareHardwareEncoder(
  track: MediaStreamTrack,
  codec: ScreenCodec,
  preset: ScreenPreset,
): Promise<HwEncoderChoice | null> {
  tweaks.delete(track);
  let tweak: TransceiverTweak | null = null;
  let choice: HwEncoderChoice | null = null;

  if (codec === 'h264') {
    // High profil yalnızca donanım kodlayıcısı varsa sunulur (OpenH264 High kodlayamaz).
    const caps = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const high = caps.find(isH264High);
    if (high && (await hasHardwareEncoder(`video/H264;${high.sdpFmtpLine ?? ''}`, preset))) {
      tweak = { codecs: [high, ...caps.filter((c) => c !== high)] };
      choice = 'h264-high';
    }
  } else if (codec === 'av1') {
    if (await hasHardwareEncoder('video/AV1', preset, 'L1T1')) {
      tweak = { scalabilityMode: 'L1T1' };
      choice = 'av1-l1t1';
    }
  }
  // VP8/VP9: NVIDIA/AMD'de donanım kodlayıcısı yok; Intel'de VP9 varsa Chromium zaten kendisi kullanır.

  if (!tweak) return null;
  installTransceiverHook();
  tweaks.set(track, tweak);
  return choice;
}

export function releaseHardwareEncoder(track: MediaStreamTrack): void {
  tweaks.delete(track);
}
