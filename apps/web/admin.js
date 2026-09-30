// Yönetim paneli (/admin): hesap yöneticilerine sunucunun genel durumu. Özet GET /api/admin/dashboard'dan sayfa
// görünürken 5 sn'de bir gelir; ağır/ayrıntılı veriler (ses geçmişi, ses kalitesi ayrıntıları, altyapı, API,
// güvenlik, sunucular, geri bildirimler) yalnızca ilgili sekme açıkken kendi uçlarından istenir (LOADERS).
// Giriş, uygulamanın kendi giriş ucuyla (POST /api/auth/login) yapılır; jeton sessionStorage'da ("Beni hatırla"
// seçilirse localStorage'da) durur.
// CSP gereği satır içi betik ve stil yok (öğe stilleri yalnızca CSSOM ile; resimler data: adresiyle). Tüm
// metinler textContent ile yazılır: istemci hata iletileri, geri bildirim metinleri gibi dışarıdan gelen
// metinler asla HTML olarak yorumlanmaz.

const REFRESH_MS = 5_000;
const TOKEN_KEY = 'diskort-admin-token';
const TAB_KEY = 'diskort-admin-tab';
const USERS_SHOWN = 15;
const DAY_MS = 86_400_000;
/** Sunucunun gün dosyalarının saat dilimi (STATS_UTC_OFFSET_MIN varsayılanı: Türkiye) */
const SERVER_DAY_OFFSET_MIN = 180;

const $ = (id) => document.getElementById(id);

// ---------- Oturum ----------

function loadToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(value, remember) {
  try {
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
  } catch {
    // Depolama kapalı (gizli sekme): jeton yalnızca bu sayfa açıkken bellekte kalır
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // yok say
  }
}

let token = loadToken();
let timer = null;
let inflight = false;
let lastData = null;
let failures = 0;

const TABS = ['genel', 'ses', 'ses-gecmisi', 'makine', 'api', 'istemciler', 'guvenlik', 'sunucular', 'geri-bildirim', 'iphone', 'hatalar'];
/** Eski bağlantılar (#sunucu) yeni sekmelere */
const TAB_ALIASES = { sunucu: 'makine' };

function initialTab() {
  const hash = decodeURIComponent(location.hash.slice(1));
  const fromHash = TAB_ALIASES[hash] ?? hash;
  if (TABS.includes(fromHash)) return fromHash;
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (TABS.includes(saved)) return saved;
  } catch {
    // depolama kapalı
  }
  return 'genel';
}

/** Yeniden çizimde korunacak arayüz durumu */
const ui = {
  tab: initialTab(),
  allUsers: false,
  openErrors: new Set(),
  incidentDays: 7,
  historyDays: 7,
  fbStatus: 'yeni',
  fbType: '',
  allEvents: false,
};

const VIEWS = ['adm-login', 'adm-denied', 'adm-loading', 'adm-dashboard'];

function show(view) {
  for (const id of VIEWS) $(id).hidden = id !== view;
  $('adm-session').hidden = view !== 'adm-dashboard' && view !== 'adm-loading';
  if (view !== 'adm-dashboard') closeSheet();
  if (view === 'adm-login') setTimeout(() => $('adm-login-form').elements.username.focus(), 0);
}

function logout(message) {
  clearTimeout(timer);
  stopExtra();
  token = null;
  lastData = null;
  extra.data = {};
  clearToken();
  loginError(message ?? null);
  show('adm-login');
}

function loginError(message) {
  const el = $('adm-login-error');
  el.hidden = !message;
  el.textContent = message ?? '';
}

$('adm-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  if (!username || !password) return loginError('Kullanıcı adı ve şifre gerekli.');
  const submit = $('adm-login-submit');
  submit.disabled = true;
  loginError(null);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return loginError(body?.message ?? `Giriş başarısız (${res.status}).`);
    form.elements.password.value = '';
    // Yönetici olmayanın jetonu saklanmaz
    if (!body?.user?.isAdmin) return show('adm-denied');
    token = body.token;
    saveToken(token, form.elements.remember.checked);
    show('adm-loading');
    void refresh();
  } catch {
    loginError('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
  } finally {
    submit.disabled = false;
  }
});

$('adm-logout').addEventListener('click', () => logout());
$('adm-denied-logout').addEventListener('click', () => logout());

// ---------- İstekler ----------

class AccessError extends Error {}

/** Yetki hatalarını oturum ekranına çevirir; diğer hatalar atılır */
function checkAccess(res) {
  if (res.status === 401) {
    logout('Oturumun sona erdi, tekrar giriş yap.');
    throw new AccessError('401');
  }
  if (res.status === 403) {
    clearToken();
    token = null;
    stopExtra();
    show('adm-denied');
    throw new AccessError('403');
  }
}

async function apiGet(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  checkAccess(res);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiSend(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  checkAccess(res);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `İstek başarısız (${res.status}).`);
  return data;
}

