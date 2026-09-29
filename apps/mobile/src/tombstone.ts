// Android'in yerel çökme dökümü (tombstone, Android 12+): debuggerd'nin protobuf'u
// (system/core/debuggerd/proto/tombstone.proto). Yalnızca güvenli alanlar okunur: sinyal, iptal mesajı,
// sebepler ve çöken iş parçacığının adı ve yığını (kütüphane ve işlev adları). Yazmaçlar, bellek dökümleri
// (yazmaçların çevresindeki ham bellek: mesaj, jeton gibi uygulama verisi içerebilir), bellek haritaları,
// günlükler ve açık dosyalar hiç çözülmeden atlanır. Ham baytlar burada kalır, hiçbir yere yazılmaz.
//
// Döküm kesik (yerel modül ilk 1 MB'ı verir) ya da bozuk olabilir: okuyucu hiçbir durumda fırlatmaz,
// okuyabildiği kadarını döner.

export interface TombstoneFrame {
  /** Kütüphane içindeki adres (onaltılık) */
  relPc: string;
  functionName: string;
  functionOffset: number;
  fileName: string;
}

export interface Tombstone {
  /** 64 bitlik süreç (adresler 16 hane) */
  wide: boolean;
  /** Çöken iş parçacığı */
  tid: number | null;
  signal: {
    number: number;
    name: string;
    code: number;
    codeName: string;
    /** Hatalı adres (onaltılık); yoksa null */
    faultAddress: string | null;
  } | null;
  abortMessage: string;
  causes: string[];
  thread: { id: number; name: string } | null;
  frames: TombstoneFrame[];
}

const MAX_ABORT = 500;
const MAX_TEXT = 300;
const MAX_CAUSES = 3;
const MAX_FRAMES = 64;
/** Map girdisi (iş parçacığı) sayısı sınırı: yalnızca konumları tutulur */
const MAX_THREADS = 2000;

// ---------- Protobuf okuyucu ----------

interface Reader {
  buf: Uint8Array;
  pos: number;
  end: number;
}

/** 64 bitlik tamsayı iki 32 bitlik yarıda (JS sayısı 53 biti aşamaz; adresler aşar) */
interface U64 {
  lo: number;
  hi: number;
}

/** Varint; bozuk ya da kesikse null ve okuma biter */
function varint(r: Reader): U64 | null {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 10; i++) {
    if (r.pos >= r.end) break;
    const byte = r.buf[r.pos++] ?? 0;
    const bits = byte & 0x7f;
    const shift = 7 * i;
    if (shift < 28) lo |= bits << shift;
    else if (shift === 28) {
      lo |= (bits & 0x0f) << 28;
      hi |= bits >>> 4;
    } else hi |= bits << (shift - 32);
    if (!(byte & 0x80)) return { lo: lo >>> 0, hi: hi >>> 0 };
  }
  r.pos = r.end;
  return null;
}

/** Alan başlığı (numara, kablo türü); bozuksa null ve okuma biter */
function tag(r: Reader): { field: number; wire: number } | null {
  const v = varint(r);
  if (!v || v.hi !== 0 || v.lo >>> 3 === 0) {
    r.pos = r.end;
    return null;
  }
  return { field: v.lo >>> 3, wire: v.lo & 7 };
}

/** Uzunluklu alanın gövdesi (kesikse eldeki kadarı); bozuksa null ve okuma biter */
function body(r: Reader): Reader | null {
  const len = varint(r);
  if (!len || len.hi !== 0) {
    r.pos = r.end;
    return null;
  }
  const start = r.pos;
  const end = Math.min(r.end, start + len.lo);
  r.pos = end;
  return { buf: r.buf, pos: start, end };
}

/** İstenmeyen alanı çözmeden atlar; atlanamıyorsa (grup, bilinmeyen tür, kesik) okuma biter */
function skip(r: Reader, wire: number): void {
  if (wire === 0) varint(r);
  else if (wire === 2) body(r);
  else if ((wire === 1 || wire === 5) && r.pos + (wire === 1 ? 8 : 4) <= r.end) r.pos += wire === 1 ? 8 : 4;
  else r.pos = r.end;
}

/**
 * Mesajın alanlarını sırayla gezer. `visit` alanı okuduysa true döner; false dönerse (istenmeyen alan ya da
 * beklenmeyen kablo türü) alan çözülmeden atlanır.
 */
