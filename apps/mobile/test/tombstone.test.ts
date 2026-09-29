// Tombstone (Android'in yerel çökme dökümü, protobuf) okuyucusu. Denetlenen: yalnızca güvenli alanlar okunur
// (sinyal, sebep, iptal mesajı, çöken iş parçacığının adı ve yığını); bellek dökümündeki ham uygulama verisi
// (jeton, DM metni), bellek haritaları, günlükler ve diğer iş parçacıkları çıktıya hiç girmez. Kesik, bozuk ve
// beklenmeyen kablo türlü girdide fırlatmaz, okuyabildiğini döner.

import { describe, expect, it } from 'vitest';
import { decodeBase64, formatTombstone, parseTombstone, topFrame } from '../src/tombstone';
import { bytes, frame, key, msg, str, toBase64, utf8, vint } from './protobuf';

const SECRET = 'Bearer secret-jeton-123';
const DM_JSON = '{"content":"gizli DM mesajı","author":"ayse"}';

const crashedThread = [
  vint(1, 4567),
  str(2, 'RenderThread'),
  msg(3, str(1, 'x0'), vint(2, 42)),
  frame(BigInt(0x4d6f8), 'SkCanvas::drawPath', 44, '/system/lib64/libhwui.so'),
  // Yazmacın çevresindeki ham bellek: uygulama verisi (jeton, DM) içerebilir
  msg(5, str(1, 'x1'), str(2, '[anon:scudo:primary]'), vint(3, BigInt('0x7000001000')), bytes(4, utf8(`${SECRET} ${DM_JSON}`))),
  frame(BigInt(0x12345), 'android::uirenderer::renderthread::RenderThread::threadLoop', 120, '/system/lib64/libhwui.so'),
];
const otherThread = [
  vint(1, 4321),
  str(2, 'main'),
  frame(BigInt(0x999), 'art::Monitor::Wait', 8, '/apex/com.android.art/lib64/libart.so'),
];

const segvParts = [
  vint(1, 1), // arm64
  str(2, 'HONOR/DNY-NX9/HNDNY:16/parmak-izi'),
  vint(5, 4321),
  vint(6, 4567),
  str(9, 'com.diskort.app'),
  msg(
    10,
    vint(1, 11),
    str(2, 'SIGSEGV'),
    vint(3, 1),
    str(4, 'SEGV_MAPERR'),
    vint(8, 1),
    vint(9, BigInt('0xb400007a12345678')),
    msg(10, bytes(4, utf8(SECRET))),
  ),
  msg(15, str(1, 'null pointer dereference')),
  // Diğer iş parçacığı önce gelse de çöken (tid) seçilir
  msg(16, vint(1, 4321), msg(2, ...otherThread)),
  msg(16, vint(1, 4567), msg(2, ...crashedThread)),
  msg(17, str(1, `/data/${SECRET}`)),
  msg(18, str(1, 'main'), msg(2, str(7, DM_JSON))),
  msg(19, vint(1, 3), str(2, `/data/${SECRET}`)),
];
const segv = Uint8Array.from(segvParts.flat());

const FORBIDDEN = ['Bearer', 'secret', 'gizli', 'scudo', 'HONOR', 'art::Monitor', 'a1b2c3d4', '/data/'];
const leaks = (text: string): string[] => FORBIDDEN.filter((word) => text.includes(word));

