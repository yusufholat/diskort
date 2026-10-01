import type { VoiceTraceSample } from '@diskort/shared';
import type { AlignedTrace } from './clientTrace.js';

// Bağlantı teşhisi: istemci olay kayıtlarından (saniyelik bağlantı ölçümleri; bkz. shared/voiceTrace.ts) kanıt.
// 30 sn'lik özetlerin göremediğini saniye saniye gösterir ve sunucu saatine hizalıdır (`ts`):
//  - STUN yanıtsız (x.su): medya olmasa da istemci ↔ sunucu UDP yolunun o saniyede ölü olduğunu gösterir; iki ya
//    da daha çok kullanıcıda AYNI saniyelerde görülmesi yolun herkes için kesildiğinin güçlü kanıtıdır,
//  - yayıncıdaki patlama (yayın bit hızı sıçraması, anahtar / dev kare) ve hemen ardından kaybın yükselmesi,
//  - PLI/NACK dalgası, bant genişliği tahmininin (BWE) çökmesi (sonuçtur, neden değil),
//  - taşıması temizken donan izleyici (çözücü / işleme), ses ve görüntü kaybının ayrı ayrı oranı,
//  - yayıncının gönderdiği ile izleyicilerin aldığı paketlerin kabaca karşılaştırması.
// Saf fonksiyonlardır (testlenir). Eski istemciler kayıt göndermez: o zaman kanıt yoktur ve "eksik kanıt"a yazılır.

/** Bir ölçümün sunucu saatindeki aralığı: [ts - dt, ts] */
type Sample = VoiceTraceSample & { ts: number };

/** STUN bu kadar süredir yanıtsızsa (ms) yol o saniyede ölü sayılır */
export const STUN_DEAD_MS = 1_500;
/** Yayın bit hızı sıçraması: öncesindeki ortancanın katı ve mutlak fark (bit/sn) */
const BURST_RATIO = 1.8;
const BURST_MIN_BPS = 2_000_000;
/** Patlamadan sonra kaybın arandığı süre (ms) */
const BURST_LOSS_WINDOW_MS = 6_000;
/** BWE çöküşü: önceki değerin bu oranının altı */
const BWE_COLLAPSE_RATIO = 0.5;

export interface TraceStun {
  /** STUN'u aynı anda yanıtsız kalan kullanıcılar ve örtüşen aralık (sunucu saati) */
  users: string[];
  /** Kayıtları aynı aralığı kapsayan ama yolu canlı görünen kullanıcılar */
  alive: string[];
  from: number;
  to: number;
  /** En uzun yanıtsız süre (ms; ölçümlerin kapsadığı aralıkla sınırlı: istemcinin bildirdiği süreye güvenilmez) */
  maxMs: number;
}

export interface TraceBurst {
  userId: string;
  /** Tepe saniyesi (sunucu saati), tepe ve öncesindeki olağan yayın bit hızı (bit/sn) */
  at: number;
  bps: number;
  baseBps: number;
  /** Tepe çevresindeki anahtar kare ve "dev" kare sayısı */
  keyFrames: number;
  hugeFrames: number;
  /** Patlamadan sonra karşı tarafın bildirdiği kaybın yükseldiği an (yoksa null) ve en yüksek kayıp oranı (%) */
  lossAt: number | null;
  lossPct: number | null;
}

export interface TraceEvidence {
  /** Kayıt sayısı ve kaydı olan kullanıcılar */
  traces: number;
  users: string[];
  /** Kayıtların kapsadığı aralık (sunucu saati) */
  from: number;
  to: number;
  /**
   * Eşzamanlı STUN yanıtsızlığı: en az iki kullanıcı, en az 1,5 sn gerçek örtüşme VE o aralığı kapsayan
   * kayıtların çoğunluğu. Koşul sağlanmıyorsa (tek kullanıcı ya da azınlık) durum `stunPartial`dadır ve yalnızca
   * etken olarak anılır.
   */
  stun: TraceStun | null;
  stunPartial: TraceStun | null;
  burst: TraceBurst | null;
  /** Yayıncıların aldığı PLI/FIR ve NACK (saniyedeki en yüksek toplam) */
  pliMax: number;
  nackMax: number;
  /** BWE çöküşü: kim, ne zaman, hangi değerden hangisine (bit/sn) */
  bwe: { userId: string; at: number; from: number; to: number } | null;
  /** Taşıması temizken (kayıp yok, STUN canlı) donan izleyiciler: çözücü / işleme tarafı */
  decoderFreezes: { userId: string; freezes: number; ms: number }[];
  /** Ağ kaybıyla birlikte donan izleyiciler */
  networkFreezes: { userId: string; freezes: number; ms: number }[];
  /** Giden kayıp, türe göre ayrı (karşı tarafın bildirdiği; %): ses (mic/sau/a) ve görüntü (scr/v) */
  lossOutAudioPct: number | null;
  lossOutVideoPct: number | null;
  /** Gelen kayıp (%): ses ve görüntü */
  lossInAudioPct: number | null;
  lossInVideoPct: number | null;
  /** Yayıncının gönderdiği görüntü paketi ile bir izleyicinin aldığı (aynı saniyeler; YAKLAŞIK) */
  sentReceived: { publisher: string; viewer: string; sent: number; received: number; pct: number } | null;
  /** JS olay döngüsünün en yüksek gecikmesi (ms) ve kimde */
  lagMax: { userId: string; ms: number } | null;
}