function walk(r: Reader, visit: (field: number, wire: number) => boolean): void {
  while (r.pos < r.end) {
    const t = tag(r);
    if (!t) return;
    if (!visit(t.field, t.wire)) skip(r, t.wire);
  }
}

const num = (v: U64 | null): number => (v ? v.hi * 0x100000000 + v.lo : 0);
/** int32 (eksi sayılar 10 baytlık varint olarak gelir) */
const int32 = (v: U64 | null): number => (v ? v.lo | 0 : 0);
const hex = (v: U64 | null): string => (!v ? '0' : v.hi ? v.hi.toString(16) + v.lo.toString(16).padStart(8, '0') : v.lo.toString(16));

/** Metin alanı: yalnızca yazdırılabilir ASCII (kütüphane ve işlev adları); diğer baytlar '?' */
function text(r: Reader | null, max: number): string {
  if (!r) return '';
  let out = '';
  for (let i = r.pos; i < r.end && out.length < max; i++) {
    const c = r.buf[i] ?? 0;
    out += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : c === 0x0a || c === 0x09 ? ' ' : '?';
  }
  return out;
}

// ---------- Tombstone ----------

function parseSignal(r: Reader | null): Tombstone['signal'] {
  if (!r) return null;
  const signal = { number: 0, name: '', code: 0, codeName: '', faultAddress: null as string | null };
  const fault = { has: false, address: null as U64 | null };
  // 1 number, 2 name, 3 code, 4 code_name, 8 has_fault_address, 9 fault_address; 10 (bellek meta verisi) atlanır
  walk(r, (field, wire) => {
    if (field === 1 && wire === 0) signal.number = int32(varint(r));
    else if (field === 2 && wire === 2) signal.name = text(body(r), MAX_TEXT);
    else if (field === 3 && wire === 0) signal.code = int32(varint(r));
    else if (field === 4 && wire === 2) signal.codeName = text(body(r), MAX_TEXT);
    else if (field === 8 && wire === 0) fault.has = num(varint(r)) !== 0;
    else if (field === 9 && wire === 0) fault.address = varint(r);
    else return false;
    return true;
  });
  signal.faultAddress = fault.has ? hex(fault.address) : null;
  return signal;
}

/** Cause: yalnızca 1 human_readable (ör. "null pointer dereference") */
function parseCause(r: Reader | null): string {
  const cause = { text: '' };
  if (!r) return '';
  walk(r, (field, wire) => {
    if (field !== 1 || wire !== 2) return false;
    cause.text = text(body(r), MAX_TEXT);
    return true;
  });
  return cause.text;
}

/** BacktraceFrame: 1 rel_pc, 4 function_name, 5 function_offset, 6 file_name (build_id vb. atlanır) */
function parseFrame(r: Reader | null): TombstoneFrame {
  const frame: TombstoneFrame = { relPc: '0', functionName: '', functionOffset: 0, fileName: '' };
  if (!r) return frame;
  walk(r, (field, wire) => {
    if (field === 1 && wire === 0) frame.relPc = hex(varint(r));
    else if (field === 4 && wire === 2) frame.functionName = text(body(r), MAX_TEXT);
    else if (field === 5 && wire === 0) frame.functionOffset = num(varint(r));
    else if (field === 6 && wire === 2) frame.fileName = text(body(r), MAX_TEXT);
    else return false;
    return true;
  });
  return frame;
}

/**
 * Thread: 1 id, 2 name, 4 current_backtrace. 3 registers ve 5 memory_dump (ham bellek) çözülmeden atlanır.
 */
function parseThread(r: Reader, out: Tombstone): void {
  const thread = { id: 0, name: '' };
  walk(r, (field, wire) => {
    if (field === 1 && wire === 0) thread.id = int32(varint(r));
    else if (field === 2 && wire === 2) thread.name = text(body(r), MAX_TEXT);
    else if (field === 4 && wire === 2) {
      const frame = parseFrame(body(r));
      if (out.frames.length < MAX_FRAMES) out.frames.push(frame);
    } else return false;
    return true;
  });
  out.thread = thread;
}

