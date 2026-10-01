import type { LineMode, LineProfile, LineTransport, PlanStep } from './plan.js';
import type { SecondStat } from './protocol.js';

// Hat testi sonuçlarının otomatik yorumu. Girdi: aynı kişinin aynı çalıştırmasındaki aşamalar (suite). Her bulgu
// neyi doğruladığını/çürüttüğünü ve kanıtını söyler; emin olunamayan durumlarda bunu açıkça yazar.

export interface TcpSecond {
  /** saniyede alınan/gönderilen bayt ve hedef bayt */
  bytes: number;
  target: number;
}

/** Test sürerken sunucunun gördüğü kesinti (dış sondalar / NIC sessizliği), plan saniyesiyle */
export interface RunOutage {
  at: number;
  durationMs: number;
  /** tam: sondalar + NIC · gelen: yalnızca NIC sessizliği · sonda: yalnızca dış sondalar */
  kind: 'tam' | 'gelen' | 'sonda';
  /** Testin başından kesintiye kadar geçen süre (sn) ve o andaki adım */
  sec: number;
  step: string | null;
  /** Kesintiden önceki son patlama adımı ve bitiminden kesintiye kadar geçen süre (sn); patlama profilinde */
  burst?: string;
  afterBurstSec?: number;
}

export interface VerdictRun {
  transport: LineTransport;
  mode: LineMode;
  profile: LineProfile;
  steps: PlanStep[];
  up: SecondStat[] | null;
  down: SecondStat[] | null;
  /** sunucunun gerçekten gönderdiği (aşağı yön) paket/sn; yoksa plan */
  downSent?: number[] | null;
  tcpUp?: TcpSecond[] | null;
  tcpDown?: TcpSecond[] | null;
  streaming?: boolean;
  /** UDP el sıkışması tamamlanamadı */
  unreachable?: boolean;
  /** Test sırasında sunucu tarafında görülen kesintiler */
  outages?: RunOutage[];
}

export type Tone = 'bad' | 'warn' | 'ok' | 'info';

export interface Finding {
  code: string;
  tone: Tone;
  text: string;
  evidence: string;
}

export interface StepStat {
  step: number;
  label: string;
  rateBps: number;
  size: number;
  pps: number;
  planned: number;
  recv: number;
  lost: number;
  lossPct: number;
  reordPct: number;
  jitMs: number;
}

/** Bu oranın üstü "kayıplı", altı "temiz" sayılır (arası belirsiz/hafif) */
export const LOSSY_PCT = 2;
export const CLEAN_PCT = 1;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mbps = (bps: number): string => `${round1(bps / 1e6)} Mbps`.replace('.', ',');

/** Aşamanın bir yönünün adım adım kayıp özeti (sunucunun gönderemediği paketler kayıp sayılmaz; ayrıca raporlanır) */
export function stepStats(steps: PlanStep[], secs: SecondStat[], sent?: number[] | null): StepStat[] {
  return steps.map((st) => {
    let planned = 0;
    let recv = 0;
    let reord = 0;
    let jit = 0;
    for (let s = st.startSec; s < st.startSec + st.secs; s++) {
      const x = secs[s];
      if (!x) continue;
      planned += sent ? Math.min(sent[s] ?? x.planned, x.planned) : x.planned;
      recv += x.recv;
      reord += x.reord;
      jit = Math.max(jit, x.jit);
    }
    const lost = Math.max(0, planned - recv);
    return {
      step: st.step,
      label: st.label,
      rateBps: st.rateBps,
      size: st.size,
      pps: st.pps,
      planned,
      recv,
      lost,
      lossPct: planned > 0 ? round1((lost / planned) * 100) : 0,
      reordPct: recv > 0 ? round1((reord / recv) * 100) : 0,
      jitMs: Math.round(jit * 10) / 10,
    };
  });
}

