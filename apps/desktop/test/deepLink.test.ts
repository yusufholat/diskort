import { describe, expect, it } from 'vitest';
import { inviteCodeFromArgv, inviteCodeFromUrl } from '../src/main/deepLink.js';

describe('inviteCodeFromUrl', () => {
  it('yalnızca diskort://davet/<kod> kabul edilir', () => {
    expect(inviteCodeFromUrl('diskort://davet/ab12cd34')).toBe('AB12CD34');
    expect(inviteCodeFromUrl('diskort://davet/AB12CD34/')).toBe('AB12CD34');
    expect(inviteCodeFromUrl('/davet/AB12CD34')).toBeNull();
    expect(inviteCodeFromUrl('davet/AB12CD34')).toBeNull();
    expect(inviteCodeFromUrl('https://diskort.ziroo.net/davet/AB12CD34')).toBeNull();
    expect(inviteCodeFromUrl('diskort://ayarlar/AB12CD34')).toBeNull();
    expect(inviteCodeFromUrl('diskort://davet/../../x')).toBeNull();
  });
});

describe('inviteCodeFromArgv', () => {
  it('Windows ilk açılış: bağlantı son argüman', () => {
    expect(inviteCodeFromArgv(['C:\\Diskort\\Diskort.exe', 'diskort://davet/QWER1234'])).toBe('QWER1234');
  });

  it('ikinci açılış: Chromium anahtarları arasında bulunur', () => {
    const argv = [
      'C:\\Diskort\\Diskort.exe',
      '--allow-file-access-from-files',
      '--original-process-start-time=1',
      'diskort://davet/ZXCV5678/',
    ];
    expect(inviteCodeFromArgv(argv)).toBe('ZXCV5678');
  });

  it('geliştirme: electron.exe <klasör> <bağlantı>', () => {
    expect(inviteCodeFromArgv(['electron.exe', 'C:\\dev\\diskort\\apps\\desktop', 'diskort://davet/ASDF1234'])).toBe('ASDF1234');
  });

  it('bağlantı yoksa ya da geçersizse null', () => {
    expect(inviteCodeFromArgv(['Diskort.exe'])).toBeNull();
    expect(inviteCodeFromArgv(['Diskort.exe', '--hidden'])).toBeNull();
    expect(inviteCodeFromArgv(['Diskort.exe', 'diskort://davet/'])).toBeNull();
    expect(inviteCodeFromArgv([])).toBeNull();
  });
});
