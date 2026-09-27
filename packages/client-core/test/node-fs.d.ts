// client-core Node türlerine bağımlı değil; testlerde kullanılan birkaç Node işlevinin türleri
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const __dirname: string;
