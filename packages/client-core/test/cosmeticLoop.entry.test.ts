import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Döngü biçimleri (dosyaya çizim) ayrı bir giriştedir: @diskort/client-core/cosmeticLoops. Telefonun paketleyicisi
// kullanılmayan kodu ayıklamaz: ana girişten (src/index.ts) içe aktarma zinciriyle erişilen her dosya telefona
// gider. Bu test zinciri dolaşır ve döngü kodunun ana girişten erişilemediğini doğrular.

const SRC = join(__dirname, '..', 'src');
const text = (path: string): string => new TextDecoder().decode(readFileSync(path));

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Göreli bir içe aktarmanın gösterdiği dosya (.ts, .tsx ya da klasörün index.ts'i) */
function resolve(from: string, spec: string): string {
  const base = join(from, '..', spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (exists(candidate)) return candidate;
  throw new Error(`çözülemedi: ${spec} (${from})`);
}

/** Bir dosyadan göreli içe/dışa aktarmalarla erişilen bütün dosyalar (yalnızca tür aktarımları dahil: zararsız) */
function reach(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const source = text(file);
    seen.set(file, source);
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'(\.[^']*)'/g)) queue.push(resolve(file, m[1]!));
    for (const m of source.matchAll(/\bimport\(\s*'(\.[^']*)'\s*\)/g)) queue.push(resolve(file, m[1]!));
  }
  return seen;
}

const norm = (path: string): string => path.replaceAll('\\', '/');

describe('kozmetik döngü biçimi: ayrı giriş', () => {
  it('ana giriş döngü koduna uzanmaz (telefon paketine girmez)', () => {
    const files = reach(join(SRC, 'index.ts'));
    // zincir gerçekten dolaşıldı: canlı gölgelendiriciler erişilebilir
    const paths = [...files.keys()].map(norm);
    expect(paths.some((p) => p.endsWith('/cosmeticShaders/buz.ts'))).toBe(true);
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.filter((p) => p.includes('/cosmeticLoops/'))).toEqual([]);
    for (const [file, source] of files) {
      expect(/from\s+'@diskort\/client-core\/cosmeticLoops'/.test(source), norm(file)).toBe(false);
      // döngüye özgü adlar ana girişten erişilen hiçbir dosyada tanımlı ya da kullanılıyor olmamalı
      expect(/\b\w+LoopShader\b|\b[A-Z]+_LOOP\b|\bCOSMETIC_LOOP_\w+|\bloopDriftGlsl\b|\bcosmeticShaderCommon\b/.exec(source)?.[0] ?? null, norm(file)).toBe(null);
    }
  });

  it('döngü girişi altı setin döngü biçimini verir ve canlı kalıpları kullanır', () => {
    const files = reach(join(SRC, 'cosmeticLoops', 'index.ts'));
    const paths = [...files.keys()].map(norm);
    for (const set of ['buz', 'neon', 'karadelik', 'kuzey', 'sakura', 'atesbocegi']) {
      expect(paths.some((p) => p.endsWith(`/cosmeticLoops/${set}.ts`)), set).toBe(true);
      expect(paths.some((p) => p.endsWith(`/cosmeticShaders/${set}.ts`)), set).toBe(true);
    }
    // döngü girişi uygulamanın geri kalanını (API, depolar) çekmez
    expect(paths.every((p) => p.includes('/cosmeticLoops/') || p.includes('/cosmeticShaders/'))).toBe(true);
  });

  it('paket girişi tanımlı', () => {
    const pkg = JSON.parse(text(join(SRC, '..', 'package.json'))) as { exports: Record<string, string> };
    expect(pkg.exports['./cosmeticLoops']).toBe('./src/cosmeticLoops/index.ts');
  });
});