/** Yetkiyle korunan resmi data: adresine çevirir (CSP: img-src 'self' data:) */
async function imageDataUrl(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  checkAccess(res);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---------- Yenileme (5 sn'lik özet) ----------

function schedule() {
  clearTimeout(timer);
  if (token && !document.hidden) timer = setTimeout(refresh, REFRESH_MS);
}

async function refresh() {
  if (inflight || !token) return;
  clearTimeout(timer);
  inflight = true;
  try {
    const res = await fetch(`/api/admin/dashboard?tz=${new Date().getTimezoneOffset()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    checkAccess(res);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const first = !lastData;
    lastData = await res.json();
    failures = 0;
    render(lastData);
    setLive('ok', `Canlı · ${clock(lastData.generatedAt, true)}`);
    show('adm-dashboard');
    if (first) {
      setTab(ui.tab, false);
      window.scrollTo(0, 0);
    }
  } catch (err) {
    if (err instanceof AccessError) return;
    failures++;
    setLive('bad', lastData ? `Bağlantı yok · son ${clock(lastData.generatedAt, true)}` : 'Bağlantı yok');
    if (!lastData) {
      $('adm-loading-text').textContent = 'Sunucuya ulaşılamadı; yeniden deneniyor…';
      show('adm-loading');
    }
  } finally {
    inflight = false;
    if (token) schedule();
  }
}

function setLive(state, text) {
  $('adm-live').dataset.state = state;
  $('adm-live-text').textContent = text;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(timer);
    stopExtra();
    clearTimeout(sheet.timer);
    if (token) setLive('paused', 'Duraklatıldı');
  } else if (token) {
    void refresh();
    loadExtra(true);
    if (sheet.reload) sheet.reload();
  }
});

// ---------- Sekmeler ve sekmeye özel veriler ----------

/**
 * Sekmeye özel veriler: yalnızca sekme açıkken ve sayfa görünürken, kendi aralığıyla istenir. `render`
 * gelen veriyle sekmenin bölümlerini çizer.
 */
const LOADERS = {
  ses: { url: () => `/api/admin/telemetry/incidents?days=${ui.incidentDays}`, every: 30_000, render: (x) => draw('adm-incidents', () => incidents(x)) },
  'ses-gecmisi': {
    url: () => `/api/admin/voice-history?days=${ui.historyDays}&tz=${new Date().getTimezoneOffset()}`,
    every: 60_000,
    render: (x) => draw('adm-history', () => voiceHistory(x)),
  },
  makine: {
    url: () => '/api/admin/infra',
    every: 10_000,
    render: (x) => {
      draw('adm-infra', () => infra(x));
      draw('adm-livekit', () => livekit(x));
      draw('adm-usage', () => usage(x));
    },
  },
  api: { url: () => '/api/admin/api-stats', every: 5_000, render: (x) => draw('adm-api', () => apiHealth(x)) },
  guvenlik: { url: () => '/api/admin/security', every: 30_000, render: (x) => draw('adm-security', () => security(x)) },
  sunucular: { url: () => '/api/admin/guilds', every: 60_000, render: (x) => draw('adm-guilds', () => guilds(x)) },
  'geri-bildirim': {
    url: () => `/api/feedback?${new URLSearchParams({ ...(ui.fbStatus ? { status: ui.fbStatus } : {}), ...(ui.fbType ? { type: ui.fbType } : {}) })}`,
    every: 60_000,
    render: (x) => draw('adm-feedback-list', () => feedbackList(x)),
  },
  iphone: { url: () => '/api/admin/ios-devices', every: 20_000, render: (x) => draw('adm-iphone', () => iosDevices(x)) },
  hatalar: { url: () => '/api/admin/api-stats', every: 15_000, render: (x) => draw('adm-logs', () => serverLogs(x)) },
};

const extra = { data: {}, timer: null, seq: 0 };

function stopExtra() {
  clearTimeout(extra.timer);
  extra.timer = null;
  extra.seq++;
}

/** Açık sekmenin verisini ister (force: hemen, yoksa zamanı gelmişse) */
async function loadExtra(force = false) {
  const tab = ui.tab;
  const loader = LOADERS[tab];
  clearTimeout(extra.timer);
  if (!loader || !token || document.hidden) return;
  const seq = ++extra.seq;
  const cached = extra.data[tab];
  if (cached && !force && Date.now() - cached.at < loader.every) {
    extra.timer = setTimeout(() => loadExtra(true), loader.every - (Date.now() - cached.at));
    return;
  }
  if (!cached) placeholder(tab, 'Yükleniyor…');
  try {
    const data = await apiGet(loader.url());
    if (seq !== extra.seq || ui.tab !== tab) return;
    extra.data[tab] = { at: Date.now(), value: data };
    loader.render(data);
  } catch (err) {
    if (err instanceof AccessError || seq !== extra.seq) return;
    if (!extra.data[tab]) placeholder(tab, `Veri alınamadı (${err.message}); yeniden denenecek.`);
  }
  if (seq === extra.seq && token) extra.timer = setTimeout(() => loadExtra(true), loader.every);
}

/** Sekme verisi gelene kadar bölümlerinde kısa bir not */
function placeholder(tab, text) {
  const target = {
    ses: ['adm-incidents'],
    'ses-gecmisi': ['adm-history'],
    makine: ['adm-infra', 'adm-livekit', 'adm-usage'],
    api: ['adm-api'],
    guvenlik: ['adm-security'],
    sunucular: ['adm-guilds'],
    'geri-bildirim': ['adm-feedback-list'],
    iphone: ['adm-iphone'],
    hatalar: ['adm-logs'],
  }[tab];
  for (const id of target ?? []) $(id).replaceChildren(h('article', 'adm-card adm-wide adm-empty', text));
}

function setTab(tab, scroll = true) {
  if (!TABS.includes(tab)) tab = 'genel';
  ui.tab = tab;
  for (const btn of $('adm-tabs').querySelectorAll('[data-tab]')) {
    const active = btn.dataset.tab === tab;
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  }
  for (const id of TABS) $(id).hidden = id !== tab;
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // depolama kapalı
  }
  if (location.hash !== `#${tab}`) window.history.replaceState(null, '', `#${tab}`);
  const cached = extra.data[tab];
  if (cached) LOADERS[tab]?.render(cached.value);
  stopExtra();
  void loadExtra(!cached);
  if (scroll && $('adm-tabs').getBoundingClientRect().top < 0) $('adm-tabs').scrollIntoView({ block: 'start' });
}

$('adm-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (btn) setTab(btn.dataset.tab);
});
$('adm-tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = TABS.indexOf(ui.tab);
  const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
  setTab(next);
  $('adm-tabs').querySelector(`[data-tab="${next}"]`)?.focus();
});
window.addEventListener('hashchange', () => {
  const hash = decodeURIComponent(location.hash.slice(1));
  const tab = TAB_ALIASES[hash] ?? hash;
  if (TABS.includes(tab) && tab !== ui.tab) setTab(tab);
});

/** Bölümü çizer; bir bölümdeki hata diğerlerini bozmaz */
function draw(id, fn) {
  try {
    $(id).replaceChildren(...[fn()].flat(Infinity).filter(Boolean));
  } catch (err) {
    console.error(err);
    $(id).replaceChildren(h('article', 'adm-card adm-wide adm-empty', `Bu bölüm çizilemedi: ${err.message}`));
  }
}

// ---------- Biçimlendirme ----------

const nf = new Intl.NumberFormat('tr-TR');
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

const num = (n) => (n === null || n === undefined ? '—' : nf.format(n));
const dec = (n, digits = 1) =>
  n === null || n === undefined ? '—' : (digits === 2 ? nf2 : digits === 0 ? nf : nf1).format(n);

/** Bayt (ondalık birimler: kota ve sağlayıcı paketleri de öyle) */
function bytes(n) {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? nf.format(v) : nf1.format(v)} ${units[i]}`;
}

/** Bit/sn */
function bits(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return `${nf1.format(v / 1e9)} Gb/sn`;
  if (v >= 1e6) return `${nf1.format(v / 1e6)} Mb/sn`;
  if (v >= 1e3) return `${nf.format(Math.round(v / 1e3))} kb/sn`;
  return `${nf.format(Math.round(v))} b/sn`;
}

/** Bayt/sn → bit/sn */
const rate = (bps) => (bps === null || bps === undefined ? '—' : bits(bps * 8));

const percent = (x) => (x === null || x === undefined ? '—' : `%${nf.format(Math.round(x * 100))}`);
/** Zaten yüzde olan değer (0–100) */
const pct = (x, digits = 1) => (x === null || x === undefined ? '—' : `%${(digits === 2 ? nf2 : nf1).format(x)}`);
const msText = (x) => (x === null || x === undefined ? '—' : `${nf.format(Math.round(x))} ms`);
const perSec = (x) => (x === null || x === undefined ? '—' : `${nf1.format(x)}/sn`);

function duration(sec) {
  if (sec === null || sec === undefined) return '—';
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86_400);
  const hh = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d} g ${hh} sa`;
  if (hh > 0) return `${hh} sa ${m} dk`;
  if (m > 0) return `${m} dk`;
  return `${s} sn`;
}

/** Dakika → "3 sa 20 dk" */
const minutes = (min) =>
  min === null || min === undefined ? '—' : min <= 0 ? '0 dk' : min < 1 ? '<1 dk' : duration(min * 60);

function clock(ms, seconds = false) {
  return new Date(ms).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
}

const shortDate = (ms) => new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
const dateTime = (ms) =>
  new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function ago(ms, now) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'şimdi';
  if (s < 3_600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86_400) return `${Math.floor(s / 3_600)} sa önce`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} gün önce`;
  return shortDate(ms);
}

/** Sunucunun gün dosyası anahtarı (YYYY-AA-GG) */
const serverDay = (ms) => new Date(ms + SERVER_DAY_OFFSET_MIN * 60_000).toISOString().slice(0, 10);

const PLATFORM = { desktop: 'Masaüstü', android: 'Android', ios: 'iOS' };
const NOISE = { dpdfnet: 'DPDFNet', deepfilter: 'DeepFilterNet', standard: 'Standart', off: 'Kapalı' };
const SEVERITY = { ok: ['İyi', 'ok'], warn: ['İdare eder', 'warn'], poor: ['Kötü', 'bad'] };

function routeText(candidate, protocol) {
  if (!candidate) return '—';
  const type = candidate === 'relay' ? 'TURN' : candidate === 'host' ? 'Doğrudan' : candidate === 'srflx' || candidate === 'prflx' ? 'NAT' : candidate;
  return protocol ? `${type} · ${protocol.toUpperCase()}` : type;
}

// ---------- DOM yardımcıları ----------

/** Öğe oluşturur; çocuklar metin (textContent olarak), öğe, dizi ya da boş (atlanır) olabilir */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (typeof props === 'string') el.className = props;
  else if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Kutu: başlık, büyük değer, alt satırlar ve isteğe bağlı grafik. `wide` her zaman tüm satırı kaplar.
 * Telefonda kutular tam genişliktir; yalnızca kısa sayı kutuları (`compact`) ikişer yan yana dizilir.
 */
function card({ label, value, unit, sub, wide, compact, tone, children, cls }) {
  return h(
    'article',
    `adm-card${wide ? ' adm-wide' : ''}${compact ? ' adm-compact' : ''}${tone ? ` adm-tone-${tone}` : ''}${cls ? ` ${cls}` : ''}`,
    h('div', 'adm-label', label),
    value !== undefined && h('div', 'adm-value', value, unit && h('span', 'adm-unit', unit)),
    sub && (Array.isArray(sub) ? sub : [sub]).filter(Boolean).map((line) => h('div', 'adm-sub', line)),
    children,
  );
}

/** Başlıklı geniş kutu (listeler) */
const panel = (label, ...children) => h('article', 'adm-card adm-wide', h('div', 'adm-label', label), children);

/** Doluluk çubuğu: renk durumu taşır (normal → uyarı → tehlike) */
function meter(fraction, label) {
  const f = Math.max(0, Math.min(1, fraction ?? 0));
  const bar = h('span');
  bar.style.width = `${(f * 100).toFixed(1)}%`;
  const state = f >= 0.95 ? 'danger' : f >= 0.8 ? 'warn' : 'ok';
  return h('div', { class: `adm-meter adm-meter-${state}`, role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(f * 100) }, bar);
}

/**
 * Küçük çizgi grafik. points: [{ at, v }] (v null ise çizgide boşluk). Fareyle ya da dokunarak üzerine
 * gelinen ölçümün saati ve değeri gösterilir. `axis`: altta başlangıç ve bitiş saati.
 */
function sparkline(points, { max, format, color = 'brand', label, axis = false, seconds = true }) {
  const W = 300;
  const H = 60;
  const wrap = h('div', `adm-spark adm-c-${color}`);
  const valid = points.filter((p) => p.v !== null && p.v !== undefined);
  if (points.length < 2 || valid.length === 0) {
    append(wrap, [h('div', 'adm-spark-empty', points.length === 0 ? 'Veri yok' : 'Ölçülüyor…')]);
    return wrap;
  }
  const from = points[0].at;
  const to = points[points.length - 1].at;
  const top = Math.max(max ?? 0, ...valid.map((p) => p.v)) || 1;
  const x = (t) => ((t - from) / Math.max(1, to - from)) * W;
  const y = (v) => H - 2 - (Math.min(v, top) / top) * (H - 6);
  let line = '';
  let area = '';
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    const d = run.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    line += run.length === 1 ? `${d}h0.5` : d;
    area += `${d}L${run[run.length - 1][0].toFixed(1)},${H}L${run[0][0].toFixed(1)},${H}Z`;
    run = [];
  };
  for (const p of points) {
    if (p.v === null || p.v === undefined) flush();
    else run.push([x(p.at), y(p.v)]);
  }
  flush();
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
  chart.append(svg('path', { d: area, class: 'adm-spark-area' }));
  chart.append(svg('path', { d: line, class: 'adm-spark-line', 'vector-effect': 'non-scaling-stroke' }));
  const cursor = h('div', 'adm-spark-cursor');
  const dot = h('div', 'adm-spark-dot');
  const tip = h('div', 'adm-spark-tip');
  cursor.hidden = dot.hidden = tip.hidden = true;
  const move = (e) => {
    const rect = wrap.getBoundingClientRect();
    const t = from + ((e.clientX - rect.left) / rect.width) * (to - from);
    let best = null;
    for (const p of valid) if (!best || Math.abs(p.at - t) < Math.abs(best.at - t)) best = p;
    if (!best) return;
    const left = (x(best.at) / W) * 100;
    cursor.style.left = dot.style.left = `${left}%`;
    dot.style.top = `${(y(best.v) / H) * 100}%`;
    tip.textContent = `${to - from > 86_400_000 ? dateTime(best.at) : clock(best.at, seconds)} · ${format(best.v)}`;
    tip.style.left = `${left}%`;
    tip.dataset.side = left > 60 ? 'left' : 'right';
    cursor.hidden = dot.hidden = tip.hidden = false;
  };
  const leave = (e) => {
    // Dokunmatikte parmak kalkınca da "ayrıldı" gelir: değer bir sonraki yenilemeye kadar görünür kalsın
    if (e.pointerType === 'touch') return;
    cursor.hidden = dot.hidden = tip.hidden = true;
  };
  wrap.addEventListener('pointermove', move);
  wrap.addEventListener('pointerdown', move);
  wrap.addEventListener('pointerleave', leave);
  append(wrap, [chart, cursor, dot, tip]);
  if (!axis) return wrap;
  return h('div', null, wrap, h('div', 'adm-axis', h('span', null, clock(from)), h('span', null, clock(to))));
}

const series = (list, key) => list.map((s) => ({ at: s.at, v: s[key] ?? null }));

/** Seçim düğmeleri (ör. 7 / 30 / 90 gün) */
function chips(options, current, onPick, label) {
  return h(
    'div',
    { class: 'adm-chips', role: 'group', 'aria-label': label },
    options.map(([value, text]) =>
      h('button', { type: 'button', class: 'adm-chip', 'aria-pressed': String(value === current), on: { click: () => onPick(value) } }, text),
    ),
  );
}

/** Anahtar-değer satırı */
const kv = (name, value, tone) => h('div', `adm-kv${tone ? ` adm-kv-${tone}` : ''}`, h('span', null, name), h('b', null, value));

function avatar(user, size = 32) {
  const el = h('span', 'adm-avatar');
  el.style.width = el.style.height = `${size}px`;
  if (user?.avatarUrl) {
    append(el, [h('img', { src: user.avatarUrl, alt: '', width: size, height: size, loading: 'lazy' })]);
  } else {
    el.style.background = user?.avatarColor ?? '#5865f2';
    el.textContent = (user?.displayName ?? '?').trim().charAt(0).toLocaleUpperCase('tr') || '?';
  }
  return el;
}

const badge = (text, tone) => h('span', `adm-badge${tone ? ` adm-badge-${tone}` : ''}`, text);
const userName = (u, fallback = 'Silinmiş kullanıcı') => u?.displayName ?? fallback;

/** Satır içi kişi: avatar + ad + @kullanıcı adı */
function person(u, size = 24) {
  return h('span', 'adm-person', avatar(u, size), h('span', null, userName(u)), u && h('span', 'adm-muted', ` @${u.username}`));
}

// ---------- 5 sn'lik özetten çizilen bölümler ----------

function render(d) {
  const now = d.generatedAt;
  draw('adm-overview', () => overview(d, now));
  draw('adm-voice', () => voice(d, now));
  draw('adm-quality', () => quality(d, now));
  draw('adm-system', () => system(d, now));
  draw('adm-clients', () => clients(d, now));
  draw('adm-errors', () => errors(d, now));
  draw('adm-feedback', () => feedbackSummary(d));
  const fb = $('adm-fb-count');
  fb.hidden = !(d.feedback.counts.yeni > 0);
  fb.textContent = num(d.feedback.counts.yeni);
  const errCount = d.errors.client.last24h + d.errors.server.last24h;
  $('adm-err-count').hidden = errCount === 0;
  $('adm-err-count').textContent = num(errCount);
  $('adm-foot').textContent =
    `Son güncelleme ${clock(now, true)} · özet 5 saniyede bir, açık sekmenin ayrıntıları kendi aralığıyla yenilenir. ` +
    `Kısa grafikler sunucu belleğinde tutulur (${dateTime(d.errors.since)} tarihinden beri); hata kayıtları yeniden başlatmada korunur (son 200, 14 gün).`;
}

function overview(d, now) {
  const o = d.overview;
  const m = o.messages;
  const trackedDays = (now - o.activitySince) / 86_400_000;
  const maxDay = Math.max(1, ...m.perDay.map((p) => p.count));
  const caption = h('div', 'adm-sub adm-bars-caption', `Son ${m.perDay.length} gün`);
  const bars = h(
    'div',
    { class: 'adm-bars', role: 'img', 'aria-label': `Son ${m.perDay.length} günün günlük mesaj sayıları` },
    m.perDay.map((p, i) => {
      const bar = h('span', {
        class: `adm-bar${p.count === 0 ? ' adm-bar-zero' : ''}${i === m.perDay.length - 1 ? ' adm-bar-today' : ''}`,
        title: `${shortDate(p.day)}: ${num(p.count)} mesaj`,
      });
      bar.style.height = `${Math.max(3, (p.count / maxDay) * 100)}%`;
      const label = `${i === m.perDay.length - 1 ? 'Bugün' : shortDate(p.day)}: ${num(p.count)} mesaj`;
      const showDay = () => (caption.textContent = label);
      bar.addEventListener('pointerenter', showDay);
      bar.addEventListener('pointerdown', showDay);
      bar.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'touch') caption.textContent = `Son ${m.perDay.length} gün`;
      });
      return bar;
    }),
  );
  const s = o.storage;
  const hl = d.health;
  return [
    card({
      label: 'Hesaplar',
      value: num(o.users),
      compact: true,
      sub: [
        `${num(o.admins)} yönetici · ${num(o.guilds)} sunucu`,
        `${num(o.channels.text + o.channels.voice)} kanal · ${num(o.channels.dm)} DM`,
      ],
    }),
    card({
      label: 'Şu an bağlı',
      value: num(o.online),
      unit: 'kişi',
      sub: `${num(o.sessions)} açık bağlantı`,
      children: sparkline(series(d.system.history, 'online'), {
        format: (v) => `${num(v)} kişi`,
        label: 'Bağlı kişi sayısı, son dakikalar',
        max: 1,
      }),
    }),
    card({
      label: 'Etkin hesaplar',
      value: num(o.active24h),
      unit: 'son 24 saat',
      compact: true,
      sub: [
        `Son 7 günde ${num(o.active7d)}`,
        // Bağlantı takibi yeni başladıysa öncesi yalnızca mesaj yazanlardan bilinir
        trackedDays < 7 && `Bağlantı takibi ${shortDate(o.activitySince)} tarihinden beri`,
      ],
    }),
    hl &&
      card({
        label: 'API (son 1 saat)',
        value: num(hl.requestsLastHour),
        unit: 'istek',
        compact: true,
        tone: hl.errors5xxLastHour > 0 ? 'bad' : hl.limitedLastHour > 0 ? 'warn' : undefined,
        sub: [`${num(hl.errors5xxLastHour)} sunucu hatası · ${num(hl.limitedLastHour)} sınır aşımı`, `${num(hl.openSockets)} açık WebSocket`],
      }),
    card({
      label: 'Depolama',
      value: bytes(s.database + s.attachments + (s.avatars ?? 0) + (s.feedback ?? 0) + (s.linkPreviews ?? 0)),
      children: h(
        'div',
        'adm-kvs',
        kv('Veritabanı', bytes(s.database)),
        kv(`Dosya ekleri (${num(s.attachmentCount)})`, bytes(s.attachments)),
        kv('Profil ve sunucu resimleri', bytes(s.avatars)),
        kv('Geri bildirim görüntüleri', bytes(s.feedback)),
        kv('Bağlantı önizlemeleri', bytes(s.linkPreviews)),
      ),
    }),
    card({
      label: 'Mesajlar',
      value: num(m.today),
      unit: 'bugün',
      wide: true,
      sub: `Son 24 saatte ${num(m.last24h)} · son 7 günde ${num(m.last7d)} · toplam ${num(m.total)}`,
      children: [bars, caption],
    }),
  ];
}

function trackText(t) {
  const codec = t.mimeType ? t.mimeType.split('/')[1] : '';
  if (t.kind === 'video') return `${t.width && t.height ? `${t.width}×${t.height} ` : ''}${codec}`.trim();
  return codec;
}

/** Kişinin ses kalitesi özeti (varsa) */
const qualityOf = (d, userId) => (d.voice.quality ?? []).find((q) => q.userId === userId) ?? null;

function voice(d, now) {
  const v = d.voice;
  const lk = v.livekit;
  const mismatch = lk.ok && lk.participants !== v.participants;
  const mx = v.metrics;
  const cards = [
    card({
      label: 'Seste',
      value: num(v.participants),
      unit: 'kişi',
      sub: `${num(v.channels.length)} kanalda`,
      children: sparkline(series(d.system.history, 'voice'), {
        format: (x) => `${num(x)} kişi`,
        label: 'Sesteki kişi sayısı, son dakikalar',
        max: 1,
      }),
    }),
    card({ label: 'Yayında', value: num(v.streams), unit: 'ekran paylaşımı', compact: true }),
    card({
      label: 'LiveKit',
      value: lk.ok ? 'Çalışıyor' : 'Ulaşılamıyor',
      compact: true,
      tone: lk.ok ? (mismatch ? 'warn' : 'ok') : 'bad',
      sub: lk.ok
        ? [
            `${num(lk.rooms)} oda · ${num(lk.participants)} kişi · ${num(lk.tracks)} iz`,
            `Yanıt ${num(lk.latencyMs ?? 0)} ms`,
            // Ses durumu LiveKit'le 30 sn'de bir eşitlenir
            mismatch && `Uygulamadaki ses listesiyle uyuşmuyor (${num(v.participants)} kişi)`,
          ]
        : lk.error,
    }),
    mx &&
      card({
        label: 'LiveKit trafiği',
        value: mx.ok && mx.latest ? rate((mx.latest.bytesIn ?? 0) + (mx.latest.bytesOut ?? 0)) : 'Ölçüm yok',
        compact: true,
        tone: mx.ok && (mx.latest?.lossInPct ?? 0) >= 3 ? 'warn' : undefined,
        sub:
          mx.ok && mx.latest
            ? [`↓ ${rate(mx.latest.bytesIn)} · ↑ ${rate(mx.latest.bytesOut)}`, `Kayıp ${pct(mx.latest.lossInPct, 2)} · RTT ${msText(mx.latest.rttMs)}`]
            : ['Metrikler kapalı (Makine sekmesine bak)'],
      }),
  ];
  if (v.channels.length === 0) {
    cards.push(h('article', 'adm-card adm-wide adm-empty', 'Şu an seste kimse yok.'));
    return cards;
  }
  for (const c of v.channels) {
    cards.push(
      h(
        'article',
        'adm-card adm-wide',
        h(
          'div',
          'adm-channel-head',
          h('span', 'adm-channel-name', `🔊 ${c.name}`),
          c.guildName && h('span', 'adm-muted', c.guildName),
          h('span', 'adm-muted adm-push', `${num(c.participants.length)} kişi`),
        ),
        h(
          'ul',
          'adm-rows',
          c.participants.map((p) => {
            const name = p.user?.displayName ?? 'Silinmiş kullanıcı';
            const screen = p.tracks?.find((t) => t.source === 'screen');
            const mic = p.tracks?.find((t) => t.source === 'microphone');
            const q = qualityOf(d, p.userId);
            return h(
              'li',
              { class: 'adm-row adm-clickable', tabindex: 0, role: 'button', on: rowOpen(() => openTelemetry(p.userId, p.user)) },
              avatar(p.user),
              h(
                'div',
                'adm-row-main',
                h('div', 'adm-row-title', name, p.user && h('span', 'adm-muted', ` @${p.user.username}`)),
                h(
                  'div',
                  'adm-badges',
                  q && badge(`${SEVERITY[q.severity][0]} · ${msText(q.rttAvg)}`, SEVERITY[q.severity][1]),
                  badge(`${duration((now - p.joinedAt) / 1000)} seste`),
                  p.platforms.map((pl) => badge(PLATFORM[pl] ?? pl)),
                  p.streaming &&
                    badge(
                      `Yayında${p.streamStartedAt ? ` · ${duration((now - p.streamStartedAt) / 1000)}` : ''}${screen ? ` · ${trackText(screen)}` : ''}`,
                      'live',
                    ),
                  p.selfMute && badge('Mikrofon kapalı', 'muted'),
                  p.selfDeaf && badge('Sağırlaştırılmış', 'muted'),
                  p.serverMute && badge('Sunucuda susturuldu', 'warn'),
                  p.serverDeaf && badge('Sunucuda sağırlaştırıldı', 'warn'),
                  mic && !p.selfMute && badge(`Mikrofon ${mic.muted ? 'sessiz' : 'açık'}${trackText(mic) ? ` · ${trackText(mic)}` : ''}`),
                  p.tracks && p.tracks.length === 0 && badge('LiveKit: iz yok', 'muted'),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
  return cards;
}

/** Tıklanabilir satır: fare ve klavye (Enter / boşluk) */
function rowOpen(fn) {
  return {
    click: fn,
    keydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    },
  };
}

/** Ölçüm hücresi (ad + değer), kötü değer renklidir */
const metric = (name, value, tone) => h('div', `adm-metric${tone ? ` adm-metric-${tone}` : ''}`, h('span', null, name), h('b', null, value));
const toneOf = (v, warn, bad) => (v === null || v === undefined ? undefined : v >= bad ? 'bad' : v >= warn ? 'warn' : undefined);

function micText(mic) {
  if (!mic) return '—';
  const name = NOISE[mic.noise] ?? mic.noise;
  const load = mic.load !== null && mic.load !== undefined ? ` · %${nf.format(Math.round(mic.load * 100))} yük` : '';
  return `${mic.muted ? 'Kapalı · ' : ''}${name}${load}`;
}

function screenText(s) {
  if (!s) return null;
  const size = s.width && s.height ? `${s.width}×${s.height}` : '';
  const encode = s.encodeMs !== null && s.encodeMs !== undefined ? `${dec(s.encodeMs)} ms/kare` : '';
  return [size, s.fps !== null ? `${dec(s.fps)} fps` : '', bits(s.bitrate), s.encoder ?? '', encode].filter(Boolean).join(' · ');
}

/** İzlenen yayın: kodek, çözücü (donanım/yazılım), çözünürlük, çözme süresi */
function watchText(w) {
  if (!w) return null;
  const kind = w.hardware === true ? 'Donanım' : w.hardware === false ? 'Yazılım' : 'Bilinmiyor';
  const codec = w.codec ? (w.codec.split('/')[1] ?? w.codec) : '';
  const size = w.width && w.height ? `${w.width}×${w.height}${w.fps !== null ? `@${dec(w.fps, 0)}` : ''}` : '';
  const decode = w.decodeMs !== null ? `${dec(w.decodeMs)} ms/kare${w.decodeMsMax !== null ? ` (en çok ${dec(w.decodeMsMax)})` : ''}` : '';
  const view = w.view ? (w.view.mode === 'fullscreen' ? 'tam ekran' : 'küçük') : '';
  return [codec, `${kind}${w.decoder ? ` (${w.decoder})` : ''}`, size, decode, bits(w.bitrate), w.framesDropped ? `${num(w.framesDropped)} atılan` : '', view]
    .filter(Boolean)
    .join(' · ');
}

/** Gelen sesler: kaç kişi, ses kaybı, gizleme olayı, titreşim (en çok), tampon, bit hızı */
function audioInText(a) {
  if (!a) return null;
  return [
    `${num(a.streams)} ses`,
    `kayıp ${pct(a.lossPct, 2)}`,
    a.concealEvents !== null ? `${num(a.concealEvents)} gizleme` : '',
    a.jitterMaxMs !== null ? `titreşim en çok ${msText(a.jitterMaxMs)}` : '',
    a.jitterBufferMs !== null ? `tampon ${msText(a.jitterBufferMs)}` : '',
    bits(a.bitrate),
  ]
    .filter(Boolean)
    .join(' · ');
}

const lagText = (l) => (l ? `en çok ${msText(l.maxMs)} · p95 ${msText(l.p95Ms)}${l.stalls ? ` · ${num(l.stalls)} takılma` : ''}` : null);

/** Sesi bozabilecek ayarlar: kapalı yankı/kazanç, ses algılama, gürültü, seviyeler */
function settingsText(s) {
  if (!s) return null;
  const onOff = (v) => (v === true ? 'açık' : v === false ? 'kapalı' : '?');
  const vad = s.voiceActivity === false ? 'kapalı' : s.vadAuto ? 'otomatik' : s.vadThresholdDb !== null && s.vadThresholdDb !== undefined ? `${s.vadThresholdDb} dB` : '?';
  return [
    `yankı ${onOff(s.echoCancellation)}`,
    `kazanç ${onOff(s.autoGainControl)}`,
    s.inputMode === 'ptt' ? 'bas-konuş' : `algılama ${vad}`,
    s.noiseMode ? `gürültü ${s.noiseMode}${s.noiseStrengthDb ? ` ${s.noiseStrengthDb} dB` : ''}` : '',
    s.speaker === true ? 'hoparlör' : s.speaker === false ? 'ahize' : '',
    s.userVolumesChanged ? `${num(s.userVolumesChanged)} kişi seviyesi değişik (en çok ${percent(s.userVolumeMax)})` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Yazılım çözücü yalnızca telefonda uyarı (ısınma ve pil); masaüstünde olağan */
const watchTone = (e) => (e.watch?.hardware === false && (e.platform === 'android' || e.platform === 'ios') ? 'warn' : undefined);

const LIMIT = { cpu: 'işlemci', bandwidth: 'bant genişliği', other: 'diğer' };

/** Kişi başına ölçüm hücreleri (canlı tablo ve ayrıntı sayfası) */
function metricsOf(q) {
  return h(
    'div',
    'adm-metrics',
    metric('Ping', q.rttMax !== null && q.rttMax !== q.rttAvg ? `${msText(q.rttAvg)} (en çok ${nf.format(q.rttMax)})` : msText(q.rttAvg), toneOf(q.rttAvg, 120, 250)),
    metric('Titreşim', msText(q.jitterIn), toneOf(q.jitterIn, 30, 60)),
    metric('Kayıp ↑ / ↓', `${pct(q.lossOut, 1)} / ${pct(q.lossIn, 1)}`, toneOf(Math.max(q.lossOut ?? 0, q.lossIn ?? 0), 3, 10)),
    metric('Ses kesilmesi', pct(q.concealed, 2), toneOf(q.concealed, 3, 8)),
    metric('Bit hızı ↑ / ↓', `${bits(q.bitrateOut)} / ${bits(q.bitrateIn)}`),
    metric('Bağlantı yolu', routeText(q.candidate, q.protocol), q.candidate === 'relay' ? 'warn' : undefined),
    metric('Mikrofon', micText(q.mic), toneOf(q.mic?.load, 0.6, 0.8)),
    q.screen && metric('Yayın', screenText(q.screen)),
    q.screen &&
      q.screen.limitation !== 'none' &&
      metric('Yayın kısıtı', `${LIMIT[q.screen.limitation] ?? q.screen.limitation} · ${percent(q.screen.limitedRatio)}`, toneOf(q.screen.limitedRatio, 0.3, 0.5)),
    q.watch && metric('İzlenen yayın', watchText(q.watch), watchTone(q)),
    q.audioIn && metric('Gelen sesler', audioInText(q.audioIn), toneOf(q.audioIn.lossPct, 3, 10)),
    q.jsLag && metric('Uygulama takılması', lagText(q.jsLag), toneOf(q.jsLag.maxMs, 250, 1000)),
    q.settings && metric('Ses ayarları', settingsText(q.settings)),
    q.reconnects > 0 && metric('Yeniden bağlanma', num(q.reconnects), 'bad'),
    metric('Cihaz', `${PLATFORM[q.platform] ?? q.platform} ${q.version}`),
  );
}

function quality(d, now) {
  const list = [...(d.voice.quality ?? [])];
  const users = new Map();
  for (const c of d.voice.channels) for (const p of c.participants) users.set(p.userId, p.user);
  for (const u of d.clients.users) if (!users.has(u.user.id)) users.set(u.user.id, u.user);
  const rank = { poor: 0, warn: 1, ok: 2 };
  list.sort((a, b) => rank[a.severity] - rank[b.severity] || (users.get(a.userId)?.displayName ?? '').localeCompare(users.get(b.userId)?.displayName ?? '', 'tr'));
  const counts = { ok: 0, warn: 0, poor: 0 };
  for (const q of list) counts[q.severity]++;
  if (list.length === 0) {
    return [
      h(
        'article',
        'adm-card adm-wide adm-empty',
        'Şu an ölçüm gönderen yok. İstemciler (0.7.0 ve sonrası) sesliyken 30 saniyede bir, bağlantı kötüleşince hemen kısa bir özet gönderir.',
      ),
    ];
  }
  const inVoice = new Set(d.voice.channels.flatMap((c) => c.participants.map((p) => p.userId)));
  return [
    h(
      'article',
      `adm-card adm-wide${counts.poor ? ' adm-tone-bad' : counts.warn ? ' adm-tone-warn' : ''}`,
      h('div', 'adm-label', 'Ölçüm gönderenler (son 90 sn)'),
      h(
        'div',
        'adm-stats',
        [
          ['ok', 'İyi'],
          ['warn', 'İdare eder'],
          ['poor', 'Kötü'],
        ].map(([key, label]) => h('div', `adm-stat adm-stat-${key}`, h('b', null, num(counts[key])), h('span', null, label))),
      ),
    ),
    panel(
      'Kişi başına son ölçüm',
      h(
        'ul',
        'adm-rows',
        list.map((q) => {
          const u = users.get(q.userId) ?? null;
          const [label, tone] = SEVERITY[q.severity];
          return h(
            'li',
            { class: 'adm-qrow adm-clickable', tabindex: 0, role: 'button', on: rowOpen(() => openTelemetry(q.userId, u)) },
            h(
              'div',
              'adm-qhead',
              avatar(u, 28),
              h('div', 'adm-row-title', userName(u), u && h('span', 'adm-muted', ` @${u.username}`), badge(label, tone), !inVoice.has(q.userId) && badge('seste değil', 'muted')),
              h('span', 'adm-muted adm-push adm-nowrap', ago(q.at, now)),
            ),
            q.causes.length > 0 && h('div', 'adm-sub', q.causes.join(' · ')),
            metricsOf(q),
          );
        }),
      ),
      h('div', 'adm-sub adm-note', 'Ayrıntı ve son bir saatin grafikleri için kişiye dokun.'),
    ),
  ];
}

function incidentRow(i, x, now) {
  const u = x.users[i.userId] ?? null;
  const channel = i.channelId ? x.channels[i.channelId]?.name : null;
  // Bağlantı yolu ayrı rozette gösterilir
  const [main, ...rest] = i.causes.filter((c) => !c.cause.startsWith('TURN aktarıcısı'));
  const w = i.worst;
  return h(
    'li',
    {
      class: 'adm-row adm-row-top adm-clickable',
      tabindex: 0,
      role: 'button',
      on: rowOpen(() => openTelemetry(i.userId, u, now - i.end > 3_600_000 ? serverDay(i.start) : null)),
    },
    avatar(u, 28),
    h(
      'div',
      'adm-row-main',
      h('div', 'adm-row-title', userName(u), i.open && badge('sürüyor', 'live')),
      h('div', 'adm-sub', `${dateTime(i.start)} – ${clock(i.end)} · ${duration((i.end - i.start) / 1000)}${channel ? ` · 🔊 ${channel}` : ''}`),
      h(
        'div',
        'adm-badges',
        main && badge(main.cause, 'warn'),
        rest.slice(0, 3).map((c) => badge(c.cause)),
        w.rttMs !== null && badge(`ping ${nf.format(w.rttMs)} ms`),
        w.lossOutPct ? badge(`kayıp ↑ ${pct(w.lossOutPct)}`) : null,
        w.lossInPct ? badge(`kayıp ↓ ${pct(w.lossInPct)}`) : null,
        w.concealedPct ? badge(`kesilme ${pct(w.concealedPct)}`) : null,
        badge(`${PLATFORM[i.platform] ?? i.platform} ${i.version}`, 'muted'),
        i.candidate && badge(routeText(i.candidate, i.protocol), i.candidate === 'relay' ? 'warn' : 'muted'),
      ),
    ),
  );
}

function incidents(x) {
  const now = x.now;
  const st = x.storage;
  const pick = (days) => {
    ui.incidentDays = days;
    delete extra.data.ses;
    void loadExtra(true);
  };
  return [
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Kötü kalite dönemleri: kim, ne zaman, ne kadar, olası neden'),
      chips(
        [
          [1, 'Son 24 saat'],
          [7, '7 gün'],
          [30, '30 gün'],
        ],
        ui.incidentDays,
        pick,
        'Dönem',
      ),
      x.incidents.length === 0
        ? h('div', 'adm-sub', 'Bu dönemde kalite sorunu yok.')
        : h(
            'ul',
            'adm-rows',
            x.incidents.slice(0, 60).map((i) => incidentRow(i, x, now)),
          ),
      h(
        'div',
        'adm-sub adm-note',
        `Ölçümler ${num(st.retentionDays)} gün saklanır (${num(st.files)} gün dosyası, ${bytes(st.bytes)}). Son 24 saatte ${num(st.reports24h)} özet` +
          `${st.dropped ? ` · boyut sınırı yüzünden yazılmayan ${num(st.dropped)}` : ''}.`,
      ),
    ),
  ];
}

function system(d, now) {
  const s = d.system;
  const p = s.process;
  const hist = s.history;
  // Son ölçüm hesaplanamadıysa (ör. sunucu yeni başladı) geçmişteki en son değer
  const latest = (value, key) => value ?? hist.findLast((x) => x[key] !== null && x[key] !== undefined)?.[key] ?? null;
  const processCard = card({
    label: 'Çalışma süresi',
    value: duration(s.hostUptimeSec ?? p.uptimeSec),
    unit: s.hostUptimeSec !== null ? 'makine' : 'API',
    compact: true,
    sub: [`API ${duration(p.uptimeSec)} · ${bytes(p.rss)} bellek`, `Node ${p.node}`],
  });
  if (!s.available) {
    return [
      card({
        label: 'Makine',
        value: 'Bilgi yok',
        tone: 'warn',
        sub: 'Makine bilgileri yalnızca Linux sunucuda (/proc) okunabilir.',
      }),
      processCard,
    ];
  }
  const mem = s.memory;
  const disk = s.disk;
  const net = s.network;
  const cards = [
    card({
      label: 'İşlemci',
      value: percent(latest(s.cpu?.usage, 'cpu')),
      sub: s.cpu?.load
        ? `Yük ${s.cpu.load.map((l) => nf2.format(l)).join(' · ')} (${num(s.cpu.cores)} çekirdek)`
        : `${num(s.cpu?.cores ?? 0)} çekirdek`,
      children: sparkline(series(hist, 'cpu'), { max: 1, format: percent, label: 'İşlemci kullanımı, son dakikalar' }),
    }),
  ];
  if (mem) {
    const used = mem.total - mem.available;
    cards.push(
      card({
        label: 'Bellek',
        value: bytes(used),
        unit: `/ ${bytes(mem.total)}`,
        sub: `${bytes(mem.available)} kullanılabilir`,
        children: [
          meter(used / mem.total, 'Bellek doluluğu'),
          sparkline(series(hist, 'memUsed'), { max: mem.total, format: bytes, label: 'Kullanılan bellek, son dakikalar', color: 'ok' }),
        ],
      }),
    );
  }
  if (net) {
    // Gelen ve giden aynı ölçekte (karşılaştırılabilsin)
    const top = Math.max(1, ...hist.flatMap((x) => [x.rxBps ?? 0, x.txBps ?? 0]));
    const half = (arrow, name, key, value, color) =>
      h(
        'div',
        'adm-net',
        h('div', 'adm-net-head', h('span', 'adm-muted', name), h('b', null, `${arrow} ${rate(value)}`)),
        sparkline(series(hist, key), { max: top, format: rate, label: `${name} trafik, son dakikalar`, color }),
      );
    cards.push(
      card({
        label: `Ağ (${net.interfaces.join(', ') || '—'})`,
        children: [half('↓', 'Gelen', 'rxBps', latest(net.rxBps, 'rxBps'), 'brand'), half('↑', 'Giden', 'txBps', latest(net.txBps, 'txBps'), 'pink')],
      }),
    );
  }
  if (disk) {
    cards.push(
      card({
        label: 'Disk (veri)',
        compact: true,
        value: bytes(disk.used),
        unit: `/ ${bytes(disk.total)}`,
        sub: `${bytes(disk.free)} boş`,
        children: meter(disk.used / Math.max(1, disk.used + disk.free), 'Disk doluluğu'),
      }),
    );
  }
  const t = s.traffic;
  if (t) {
    const total = t.rx + t.tx;
    const start = new Date(now);
    const monthStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const monthEnd = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
    const elapsed = now - t.since;
    // Ay sonu tahmini: bu ayki ortalama hızla (en az bir günlük veri varsa)
    const projected = elapsed > 86_400_000 ? (total / elapsed) * (monthEnd - t.since) : null;
    cards.push(
      card({
        label: `Bu ayın trafiği (${t.month})`,
        value: bytes(total),
        unit: `/ ${bytes(t.quota)}`,
        tone: total / t.quota >= 0.95 ? 'bad' : total / t.quota >= 0.8 ? 'warn' : undefined,
        children: [
          meter(total / t.quota, 'Aylık trafik kotası'),
          [
            `Gelen ${bytes(t.rx)} · giden ${bytes(t.tx)}`,
            projected !== null && `Bu hızla ay sonunda ~${bytes(projected)} (%${num(Math.round((projected / t.quota) * 100))})`,
            t.since > monthStart + 60_000 && `Sayım ${dateTime(t.since)} tarihinden beri (öncesi bilinmiyor).`,
            t.history.length > 0 &&
              `Önceki aylar: ${t.history
                .slice(-3)
                .reverse()
                .map((m) => `${m.month} ${bytes(m.rx + m.tx)}`)
                .join(' · ')}`,
          ]
            .filter(Boolean)
            .map((line) => h('div', 'adm-sub', line)),
        ],
      }),
    );
  }
  cards.push(processCard);
  return cards;
}

function clients(d, now) {
  const c = d.clients;
  const cards = [
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Açık bağlantılar (platforma göre)'),
      h(
        'div',
        'adm-stats',
        ['desktop', 'android', 'ios'].map((p) =>
          h(
            'div',
            'adm-stat',
            h('b', null, num(c.platforms[p])),
            h('span', null, PLATFORM[p]),
            h('span', null, c.latest[p] ? `son sürüm ${c.latest[p]}` : 'son sürüm bilinmiyor'),
          ),
        ),
      ),
    ),
  ];
  cards.push(
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Bağlı sürümler'),
      c.versions.length === 0
        ? h('div', 'adm-sub', 'Şu an bağlı istemci yok.')
        : h(
            'ul',
            'adm-rows adm-rows-compact',
            c.versions.map((v) =>
              h(
                'li',
                'adm-row',
                h('span', 'adm-row-title', `${PLATFORM[v.platform]} ${v.version ?? '(sürüm bildirmiyor)'}`),
                h('span', 'adm-muted adm-push', `${num(v.sessions)} bağlantı`),
                v.current === true
                  ? badge('güncel', 'ok')
                  : v.current === false
                    ? badge(`eski · son ${c.latest[v.platform]}`, 'warn')
                    : null,
              ),
            ),
          ),
    ),
  );
  const shown = ui.allUsers ? c.users : c.users.slice(0, USERS_SHOWN);
  const more =
    c.users.length > USERS_SHOWN &&
    h(
      'button',
      {
        type: 'button',
        class: 'adm-more',
        on: {
          click: () => {
            ui.allUsers = !ui.allUsers;
            if (lastData) render(lastData);
          },
        },
      },
      ui.allUsers ? 'Daha az göster' : `Tümünü göster (${num(c.users.length)})`,
    );
  cards.push(
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Hesaplar ve son görülme'),
      h(
        'ul',
        'adm-rows',
        shown.map((u) => {
          const devices = u.devices.map((x) => `${PLATFORM[x.platform]} ${x.version ?? ''}${x.idle ? ' (boşta)' : ''}`.trim());
          const last = u.lastPlatform ? `${PLATFORM[u.lastPlatform]} ${u.lastVersion ?? ''}`.trim() : null;
          return h(
            'li',
            'adm-row',
            h('span', { class: `adm-status${u.online ? ' adm-status-on' : ''}`, title: u.online ? 'Bağlı' : 'Bağlı değil' }),
            avatar(u.user, 28),
            h(
              'div',
              'adm-row-main',
              h('div', 'adm-row-title', u.user.displayName, h('span', 'adm-muted', ` @${u.user.username}`), u.user.isAdmin && badge('yönetici')),
              h('div', 'adm-sub', u.online ? devices.join(' · ') : last ? `Son: ${last}` : 'Bu takip başladığından beri bağlanmadı'),
            ),
            h('span', 'adm-muted adm-push adm-nowrap', u.online ? 'bağlı' : ago(u.lastSeen, now)),
          );
        }),
      ),
      more,
    ),
  );
  return cards;
}

function countText(c) {
  return `${num(c.last24h)}${c.capped ? '+' : ''}`;
}

function details(key, summary, body) {
  const el = h('details', 'adm-details', h('summary', null, summary), h('pre', null, body));
  if (ui.openErrors.has(key)) el.open = true;
  el.addEventListener('toggle', () => (el.open ? ui.openErrors.add(key) : ui.openErrors.delete(key)));
  return el;
}

function errors(d, now) {
  const e = d.errors;
  const cards = [
    card({
      label: 'İstemci hataları',
      value: countText(e.client),
      unit: 'son 24 saat',
      compact: true,
      tone: e.client.last24h > 0 ? 'warn' : undefined,
      sub: `Toplam ${num(e.client.total)}`,
    }),
    card({
      label: 'Sunucu hataları',
      value: countText(e.server),
      unit: 'son 24 saat',
      compact: true,
      tone: e.server.last24h > 0 ? 'bad' : undefined,
      sub: `Toplam ${num(e.server.total)} (5xx yanıt)`,
    }),
  ];
  cards.push(
    panel(
      'Son istemci hataları',
      e.client.recent.length === 0
        ? h('div', 'adm-sub', 'Hata yok.')
        : h(
            'ul',
            'adm-rows',
            e.client.recent.map((x) =>
              h(
                'li',
                'adm-row adm-row-top',
                h(
                  'div',
                  'adm-row-main',
                  h(
                    'div',
                    'adm-badges',
                    badge(ago(x.at, now)),
                    badge(`${PLATFORM[x.platform] ?? x.platform} ${x.version}`),
                    badge(x.where),
                    badge(x.user ? `@${x.user}` : 'oturumsuz', 'muted'),
                  ),
                  h('div', 'adm-error-msg', x.message),
                  x.stack && details(`c${x.at}${x.message}`, 'Yığın izi', x.stack),
                ),
              ),
            ),
          ),
    ),
  );
  cards.push(
    panel(
      'Son sunucu hataları (5xx)',
      e.server.recent.length === 0
        ? h('div', 'adm-sub', 'Hata yok.')
        : h(
            'ul',
            'adm-rows',
            e.server.recent.map((x) =>
              h(
                'li',
                'adm-row adm-row-top',
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-badges', badge(ago(x.at, now)), badge(String(x.status), 'warn'), badge(`${x.method} ${x.route}`)),
                  x.message && h('div', 'adm-error-msg', x.message),
                ),
              ),
            ),
          ),
    ),
  );
  return cards;
}

/** Sunucu günlüğündeki hata ve ölümcül kayıtlar (Hatalar sekmesi; /api/admin/api-stats) */
function serverLogs(a) {
  const now = a.now;
  const logs = a.logs;
  return [
    panel(
      `Hata ve ölümcül kayıtlar (toplam ${num(logs.total)}, ${dateTime(a.since)} tarihinden beri)`,
      logs.recent.length === 0
        ? h('div', 'adm-sub', 'Kayıt yok.')
        : h(
            'ul',
            'adm-rows',
            logs.recent.map((x) =>
              h(
                'li',
                'adm-row adm-row-top',
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-badges', badge(ago(x.at, now)), badge(x.level >= 60 ? 'ölümcül' : 'hata', x.level >= 60 ? 'live' : 'warn')),
                  h('div', 'adm-error-msg', x.msg || '(ileti yok)'),
                  x.err && h('div', 'adm-sub', x.err),
                  x.stack && details(`l${x.at}${x.msg}`, 'Yığın izi', x.stack),
                ),
              ),
            ),
          ),
    ),
  ];
}

// ---------- Ses kalitesi ayrıntısı (kişi başına) ----------

const sheet = { timer: null, reload: null, seq: 0 };

function openSheet(title, onClose) {
  $('adm-sheet-title').textContent = title;
  $('adm-sheet-body').replaceChildren(h('div', 'adm-sub', 'Yükleniyor…'));
  $('adm-sheet').hidden = false;
  document.body.classList.add('adm-sheet-open');
  sheet.onClose = onClose ?? null;
  $('adm-sheet-close').focus();
}

function closeSheet() {
  clearTimeout(sheet.timer);
  sheet.seq++;
  sheet.reload = null;
  if ($('adm-sheet').hidden) return;
  $('adm-sheet').hidden = true;
  document.body.classList.remove('adm-sheet-open');
  sheet.onClose?.();
  sheet.onClose = null;
}

$('adm-sheet-close').addEventListener('click', closeSheet);
$('adm-sheet').addEventListener('click', (e) => {
  if (e.target === $('adm-sheet')) closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('adm-sheet').hidden) closeSheet();
});

/** Kişinin son bir saati (date: null) ya da geçmiş bir günü */
function openTelemetry(userId, user, date = null) {
  openSheet(`${userName(user, 'Kullanıcı')} · bağlantı kalitesi`);
  const state = { date };
  const seq = ++sheet.seq;
  const load = async () => {
    clearTimeout(sheet.timer);
    if (seq !== sheet.seq) return;
    try {
      const params = new URLSearchParams({ user: userId, ...(state.date ? { date: state.date } : { minutes: '60' }) });
      const x = await apiGet(`/api/admin/telemetry?${params}`);
      if (seq !== sheet.seq) return;
      $('adm-sheet-title').textContent = `${userName(x.user, 'Kullanıcı')} · bağlantı kalitesi`;
      const scroll = $('adm-sheet-body').scrollTop;
      $('adm-sheet-body').replaceChildren(...telemetryDetail(x, state, load));
      $('adm-sheet-body').scrollTop = scroll;
    } catch (err) {
      if (err instanceof AccessError || seq !== sheet.seq) return;
      $('adm-sheet-body').replaceChildren(h('div', 'adm-sub', `Veri alınamadı: ${err.message}`));
    }
    // Canlı görünüm 15 sn'de bir yenilenir
    if (!state.date && seq === sheet.seq && !document.hidden) sheet.timer = setTimeout(load, 15_000);
  };
  sheet.reload = load;
  void load();
}

function telemetryDetail(x, state, reload) {
  const entries = x.entries;
  const now = x.now;
  const pickDay = (day) => {
    state.date = day;
    $('adm-sheet-body').replaceChildren(h('div', 'adm-sub', 'Yükleniyor…'));
    void reload();
  };
  const today = serverDay(now);
  const dayOptions = [[null, 'Son 1 saat'], ...x.days.slice(0, 14).map((d) => [d, d === today ? 'Bugün (tümü)' : d.slice(5).split('-').reverse().join('.')])];
  const out = [chips(dayOptions, state.date, pickDay, 'Dönem')];
  if (entries.length === 0) {
    out.push(h('div', 'adm-card adm-empty', state.date ? 'Bu gün için ölçüm yok.' : 'Son bir saatte ölçüm yok (kişi seste değil ya da eski sürüm kullanıyor).'));
  } else {
    const poor = entries.filter((e) => e.severity === 'poor').length;
    const warn = entries.filter((e) => e.severity === 'warn').length;
    const last = entries.at(-1);
    out.push(
      h(
        'div',
        'adm-sub',
        `${num(entries.length)} özet · ${num(poor)} kötü · ${num(warn)} idare eder${x.truncated ? ' · (ilk 3000 kayıt)' : ''}` +
          ` · son: ${dateTime(last.at)} · ${PLATFORM[last.platform] ?? last.platform} ${last.version}`,
      ),
    );
    // Zaman çizelgesi: her özet bir dilim (yeşil iyi, sarı idare eder, kırmızı kötü); boşluklar ölçüm yok
    const from = entries[0].at - entries[0].windowSec * 1000;
    const span = Math.max(1, last.at - from);
    const strip = h('div', { class: 'adm-timeline', role: 'img', 'aria-label': 'Bağlantı kalitesi zaman çizelgesi' });
    for (const e of entries) {
      const seg = h('span', { class: `adm-tl adm-tl-${e.severity}`, title: `${clock(e.at, true)} · ${SEVERITY[e.severity][0]}${e.causes.length ? ` · ${e.causes[0]}` : ''}` });
      const start = Math.max(from, e.at - e.windowSec * 1000);
      seg.style.left = `${(((start - from) / span) * 100).toFixed(2)}%`;
      seg.style.width = `${Math.max(0.4, ((e.at - start) / span) * 100).toFixed(2)}%`;
      strip.append(seg);
    }
    out.push(
      h(
        'div',
        'adm-card',
        h('div', 'adm-label', 'Kalite zaman çizelgesi'),
        strip,
        h('div', 'adm-axis', h('span', null, span > DAY_MS ? dateTime(from) : clock(from)), h('span', null, clock(last.at))),
      ),
    );
    out.push(h('div', 'adm-card', h('div', 'adm-label', `Son özet (${clock(last.at, true)})`), last.causes.length > 0 && h('div', 'adm-sub', last.causes.join(' · ')), metricsOf(last)));
    const chart = (label, key, format, opts = {}) => {
      const pts = entries.map((e) => ({ at: e.at, v: typeof key === 'function' ? key(e) : e[key] }));
      if (!pts.some((p) => p.v !== null && p.v !== undefined)) return null;
      const lastV = pts.findLast((p) => p.v !== null && p.v !== undefined)?.v;
      return h(
        'div',
        'adm-card adm-chart',
        h('div', 'adm-net-head', h('span', 'adm-muted', label), h('b', null, format(lastV))),
        sparkline(pts, { format, label, axis: true, ...opts }),
      );
    };
    out.push(
      h(
        'div',
        'adm-chart-grid',
        chart('Ping (ortalama)', 'rttAvg', msText, { max: 100 }),
        chart('Ping (en yüksek)', 'rttMax', msText, { max: 100, color: 'pink' }),
        chart('Titreşim (gelen)', 'jitterIn', msText, { max: 20, color: 'ok' }),
        chart('Paket kaybı ↑ (giden)', 'lossOut', (v) => pct(v, 2), { max: 5, color: 'pink' }),
        chart('Paket kaybı ↓ (gelen)', 'lossIn', (v) => pct(v, 2), { max: 5, color: 'pink' }),
        chart('Ses kesilmesi (gelen)', 'concealed', (v) => pct(v, 2), { max: 5, color: 'pink' }),
        chart('Gelen ses kaybı', (e) => e.audioIn?.lossPct ?? null, (v) => pct(v, 2), { max: 5, color: 'pink' }),
        chart('Gelen ses gizleme olayı', (e) => e.audioIn?.concealEvents ?? null, num, { max: 10, color: 'pink' }),
        chart('Uygulama takılması (en yüksek)', (e) => e.jsLag?.maxMs ?? null, msText, { max: 200, color: 'pink' }),
        chart('Bit hızı ↑', 'bitrateOut', bits),
        chart('Bit hızı ↓', 'bitrateIn', bits, { color: 'ok' }),
        chart('Gürültü engelleyici yükü', (e) => e.mic?.load ?? null, percent, { max: 1 }),
        chart('Yayın kare hızı', (e) => e.screen?.fps ?? null, (v) => `${dec(v)} fps`, { max: 30, color: 'ok' }),
        chart('Yayın bit hızı', (e) => e.screen?.bitrate ?? null, bits, { color: 'pink' }),
        chart('İzlenen yayın: çözme süresi', (e) => e.watch?.decodeMs ?? null, (v) => `${dec(v)} ms/kare`, { max: 10, color: 'pink' }),
        chart('İzlenen yayın: kare hızı', (e) => e.watch?.fps ?? null, (v) => `${dec(v)} fps`, { max: 30, color: 'ok' }),
        chart('Gürültü engelleyici kare süresi', (e) => e.mic?.avgFrameMs ?? null, (v) => `${dec(v, 2)} ms`, { max: 5 }),
        chart('Kullanılabilir yükleme hızı', 'availableOut', bits, { color: 'ok' }),
      ),
    );
    const shown = [...entries].reverse().slice(0, 60);
    out.push(
      panel(
        'Özetler (en yeniler önce)',
        h(
          'ul',
          'adm-rows',
          shown.map((e) =>
            h(
              'li',
              'adm-row adm-row-top',
              h(
                'div',
                'adm-row-main',
                h(
                  'div',
                  'adm-badges',
                  badge(clock(e.at, true)),
                  badge(SEVERITY[e.severity][0], SEVERITY[e.severity][1]),
                  badge(`ping ${msText(e.rttAvg)}`),
                  badge(`kayıp ${pct(e.lossOut, 1)} / ${pct(e.lossIn, 1)}`),
                  e.concealed ? badge(`kesilme ${pct(e.concealed)}`) : null,
                  e.screen && badge(`yayın ${screenText(e.screen)}`, 'live'),
                  e.watch && badge(`izliyor ${watchText(e.watch)}`, watchTone(e)),
                  (e.jsLag?.maxMs ?? 0) >= 250 ? badge(`takılma ${msText(e.jsLag.maxMs)}`, e.jsLag.maxMs >= 1000 ? 'bad' : 'warn') : null,
                  e.channelId && x.channels[e.channelId] && badge(`🔊 ${x.channels[e.channelId].name}`, 'muted'),
                ),
                e.causes.length > 0 && h('div', 'adm-sub', e.causes.join(' · ')),
              ),
            ),
          ),
        ),
      ),
    );
  }
  if (x.incidents.length > 0) {
    out.push(
      panel(
        'Son 14 günün kalite sorunları',
        h(
          'ul',
          'adm-rows',
          x.incidents.slice(0, 20).map((i) =>
            h(
              'li',
              'adm-row adm-row-top',
              h(
                'div',
                'adm-row-main',
                h('div', 'adm-row-title', `${dateTime(i.start)} · ${duration((i.end - i.start) / 1000)}`, i.open && badge('sürüyor', 'live')),
                h('div', 'adm-sub', i.causes.map((c) => c.cause).join(' · ')),
              ),
              x.days.includes(serverDay(i.start)) &&
                h('button', { type: 'button', class: 'adm-more', on: { click: () => pickDay(serverDay(i.start)) } }, 'O günü aç'),
            ),
          ),
        ),
      ),
    );
  }
  return out;
}

// ---------- Ses geçmişi ----------

function voiceHistory(x) {
  const pick = (days) => {
    ui.historyDays = days;
    delete extra.data['ses-gecmisi'];
    void loadExtra(true);
  };
  const t = x.totals;
  const channelName = (id) => x.channelNames[id]?.name ?? 'Silinmiş kanal';
  const maxDay = Math.max(1, ...x.perDay.map((d) => d.voiceMin));
  const caption = h('div', 'adm-sub adm-bars-caption', `Son ${x.days} gün · günlük ses dakikası`);
  const bars = h(
    'div',
    { class: 'adm-bars', role: 'img', 'aria-label': 'Günlük ses süreleri' },
    x.perDay.map((d, i) => {
      const bar = h('span', { class: `adm-bar${d.voiceMin === 0 ? ' adm-bar-zero' : ''}${i === x.perDay.length - 1 ? ' adm-bar-today' : ''}` });
      bar.style.height = `${Math.max(3, (d.voiceMin / maxDay) * 100)}%`;
      const label = `${i === x.perDay.length - 1 ? 'Bugün' : shortDate(d.day)}: ${minutes(d.voiceMin)} ses, ${minutes(d.streamMin)} yayın · ${num(d.users)} kişi · aynı anda en çok ${num(d.peak)}`;
      const showDay = () => (caption.textContent = label);
      bar.addEventListener('pointerenter', showDay);
      bar.addEventListener('pointerdown', showDay);
      return bar;
    }),
  );
  // Isı haritası: haftanın günleri × saatler
  const peak = Math.max(1, ...x.heatmap.flat());
  const heat = h(
    'div',
    { class: 'adm-heat', role: 'img', 'aria-label': 'Haftanın günlerine ve saatlere göre ses süresi' },
    h('span', 'adm-heat-corner'),
    Array.from({ length: 24 }, (_, hr) => h('span', 'adm-heat-hour', hr % 6 === 0 ? String(hr).padStart(2, '0') : '')),
    x.heatmap.map((row, day) => [
      h('span', 'adm-heat-day', WEEKDAYS[day]),
      row.map((v, hr) => {
        const cell = h('span', { class: 'adm-heat-cell', title: `${WEEKDAYS[day]} ${String(hr).padStart(2, '0')}:00 · ${minutes(v)}` });
        if (v > 0) cell.style.background = `rgba(88, 101, 242, ${(0.15 + 0.85 * (v / peak)).toFixed(2)})`;
        return cell;
      }),
    ]),
  );
  const maxUser = Math.max(1, ...x.userStats.map((u) => u.voiceMin));
  return [
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Dönem'),
      chips(
        [
          [1, 'Bugün'],
          [7, '7 gün'],
          [30, '30 gün'],
          [90, '90 gün'],
        ],
        ui.historyDays,
        pick,
        'Dönem',
      ),
      x.trackingSince
        ? h('div', 'adm-sub', `Kayıt ${dateTime(x.trackingSince)} tarihinden beri tutuluyor.`)
        : h('div', 'adm-sub', 'Henüz ses kaydı yok (kayıt bu sürümle başladı).'),
    ),
    card({ label: 'Toplam ses', value: minutes(t.voiceMin), compact: true, sub: `${num(t.sessions)} oturum · ${num(t.users)} kişi` }),
    card({ label: 'Toplam yayın', value: minutes(t.streamMin), compact: true, sub: `${num(t.streams)} yayın · ${num(t.streamers)} kişi` }),
    card({ label: 'Günlük ses', wide: true, children: [bars, caption] }),
    card({ label: 'En yoğun saatler (sizin saat diliminizle)', wide: true, children: heat }),
    panel(
      'Kim ne kadar seste / yayında',
      x.userStats.length === 0
        ? h('div', 'adm-sub', 'Bu dönemde kayıt yok.')
        : h(
            'ul',
            'adm-rows',
            x.userStats.slice(0, 50).map((u) => {
              const bar = h('span');
              bar.style.width = `${((u.voiceMin / maxUser) * 100).toFixed(1)}%`;
              return h(
                'li',
                'adm-row',
                avatar(x.users[u.userId], 28),
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-row-title', userName(x.users[u.userId]), u.online && badge('seste', 'live')),
                  h('div', 'adm-hbar', bar),
                  h('div', 'adm-sub', [`${minutes(u.voiceMin)} ses`, u.streamMin > 0 && `${minutes(u.streamMin)} yayın`, `${num(u.sessions)} oturum`].filter(Boolean).join(' · ')),
                ),
                h('span', 'adm-muted adm-nowrap', ago(u.lastAt, x.to)),
              );
            }),
          ),
    ),
    panel(
      'En çok kullanılan kanallar',
      x.channels.length === 0
        ? h('div', 'adm-sub', 'Kayıt yok.')
        : h(
            'ul',
            'adm-rows adm-rows-compact',
            x.channels.map((c) =>
              h(
                'li',
                'adm-row',
                h('span', 'adm-row-title', `🔊 ${channelName(c.channelId)}`),
                c.guildId && x.guildNames[c.guildId] && h('span', 'adm-muted', x.guildNames[c.guildId]),
                h('span', 'adm-muted adm-push', `${minutes(c.voiceMin)} · ${num(c.users)} kişi · ${num(c.sessions)} oturum`),
              ),
            ),
          ),
    ),
    panel(
      'Son oturumlar',
      x.recent.length === 0
        ? h('div', 'adm-sub', 'Kayıt yok.')
        : h(
            'ul',
            'adm-rows',
            x.recent.map((r) =>
              h(
                'li',
                'adm-row',
                avatar(x.users[r.userId], 24),
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-row-title', userName(x.users[r.userId]), badge(r.kind === 'stream' ? 'yayın' : 'ses', r.kind === 'stream' ? 'live' : undefined), r.open && badge('sürüyor', 'ok')),
                  h('div', 'adm-sub', `🔊 ${channelName(r.channelId)} · ${dateTime(r.start)} · ${duration((r.end - r.start) / 1000)}`),
                ),
              ),
            ),
          ),
    ),
  ];
}

// ---------- Makine sekmesi: kapsayıcılar, LiveKit, kullanım sayaçları ----------

const CONTAINER = { api: 'API', livekit: 'LiveKit', caddy: 'Caddy (HTTPS, TURN/TLS)' };

function infra(x) {
  const now = x.now;
  const cards = [];
  cards.push(
    panel(
      'Kapsayıcılar (işlemci: tek çekirdek oranı)',
      h(
        'ul',
        'adm-rows',
        x.containers.map((c) =>
          h(
            'li',
            'adm-row adm-row-top',
            h(
              'div',
              'adm-row-main',
              h('div', 'adm-row-title', CONTAINER[c.name] ?? c.name, !c.ok && badge('ölçülemiyor', 'muted')),
              c.ok
                ? h('div', 'adm-sub', `İşlemci ${percent(c.cpu)} · bellek ${bytes(c.memory)}${c.memoryLimit ? ` / ${bytes(c.memoryLimit)}` : ''} · kaynak: ${c.source}`)
                : h('div', 'adm-sub', c.error ?? '—'),
              c.ok &&
                sparkline(
                  x.history.map((s) => ({ at: s.at, v: s[c.name] })),
                  { max: 0.5, format: percent, label: `${c.name} işlemci kullanımı`, color: c.name === 'livekit' ? 'pink' : c.name === 'caddy' ? 'ok' : 'brand' },
                ),
            ),
          ),
        ),
      ),
    ),
  );
  const net = x.network;
  if (net) {
    if (!net.ok || net.history.length === 0) {
      cards.push(
        card({
          label: 'Makine ağı',
          value: net.ok ? 'Ölçülüyor…' : 'Bilgi yok',
          compact: true,
          tone: net.ok ? undefined : 'warn',
          sub: net.ok ? 'İlk hız ölçümü 15 saniye içinde.' : net.error,
        }),
      );
    } else {
      const nh = net.history;
      const last = nh[nh.length - 1];
      const mbps = (v) => (v === null || v === undefined ? '—' : `${nf1.format(v)} Mb/sn`);
      const top = Math.max(1, ...nh.flatMap((s) => [s.rxMbps ?? 0, s.txMbps ?? 0]));
      const half = (arrow, name, key, color) =>
        h(
          'div',
          'adm-net',
          h('div', 'adm-net-head', h('span', 'adm-muted', name), h('b', null, `${arrow} ${mbps(last[key])}`)),
          sparkline(series(nh, key), { max: top, format: mbps, label: `${name} trafik (makine), son 30 dakika`, color }),
        );
      const peak = (key) => Math.max(0, ...nh.map((s) => s[key] ?? 0));
      const drops = peak('rxDropPerSec');
      cards.push(
        card({
          label: `Makine ağı (${net.iface}, son 30 dk)`,
          sub: [`En yüksek: ↓ ${mbps(peak('rxMbps'))} · ↑ ${mbps(peak('txMbps'))}`],
          children: [half('↓', 'Gelen', 'rxMbps', 'brand'), half('↑', 'Giden', 'txMbps', 'pink')],
        }),
        card({
          label: `Düşen paket ve UDP hataları (${net.iface})`,
          value: perSec(last.rxDropPerSec),
          unit: 'düşen',
          tone: drops >= 50 ? 'bad' : drops >= 5 ? 'warn' : undefined,
          sub: [
            `Paket: ↓ ${dec(last.rxPps, 0)}/sn · ↑ ${dec(last.txPps, 0)}/sn · rx hata ${perSec(last.rxErrPerSec)}`,
            `UDP: gelen ${dec(last.udpInPerSec, 0)}/sn · giden ${dec(last.udpOutPerSec, 0)}/sn`,
            `UDP hata: alma tamponu ${perSec(last.udpRcvbufErrPerSec)} · gönderme tamponu ${perSec(last.udpSndbufErrPerSec)} · toplam ${perSec(last.udpInErrPerSec)}`,
            `30 dk içinde en çok ${perSec(drops)} düşen paket. Dakikalık özetler diskte (telemetry/network-*.jsonl).`,
          ],
          children: sparkline(series(nh, 'rxDropPerSec'), { max: 5, format: perSec, label: 'Düşen paket/sn (rx_dropped)', color: 'pink', axis: true }),
        }),
      );
    }
  }
  const cd = x.caddy;
  cards.push(
    card({
      label: 'Yedek bağlantı (TURN/TLS, 443)',
      value: cd.ok ? num(cd.turnActive ?? 0) : '—',
      unit: cd.ok ? 'açık' : undefined,
      compact: true,
      sub: cd.ok
        ? [`${dec(cd.turnPerMin ?? 0)} yeni/dk · toplam ${num(cd.turnTotal)}`, ...cd.upstreams.map((u) => `${u.upstream}: ${u.healthy ? 'sağlıklı' : 'SAĞLIKSIZ'}`)]
        : cd.error,
      tone: cd.ok && cd.upstreams.some((u) => !u.healthy) ? 'bad' : undefined,
    }),
  );
  const b = x.backups;
  if (b) {
    const age = b.latest ? now - b.latest.at : null;
    cards.push(
      card({
        label: 'Veritabanı yedeği',
        value: b.latest ? ago(b.latest.at, now) : b.configured ? 'Yedek yok' : 'Bilinmiyor',
        compact: true,
        tone: !b.configured ? undefined : age === null || age > 26 * 3_600_000 ? 'bad' : 'ok',
        sub: b.configured
          ? [
              b.latest && `${dateTime(b.latest.at)} · ${bytes(b.latest.size)}`,
              `${num(b.count)} yedek · toplam ${bytes(b.totalBytes)}`,
              b.attachmentsAt && `Ek/avatar anlık görüntüsü ${ago(Math.max(b.attachmentsAt, b.avatarsAt ?? 0), now)}`,
              b.error,
            ]
          : [b.error ?? 'Yedek klasörü bağlı değil'],
      }),
    );
  }
  if (x.tls.length > 0) {
    cards.push(
      panel(
        'TLS sertifikaları',
        h(
          'ul',
          'adm-rows adm-rows-compact',
          x.tls.map((t) =>
            h(
              'li',
              'adm-row',
              h('span', 'adm-row-title', t.domain),
              h('span', 'adm-muted', t.ok ? `${t.issuer ?? ''} · ${shortDate(t.validTo)} tarihine kadar` : t.error),
              h(
                'span',
                'adm-push',
                t.ok ? badge(`${num(t.daysLeft)} gün`, t.daysLeft < 7 ? 'live' : t.daysLeft < 14 ? 'warn' : 'ok') : badge('denetlenemedi', 'warn'),
                t.ok && !t.authorized && badge('doğrulanmadı', 'warn'),
              ),
            ),
          ),
        ),
        h('div', 'adm-sub adm-note', `Son denetim ${ago(x.tls[0].checkedAt, now)} (6 saatte bir). Caddy sertifikaları süresi dolmadan kendisi yeniler.`),
      ),
    );
  }
  return cards;
}

function livekit(x) {
  const m = x.livekit;
  if (!m.configured || !m.ok) {
    return [
      h(
        'article',
        'adm-card adm-wide adm-tone-warn',
        h('div', 'adm-label', 'LiveKit ölçümleri'),
        h('div', 'adm-value adm-value-sm', 'Metrikler kapalı'),
        h('div', 'adm-sub', m.error ?? ''),
        h(
          'div',
          'adm-sub adm-note',
          'Açmak için infra/livekit.yaml içinde ',
          h('b', null, 'prometheus: port: 6789'),
          ' olmalı ve LiveKit yeniden başlatılmalı (görüşmeler birkaç saniye kopar). Port güvenlik duvarıyla dışarıya kapalıdır; API yalnızca 127.0.0.1\'den okur.',
        ),
      ),
    ];
  }
  const hist = m.history;
  const l = m.latest;
  const top = Math.max(1, ...hist.flatMap((s) => [s.bytesIn ?? 0, s.bytesOut ?? 0]));
  const pair = (arrow, name, key, value, color, fmt, max) =>
    h('div', 'adm-net', h('div', 'adm-net-head', h('span', 'adm-muted', name), h('b', null, `${arrow} ${fmt(value)}`)), sparkline(series(hist, key), { max, format: fmt, label: name, color }));
  const tracks = (o) => Object.entries(o ?? {}).map(([k, n]) => `${k === 'audio' ? 'ses' : k === 'video' ? 'görüntü' : k} ${num(n)}`).join(' · ') || '0';
  return [
    card({
      label: 'Medya trafiği',
      children: [pair('↓', 'Gelen (yayıncılardan)', 'bytesIn', l.bytesIn, 'brand', rate, top), pair('↑', 'Giden (izleyicilere)', 'bytesOut', l.bytesOut, 'pink', rate, top)],
    }),
    card({
      label: 'Paketler',
      children: [
        pair('↓', 'Gelen', 'packetsIn', l.packetsIn, 'brand', perSec),
        pair('↑', 'Giden', 'packetsOut', l.packetsOut, 'pink', perSec),
      ],
    }),
    card({
      label: 'Paket kaybı',
      value: pct(l.lossInPct, 2),
      unit: 'gelen',
      tone: (l.lossInPct ?? 0) >= 5 ? 'bad' : (l.lossInPct ?? 0) >= 2 ? 'warn' : undefined,
      sub: `Giden ${pct(l.lossOutPct, 2)} · ${perSec(l.lossIn)} kayıp paket`,
      children: sparkline(series(hist, 'lossInPct'), { max: 2, format: (v) => pct(v, 2), label: 'Gelen paket kaybı', color: 'pink' }),
    }),
    card({
      label: 'Yeniden gönderme / anahtar kare',
      value: perSec(l.nack),
      unit: 'NACK',
      sub: `PLI ${perSec(l.pli)} · FIR ${perSec(l.fir)}`,
      children: sparkline(series(hist, 'nack'), { max: 5, format: perSec, label: 'NACK/sn' }),
    }),
    card({
      label: 'Gecikme ve titreşim (sunucudan)',
      value: msText(l.rttMs),
      unit: 'RTT',
      sub: `Titreşim ${msText(l.jitterMs)}`,
      children: sparkline(series(hist, 'rttMs'), { max: 50, format: msText, label: 'RTT', color: 'ok' }),
    }),
    card({
      label: 'Odalar',
      value: num(l.rooms),
      unit: 'oda',
      compact: true,
      sub: [`${num(l.participants)} katılımcı`, `Yayınlanan: ${tracks(l.tracksPublished)}`, `Abone: ${tracks(l.tracksSubscribed)}`, l.joinsPerMin !== null && `${dec(l.joinsPerMin)} katılım/dk`],
    }),
    card({
      label: 'LiveKit süreci',
      value: percent(l.cpu),
      unit: 'işlemci',
      compact: true,
      sub: [`${bytes(l.rss)} bellek`, l.goroutines !== null && `${num(l.goroutines)} goroutine`],
    }),
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-label', 'Tüm LiveKit ölçümleri (ham toplamlar)'),
      details('lk-raw', `${num(m.raw.length)} ölçüm`, m.raw.map((r) => `${r.name} ${r.value}`).join('\n')),
      h('div', 'adm-sub', `Son ölçüm ${clock(m.lastOkAt, true)} · 10 saniyede bir`),
    ),
  ];
}

function usage(x) {
  const p = x.push;
  const sum = (o, prefix) => Object.entries(o).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);
  const pushLine = (label, key) =>
    h(
      'div',
      'adm-kv',
      h('span', null, label),
      h('b', null, `${num(sum(p.counts.day, key))} / ${num(sum(p.counts.week, key))} / ${num(sum(p.counts.month, key))}`),
    );
  const tokens = Object.fromEntries(p.tokens.map((t) => [t.platform, t]));
  const d = x.downloads.counts;
  const u = x.updates;
  const dl = (name) => `${num(d.day[name] ?? 0)} / ${num(d.week[name] ?? 0)} / ${num(d.month[name] ?? 0)}`;
  const three = (o, key) => `${num(o.day[key] ?? 0)} / ${num(o.week[key] ?? 0)} / ${num(o.month[key] ?? 0)}`;
  const platforms = [...new Set([...Object.keys(d.month)].filter((k) => k !== 'page'))].sort();
  return [
    card({
      label: 'Telefon bildirimleri',
      value: p.enabled ? num(sum(p.counts.day, 'android.sent') + sum(p.counts.day, 'ios.sent')) : 'Kapalı',
      unit: p.enabled ? 'bugün gönderildi' : undefined,
      tone: p.enabled && sum(p.counts.day, 'android.failed') + sum(p.counts.day, 'ios.failed') > 0 ? 'warn' : undefined,
      children: [
        h(
          'div',
          'adm-kvs',
          h('div', 'adm-sub', 'Bugün / 7 gün / 30 gün'),
          pushLine('Android gönderildi', 'android.sent'),
          pushLine('Android başarısız', 'android.failed'),
          pushLine('Android geçersiz jeton', 'android.unregistered'),
          pushLine('iOS gönderildi', 'ios.sent'),
          pushLine('iOS başarısız', 'ios.failed'),
          kv('Kayıtlı cihaz', `Android ${num(tokens.android?.n ?? 0)} · iOS ${num(tokens.ios?.n ?? 0)}`),
        ),
        sparkline(
          p.daily.sent.map((s) => ({ at: Date.parse(`${s.day}T12:00:00Z`), v: s.count })),
          { max: 1, format: (v) => `${num(v)} bildirim`, label: 'Günlük bildirim, son 14 gün' },
        ),
      ],
    }),
    card({
      label: 'İndirme sayfası ve indirmeler',
      value: num(d.day.page ?? 0),
      unit: 'ziyaret bugün',
      children: h(
        'div',
        'adm-kvs',
        h('div', 'adm-sub', 'Bugün / 7 gün / 30 gün'),
        kv('Sayfa ziyareti', dl('page')),
        platforms.length === 0 ? h('div', 'adm-sub', 'Henüz indirme yok.') : platforms.map((pl) => kv(pl, dl(pl))),
      ),
    }),
    card({
      label: 'Güncellemeler',
      value: num(u.desktop.day.check ?? 0),
      unit: 'masaüstü denetimi bugün',
      children: h(
        'div',
        'adm-kvs',
        h('div', 'adm-sub', 'Bugün / 7 gün / 30 gün'),
        kv('Masaüstü denetimi', three(u.desktop, 'check')),
        kv('Masaüstü kurulum indirmesi', three(u.desktop, 'download')),
        kv('Android OTA denetimi', three(u.ota, 'android.check')),
        kv('Android OTA güncellemesi', three(u.ota, 'android.served')),
        kv('iOS OTA denetimi', three(u.ota, 'ios.check')),
        kv('Sürüm sorgusu (tümü)', `${num(sum(u.version.day, ''))} / ${num(sum(u.version.week, ''))} / ${num(sum(u.version.month, ''))}`),
      ),
    }),
    h('p', 'adm-sub adm-wide', `Sayaçlar ${dateTime(x.countersSince)} tarihinden beri (günler Türkiye saatine göre).`),
  ];
}

// ---------- API sağlığı ----------

function apiHealth(a) {
  const now = a.now;
  const lh = a.lastHour;
  const g = a.gateway;
  const gh = a.gatewayHistory;
  const lastG = gh.at(-1) ?? {};
  const closes = Object.entries(g.closes)
    .sort((x, y) => y[1] - x[1])
    .map(([code, n]) => `${code}: ${num(n)}`)
    .join(' · ');
  return [
    card({
      label: 'İstekler (dakikada)',
      value: num(a.perMinute.at(-1)?.total ?? 0),
      unit: 'bu dakika',
      sub: `Son 1 saatte ${num(lh.total)} · başlangıçtan beri ${num(a.totals.requests)}`,
      children: sparkline(
        a.perMinute.map((m) => ({ at: m.minute, v: m.total })),
        { max: 10, format: (v) => `${num(v)} istek/dk`, label: 'Dakikadaki istekler, son saat', seconds: false },
      ),
    }),
    card({
      label: 'Durum kodları (son 1 saat)',
      value: num(lh.s5),
      unit: '5xx',
      tone: lh.s5 > 0 ? 'bad' : lh.limited > 0 ? 'warn' : undefined,
      children: [
        h('div', 'adm-kvs', kv('2xx', num(lh.s2)), kv('3xx', num(lh.s3)), kv('4xx', num(lh.s4)), kv('429 (sınır aşımı)', num(lh.limited), lh.limited ? 'warn' : undefined), kv('5xx', num(lh.s5), lh.s5 ? 'bad' : undefined)),
        sparkline(
          a.perMinute.map((m) => ({ at: m.minute, v: m.s4 + m.s5 })),
          { max: 1, format: (v) => `${num(v)} hata/dk`, label: '4xx ve 5xx, son saat', color: 'pink', seconds: false },
        ),
      ],
    }),
    card({
      label: 'Olay döngüsü gecikmesi',
      value: a.eventLoop ? `${dec(a.eventLoop.p99)} ms` : '—',
      unit: 'p99',
      compact: true,
      tone: a.eventLoop && a.eventLoop.p99 > 100 ? 'warn' : undefined,
      sub: a.eventLoop ? `p50 ${dec(a.eventLoop.p50)} ms · en çok ${dec(a.eventLoop.max)} ms (son 5 sn)` : 'Düzenli ölçüm kapalı',
    }),
    card({
      label: 'Gateway (WebSocket)',
      value: num(g.openSockets),
      unit: 'açık',
      sub: [
        `${num(g.sessions)} oturum · ${num(g.connections)} bağlantı · ${num(g.reconnects)} yeniden bağlanma`,
        `${num(g.authFailures)} geçersiz oturum · ${num(g.updateRequired)} güncelleme zorunlu`,
        closes && `Kapanış kodları: ${closes}`,
      ],
      children: [
        h(
          'div',
          'adm-net',
          h('div', 'adm-net-head', h('span', 'adm-muted', 'Giden mesaj'), h('b', null, `${perSec(lastG.outPerSec)} · ${rate(lastG.bytesOutPerSec)}`)),
          sparkline(series(gh, 'outPerSec'), { max: 1, format: perSec, label: 'Giden gateway mesajları' }),
        ),
        h(
          'div',
          'adm-net',
          h('div', 'adm-net-head', h('span', 'adm-muted', 'Gelen mesaj'), h('b', null, perSec(lastG.inPerSec))),
          sparkline(series(gh, 'inPerSec'), { max: 1, format: perSec, label: 'Gelen gateway mesajları', color: 'pink' }),
        ),
      ],
    }),
    panel(
      'Yol gruplarına göre gecikme (son 15 dk)',
      a.groups.length === 0
        ? h('div', 'adm-sub', 'İstek yok.')
        : h(
            'ul',
            'adm-rows adm-rows-compact',
            a.groups.map((x) =>
              h(
                'li',
                'adm-row',
                h('span', 'adm-row-title adm-mono', x.group),
                h('span', 'adm-muted adm-push', `${num(x.count)} istek · p50 ${dec(x.p50)} ms · p95 ${dec(x.p95)} ms`),
              ),
            ),
          ),
    ),
    panel(
      'En sık istenen yollar (son 15 dk)',
      a.routes.length === 0
        ? h('div', 'adm-sub', 'İstek yok.')
        : h(
            'ul',
            'adm-rows adm-rows-compact',
            a.routes.map((x) =>
              h(
                'li',
                'adm-row',
                h('span', 'adm-row-title adm-mono', x.route),
                h('span', 'adm-muted adm-push', `${num(x.count)} · p50 ${dec(x.p50)} · p95 ${dec(x.p95)} · en çok ${dec(x.max)} ms`),
              ),
            ),
          ),
    ),
    panel(
      `Sınır aşımları (429; toplam ${num(a.rateLimited.total)})`,
      a.rateLimited.recent.length === 0
        ? h('div', 'adm-sub', 'Yok.')
        : h(
            'ul',
            'adm-rows adm-rows-compact',
            a.rateLimited.recent.slice(0, 30).map((x) =>
              h(
                'li',
                'adm-row',
                badge(ago(x.at, now)),
                h('span', 'adm-row-title adm-mono', `${x.method} ${x.route}`),
                h('span', 'adm-muted adm-push', `${x.ip}${x.user ? ` · @${x.user}` : ''}`),
              ),
            ),
          ),
    ),
    h('p', 'adm-sub adm-wide', `Sayımlar ${dateTime(a.since)} tarihinden beri (sunucu belleğinde). Sunucu günlüğündeki hatalar Hatalar sekmesinde.`),
  ];
}

// ---------- Güvenlik ----------

const AUTH_KIND = {
  login: ['Giriş', 'ok'],
  login_failed: ['Başarısız', 'warn'],
  register: ['Kayıt', undefined],
  join: ['Davetle katıldı', undefined],
  reset: ['Şifre sıfırlandı', 'warn'],
  password: ['Şifre değişti', undefined],
  rate_limited: ['Sınır aşımı', 'live'],
};

function security(x) {
  const now = x.now;
  const c = x.counts;
  const events = ui.allEvents ? x.events : x.events.slice(0, 25);
  const guild = (id) => (id ? (x.guildNames[id] ?? 'Silinmiş sunucu') : 'Hesap daveti');
  return [
    card({ label: 'Girişler', value: num(c.login24h), unit: 'son 24 saat', compact: true, sub: `Son 7 günde ${num(c.login7d)}` }),
    card({
      label: 'Başarısız girişler',
      value: num(c.failed24h),
      unit: 'son 24 saat',
      compact: true,
      tone: c.failed24h >= 10 ? 'bad' : c.failed24h > 0 ? 'warn' : undefined,
      sub: [`Son 7 günde ${num(c.failed7d)}`, `${num(c.limited24h)} sınır aşımı (24 sa)`],
    }),
    card({
      label: 'Oturumlar',
      value: num(x.sessions.gatewaySessions),
      unit: 'bağlı cihaz',
      sub: [
        `${num(x.sessions.onlineUsers)} kişi çevrimiçi`,
        `${num(x.sessions.pushDevices)} bildirim kayıtlı cihaz (${num(x.sessions.pushUsers)} kişi)`,
        `${num(x.sessions.gatewayAuthFailures)} geçersiz oturumla bağlanma`,
        `Jetonlar ${num(x.sessions.tokenTtlDays)} gün geçerli; sunucu jeton listesi tutmaz`,
      ],
    }),
    x.failuresByIp.length > 0 &&
      panel(
        'Başarısız girişler: adrese göre (son 24 saat)',
        h(
          'ul',
          'adm-rows adm-rows-compact',
          x.failuresByIp.map((f) =>
            h(
              'li',
              'adm-row',
              h('span', 'adm-row-title adm-mono', f.ip),
              h('span', 'adm-muted', f.usernames.length ? f.usernames.map((n) => `@${n}`).join(', ') : 'bilinmeyen hesaplar'),
              h('span', 'adm-push', badge(`${num(f.count)} deneme`, f.count >= 10 ? 'live' : 'warn'), ' ', badge(ago(f.last, now), 'muted')),
            ),
          ),
        ),
      ),
    panel(
      'Son giriş olayları (30 gün saklanır)',
      x.events.length === 0
        ? h('div', 'adm-sub', 'Kayıt yok.')
        : h(
            'ul',
            'adm-rows',
            events.map((e) => {
              const u = e.userId ? x.users[e.userId] : null;
              const [label, tone] = AUTH_KIND[e.kind] ?? [e.kind];
              return h(
                'li',
                'adm-row adm-row-top',
                h(
                  'div',
                  'adm-row-main',
                  h(
                    'div',
                    'adm-badges',
                    badge(label, tone),
                    badge(dateTime(e.at), 'muted'),
                    e.username ? badge(`@${e.username}`) : badge('bilinmeyen hesap', 'muted'),
                    badge(e.client),
                    badge(e.ip, 'muted'),
                  ),
                  (e.detail || u) && h('div', 'adm-sub', [u && userName(u), e.detail].filter(Boolean).join(' · ')),
                ),
              );
            }),
          ),
      x.events.length > 25 &&
        h(
          'button',
          {
            type: 'button',
            class: 'adm-more',
            on: {
              click: () => {
                ui.allEvents = !ui.allEvents;
                draw('adm-security', () => security(x));
              },
            },
          },
          ui.allEvents ? 'Daha az göster' : `Tümünü göster (${num(x.events.length)})`,
        ),
    ),
    panel(
      'Davet kullanımları (kim kimi davet etti)',
      x.inviteUses.length === 0
        ? h('div', 'adm-sub', 'Kayıt yok (bu sürümden sonraki kullanımlar görünür).')
        : h(
            'ul',
            'adm-rows',
            x.inviteUses.map((u) =>
              h(
                'li',
                'adm-row',
                avatar(x.users[u.userId], 24),
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-row-title', userName(x.users[u.userId]), badge(u.kind === 'register' ? 'yeni hesap' : 'sunucuya katıldı')),
                  h('div', 'adm-sub', `${guild(u.guildId)} · davet eden: ${u.inviterId ? userName(x.users[u.inviterId]) : 'başlangıç daveti'} · ${u.code} · ${dateTime(u.at)}`),
                ),
              ),
            ),
          ),
    ),
    panel(
      'Davetler',
      x.invites.length === 0
        ? h('div', 'adm-sub', 'Davet yok.')
        : h(
            'ul',
            'adm-rows adm-rows-compact',
            x.invites.map((i) =>
              h(
                'li',
                'adm-row',
                h('span', 'adm-row-title adm-mono', i.code),
                h('span', 'adm-muted', `${guild(i.guildId)} · ${i.createdBy ? userName(x.users[i.createdBy]) : 'sistem'} · ${shortDate(i.createdAt)}`),
                h(
                  'span',
                  'adm-push',
                  badge(`${num(i.uses)}${i.maxUses ? ` / ${num(i.maxUses)}` : ''} kullanım`),
                  ' ',
                  i.grantsAdmin && badge('yönetici', 'warn'),
                  i.active ? badge(i.expiresAt ? `${shortDate(i.expiresAt)} tarihine kadar` : 'süresiz', 'ok') : badge('bitti', 'muted'),
                ),
              ),
            ),
          ),
    ),
    panel(
      'Son açılan hesaplar ve yöneticiler',
      h(
        'ul',
        'adm-rows adm-rows-compact',
        x.recentAccounts.map((a) =>
          h('li', 'adm-row', person(x.users[a.userId]), x.admins.includes(a.userId) && badge('yönetici', 'warn'), h('span', 'adm-muted adm-push', dateTime(a.createdAt))),
        ),
      ),
      h('div', 'adm-sub', `Hesap yöneticileri: ${x.admins.map((id) => userName(x.users[id])).join(', ') || '—'}`),
    ),
  ];
}

// ---------- Sunucular ----------

function guilds(x) {
  const out = x.guilds.map((g) =>
    h(
      'article',
      'adm-card adm-wide',
      h('div', 'adm-channel-head', h('span', 'adm-channel-name', g.name), h('span', 'adm-muted', `sahibi ${userName(x.users[g.ownerId], '—')}`), h('span', 'adm-muted adm-push', `kuruldu ${shortDate(g.createdAt)}`)),
      h(
        'div',
        'adm-metrics',
        metric('Üyeler', `${num(g.members)}${g.formerMembers ? ` (+${num(g.formerMembers)} eski)` : ''}`),
        metric('Yasaklı', num(g.banned)),
        metric('Kanallar', `${num(g.channels.text)} metin · ${num(g.channels.voice)} ses`),
        metric('Mesajlar', `${num(g.messages.total)} (7 gün: ${num(g.messages.last7d)})`),
        metric('Son mesaj', g.messages.lastAt ? ago(g.messages.lastAt, x.generatedAt) : '—'),
        metric('Dosya ekleri', `${num(g.attachments.count)} · ${bytes(g.attachments.bytes)}`),
        metric('Ses (7 gün)', minutes(g.voice7d.voiceMin)),
        metric('Yayın (7 gün)', minutes(g.voice7d.streamMin)),
        metric('Etkin davet', num(g.invites)),
      ),
      g.topPosters.length > 0 &&
        h(
          'div',
          'adm-sub',
          'En çok yazanlar (7 gün): ',
          g.topPosters.map((p, i) => `${i ? ', ' : ''}${userName(x.users[p.userId])} ${num(p.count)}`).join(''),
        ),
    ),
  );
  out.push(
    card({
      label: 'Direkt mesajlar',
      value: num(x.dms.conversations),
      unit: 'konuşma',
      compact: true,
      sub: [`${num(x.dms.messages)} mesaj (7 gün: ${num(x.dms.last7d)})`, `${num(x.dms.attachments.count)} ek · ${bytes(x.dms.attachments.bytes)}`],
    }),
  );
  return out;
}

// ---------- Geri bildirim ----------

const FEEDBACK = [
  ['yeni', 'Yeni'],
  ['incelendi', 'İncelendi'],
  ['planlandi', 'Planlandı'],
  ['tamamlandi', 'Tamamlandı'],
  ['reddedildi', 'Reddedildi'],
];
const FEEDBACK_LABEL = Object.fromEntries(FEEDBACK);
const FEEDBACK_TYPES = [
  ['', 'Tüm türler'],
  ['hata', 'Hata'],
  ['oneri', 'Öneri'],
  ['diger', 'Diğer'],
];
const FEEDBACK_TYPE_LABEL = { hata: 'Hata', oneri: 'Öneri', diger: 'Diğer' };
const STATUS_TONE = { yeni: 'live', incelendi: 'warn', planlandi: undefined, tamamlandi: 'ok', reddedildi: 'muted' };

function feedbackSummary(d) {
  const f = d.feedback;
  const pick = (status) => {
    ui.fbStatus = ui.fbStatus === status ? '' : status;
    delete extra.data['geri-bildirim'];
    draw('adm-feedback', () => feedbackSummary(d));
    void loadExtra(true);
  };
  return [
    h(
      'article',
      `adm-card adm-wide${f.counts.yeni > 0 ? ' adm-tone-accent' : ''}`,
      h('div', 'adm-label', `Durumlara göre (toplam ${num(f.total)}) · süzmek için dokun`),
      h(
        'div',
        'adm-stats',
        FEEDBACK.map(([key, label]) =>
          h(
            'button',
            {
              type: 'button',
              class: `adm-stat adm-stat-btn${key === 'yeni' && f.counts[key] > 0 ? ' adm-stat-new' : ''}`,
              'aria-pressed': String(ui.fbStatus === key),
              on: { click: () => pick(key) },
            },
            h('b', null, num(f.counts[key] ?? 0)),
            h('span', null, label),
          ),
        ),
      ),
      chips(
        FEEDBACK_TYPES,
        ui.fbType,
        (type) => {
          ui.fbType = type;
          delete extra.data['geri-bildirim'];
          draw('adm-feedback', () => feedbackSummary(d));
          void loadExtra(true);
        },
        'Tür',
      ),
    ),
  ];
}

/** Hesap bilgisi (panelin kişi listesinden) */
function knownUser(id) {
  return lastData?.clients.users.find((u) => u.user.id === id)?.user ?? null;
}

function feedbackList(list) {
  const now = Date.now();
  const title = `${ui.fbStatus ? FEEDBACK_LABEL[ui.fbStatus] : 'Tüm durumlar'}${ui.fbType ? ` · ${FEEDBACK_TYPE_LABEL[ui.fbType]}` : ''} (${num(list.length)})`;
  return [
    panel(
      title,
      list.length === 0
        ? h('div', 'adm-sub', 'Bu süzgeçte geri bildirim yok.')
        : h(
            'ul',
            'adm-rows',
            list.map((f) => {
              const u = f.userId ? knownUser(f.userId) : null;
              return h(
                'li',
                { class: 'adm-row adm-row-top adm-clickable', tabindex: 0, role: 'button', on: rowOpen(() => openFeedback(f)) },
                avatar(u, 28),
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-row-title', `#${f.id} `, f.title || f.body.split('\n')[0].slice(0, 120)),
                  h(
                    'div',
                    'adm-badges',
                    badge(FEEDBACK_TYPE_LABEL[f.type] ?? f.type, f.type === 'hata' ? 'warn' : undefined),
                    badge(FEEDBACK_LABEL[f.status] ?? f.status, STATUS_TONE[f.status]),
                    badge(u ? `@${u.username}` : f.userId ? 'hesap' : 'silinmiş hesap', 'muted'),
                    badge(ago(f.createdAt, now), 'muted'),
                    f.screenshots.length > 0 && badge(`${num(f.screenshots.length)} görüntü`),
                    f.adminNote && badge('not var'),
                  ),
                ),
              );
            }),
          ),
    ),
  ];
}

