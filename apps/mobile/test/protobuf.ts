// Testler için el yapımı protobuf kodlayıcı (tombstone örnekleri)

export function varint(value: bigint | number): number[] {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  do {
    let byte = Number(v & BigInt(0x7f));
    v >>= BigInt(7);
    if (v > BigInt(0)) byte |= 0x80;
    out.push(byte);
  } while (v > BigInt(0));
  return out;
}

export const key = (field: number, wire: number): number[] => varint((field << 3) | wire);
export const vint = (field: number, value: bigint | number): number[] => [...key(field, 0), ...varint(value)];
export const bytes = (field: number, data: number[]): number[] => [...key(field, 2), ...varint(data.length), ...data];
export const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];

/** Yerel modülün verdiği biçim (base64) */
export function toBase64(data: ArrayLike<number>): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i] ?? 0);
  return btoa(binary);
}
export const str = (field: number, s: string): number[] => bytes(field, utf8(s));
export const msg = (field: number, ...parts: number[][]): number[] => bytes(field, parts.flat());

/** BacktraceFrame (Thread.current_backtrace = 4): rel_pc, pc, sp, işlev, uzaklık, dosya, build_id */
export const frame = (relPc: bigint, fn: string, offset: number, file: string): number[] =>
  msg(
    4,
    vint(1, relPc),
    vint(2, relPc + BigInt('0x7000000000')),
    vint(3, BigInt('0x7fff0000')),
    str(4, fn),
    vint(5, offset),
    str(6, file),
    str(8, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'),
  );
