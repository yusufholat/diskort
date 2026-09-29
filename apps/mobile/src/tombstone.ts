// Android'in yerel çökme dökümü (tombstone, Android 12+): debuggerd'nin protobuf'u
// (system/core/debuggerd/proto/tombstone.proto). Yalnızca güvenli alanlar okunur: sinyal, iptal mesajı,
// sebepler ve çöken iş parçacığının adı ve yığını (kütüphane ve işlev adları). Yazmaçlar, bellek dökümleri
// (yazmaçların çevresindeki ham bellek: mesaj, jeton gibi uygulama verisi içerebilir), bellek haritaları,
// günlükler ve açık dosyalar hiç çözülmeden atlanır. Ham baytlar burada kalır, hiçbir yere yazılmaz.
//
// Döküm kesik olabilir (yerel modül ilk 1 MB'ı verir): okunabilen kadarı döner. Ama girdi protobuf gibi
// görünmüyorsa (bozuk alan başlığı, grup, aşırı uzun varint, bilinen bir alanın yanlış kablo türüyle gelmesi)
// ya da ne sinyal ne mimari okunabildiyse hiçbir şey döndürülmez: metin döküm ya da rastgele bayt tesadüfen
// "alan" gibi okunup içindeki uygulama verisi sızmasın. Okuyucu hiçbir durumda fırlatmaz.

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

/** Girdinin protobuf olmadığı anlaşıldı (bkz. dosyanın başı); iç içe okuyucular paylaşır */
interface ParseState {
  bad: boolean;
}

interface Reader {
  buf: Uint8Array;
  pos: number;
  end: number;
  state: ParseState;
}

/** 64 bitlik tamsayı iki 32 bitlik yarıda (JS sayısı 53 biti aşamaz; adresler aşar) */
interface U64 {
  lo: number;
  hi: number;
}

/** Bozuk girdi: okuma biter, sonuç atılır */
function fail(r: Reader): null {
  r.state.bad = true;
  r.pos = r.end;
  return null;
}

/** Varint; kesikse null (okuma biter), 10 bayttan uzunsa bozuk */
function varint(r: Reader): U64 | null {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 10; i++) {
    if (r.pos >= r.end) {
      r.pos = r.end;
      return null;
    }
    const byte = r.buf[r.pos++] ?? 0;
    const bits = byte & 0x7f;
    const shift = 7 * i;
    if (shift < 28) lo |= bits << shift;
    else if (shift === 28) {
      lo |= (bits & 0x0f) << 28;
      hi |= bits >>> 4;
    } else hi |= bits << (shift - 32);
    if (!(byte & 0x80)) return i === 9 && bits > 1 ? fail(r) : { lo: lo >>> 0, hi: hi >>> 0 };
  }
  return fail(r);
}

/** Kablo türleri */
const VARINT = 0;
const LEN = 2;

/** Alan başlığı; kesikse null, alan numarası 0 ya da grup/bilinmeyen kablo türü (3, 4, 6, 7) bozuk */
function tag(r: Reader): { field: number; wire: number } | null {
  const v = varint(r);
  if (!v) return null;
  const field = v.lo >>> 3;
  const wire = v.lo & 7;
  if (v.hi !== 0 || field === 0 || (wire !== 0 && wire !== 1 && wire !== 2 && wire !== 5)) return fail(r);
  return { field, wire };
}

/** Uzunluklu alanın gövdesi (kesikse eldeki kadarı); uzunluk okunamazsa null */
function body(r: Reader): Reader | null {
  const len = varint(r);
  if (!len) return null;
  if (len.hi !== 0) return fail(r);
  const start = r.pos;
  const end = Math.min(r.end, start + len.lo);
  r.pos = end;
  return { buf: r.buf, pos: start, end, state: r.state };
}

/** İstenmeyen alanı çözmeden atlar (kesikse okuma biter) */
function skip(r: Reader, wire: number): void {
  if (wire === VARINT) varint(r);
  else if (wire === LEN) body(r);
  else {
    const size = wire === 1 ? 8 : 4;
    r.pos = r.pos + size <= r.end ? r.pos + size : r.end;
  }
}