const CONTEXT_LABELS = {
  platform: 'Platform',
  appVersion: 'Uygulama sürümü',
  nativeVersion: 'Yüklü APK sürümü',
  os: 'İşletim sistemi',
  osVersion: 'Sistem sürümü',
  device: 'Cihaz',
  screen: 'Ekran',
  window: 'Pencere',
  view: 'Açık görünüm',
  inVoice: 'Seste',
};

function openFeedback(f) {
  const u = f.userId ? knownUser(f.userId) : null;
  openSheet(`Geri bildirim #${f.id}`);
  const body = [];
  body.push(
    h(
      'div',
      'adm-badges',
      badge(FEEDBACK_TYPE_LABEL[f.type] ?? f.type, f.type === 'hata' ? 'warn' : undefined),
      badge(FEEDBACK_LABEL[f.status] ?? f.status, STATUS_TONE[f.status]),
      badge(dateTime(f.createdAt), 'muted'),
      f.updatedAt !== f.createdAt && badge(`güncellendi ${dateTime(f.updatedAt)}`, 'muted'),
    ),
  );
  body.push(h('div', 'adm-fb-author', u ? person(u, 28) : h('span', 'adm-muted', f.userId ? 'Hesap' : 'Silinmiş hesap')));
  if (f.title) body.push(h('h3', 'adm-fb-title', f.title));
  // Kullanıcı metni: yalnızca metin olarak (satır sonları korunur)
  body.push(h('div', 'adm-fb-body', f.body));
  if (f.screenshots.length > 0) {
    const shots = h('div', 'adm-shots');
    for (const s of f.screenshots) {
      const holder = h('a', { class: 'adm-shot', href: '#', 'aria-label': `Ekran görüntüsü ${s.width}×${s.height}` }, h('span', 'adm-sub', 'Yükleniyor…'));
      shots.append(holder);
      imageDataUrl(s.url)
        .then((src) => {
          const img = h('img', { src, alt: `Ekran görüntüsü ${s.width}×${s.height}`, loading: 'lazy' });
          holder.replaceChildren(img);
          holder.addEventListener('click', (e) => {
            e.preventDefault();
            holder.classList.toggle('adm-shot-big');
          });
        })
        .catch((err) => {
          if (!(err instanceof AccessError)) holder.replaceChildren(h('span', 'adm-sub', 'Görüntü alınamadı'));
        });
    }
    body.push(h('div', 'adm-label', 'Ekran görüntüleri (büyütmek için dokun)'), shots);
  }
  const ctx = f.context;
  if (ctx) {
    const rows = Object.entries(CONTEXT_LABELS)
      .filter(([k]) => ctx[k] !== undefined && ctx[k] !== null && ctx[k] !== '')
      .map(([k, label]) => kv(label, k === 'inVoice' ? (ctx[k] ? 'evet' : 'hayır') : k === 'platform' ? (PLATFORM[ctx[k]] ?? String(ctx[k])) : String(ctx[k])));
    body.push(h('div', 'adm-label', 'Teknik bilgiler'), h('div', 'adm-kvs', rows));
    if (Array.isArray(ctx.recentErrors) && ctx.recentErrors.length > 0) {
      body.push(details(`fb${f.id}`, `Son uygulama hataları (${num(ctx.recentErrors.length)})`, ctx.recentErrors.join('\n')));
    }
  } else {
    body.push(h('div', 'adm-sub', 'Gönderen teknik bilgileri eklemedi.'));
  }
  // Durum ve yönetici notu (gönderen de görür)
  const status = h(
    'select',
    { class: 'adm-input', 'aria-label': 'Durum' },
    FEEDBACK.map(([value, label]) => {
      const opt = h('option', { value }, label);
      if (value === f.status) opt.selected = true;
      return opt;
    }),
  );
  const note = h('textarea', { class: 'adm-input', rows: 4, maxlength: 2000, 'aria-label': 'Yönetici notu', placeholder: 'Gönderenin de göreceği not (isteğe bağlı)' });
  note.value = f.adminNote ?? '';
  const message = h('p', 'adm-sub', '');
  const save = h('button', { type: 'button', class: 'btn btn-primary adm-save' }, 'Kaydet');
  save.addEventListener('click', async () => {
    save.disabled = true;
    message.textContent = 'Kaydediliyor…';
    try {
      const updated = await apiSend('PATCH', `/api/feedback/${f.id}`, { status: status.value, adminNote: note.value.trim() || null });
      Object.assign(f, updated);
      message.textContent = `Kaydedildi (${clock(Date.now(), true)}).`;
      delete extra.data['geri-bildirim'];
      if (ui.tab === 'geri-bildirim') void loadExtra(true);
      void refresh();
    } catch (err) {
      if (!(err instanceof AccessError)) message.textContent = `Kaydedilemedi: ${err.message}`;
    } finally {
      save.disabled = false;
    }
  });
  body.push(
    h(
      'div',
      'adm-card adm-fb-edit',
      h('label', 'adm-field', h('span', null, 'Durum'), status),
      h('label', 'adm-field', h('span', null, 'Yönetici notu'), note),
      h('div', 'adm-fb-actions', save, message),
    ),
  );
  $('adm-sheet-body').replaceChildren(...body);
}