type Dir = 'up' | 'down';
const DIR_TEXT: Record<Dir, string> = { up: 'yukarı (istemci→sunucu)', down: 'aşağı (sunucu→istemci)' };

interface DirData {
  rate: StepStat[];
  pps: StepStat[];
  steady: StepStat[];
  both: StepStat[];
  single: StepStat[];
  all: StepStat[];
}

function collect(runs: VerdictRun[], dir: Dir): DirData {
  const d: DirData = { rate: [], pps: [], steady: [], both: [], single: [], all: [] };
  for (const r of runs) {
    // Patlama profili ayrı yorumlanır (burstFindings): basamakları hız eşiği aramasına katılmaz
    if (r.transport !== 'udp' || r.unreachable || r.profile === 'burst') continue;
    const secs = dir === 'up' ? r.up : r.down;
    if (!secs) continue;
    const stats = stepStats(r.steps, secs, dir === 'down' ? r.downSent : null);
    d.all.push(...stats);
    if (r.profile === 'pps') d.pps.push(...stats);
    else if (r.profile === 'steady') d.steady.push(...stats);
    else d.rate.push(...stats);
    (r.mode === 'both' ? d.both : d.single).push(...stats);
  }
  d.rate.sort((a, b) => a.rateBps - b.rateBps);
  d.pps.sort((a, b) => a.pps - b.pps);
  return d;
}

const total = (list: StepStat[]): { planned: number; lost: number; pct: number } => {
  const planned = list.reduce((n, s) => n + s.planned, 0);
  const lost = list.reduce((n, s) => n + s.lost, 0);
  return { planned, lost, pct: planned > 0 ? round1((lost / planned) * 100) : 0 };
};

const curve = (list: StepStat[], unit: (s: StepStat) => string): string => list.map((s) => `${unit(s)} %${s.lossPct}`).join(' · ');

/** Adımlar artan sırada; ilk k adım temiz, sonrakilerin hepsi kayıplıysa k (eşik); yoksa -1 */
export function thresholdIndex(list: StepStat[]): number {
  for (let k = 1; k < list.length; k++) {
    const head = list.slice(0, k);
    const tail = list.slice(k);
    if (head.every((s) => s.lossPct < CLEAN_PCT) && tail.every((s) => s.lossPct >= LOSSY_PCT)) return k;
  }
  return -1;
}

function tcpShortfall(runs: VerdictRun[], dir: Dir): { pct: number; secs: number } | null {
  let target = 0;
  let got = 0;
  let secs = 0;
  for (const r of runs) {
    if (r.transport !== 'tcp') continue;
    const list = dir === 'up' ? r.tcpUp : r.tcpDown;
    if (!list) continue;
    for (const s of list) {
      target += s.target;
      got += Math.min(s.bytes, s.target);
      secs++;
    }
  }
  return target > 0 ? { pct: round1(((target - got) / target) * 100), secs } : null;
}

const OUTAGE_TEXT: Record<RunOutage['kind'], string> = {
  tam: 'tam kesinti (dış sondalar yanıtsız + sunucuya paket gelmedi)',
  gelen: 'sunucuya gelen paketler kesildi (NIC sessizliği)',
  sonda: 'dış sondalar yanıtsız kaldı',
};
const secText = (ms: number): string => `${round1(ms / 1000)}`.replace('.', ',');

/**
 * Patlama profili: şüphelenilen tetikleyiciyi (yayında sahne değişimi gibi ani hız artışı) sese girmeden yeniden
 * üretir. Asıl soru kayıp yüzdesi değil, patlamanın sunucu ağında KESİNTİ tetikleyip tetiklemediğidir.
 */