const median = (v: number[]): number | null => {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const isVideo = (k: string): boolean => k === 'scr' || k === 'v';
const pctOf = (lost: number, total: number): number | null => (total <= 0 ? null : Math.round((lost / total) * 1000) / 10);

/** Aynı sıra numarası bu kadar yakın zamanda yeniden görülürse aynı ölçümdür (örtüşen gönderimler, farklı saat farkı) */
const SAME_SAMPLE_MS = 30_000;

/** Kullanıcının ölçümleri (birden çok kayıt birleştirilir, yinelenen sıra numaraları atılır), zamana göre */
function samplesByUser(traces: AlignedTrace[], from: number, to: number): Map<string, Sample[]> {
  const out = new Map<string, Sample[]>();
  for (const t of traces) {
    const list = out.get(t.userId) ?? [];
    for (const s of t.samples) if (s.ts >= from && s.ts - s.dt <= to) list.push(s);
    out.set(t.userId, list);
  }
  for (const [userId, list] of out) {
    list.sort((a, b) => a.ts - b.ts);
    // Örtüşen gönderimler aynı ölçümü iki kez taşıyabilir (saat farkı tahmini farklıysa `ts` de kayar): sıra
    // numarasıyla ayıklanır; sıra numarası yoksa zaman dilimiyle
    const byQ = new Map<number, number[]>();
    const buckets = new Set<number>();
    out.set(
      userId,
      list.filter((s) => {
        if (Number.isFinite(s.q)) {
          const at = byQ.get(s.q) ?? [];
          if (at.some((t) => Math.abs(t - s.ts) < SAME_SAMPLE_MS)) return false;
          at.push(s.ts);
          byQ.set(s.q, at);
          return true;
        }
        const key = Math.round(s.ts / 500);
        if (buckets.has(key)) return false;
        buckets.add(key);
        return true;
      }),
    );
  }
  return out;
}

/** Yanıtsızlığın başlangıcı, ilk "ölü" ölçümden en çok bu kadar geriye çekilir (ms) */
const STUN_BACKDATE_MS = 5_000;
/** "Aynı anda" sayılmak için gereken gerçek örtüşme (ms) */
const STUN_OVERLAP_MS = 1_500;

/**
 * STUN'un yanıtsız kaldığı aralıklar. Başlangıç istemcinin bildirdiği süreden (su) hesaplanır ama ona güvenilmez:
 * aynı kullanıcının yolu canlı gösteren önceki ölçümünden, ilk ölü ölçümün birkaç saniye öncesinden ve pencerenin
 * başından geriye gidemez (tek bir ölçümde çok büyük `su` bildiren istemci dakikalarca "ölü" sayılmasın).
 */
function stunDead(samples: Sample[], windowFrom: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let cur: { from: number; to: number } | null = null;
  let lastAlive = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    const su = s.x?.su ?? 0;
    if (su >= STUN_DEAD_MS) {
      if (!cur) {
        cur = { from: Math.min(s.ts, Math.max(s.ts - su, lastAlive, s.ts - s.dt - STUN_BACKDATE_MS, windowFrom)), to: s.ts };
        out.push(cur);
      }
      cur.to = s.ts;
    } else {
      cur = null;
      if (s.x) lastAlive = s.ts;
    }
  }
  return out;
}