// ---------- iPhone cihazları (Ad Hoc onayı) ----------

const IOS_STATUS = {
  bekliyor: ['Bekliyor', 'live'],
  onaylandi: ['Onaylandı', 'warn'],
  eklendi: ['Eklendi', 'ok'],
  reddedildi: ['Reddedildi', 'muted'],
};
const CI_STATUS = {
  queued: ['Sırada', 'warn'],
  requested: ['Sırada', 'warn'],
  waiting: ['Bekliyor', 'warn'],
  pending: ['Sırada', 'warn'],
  in_progress: ['Derleniyor', 'warn'],
  bulunamadi: ["GitHub'da bulunamadı", 'bad'],
  hata: ['Başlatılamadı', 'bad'],
};
const CI_CONCLUSION = { success: ['Başarılı', 'ok'], failure: ['Başarısız', 'bad'], cancelled: ['İptal edildi', 'muted'], timed_out: ['Zaman aşımı', 'bad'] };

/** Durumu değiştirip listeyi yeniden ister */
async function setIosStatus(udid, status, button) {
  button.disabled = true;
  try {
    await apiSend('PATCH', `/api/admin/ios-devices/${encodeURIComponent(udid)}`, { status });
    delete extra.data.iphone;
    if (ui.tab === 'iphone') void loadExtra(true);
  } catch (err) {
    if (!(err instanceof AccessError)) {
      button.disabled = false;
      window.alert(`Kaydedilemedi: ${err.message}`);
    }
  }
}