/**
 * Mesajın alanlarını sırayla gezer. `schema`: bilinen alanların kablo türü; bilinen bir alan başka türle gelirse
 * girdi bozuktur. `visit` alanı okuduysa true döner; false dönerse ya da alan bilinmiyorsa çözülmeden atlanır.
 */
function walk(r: Reader, schema: Readonly<Record<number, number>>, visit: (field: number) => boolean): void {
  while (r.pos < r.end && !r.state.bad) {
    const t = tag(r);
    if (!t) return;
    const expected = schema[t.field];
    if (expected !== undefined && expected !== t.wire) {
      fail(r);
      return;
    }
    if (expected === undefined || !visit(t.field)) skip(r, t.wire);
  }
}

// Kablo türleri kesin bilinen alanlar (tombstone.proto); diğerleri (yeni sürümlerin alanları) atlanır
const TOMBSTONE_SCHEMA = {
  1: VARINT, // arch
  2: LEN, // build_fingerprint
  3: LEN, // revision
  4: LEN, // timestamp
  5: VARINT, // pid
  6: VARINT, // tid
  7: VARINT, // uid
  8: LEN, // selinux_label
  9: LEN, // command_line
  10: LEN, // signal_info
  14: LEN, // abort_message
  15: LEN, // causes
  16: LEN, // threads
  17: LEN, // memory_mappings
  18: LEN, // log_buffers
  19: LEN, // open_fds
};
// number, name, code, code_name, has_sender, sender_uid, sender_pid, has_fault_address, fault_address,
// fault_adjacent_metadata
const SIGNAL_SCHEMA = { 1: VARINT, 2: LEN, 3: VARINT, 4: LEN, 5: VARINT, 6: VARINT, 7: VARINT, 8: VARINT, 9: VARINT, 10: LEN };
// human_readable, heap_object, memory_error
const CAUSE_SCHEMA = { 1: LEN, 2: LEN, 3: LEN };
// map<uint32, Thread> girdisi: key, value
const ENTRY_SCHEMA = { 1: VARINT, 2: LEN };
// id, name, registers, current_backtrace, memory_dump
const THREAD_SCHEMA = { 1: VARINT, 2: LEN, 3: LEN, 4: LEN, 5: LEN };
// rel_pc, pc, sp, function_name, function_offset, file_name, file_map_offset, build_id
const FRAME_SCHEMA = { 1: VARINT, 2: VARINT, 3: VARINT, 4: LEN, 5: VARINT, 6: LEN, 7: VARINT, 8: LEN };

const num = (v: U64): number => v.hi * 0x100000000 + v.lo;
/** int32 (eksi sayılar 10 baytlık varint olarak gelir) */
const int32 = (v: U64): number => v.lo | 0;
const hex = (v: U64): string => (v.hi ? v.hi.toString(16) + v.lo.toString(16).padStart(8, '0') : v.lo.toString(16));

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
  // Yalnızca sinyal, kod ve hatalı adres; gönderen bilgisi ve 10 (adresin çevresindeki bellek) atlanır
  walk(r, SIGNAL_SCHEMA, (field) => {
    if (field === 2) signal.name = text(body(r), MAX_TEXT);
    else if (field === 4) signal.codeName = text(body(r), MAX_TEXT);
    else if (field === 1 || field === 3 || field === 8 || field === 9) {
      const v = varint(r);
      if (!v) return true;
      if (field === 1) signal.number = int32(v);
      else if (field === 3) signal.code = int32(v);
      else if (field === 8) fault.has = num(v) !== 0;
      else fault.address = v;
    } else return false;
    return true;
  });
  signal.faultAddress = fault.has && fault.address ? hex(fault.address) : null;
  return signal;
}

/** Cause: yalnızca human_readable (ör. "null pointer dereference") */
function parseCause(r: Reader | null): string {
  const cause = { text: '' };
  if (!r) return '';
  walk(r, CAUSE_SCHEMA, (field) => {
    if (field !== 1) return false;
    cause.text = text(body(r), MAX_TEXT);
    return true;
  });
  return cause.text;
}