function burstFindings(runs: VerdictRun[]): Finding[] {
  const out: Finding[] = [];
  for (const r of runs) {
    if (r.profile !== 'burst' || r.transport !== 'udp' || r.unreachable) continue;
    const dir: Dir = r.mode === 'up' ? 'up' : 'down';
    const secs = dir === 'up' ? r.up : r.down;
    const stats = secs ? stepStats(r.steps, secs, dir === 'down' ? r.downSent : null) : [];
    const kindOf = (st: StepStat): string | undefined => r.steps[st.step]?.kind;
    const bursts = stats.filter((st) => kindOf(st) === 'burst');
    const peak = Math.max(0, ...r.steps.filter((st) => st.kind === 'burst').map((st) => st.rateBps));
    const outages = r.outages ?? [];
    for (const o of outages) {
      if (o.burst) {
        out.push({
          code: `patlama_kesinti_${dir}`,
          tone: 'bad',
          text:
            `Patlama testi (${DIR_TEXT[dir]}): "${o.burst}" adımı${o.afterBurstSec ? `ndan ${String(o.afterBurstSec).replace('.', ',')} sn sonra` : ' sırasında'} sunucu ağında kesinti görüldü: ` +
            `${OUTAGE_TEXT[o.kind]}, ${secText(o.durationMs)} sn → ani hız artışı kesintiyi tetikliyor (sağlayıcı hız sınırı/süzgeci şüphesi yeniden üretildi).`,
          evidence: `testin ${String(o.sec).replace('.', ',')}. saniyesi · adım: ${o.step ?? '?'}`,
        });
      } else {
        // Test başlamadan önce başlamış kesinti testten kaynaklanamaz; ilk patlamadan önceki de patlamaya bağlanamaz
        const before = o.sec < 0;
        out.push({
          code: `patlama_oncesi_kesinti_${dir}`,
          tone: 'warn',
          text:
            `Patlama testi (${DIR_TEXT[dir]}): ${before ? 'test başlamadan önce başlamış bir kesinti sürüyordu' : 'ilk patlamadan önce (taban hızda) sunucu ağında kesinti görüldü'}: ` +
            `${OUTAGE_TEXT[o.kind]}, ${secText(o.durationMs)} sn → patlamayla ilgisiz${before ? '' : ' olabilir'}; ölçüm etkilenmiş olabilir, testi tekrarla.`,
          evidence: before ? `test başlamadan ${String(-o.sec).replace('.', ',')} sn önce başladı` : `testin ${String(o.sec).replace('.', ',')}. saniyesi`,
        });
      }
    }
    if (!secs) {
      if (outages.length === 0) out.push({ code: `patlama_eksik_${dir}`, tone: 'info', text: `Patlama testi (${DIR_TEXT[dir]}): istemci ölçümü yok; sunucu tarafında kesinti görülmedi.`, evidence: '' });
      continue;
    }
    const lossy = bursts.filter((st) => st.lossPct >= LOSSY_PCT);
    // Patlamadan sonraki taban adımında kayıp: patlama sonrası çöküş (yayındaki donmanın imzası)
    const after = stats.filter((st, i) => kindOf(st) === 'base' && i > 0 && st.lossPct >= LOSSY_PCT);
    if (after.length > 0) {
      out.push({
        code: `patlama_sonrasi_kayip_${dir}`,
        tone: 'bad',
        text: `Patlama testi (${DIR_TEXT[dir]}): patlamadan sonraki taban hızda (3 Mbps) da kayıp var → patlama sonrası çöküş${outages.length === 0 ? '; sunucu tarafında kesinti kaydedilmedi (kayıp yolun bu yönünde ya da istemci hattında)' : ''}.`,
        evidence: curve(stats, (st) => st.label),
      });
    } else if (lossy.length > 0) {
      out.push({
        code: `patlama_kayip_${dir}`,
        tone: 'warn',
        text:
          `Patlama testi (${DIR_TEXT[dir]}): "${lossy[0]!.label}" ve üstünde kayıp var, taban hız temiz` +
          (outages.length === 0 ? '; sunucu tarafında kesinti görülmedi → bu hız istemcinin hattını aşıyor olabilir (ev bağlantısının hızıyla karşılaştır), sunucu ağı çökmedi.' : '.'),
        evidence: curve(stats, (st) => st.label),
      });
    } else if (outages.length === 0) {
      out.push({
        code: `patlama_temiz_${dir}`,
        tone: 'ok',
        text: `Patlama testi (${DIR_TEXT[dir]}, ${mbps(peak)} hızına kadar): kayıp yok ve sunucu ağında kesinti tetiklenmedi.`,
        evidence: curve(bursts, (st) => st.label),
      });
    }
  }
  return out;
}