function iosDevices(x) {
  const now = x.generatedAt;
  const waiting = x.devices.filter((d) => d.status === 'bekliyor').length;
  const count = $('adm-ios-count');
  count.hidden = waiting === 0;
  count.textContent = num(waiting);
  const out = [];

  // Otomatik derleme durumu
  const auto = x.automation;
  const ci = x.ci;
  const running = ci && !['completed', 'bulunamadi', 'hata'].includes(ci.status);
  // Sürmekte olan derlemeye girmemiş onaylı cihazlar
  const waitingBuild = x.devices.filter((d) => d.status === 'onaylandi' && !(running && ci.udids.includes(d.udid))).length;
  if (auto.enabled) {
    const message = h('p', 'adm-sub', '');
    const now_ = h('button', { type: 'button', class: 'adm-more' }, 'Hemen derle');
    now_.addEventListener('click', async () => {
      now_.disabled = true;
      message.textContent = 'Başlatılıyor…';
      try {
        await apiSend('POST', '/api/admin/ios-devices/dispatch', {});
        message.textContent = 'Derleme başlatıldı.';
        delete extra.data.iphone;
        void loadExtra(true);
      } catch (err) {
        if (!(err instanceof AccessError)) message.textContent = err.message;
        now_.disabled = false;
      }
    });
    out.push(
      card({
        label: 'Otomatik derleme',
        value: 'Açık',
        wide: true,
        tone: 'ok',
        sub: [
          auto.pendingDispatchAt
            ? `Onaylar toplanıyor; derleme ${clock(Date.parse(auto.pendingDispatchAt), true)} civarı başlayacak.`
            : waitingBuild > 0
              ? `${num(waitingBuild)} onaylı cihaz derleme bekliyor.`
              : running
                ? 'Derleme sürüyor; bitince cihazlar "Eklendi" olur (yaklaşık 30-40 dk).'
                : 'Onaylanan cihazlar birkaç dakika içinde tek derlemede Apple\'a eklenir ve IPA yenilenir.',
        ],
        children: waitingBuild > 0 ? h('div', 'adm-fb-actions', now_, message) : null,
      }),
    );
  } else {
    const manual = x.manualCommand;
    out.push(
      h(
        'article',
        `adm-card adm-wide ${auto.keyMissing ? 'adm-tone-bad' : 'adm-tone-accent'}`,
        h('div', 'adm-label', auto.keyMissing ? 'Otomatik derleme durdu: IOS_DEVICES_KEY yok' : 'Otomatik derleme kapalı'),
        h(
          'div',
          'adm-sub',
          auto.keyMissing
            ? 'Sunucuda GitHub belirteci var ama cihaz listesini şifreleyecek anahtar (IOS_DEVICES_KEY) yok. Depo herkese açık olduğundan UDID\'ler açık gönderilmez; anahtarı .env\'e ekle (bkz. docs/ios.md). O zamana kadar elle:'
            : 'Sunucuda GITHUB_DISPATCH_TOKEN yok (bkz. docs/ios.md). Onayladığın cihazlar için şu komutu çalıştır; derleme bitince cihazları "Eklendi" olarak işaretle.',
        ),
        manual
          ? [
              h('pre', 'adm-mono adm-pre', manual.command),
              !manual.encrypted &&
                h(
                  'div',
                  'adm-sub',
                  "Cihaz listesi şifrelenemediği için komut cihazsız: önce cihazları Apple Developer'da (Devices) elle ekle; derleme Apple'daki tüm açık cihazlarla profili yeniler.",
                ),
            ]
          : h('div', 'adm-sub', 'Şu an onaylı cihaz yok.'),
      ),
    );
  }

  if (ci) {
    const [label, tone] = ci.status === 'completed' ? (CI_CONCLUSION[ci.conclusion] ?? [ci.conclusion ?? 'Bitti', 'muted']) : (CI_STATUS[ci.status] ?? [ci.status, 'warn']);
    out.push(
      h(
        'article',
        'adm-card adm-wide',
        h('div', 'adm-label', 'Son derleme'),
        h(
          'div',
          'adm-badges',
          badge(label, tone),
          badge(`${num(ci.udids.length)} cihaz`, 'muted'),
          badge(`başladı ${ago(Date.parse(ci.dispatchedAt), now)}`, 'muted'),
          ci.checkedAt && badge(`denetlendi ${clock(Date.parse(ci.checkedAt), true)}`, 'muted'),
        ),
        ci.url && h('div', 'adm-sub', h('a', { href: ci.url, target: '_blank', rel: 'noopener noreferrer' }, "GitHub'da aç")),
        ci.error && h('div', 'adm-sub', ci.error),
      ),
    );
  }

  const action = (udid, status, text) => {
    const btn = h('button', { type: 'button', class: 'adm-more' }, text);
    btn.addEventListener('click', () => setIosStatus(udid, status, btn));
    return btn;
  };
  const ACTIONS = {
    bekliyor: (d) => [action(d.udid, 'onaylandi', 'Onayla'), action(d.udid, 'reddedildi', 'Reddet')],
    onaylandi: (d) => [action(d.udid, 'bekliyor', 'Geri al'), !auto.enabled && action(d.udid, 'eklendi', 'Eklendi say')],
    eklendi: (d) => [action(d.udid, 'bekliyor', 'Bekliyor yap')],
    reddedildi: (d) => [action(d.udid, 'onaylandi', 'Onayla')],
  };

  out.push(
    panel(
      `Kayıtlı cihazlar (${num(x.devices.length)}) · /udid sayfasından`,
      x.devices.length === 0
        ? h('div', 'adm-sub', 'Henüz kayıt yok. Arkadaşların iPhone\'da Safari ile /udid sayfasını açıp profili yükleyince burada görünür.')
        : h(
            'ul',
            'adm-rows',
            x.devices.map((d) => {
              const [label, tone] = IOS_STATUS[d.status] ?? [d.status, 'muted'];
              return h(
                'li',
                'adm-row adm-row-top adm-ios-row',
                h(
                  'div',
                  'adm-row-main',
                  h('div', 'adm-row-title', d.name || d.deviceName || 'Adsız'),
                  h(
                    'div',
                    'adm-badges',
                    badge(label, tone),
                    d.name && d.deviceName && badge(d.deviceName, 'muted'),
                    d.product && badge(d.product, 'muted'),
                    d.version && badge(`iOS ${d.version}`, 'muted'),
                    badge(`kayıt ${dateTime(Date.parse(d.at))}`, 'muted'),
                    d.statusAt && badge(`${label.toLowerCase()} ${ago(Date.parse(d.statusAt), now)}`, 'muted'),
                  ),
                  h('div', 'adm-sub adm-mono', d.udid),
                ),
                h('div', 'adm-ios-actions', ACTIONS[d.status]?.(d)),
              );
            }),
          ),
    ),
  );
  return out;
}

// ---------- Başlangıç ----------

if (token) {
  show('adm-loading');
  void refresh();
} else {
  show('adm-login');
}