describe('parseTombstone', () => {
  it('sinyal, sebep ve çöken iş parçacığının yığını; ham bellek ve diğer alanlar yok', () => {
    const t = parseTombstone(segv);
    expect(t).toMatchObject({ wide: true, tid: 4567, abortMessage: '', causes: ['null pointer dereference'] });
    expect(t.thread).toEqual({ id: 4567, name: 'RenderThread' });
    expect(t.frames).toHaveLength(2);
    const text = formatTombstone(t);
    expect(text).toBe(
      [
        'signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0xb400007a12345678',
        'Cause: null pointer dereference',
        'thread: RenderThread (4567)',
        '  #00 pc 000000000004d6f8  /system/lib64/libhwui.so (SkCanvas::drawPath+44)',
        '  #01 pc 0000000000012345  /system/lib64/libhwui.so (android::uirenderer::renderthread::RenderThread::threadLoop+120)',
      ].join('\n'),
    );
    expect(leaks(text)).toEqual([]);
    expect(leaks(JSON.stringify(t))).toEqual([]);
    expect(topFrame(t)).toBe('libhwui.so (SkCanvas::drawPath+44)');
  });

  it('iptal mesajı, eksi sinyal kodu; 32 bit, hatalı adres yok', () => {
    const abort = Uint8Array.from([
      ...vint(6, 100),
      ...msg(10, vint(1, 6), str(2, 'SIGABRT'), vint(3, -6), str(4, 'SI_TKILL')),
      ...str(14, 'Check failed: surface != nullptr'),
      ...msg(16, vint(1, 100), msg(2, vint(1, 100), str(2, 'mqt_js'), frame(BigInt(0x6f8), 'abort', 168, '/apex/libc.so'))),
    ]);
    expect(formatTombstone(parseTombstone(abort))).toBe(
      [
        'signal 6 (SIGABRT), code -6 (SI_TKILL), fault addr --------',
        "Abort message: 'Check failed: surface != nullptr'",
        'thread: mqt_js (100)',
        '  #00 pc 000006f8  /apex/libc.so (abort+168)',
      ].join('\n'),
    );
  });

  it('kesik girdi: hiçbir uzunlukta fırlatmaz, sızdırmaz', () => {
    for (let n = 0; n <= segv.length; n++) {
      const part = segv.subarray(0, n);
      let text = '';
      expect(() => (text = formatTombstone(parseTombstone(part)))).not.toThrow();
      expect(leaks(text)).toEqual([]);
    }
    // tid'den sonra, komut satırının ortasında kesilen döküm: okunabilen kadarı
    const head = parseTombstone(segv.subarray(0, segvParts.slice(0, 4).flat().length + 5));
    expect(head).toMatchObject({ wide: true, tid: 4567, signal: null, thread: null, frames: [] });
    // Çöken iş parçacığının ortasında kesilen döküm: ilk çerçeve okunur
    const cut = parseTombstone(segv.subarray(0, segvParts.slice(0, 9).flat().length - 60));
    expect(cut.thread?.name).toBe('RenderThread');
    expect(cut.frames[0]?.functionName).toBe('SkCanvas::drawPath');
  });

  it('bilinmeyen alanlar atlanır; uzunluğu taşan alan kesik sayılır', () => {
    const t = parseTombstone(
      Uint8Array.from([
        ...vint(1, 1),
        ...key(30, 5), 1, 2, 3, 4, // bilinmeyen 32 bitlik alan
        ...key(31, 1), 1, 2, 3, 4, 5, 6, 7, 8, // bilinmeyen 64 bitlik alan
        ...vint(12, 3), // bilinmeyen sayı alanı
        ...vint(6, 77),
        ...key(14, 2), 0xff, 0xff, 0xff, 0xff, 0x0f, ...utf8('son'), // uzunluk dökümden uzun: eldeki kadarı
      ]),
    );
    expect(t).toMatchObject({ wide: true, tid: 77, abortMessage: 'son' });
  });

  it('protobuf gibi görünmeyen girdi: hiçbir şey döndürülmez', () => {
    const base = [...vint(1, 1), ...msg(10, vint(1, 11), str(2, 'SIGSEGV')), ...str(14, SECRET)];
    // Tek başına geçerli: iptal mesajı okunur
    expect(parseTombstone(Uint8Array.from(base)).abortMessage).toBe(SECRET);
    const broken: [string, number[]][] = [
      ['tid uzunluklu', bytes(6, [1, 2, 3])],
      ['pid uzunluklu', bytes(5, [1])],
      ['signal_info sayı', vint(10, 5)],
      ['abort_message sayı', vint(14, 5)],
      ['causes sayı', vint(15, 5)],
      ['threads sayı', vint(16, 9)],
      ['grup', [...key(7, 3)]],
      ['grup sonu', [...key(7, 4)]],
      ['kablo türü 6', [...key(20, 6)]],
      ['kablo türü 7', [...key(20, 7)]],
      ['alan numarası 0', [0x02, 0x00]],
      ['aşırı uzun varint', [...key(6, 0), ...Array<number>(10).fill(0xff), 0x01]],
      ['iç içe yanlış tür (sinyal adı sayı)', msg(10, vint(2, 1))],
    ];
    for (const [name, part] of broken) {
      const t = parseTombstone(Uint8Array.from([...base, ...part]));
      expect({ name, text: formatTombstone(t), abort: t.abortMessage }).toEqual({ name, text: '', abort: '' });
    }
    // Ne sinyal ne mimari: boş
    expect(formatTombstone(parseTombstone(Uint8Array.from([...vint(6, 5), ...str(14, SECRET)])))).toBe('');
  });

  it('kesik varint 0 sayılmaz: 0 anahtarlı sahte iş parçacığı seçilmez', () => {
    const fake = msg(16, vint(1, 0), msg(2, vint(1, 0), str(2, 'sahte'), frame(BigInt(1), 'sahte', 1, '/sahte.so')));
    const sig = msg(10, vint(1, 11), str(2, 'SIGSEGV'));
    // tid'in değeri kesik
    const a = parseTombstone(Uint8Array.from([...vint(1, 1), ...sig, ...fake, ...key(6, 0)]));
    expect(a).toMatchObject({ tid: null, thread: null, frames: [] });
    // Girdinin anahtarı kesik, tid = 0
    const b = parseTombstone(
      Uint8Array.from([...vint(1, 1), ...sig, ...vint(6, 0), ...msg(16, key(1, 0)), ...msg(16, msg(2, str(2, 'sahte')))]),
    );
    expect(b).toMatchObject({ tid: 0, thread: null, frames: [] });
  });

  it('metin döküm ve rastgele bayt: hiçbir kaydırmada çıktı yok, sızıntı yok', () => {
    const textTombstone = utf8(
      [
        '*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***',
        "Build fingerprint: 'HONOR/DNY-NX9/HNDNY:16/parmak-izi'",
        "ABI: 'arm64'",
        'pid: 4321, tid: 4567, name: RenderThread  >>> com.diskort.app <<<',
        'signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000000',
        `Abort message: '${SECRET}'`,
        '    x0  0000000000000000  x1  b400007a12345678  x2  0000000000000001',
        'backtrace:',
        '      #00 pc 000000000004d6f8  /system/lib64/libhwui.so (SkCanvas::drawPath+44)',
        '',
        'memory near x0 ([anon:scudo:primary]):',
        `    0000007a12345670 7265726165422022 7465726365732072  ${SECRET}`,
        `    0000007a12345680 746e6f63227b2020 2c22746e65746e6f  ${DM_JSON}`,
        `--------- log main`,
        `09-29 12:00:00.000  4321  4567 I ReactNativeJS: ${DM_JSON} ${SECRET}`,
      ].join('\n'),
    );
    for (let offset = 0; offset < 300; offset++) {
      const t = parseTombstone(Uint8Array.from(textTombstone.slice(offset)));
      expect({ offset, text: formatTombstone(t), leaks: leaks(JSON.stringify(t)) }).toEqual({ offset, text: '', leaks: [] });
    }

    // Rastgele baytların ortasında jeton ve DM metni
    const payload = utf8(` ${SECRET} ${DM_JSON} `);
    for (let seed = 1; seed <= 40; seed++) {
      let x = seed;
      const noise = Array.from({ length: 2048 }, () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x >>> 24;
      });
      const input = [...noise.slice(0, 1024), ...payload, ...noise.slice(1024)];
      for (const offset of [0, 1, 2, 3, 7, 100, 1000, 1020]) {
        const t = parseTombstone(Uint8Array.from(input.slice(offset)));
        expect({ seed, offset, text: formatTombstone(t), leaks: leaks(JSON.stringify(t)) }).toEqual({
          seed,
          offset,
          text: '',
          leaks: [],
        });
      }
    }
  });

  it('bozuk girdi fırlatmaz', () => {
    for (const garbage of [[0xff, 0xff, 0xff], [0x00], [0x80], Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff)]) {
      expect(() => formatTombstone(parseTombstone(Uint8Array.from(garbage)))).not.toThrow();
    }
    expect(formatTombstone(parseTombstone(new Uint8Array()))).toBe('');
  });
});

describe('decodeBase64', () => {
  it('Node ile aynı baytlar; dolgu ve geçersiz karakterler atlanır', () => {
    const encoded = toBase64(segv);
    expect(Array.from(decodeBase64(encoded))).toEqual(Array.from(segv));
    expect(Array.from(decodeBase64('aGk='))).toEqual(utf8('hi'));
    expect(Array.from(decodeBase64('aG\nk'))).toEqual(utf8('hi'));
    expect(decodeBase64('')).toHaveLength(0);
  });
});
