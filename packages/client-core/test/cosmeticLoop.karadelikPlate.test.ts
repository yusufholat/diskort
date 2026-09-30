import { describe, expect, it } from 'vitest';
import { KARADELIK_LOOP, karadelikLoopShader } from '../src/cosmeticLoops';
import { COSMETIC_SHADERS } from '../src/index';

describe('kozmetik döngü biçimi: karadelik isim plakası', () => {
  it('canlıda delik eski yerinde; döngü biçiminde sağ kenara daha yakın', () => {
    // canlı: sağ kenardan satır yüksekliğinin 1.35 katı içeride
    expect(COSMETIC_SHADERS.karadelik).toContain('C=vec2(u_res.x-u_res.y*1.35,u_res.y*.5);RS=u_res.y*.24;');
    const loop = karadelikLoopShader(6);
    expect(loop).not.toContain('u_res.y*1.35');
    expect(loop).toContain(`C=vec2(u_res.x-u_res.y*${KARADELIK_LOOP.plateX},u_res.y*.5);RS=u_res.y*.24;`);
    // daha sağda ama disk (yarıçapı deliğin 3.6 katı, delik satır yüksekliğinin .24'ü) satırın içinde kalır
    expect(KARADELIK_LOOP.plateX).toBeLessThan(1.35);
    expect(KARADELIK_LOOP.plateX).toBeGreaterThanOrEqual(0.24 * 3.6);
  });
});
