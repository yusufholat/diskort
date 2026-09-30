// Telefonda kozmetikler yalnızca açık profilde oynar (Discord gibi). Kural kaynak kodda denetlenir:
// - hareket (`animate` / `animateDecoration`) yalnızca açık profil kartında verilir: ProfileHeader (üye menüsü) ve
//   Ayarlar → Profil'deki önizleme kartının avatarı;
// - listeler, mesajlar, ses kutucukları, paneller ve seçici hiçbir yerde hareket istemez;
// - sabit parça (StillPiece) oynatıcıya bağlanmaz, Skia yüzeyi ve paylaşılan değer kurmaz.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (path: string): string => relative(SRC, path).split(sep).join('/');
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8');

/** JSX'te hareket isteyen öznitelik (ör. `animate`, `animate={x}`, `animateDecoration />`) */
const ANIMATE_PROP = /\s(animate|animateDecoration)(?=[\s=/>])/g;

/** Hareketi yalnızca ileten bileşenler (kendileri istemez) */
const FORWARDERS = new Set(['components/Avatar.tsx', 'components/cosmetics/Cosmetics.tsx']);

function animateSites(): Map<string, string[]> {
  const sites = new Map<string, string[]>();
  for (const path of sources(SRC)) {
    const file = rel(path);
    if (FORWARDERS.has(file)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    const hits = lines.filter((line) => new RegExp(ANIMATE_PROP.source).test(line));
    if (hits.length > 0) sites.set(file, hits);
  }
  return sites;
}

describe('kozmetikler yalnızca açık profilde oynar', () => {
  it('hareket yalnızca ProfileHeader ve ayarlardaki önizleme kartında istenir', () => {
    const sites = animateSites();
    expect([...sites.keys()].sort()).toEqual(['components/ProfileHeader.tsx', 'components/settings/ProfileSettings.tsx']);
    // Ayarlarda tek yer: ProfileHeader'a verilen büyük (88) önizleme avatarı; seçicinin kutuları değil
    const settings = sites.get('components/settings/ProfileSettings.tsx')!;
    expect(settings).toHaveLength(1);
    expect(settings[0]).toContain('size={88}');
    expect(settings[0]).toContain('animateDecoration');
  });

  it('açık profil kartı efekti ve dekorasyonu oynatır', () => {
    const header = read('components/ProfileHeader.tsx');
    expect(header).toMatch(/<CardEffect set=\{effect\} animate \/>/);
    expect(header).toMatch(/<Avatar[^>]*decoration=\{user\.avatarDecoration\} animateDecoration \/>/);
  });

  it('listeler, mesajlar, ses kutucukları ve paneller hareket istemez', () => {
    const lists = [
      'components/channelPanel/MemberList.tsx',
      'components/DmList.tsx',
      'components/DmAvatar.tsx',
      'components/MessageRow.tsx',
      'components/ChannelChat.tsx',
      'components/VoiceTiles.tsx',
      'components/UserPanel.tsx',
      'components/PinsSheet.tsx',
      'app/search.tsx',
    ];
    for (const file of lists) expect(read(file), file).not.toMatch(new RegExp(ANIMATE_PROP.source));
  });

  it('eski "oynat / durdur" yolları kalmadı (sesli sahnede konuşurken oynama, seçicide seçili olanın oynaması)', () => {
    for (const path of sources(SRC)) {
      const text = readFileSync(path, 'utf8');
      expect(text, rel(path)).not.toMatch(/decorationLite|decorationStill/);
      expect(text, rel(path)).not.toMatch(/<NameplateBackground[^>]*still=/);
    }
  });

  it('sabit parça oynatıcıya bağlanmaz, Skia yüzeyi ya da paylaşılan değer kurmaz', () => {
    const cosmetics = read('components/cosmetics/Cosmetics.tsx');
    expect(cosmetics).toContain('return animate ? <LivePiece {...props} /> : <StillPiece {...props} />;');
    const start = cosmetics.indexOf('function StillPiece(');
    const end = cosmetics.indexOf('function LivePiece(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const still = cosmetics.slice(start, end);
    for (const heavy of ['usePlayback', 'playback()', 'LiveCanvas', 'FadingPoster', 'useSharedValue', 'useIsFocused', 'Canvas']) {
      expect(still, heavy).not.toContain(heavy);
    }
  });
});