/** Olay kayıtlarından kanıt; kayıt yoksa null */
export function summarizeTraces(traces: AlignedTrace[], from: number, to: number): TraceEvidence | null {
  if (traces.length === 0) return null;
  const byUser = samplesByUser(traces, from, to);
  const all = [...byUser.values()].flat();
  if (all.length === 0) return null;

  // --- STUN ---
  const dead = [...byUser.entries()].flatMap(([userId, list]) => stunDead(list, from).map((d) => ({ userId, ...d })));
  /** Aralığı kapsayan (o saniyelerde ölçümü olan) kullanıcılardan yolu canlı görünenler */
  const aliveIn = (a: number, b: number, deadUsers: string[]): string[] =>
    [...byUser.entries()].filter(([userId, list]) => !deadUsers.includes(userId) && list.some((s) => s.x && s.ts >= a && s.ts <= b + 1_000)).map(([userId]) => userId);
  let best: TraceStun | null = null;
  for (const d of dead) {
    // En kalabalık an bir aralığın başındadır; "aynı anda" için gerçek örtüşme aranır (tek noktada kesişme yetmez)
    const hit = dead.filter((x) => x.from <= d.from && x.to > d.from);
    const users = [...new Set(hit.map((x) => x.userId))];
    const a = Math.max(...hit.map((x) => x.from));
    const b = Math.min(...hit.map((x) => x.to));
    if (users.length < 2 || b - a < STUN_OVERLAP_MS || users.length <= (best?.users.length ?? 0)) continue;
    best = { users, alive: aliveIn(a, b, users), from: a, to: b, maxMs: Math.max(...hit.map((x) => x.to - x.from)) };
  }
  // Çoğunluk koşulu: o saniyeleri kapsayan kayıtların yarısından fazlası ölü olmalı; yoksa herkes için kesinti değildir
  const stun = best && best.users.length > (best.users.length + best.alive.length) / 2 ? best : null;
  let stunPartial: TraceStun | null = null;
  if (!stun) {
    if (best) stunPartial = best;
    else {
      const longest = [...dead].sort((x, y) => y.to - y.from - (x.to - x.from))[0];
      if (longest) stunPartial = { users: [longest.userId], alive: aliveIn(longest.from, longest.to, [longest.userId]), from: longest.from, to: longest.to, maxMs: longest.to - longest.from };
    }
  }

  // --- Yayıncıdaki patlama ve ardından kayıp ---
  let burst: TraceBurst | null = null;
  let pliMax = 0;
  let nackMax = 0;
  let outAudio = { lost: 0, sent: 0 };
  let outVideo = { lost: 0, sent: 0 };
  for (const [userId, list] of byUser) {
    const rates: { s: Sample; bps: number }[] = [];
    for (const s of list) {
      let pli = 0;
      let nack = 0;
      for (const u of s.up) {
        const bucket = isVideo(u.k) ? outVideo : outAudio;
        bucket.sent += u.ps;
        bucket.lost += u.pl ?? 0;
        pli += (u.pli ?? 0) + (u.fir ?? 0);
        nack += u.nk ?? 0;
      }
      const sec = Math.max(0.2, s.dt / 1000);
      pliMax = Math.max(pliMax, pli / sec);
      nackMax = Math.max(nackMax, nack / sec);
      const video = s.up.filter((u) => isVideo(u.k));
      if (video.length > 0 && s.dt > 0) rates.push({ s, bps: (video.reduce((n, u) => n + u.bs, 0) * 8) / (s.dt / 1000) });
    }
    for (let i = 5; i < rates.length; i++) {
      const cur = rates[i]!;
      const base = median(rates.slice(Math.max(0, i - 30), i - 1).map((r) => r.bps));
      if (base === null || cur.bps < base * BURST_RATIO || cur.bps - base < BURST_MIN_BPS) continue;
      if (burst && cur.bps - base <= burst.bps - burst.baseBps) continue;
      const near = list.filter((s) => Math.abs(s.ts - cur.s.ts) <= 2_000).flatMap((s) => s.up.filter((u) => isVideo(u.k)));
      const after = list.filter((s) => s.ts > cur.s.ts - 500 && s.ts <= cur.s.ts + BURST_LOSS_WINDOW_MS);
      const lossy = after
        .map((s) => ({ ts: s.ts, fl: Math.max(0, ...s.up.map((u) => u.fl ?? 0)), pl: s.up.reduce((n, u) => n + (u.pl ?? 0), 0) }))
        .filter((x) => x.fl >= 3 || x.pl >= 5);
      burst = {
        userId,
        at: cur.s.ts,
        bps: Math.round(cur.bps),
        baseBps: Math.round(base),
        keyFrames: near.reduce((n, u) => n + (u.kf ?? 0), 0),
        hugeFrames: near.reduce((n, u) => n + (u.hf ?? 0), 0),
        lossAt: lossy[0]?.ts ?? null,
        lossPct: lossy.length > 0 ? Math.max(...lossy.map((x) => x.fl)) : null,
      };
    }
  }

  // --- BWE çöküşü ---
  let bwe: TraceEvidence['bwe'] = null;
  for (const [userId, list] of byUser) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!.x?.ao ?? null;
      const cur = list[i]!.x?.ao ?? null;
      if (prev === null || cur === null || prev < 500_000 || cur > prev * BWE_COLLAPSE_RATIO) continue;
      if (!bwe || prev - cur > bwe.from - bwe.to) bwe = { userId, at: list[i]!.ts, from: Math.round(prev), to: Math.round(cur) };
    }
  }

  // --- İzleyiciler: donma ağ kaybıyla mı, taşıma temizken mi ---
  const decoderFreezes: TraceEvidence['decoderFreezes'] = [];
  const networkFreezes: TraceEvidence['networkFreezes'] = [];
  const inAudio = { lost: 0, recv: 0 };
  const inVideo = { lost: 0, recv: 0 };
  let lagMax: TraceEvidence['lagMax'] = null;
  for (const [userId, list] of byUser) {
    let clean = { freezes: 0, ms: 0 };
    let lossy = { freezes: 0, ms: 0 };
    list.forEach((s, i) => {
      if (s.da) {
        inAudio.recv += s.da.pr;
        inAudio.lost += s.da.pl;
      }
      for (const v of s.dv ?? []) {
        inVideo.recv += v.pr;
        inVideo.lost += v.pl ?? 0;
      }
      if ((s.lag ?? 0) > (lagMax?.ms ?? 0)) lagMax = { userId, ms: Math.round(s.lag!) };
      const fz = (s.dv ?? []).reduce((n, v) => n + (v.fz ?? 0), 0);
      const fzd = (s.dv ?? []).reduce((n, v) => n + (v.fzd ?? 0), 0);
      if (fz === 0 && fzd === 0) return;
      // Donmanın nedeni birkaç saniye öncesindeki kayıp olabilir: bu ve önceki iki ölçüme bakılır
      const around = list.slice(Math.max(0, i - 2), i + 1);
      const dirty = around.some((a) => (a.dv ?? []).some((v) => (v.pl ?? 0) > 0) || (a.x?.su ?? 0) >= STUN_DEAD_MS || (a.da?.pl ?? 0) > 0);
      const bucket = dirty ? lossy : clean;
      bucket.freezes += fz;
      bucket.ms += fzd;
    });
    if (clean.freezes > 0 || clean.ms > 0) decoderFreezes.push({ userId, freezes: clean.freezes, ms: Math.round(clean.ms) });
    if (lossy.freezes > 0 || lossy.ms > 0) networkFreezes.push({ userId, freezes: lossy.freezes, ms: Math.round(lossy.ms) });
  }

  // --- Gönderilen / alınan (yaklaşık): yayıncının görüntü paketleri ile bir izleyicinin aldığı, ortak saniyelerde ---
  let sentReceived: TraceEvidence['sentReceived'] = null;
  const publishers = [...byUser.entries()].filter(([, list]) => list.some((s) => s.up.some((u) => u.k === 'scr' && u.ps > 0)));
  if (publishers.length === 1) {
    const [publisher, pub] = publishers[0]!;
    for (const [viewer, list] of byUser) {
      if (viewer === publisher) continue;
      const watch = list.filter((s) => (s.dv ?? []).some((v) => v.pr > 0));
      if (watch.length < 5) continue;
      const a = Math.max(pub[0]!.ts, watch[0]!.ts);
      const b = Math.min(pub[pub.length - 1]!.ts, watch[watch.length - 1]!.ts);
      if (b - a < 5_000) continue;
      const sent = pub.filter((s) => s.ts > a && s.ts <= b).reduce((n, s) => n + s.up.filter((u) => u.k === 'scr').reduce((m, u) => m + u.ps, 0), 0);
      const received = watch.filter((s) => s.ts > a && s.ts <= b).reduce((n, s) => n + (s.dv ?? []).reduce((m, v) => m + v.pr, 0), 0);
      if (sent <= 0) continue;
      const pct = Math.round((received / sent) * 1000) / 10;
      if (!sentReceived || pct < sentReceived.pct) sentReceived = { publisher, viewer, sent, received, pct };
    }
  }

  return {
    traces: traces.length,
    users: [...byUser.keys()],
    from: Math.min(...all.map((s) => s.ts - s.dt)),
    to: Math.max(...all.map((s) => s.ts)),
    stun,
    stunPartial,
    burst,
    pliMax: Math.round(pliMax * 10) / 10,
    nackMax: Math.round(nackMax * 10) / 10,
    bwe,
    decoderFreezes,
    networkFreezes,
    lossOutAudioPct: pctOf(outAudio.lost, outAudio.sent),
    lossOutVideoPct: pctOf(outVideo.lost, outVideo.sent),
    lossInAudioPct: pctOf(inAudio.lost, inAudio.recv + inAudio.lost),
    lossInVideoPct: pctOf(inVideo.lost, inVideo.recv + inVideo.lost),
    sentReceived,
    lagMax,
  };
}