/** threads map girdisi: 1 anahtar (iş parçacığı kimliği), 2 değer (Thread); değer çözülmez, yalnızca yeri tutulur */
function threadEntry(r: Reader | null): { id: number; thread: Reader } | null {
  if (!r) return null;
  const entry = { id: null as number | null, thread: null as Reader | null };
  walk(r, (field, wire) => {
    if (field === 1 && wire === 0) entry.id = num(varint(r));
    else if (field === 2 && wire === 2) entry.thread = body(r);
    else return false;
    return true;
  });
  return entry.id !== null && entry.thread ? { id: entry.id, thread: entry.thread } : null;
}

/** Tombstone protobuf'unu okur; hiçbir durumda fırlatmaz, okuyabildiğini döner */
export function parseTombstone(bytes: Uint8Array): Tombstone {
  const out: Tombstone = { wide: false, tid: null, signal: null, abortMessage: '', causes: [], thread: null, frames: [] };
  try {
    const threads: { id: number; thread: Reader }[] = [];
    const r: Reader = { buf: bytes, pos: 0, end: bytes.length };
    // 1 arch, 6 tid, 10 signal_info, 14 abort_message, 15 causes, 16 threads; diğerleri (17 bellek haritaları,
    // 18 günlükler, 19 açık dosyalar…) çözülmeden atlanır
    walk(r, (field, wire) => {
      // Architecture: ARM32 = 0 (yazılmaz), ARM64 = 1, X86 = 2, X86_64 = 3, RISCV64 = 4
      if (field === 1 && wire === 0) out.wide = [1, 3, 4].includes(num(varint(r)));
      else if (field === 6 && wire === 0) out.tid = num(varint(r));
      else if (field === 10 && wire === 2) out.signal = parseSignal(body(r));
      else if (field === 14 && wire === 2) out.abortMessage = text(body(r), MAX_ABORT);
      else if (field === 15 && wire === 2) {
        const cause = parseCause(body(r));
        if (cause && out.causes.length < MAX_CAUSES) out.causes.push(cause);
      } else if (field === 16 && wire === 2) {
        const entry = threadEntry(body(r));
        if (entry && threads.length < MAX_THREADS) threads.push(entry);
      } else return false;
      return true;
    });
    // Yalnızca çöken iş parçacığı (diğerlerinin adları ve yığınları gerekmez)
    const crashed = out.tid === null ? undefined : threads.find((t) => t.id === out.tid);
    if (crashed) parseThread(crashed.thread, out);
  } catch {
    // beklenmez (okuyucu sınırları denetler): okunabilen kadarı döner
  }
  return out;
}

const pad = (value: string, wide: boolean): string => value.padStart(wide ? 16 : 8, '0');

/** Okunabilir döküm (Android'in metin tombstone'una benzer); hiçbir şey okunamadıysa boş */
export function formatTombstone(t: Tombstone): string {
  const lines: string[] = [];
  if (t.signal) {
    const s = t.signal;
    const fault = s.faultAddress === null ? '--------' : `0x${pad(s.faultAddress, t.wide)}`;
    lines.push(`signal ${s.number} (${s.name || '?'}), code ${s.code} (${s.codeName || '?'}), fault addr ${fault}`);
  }
  for (const cause of t.causes) lines.push(`Cause: ${cause}`);
  if (t.abortMessage) lines.push(`Abort message: '${t.abortMessage}'`);
  if (t.thread) lines.push(`thread: ${t.thread.name || '?'} (${t.thread.id})`);
  t.frames.forEach((f, i) => {
    const fn = f.functionName ? ` (${f.functionName}+${f.functionOffset})` : '';
    lines.push(`  #${String(i).padStart(2, '0')} pc ${pad(f.relPc, t.wide)}  ${f.fileName || '<bilinmiyor>'}${fn}`);
  });
  return lines.join('\n');
}

/** Özet için en üstteki çerçeve: "libhwui.so (İşlev+44)" */
export function topFrame(t: Tombstone): string {
  const f = t.frames[0];
  if (!f) return '';
  const file = f.fileName.split('/').pop() || '?';
  return f.functionName ? `${file} (${f.functionName}+${f.functionOffset})` : file;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

/** Base64 çözücü (yerel modül baytları base64 verir); geçersiz karakterler ve dolgu atlanır */
export function decodeBase64(input: string): Uint8Array {
  const out = new Uint8Array(Math.floor((input.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    const v = code < 128 ? (B64_INDEX[code] ?? -1) : -1;
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}