/** BacktraceFrame: rel_pc, function_name, function_offset, file_name (build_id vb. atlanır) */
function parseFrame(r: Reader | null): TombstoneFrame {
  const frame: TombstoneFrame = { relPc: '0', functionName: '', functionOffset: 0, fileName: '' };
  if (!r) return frame;
  walk(r, FRAME_SCHEMA, (field) => {
    if (field === 4) frame.functionName = text(body(r), MAX_TEXT);
    else if (field === 6) frame.fileName = text(body(r), MAX_TEXT);
    else if (field === 1 || field === 5) {
      const v = varint(r);
      if (v && field === 1) frame.relPc = hex(v);
      else if (v) frame.functionOffset = num(v);
    } else return false;
    return true;
  });
  return frame;
}

/** Thread: id, name, current_backtrace. registers ve memory_dump (ham bellek) çözülmeden atlanır. */
function parseThread(r: Reader, out: Tombstone): void {
  const thread = { id: 0, name: '' };
  walk(r, THREAD_SCHEMA, (field) => {
    if (field === 1) {
      const v = varint(r);
      if (v) thread.id = int32(v);
    } else if (field === 2) thread.name = text(body(r), MAX_TEXT);
    else if (field === 4) {
      const frame = parseFrame(body(r));
      if (out.frames.length < MAX_FRAMES) out.frames.push(frame);
    } else return false;
    return true;
  });
  out.thread = thread;
}

/** threads map girdisi: anahtar (iş parçacığı kimliği) ve değer (Thread); değer çözülmez, yalnızca yeri tutulur */
function threadEntry(r: Reader | null): { id: number; thread: Reader } | null {
  if (!r) return null;
  const entry = { id: null as number | null, thread: null as Reader | null };
  walk(r, ENTRY_SCHEMA, (field) => {
    if (field === 1) {
      const v = varint(r);
      entry.id = v ? num(v) : null;
    } else entry.thread = body(r);
    return true;
  });
  return entry.id !== null && entry.thread ? { id: entry.id, thread: entry.thread } : null;
}

const empty = (): Tombstone => ({
  wide: false,
  tid: null,
  signal: null,
  abortMessage: '',
  causes: [],
  thread: null,
  frames: [],
});

/**
 * Tombstone protobuf'unu okur; hiçbir durumda fırlatmaz. Kesikse okuyabildiğini döner; protobuf gibi
 * görünmüyorsa ya da ne sinyal ne mimari okunabildiyse boş döner (bkz. dosyanın başı).
 */
export function parseTombstone(bytes: Uint8Array): Tombstone {
  try {
    const out = empty();
    const state: ParseState = { bad: false };
    const r: Reader = { buf: bytes, pos: 0, end: bytes.length, state };
    const arch = { read: false };
    const threads: { id: number; thread: Reader }[] = [];
    // arch, tid, signal_info, abort_message, causes, threads; diğerleri (bellek haritaları, günlükler, açık
    // dosyalar…) çözülmeden atlanır
    walk(r, TOMBSTONE_SCHEMA, (field) => {
      if (field === 1 || field === 6) {
        const v = varint(r);
        if (!v) return true;
        // Architecture: ARM32 = 0 (varsayılan, yazılmaz), ARM64 = 1, X86 = 2, X86_64 = 3, RISCV64 = 4
        if (field === 1) {
          arch.read = true;
          out.wide = [1, 3, 4].includes(num(v));
        } else out.tid = num(v);
      } else if (field === 10) out.signal = parseSignal(body(r));
      else if (field === 14) out.abortMessage = text(body(r), MAX_ABORT);
      else if (field === 15) {
        const cause = parseCause(body(r));
        if (cause && out.causes.length < MAX_CAUSES) out.causes.push(cause);
      } else if (field === 16) {
        const entry = threadEntry(body(r));
        if (entry && threads.length < MAX_THREADS) threads.push(entry);
      } else return false;
      return true;
    });
    if (state.bad || !(arch.read || (out.signal?.number ?? 0) > 0)) return empty();
    // Yalnızca çöken iş parçacığı (diğerlerinin adları ve yığınları gerekmez)
    const crashed = out.tid === null ? undefined : threads.find((t) => t.id === out.tid);
    if (crashed) parseThread(crashed.thread, out);
    return state.bad ? empty() : out;
  } catch {
    // beklenmez (okuyucu sınırları denetler)
    return empty();
  }
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