/** Aşamaların birleşik yorumu */
export function classify(runs: VerdictRun[]): Finding[] {
  const out: Finding[] = [];
  const dirs: Dir[] = ['up', 'down'];
  const data = { up: collect(runs, 'up'), down: collect(runs, 'down') };
  if (runs.some((r) => r.transport === 'udp' && r.unreachable)) {
    out.push({
      code: 'udp_ulasilamadi',
      tone: 'bad',
      text: 'UDP el sıkışması tamamlanamadı: test paketleri sunucuya ulaşmadı ya da yanıt dönmedi (port/güvenlik duvarı ya da tam kayıp).',
      evidence: 'HELLO/START denemeleri yanıtsız kaldı',
    });
  }
  const measured = dirs.filter((d) => data[d].all.length > 0);
  const burst = burstFindings(runs);
  out.push(...burst);
  // Öbür profillerde test sürerken sunucu kesinti gördüyse: o saniyelerdeki kayıp istemci hattına yazılmamalı
  const seen = runs.filter((r) => r.profile !== 'burst').flatMap((r) => r.outages ?? []);
  if (seen.length > 0) {
    const longest = seen.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
    out.push({
      code: 'sunucu_kesinti',
      tone: 'warn',
      text: `Test sürerken sunucu kendi ağında ${seen.length} kesinti gördü (en uzunu ${OUTAGE_TEXT[longest.kind]}, ${secText(longest.durationMs)} sn): o saniyelerdeki kayıp istemci hattından değil, sunucu/sağlayıcı tarafındandır.`,
      evidence: seen.map((o) => `${String(o.sec).replace('.', ',')}. sn${o.step ? ` (${o.step})` : ''}`).join(' · '),
    });
  }
  if (measured.length === 0 && burst.length === 0) {
    out.push({ code: 'veri_yok', tone: 'info', text: 'UDP ölçümü yok (yalnızca TCP ya da rapor eksik).', evidence: '' });
  }

  // Sunucunun aşağı yönde planı gönderememesi (sunucu/soket tarafı): kaybı "hat" saymadan önce
  for (const r of runs) {
    if (r.transport !== 'udp' || !r.down || !r.downSent) continue;
    const planned = r.down.reduce((n, s) => n + s.planned, 0);
    const sent = r.downSent.reduce((n, s) => n + s, 0);
    if (planned > 0 && (planned - sent) / planned > 0.02) {
      out.push({
        code: 'sunucu_gonderim',
        tone: 'warn',
        text: 'Sunucu aşağı yön planını tam gönderemedi (soket/olay döngüsü); bu paketler hat kaybı sayılmadı.',
        evidence: `planlanan ${planned}, gönderilen ${sent}`,
      });
    }
  }

  const overall: Partial<Record<Dir, number>> = {};
  for (const d of measured) overall[d] = total(data[d].all).pct;

  for (const d of measured) {
    const x = data[d];
    const all = overall[d]!;
    if (all < CLEAN_PCT && x.all.every((s) => s.lossPct < LOSSY_PCT)) continue;
    let explained = false;

    // 1) Hız eşiği
    const k = thresholdIndex(x.rate.filter((s) => s.size >= 400));
    const ramp = x.rate.filter((s) => s.size >= 400);
    if (k > 0) {
      const lo = ramp[k - 1]!.rateBps;
      const hi = ramp[k]!.rateBps;
      out.push({
        code: `hiz_siniri_${d}`,
        tone: 'bad',
        text: `${DIR_TEXT[d]} yönde kayıp ≈${mbps(lo)}–${mbps(hi)} üzerinde başlıyor → hız/paket sınırı şüphesi.`,
        evidence: curve(ramp, (s) => mbps(s.rateBps)),
      });
      explained = true;
    }

    // 2) Paket/sn sınırı: küçük paketli testte kayıp, bitrate testi (en fazla ~1250 pk/sn) temiz
    const ppsLossy = x.pps.filter((s) => s.lossPct >= LOSSY_PCT);
    if (ppsLossy.length > 0 && ramp.length > 0 && ramp.every((s) => s.lossPct < CLEAN_PCT)) {
      const first = ppsLossy[0]!;
      const maxRampPps = Math.max(...ramp.map((s) => s.pps));
      if (first.pps > maxRampPps) {
        out.push({
          code: `pps_siniri_${d}`,
          tone: 'bad',
          text: `${DIR_TEXT[d]} yönde pps testinde kayıp (≈${first.pps} pk/sn ve üstü), bitrate testinde yok (en çok ${maxRampPps} pk/sn) → paket/sn sınırı şüphesi.`,
          evidence: `pps: ${curve(x.pps, (s) => `${s.pps} pk/sn`)} | bitrate: ${curve(ramp, (s) => mbps(s.rateBps))}`,
        });
        explained = true;
      }
    } else if (ppsLossy.length > 0 && ramp.length === 0) {
      out.push({
        code: `pps_kayip_${d}`,
        tone: 'warn',
        text: `${DIR_TEXT[d]} yönde pps testinde kayıp (≈${ppsLossy[0]!.pps} pk/sn ve üstü); bu yönde bitrate testi olmadığından paket/sn mi hız mı ayırt edilemedi.`,
        evidence: curve(x.pps, (st) => `${st.pps} pk/sn`),
      });
      explained = true;
    }

    // 3) Her hızda rastgele kayıp (en düşük adım dahil)
    if (!explained && ramp.length >= 2) {
      const lossy = ramp.filter((s) => s.lossPct >= LOSSY_PCT);
      if (ramp[0]!.lossPct >= LOSSY_PCT && lossy.length >= Math.ceil(ramp.length * 0.7)) {
        out.push({
          code: `her_hizda_${d}`,
          tone: 'bad',
          text: `${DIR_TEXT[d]} yönde düşük hızda bile kayıp var, hızla belirgin artmıyor → sıkışıklık/hat sorunu (hız sınırı değil).`,
          evidence: curve(ramp, (s) => mbps(s.rateBps)),
        });
        explained = true;
      }
    }

    // 4) Yayın benzeri (kare patlamalı, iki yön aynı anda) testte kayıp, aynı hızdaki düz tek yönlü adımda yok
    const steady = total(x.steady);
    if (x.steady.length > 0 && steady.pct >= LOSSY_PCT) {
      const at8 = ramp.find((st) => Math.abs(st.rateBps - 8e6) < 0.6e6);
      if (at8 && at8.lossPct < CLEAN_PCT) {
        out.push({
          code: `patlama_${d}`,
          tone: 'warn',
          text: `${DIR_TEXT[d]} yönde yayın benzeri testte kayıp %${steady.pct}, aynı hızdaki (8 Mbps) düz testte yok → kare patlamalarına ya da iki yönün aynı anda yüklenmesine duyarlı (bu test ikisini ayıramaz; yalnız-${d === 'up' ? 'yukarı' : 'aşağı'} tekrar testi gerekir).`,
          evidence: `yayın benzeri %${steady.pct}; 8 Mbps düz %${at8.lossPct}`,
        });
        explained = true;
      }
    }

    // 5) Kararsız: kayıp var ama desene uymuyor
    if (!explained) {
      out.push({
        code: `duzensiz_${d}`,
        tone: 'warn',
        text: `${DIR_TEXT[d]} yönde kayıp %${all}; belirli bir hız/pps desenine uymuyor (seyrek/rastgele). Aynı testi birkaç kez ve farklı saatlerde tekrarla.`,
        evidence: curve(x.all, (s) => s.label),
      });
    }

    // Sırasız gelme
    const reord = x.all.reduce((n, s) => n + s.reordPct * s.recv, 0) / Math.max(1, x.all.reduce((n, s) => n + s.recv, 0));
    if (reord >= 1) {
      out.push({ code: `sirasiz_${d}`, tone: 'info', text: `${DIR_TEXT[d]} yönde paketlerin %${round1(reord)}'i sırasız geldi (çoklu yol/hat yük dengeleme işareti olabilir).`, evidence: '' });
    }
  }

  // Yön farkı
  if (measured.length === 2) {
    const [u, dn] = [overall.up!, overall.down!];
    if ((u >= LOSSY_PCT && dn < CLEAN_PCT) || (dn >= LOSSY_PCT && u < CLEAN_PCT)) {
      const bad: Dir = u >= LOSSY_PCT ? 'up' : 'down';
      out.push({
        code: 'yon_farki',
        tone: 'warn',
        text: `Yön farkı: yalnızca ${DIR_TEXT[bad]} yönde kayıp (%${overall[bad]}); diğer yön temiz (%${overall[bad === 'up' ? 'down' : 'up']}).`,
        evidence: `yukarı %${u} · aşağı %${dn}`,
      });
    }
  }

  // UDP/TCP karşılaştırması
  for (const d of dirs) {
    const tcp = tcpShortfall(runs, d);
    if (!tcp || overall[d] === undefined) continue;
    const udp = overall[d]!;
    if (udp >= LOSSY_PCT && tcp.pct < 5) {
      out.push({
        code: `yalniz_udp_${d}`,
        tone: 'bad',
        text: `${DIR_TEXT[d]} yönde UDP'de kayıp (%${udp}) ama TCP hedef hıza ulaşıyor (eksik %${tcp.pct}) → UDP'ye özgü filtreleme/sınırlama şüphesi.`,
        evidence: `UDP %${udp} · TCP eksik %${tcp.pct} (${tcp.secs} sn)`,
      });
    } else if (udp >= LOSSY_PCT && tcp.pct >= 5) {
      out.push({
        code: `udp_tcp_ikisi_${d}`,
        tone: 'warn',
        text: `${DIR_TEXT[d]} yönde hem UDP'de hem TCP'de eksik (UDP %${udp}, TCP %${tcp.pct}) → UDP'ye özgü değil, genel hat/sıkışıklık.`,
        evidence: '',
      });
    }
  }
  if (measured.length > 0 && !runs.some((r) => r.transport === 'tcp') && out.some((f) => f.tone === 'bad' || f.tone === 'warn')) {
    out.push({ code: 'tcp_yok', tone: 'info', text: 'TCP karşılaştırması yok (--tcp ile tekrar çalıştır): UDP\'ye özgü filtreleme ayrımı yapılamadı.', evidence: '' });
  }

  // Temiz
  if (measured.length > 0 && measured.every((d) => overall[d]! < CLEAN_PCT) && !out.some((f) => f.tone === 'bad' || f.tone === 'warn')) {
    const live = runs.some((r) => r.streaming);
    out.push({
      code: 'temiz',
      tone: 'ok',
      text: live
        ? 'Hat temiz (yayın açıkken bile): UDP yolunda kayıp yok → sorun LiveKit/istemci/kodlayıcı tarafında.'
        : 'Hat temiz: bu testte UDP yolunda kayıp yok. Sorun yalnızca yayın sırasında çıkıyorsa testi yayın açıkken tekrarla (yük yayınla birlikte gelebilir).',
      evidence: measured.map((d) => `${DIR_TEXT[d]} %${overall[d]}`).join(' · '),
    });
  }
  return out;
}
