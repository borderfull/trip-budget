/* Trip Budget — a daily spending ledger for a single trip.
 *
 * Runs two ways from one file:
 *   - as a plain web page (GitHub Pages, Vercel, anywhere): localStorage + file download
 *   - inside a Claude artifact: account storage + the host download prompt
 * Everything is feature-detected at runtime; there is no build step.
 */
"use strict";

/* ---------------------------------------------------------------- model */

const CATS = [
  { id: 'food',       label: 'Food' },
  { id: 'stay',       label: 'Stay' },
  { id: 'transport',  label: 'Transport' },
  { id: 'activities', label: 'Activities' },
  { id: 'misc',       label: 'Misc' }
];
const DEFAULT_SHARES = { food: 35, stay: 30, transport: 15, activities: 12, misc: 8 };
const LS_KEY = 'tripbudget.v1';

const $ = s => document.querySelector(s);
const p2 = n => String(n).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catOf = id => CATS.find(c => c.id === id) || CATS[4];
const sum = a => a.reduce((x, y) => x + y, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

/* ----------------------------------------------------------- currencies */

const CURRENCIES = {
  INR: 'Indian rupee', USD: 'US dollar', EUR: 'Euro', GBP: 'British pound',
  AED: 'UAE dirham', SAR: 'Saudi riyal', QAR: 'Qatari riyal', OMR: 'Omani rial', KWD: 'Kuwaiti dinar', BHD: 'Bahraini dinar',
  THB: 'Thai baht', SGD: 'Singapore dollar', MYR: 'Malaysian ringgit', IDR: 'Indonesian rupiah', VND: 'Vietnamese dong',
  PHP: 'Philippine peso', KHR: 'Cambodian riel', LAK: 'Lao kip',
  LKR: 'Sri Lankan rupee', NPR: 'Nepalese rupee', BTN: 'Bhutanese ngultrum', MVR: 'Maldivian rufiyaa', BDT: 'Bangladeshi taka',
  JPY: 'Japanese yen', KRW: 'South Korean won', CNY: 'Chinese yuan', HKD: 'Hong Kong dollar', TWD: 'Taiwan dollar',
  AUD: 'Australian dollar', NZD: 'New Zealand dollar', CAD: 'Canadian dollar',
  CHF: 'Swiss franc', SEK: 'Swedish krona', NOK: 'Norwegian krone', DKK: 'Danish krone', ISK: 'Icelandic krona',
  CZK: 'Czech koruna', HUF: 'Hungarian forint', PLN: 'Polish zloty', TRY: 'Turkish lira', GEL: 'Georgian lari',
  EGP: 'Egyptian pound', MAD: 'Moroccan dirham', KES: 'Kenyan shilling', TZS: 'Tanzanian shilling', ZAR: 'South African rand',
  MUR: 'Mauritian rupee', BRL: 'Brazilian real', MXN: 'Mexican peso'
};
const isCur = c => Object.prototype.hasOwnProperty.call(CURRENCIES, c);
/* Rough units per US dollar. Used ONLY to decide which way round to ask for a
 * rate nobody has fetched yet (“$1 buys how many THB?” rather than
 * “1 THB is how many $?”). Never used to convert money. */
const MAGNITUDE = {
  INR: 84, USD: 1, EUR: 0.92, GBP: 0.79, AED: 3.67, SAR: 3.75, QAR: 3.64, OMR: 0.385, KWD: 0.31, BHD: 0.377,
  THB: 35, SGD: 1.34, MYR: 4.5, IDR: 16000, VND: 25000, PHP: 58, KHR: 4100, LAK: 22000,
  LKR: 300, NPR: 135, BTN: 84, MVR: 15.4, BDT: 120, JPY: 150, KRW: 1400, CNY: 7.2, HKD: 7.8, TWD: 32,
  AUD: 1.5, NZD: 1.65, CAD: 1.38, CHF: 0.88, SEK: 10.5, NOK: 10.8, DKK: 6.9, ISK: 138,
  CZK: 23, HUF: 370, PLN: 4, TRY: 34, GEL: 2.7, EGP: 49, MAD: 10, KES: 129, TZS: 2700, ZAR: 18,
  MUR: 46, BRL: 5.6, MXN: 19.5
};
const LAKH = { INR: 1, NPR: 1, LKR: 1, BDT: 1, BTN: 1 };

const _fmt = {};
function fmtFor(cur, dec) {
  const k = cur + dec;
  if (!_fmt[k]) {
    const o = { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: dec };
    try { _fmt[k] = new Intl.NumberFormat(LAKH[cur] ? 'en-IN' : 'en-US', Object.assign({ currencyDisplay: 'narrowSymbol' }, o)); }
    catch (e) {
      try { _fmt[k] = new Intl.NumberFormat('en-US', o); }
      catch (e2) { _fmt[k] = { format: n => cur + ' ' + Number(n).toFixed(dec) }; }
    }
  }
  return _fmt[k];
}
function baseCur() { return (S && S.trip.currency) || (F && F.currency) || 'INR'; }
/* whole units, for every total in the app */
function money(n, cur) {
  cur = cur || baseCur();
  const r = Math.round(n);
  return (r < 0 ? '−' : '') + fmtFor(cur, 0).format(Math.abs(r));
}
/* up to two decimals, for the amount a spend was actually paid in */
function moneyExact(n, cur) { return (n < 0 ? '−' : '') + fmtFor(cur, 2).format(Math.abs(n)); }
function symbolOf(cur) {
  try { const p = fmtFor(cur, 0).formatToParts(1).find(x => x.type === 'currency'); return p ? p.value : cur; }
  catch (e) { return cur; }
}
function numStr(x) {
  if (!(x > 0)) return '';
  return x >= 1 ? x.toLocaleString('en-US', { maximumFractionDigits: 2 })
                : x.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

/* Exchange rates: ExchangeRate-API's open endpoint (no key, daily updates,
 * attribution required). Cached on the device so the app converts offline;
 * when there is no rate at all the person types one in. */
const RATE_KEY = 'tripbudget.rates';
let RATES = (function () { try { return JSON.parse(localStorage.getItem(RATE_KEY)) || null; } catch (e) { return null; } })();
let ratesInflight = null;

function refreshRates(base) {
  if (RATES && RATES.base === base && Date.now() - RATES.at < 12 * 3600e3) return Promise.resolve(RATES);
  if (ratesInflight) return ratesInflight;
  if (typeof window.fetch !== 'function') return Promise.resolve(null);
  ratesInflight = window.fetch('https://open.er-api.com/v6/latest/' + encodeURIComponent(base))
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (j && j.result === 'success' && j.rates) {
        RATES = { base: j.base_code || base, at: Date.now(), rates: j.rates };
        try { localStorage.setItem(RATE_KEY, JSON.stringify(RATES)); } catch (e) {}
      }
      return RATES;
    })
    .catch(() => null)
    .then(r => { ratesInflight = null; return r; });
  return ratesInflight;
}
/* how many units of the home currency one unit of `cur` buys */
function liveRate(cur) {
  const base = baseCur();
  if (cur === base) return 1;
  if (RATES && RATES.base === base && RATES.rates && RATES.rates[cur] > 0) return 1 / RATES.rates[cur];
  return null;
}
function lastUsedRate(cur) {
  if (!S) return null;
  let best = null;
  S.expenses.forEach(e => { if (e.cur === cur && e.rate > 0 && (!best || e.date >= best.date)) best = e; });
  return best ? best.rate : null;
}
function knownRate(cur) { return liveRate(cur) || lastUsedRate(cur); }
/* round advice figures so they read like money a person would hand over */
function nice(n) { n = Math.max(0, n); return n >= 200 ? Math.round(n / 10) * 10 : Math.round(n); }

function todayStr() { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
function utc(s) { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); }
function addDays(s, n) { const d = new Date(utc(s) + n * 864e5); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
function dayNum(start, d) { return Math.round((utc(d) - utc(start)) / 864e5) + 1; }
function fmtDate(s) { return new Date(utc(s)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(utc(s));

const ICON = {
  edit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>',
  del:  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1.2 14h9.6L18 6"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M8 2v12M2 8h12"/></svg>',
  x:    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>',
  sun:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 1.8v2.4M12 19.8v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M1.8 12h2.4M19.8 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7"/></svg>',
  moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.3A8.8 8.8 0 019.7 3.5a8.8 8.8 0 1010.8 10.8z"/></svg>'
};

/* ------------------------------------------------------------ analytics */

/* Events go to Google Analytics when its tag is on the page, and nowhere
 * otherwise (the Claude build, offline, an ad blocker). Only behaviour is
 * sent: never an amount, a note, a trip name or a budget. */
function track(name, params) {
  try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (e) {}
}

/* time actually spent looking at the app, reported each time it is put away */
function watchTimeSpent() {
  let since = document.visibilityState === 'visible' ? Date.now() : 0;
  const stop = () => {
    if (!since) return;
    const secs = Math.round((Date.now() - since) / 1000);
    since = 0;
    if (secs >= 1) track('time_spent', { seconds: secs, view: view, transport_type: 'beacon' });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') since = Date.now(); else stop();
  });
  window.addEventListener('pagehide', stop);
}

/* ---------------------------------------------------------------- theme */

const THEME_KEY = 'tripbudget.theme';
const PAPER = { light: '#F2EDE3', dark: '#14110C' };

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function applyTheme(t, remember) {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.background = PAPER[t];
  const m = document.getElementById('themeColor');
  if (m) m.setAttribute('content', PAPER[t]);
  if (remember) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
}

/* ------------------------------------------------------------- state */

let S = null;            // { trip, expenses, updatedAt }
let view = 'today';
let F = null;            // trip form draft
let A = null;            // add/edit sheet draft
let pulse = false;       // animate the headline figure once

/* storage back ends, resolved at boot */
let cloudRef = null;     // Claude account document, when available
let saver = null;        // Claude download prompt, when available
let lsOK = true;
let saving = false, dirty = false, saveTimer = null;
let statusKey = 'local';

function normalize(o) {
  const t = (o && o.trip) || {};
  const shares = {};
  CATS.forEach(c => { shares[c.id] = Number(t.shares && t.shares[c.id]) || 0; });
  // trips saved before currencies existed were all in rupees
  const base = isCur(t.currency) ? t.currency : 'INR';
  return {
    trip: {
      name: String(t.name || 'My trip'),
      currency: base,
      lastCur: isCur(t.lastCur) ? t.lastCur : base,
      total: Number(t.total) || 0,
      start: validDate(t.start) ? t.start : todayStr(),
      days: clamp(Math.round(Number(t.days)) || 1, 1, 365),
      bufferPct: clamp(Number(t.bufferPct) || 0, 0, 50),
      prepaid: (Array.isArray(t.prepaid) ? t.prepaid : []).map(p => ({
        id: p.id || uid(), label: String(p.label || 'Prepaid'), amount: Number(p.amount) || 0
      })),
      shares
    },
    expenses: (Array.isArray(o && o.expenses) ? o.expenses : [])
      .filter(e => e && validDate(e.date))
      .map(e => {
        // `amount` is always in the home currency; `orig`/`cur` are what was paid, `rate` what it was converted at
        const amount = Number(e.amount) || 0;
        const cur = isCur(e.cur) ? e.cur : base;
        const foreign = cur !== base && Number(e.orig) > 0 && Number(e.rate) > 0;
        return { id: e.id || uid(), date: e.date, cat: catOf(e.cat).id, amount: amount, note: String(e.note || ''),
                 cur: foreign ? cur : base, orig: foreign ? Number(e.orig) : amount, rate: foreign ? Number(e.rate) : 1 };
      }),
    updatedAt: Number(o && o.updatedAt) || 0
  };
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && o.trip ? normalize(o) : null;
  } catch (e) { lsOK = false; return null; }
}
function writeLocal() {
  try {
    if (S) localStorage.setItem(LS_KEY, JSON.stringify(S));
    else localStorage.removeItem(LS_KEY);
    lsOK = true;
  } catch (e) { lsOK = false; }
}

function setStatus(k) {
  statusKey = k;
  const el = $('#status');
  if (!el) return;
  const text = {
    cloud:   'Saved to your account',
    local:   'Saved on this device',
    blocked: 'Not saved — this browser is blocking storage. Keep a backup.',
    error:   'Save failed. It will retry on your next change.'
  }[k] || '';
  el.className = 'status ' + k;
  el.innerHTML = '<i></i><span>' + esc(text) + '</span>';
}
function liveStatus() { return !lsOK && !cloudRef ? 'blocked' : statusKey; }

function queueSave() {
  if (S) S.updatedAt = Date.now();
  writeLocal();
  if (!cloudRef) { setStatus(lsOK ? 'local' : 'blocked'); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
async function flush() {
  if (saving) { dirty = true; return; }
  saving = true;
  do {
    dirty = false;
    try {
      if (S) await cloudRef.set(JSON.parse(JSON.stringify(S)));
      else await cloudRef.delete();
      setStatus('cloud');
    } catch (e) { setStatus('error'); }
  } while (dirty);
  saving = false;
}

async function boot() {
  S = readLocal();
  const installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  track('app_open', { has_trip: !!S, installed: !!installed, theme: currentTheme() });
  if (S) refreshRates(S.trip.currency).then(() => { if (!A && view === 'today') render(); });
  watchTimeSpent();
  setStatus(lsOK ? 'local' : 'blocked');
  render();

  // Claude artifact back ends, if this page is running inside one
  if (window.claude && window.claude.use) {
    window.claude.use('downloads').then(d => {
      saver = d;
      if (view === 'settings' && !A) render();
    }).catch(() => {});
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const id = user ? await user.id() : null;
      if (db && id) {
        const ref = db.doc('data/users/' + id + '/trip');
        const snap = await Promise.race([
          ref.get(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
        ]);
        cloudRef = ref;
        const remote = snap.exists ? snap.data() : null;
        if (remote && remote.trip && (!S || (Number(remote.updatedAt) || 0) > (S.updatedAt || 0))) {
          S = normalize(remote);
          writeLocal();
        } else if (S) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(flush, 50);
        }
        setStatus('cloud');
        if (!A) render();
        return;
      }
    } catch (e) { /* fall through to local-only */ }
  }
  setStatus(lsOK ? 'local' : 'blocked');

  // offline support on a real origin (never inside the artifact sandbox)
  if ('serviceWorker' in navigator && !window.claude && location.protocol.startsWith('http')) {
    try { navigator.serviceWorker.register('./sw.js'); } catch (e) {}
  }
}

/* --------------------------------------------------------- arithmetic */

function compute() {
  const t = S.trip, ex = S.expenses, today = todayStr();

  const prepaidTotal = sum(t.prepaid.map(p => p.amount));
  const buffer = t.total * t.bufferPct / 100;
  const spendable = Math.max(0, t.total - prepaidTotal - buffer);
  const target = spendable / t.days;                       // the flat plan

  const raw = dayNum(t.start, today);
  const status = raw < 1 ? 'before' : (raw > t.days ? 'after' : 'during');
  const d = status === 'before' ? 0 : (status === 'after' ? t.days : raw);
  const remaining = status === 'after' ? 0 : (status === 'before' ? t.days : t.days - d + 1);

  const spentTotal  = sum(ex.map(e => e.amount));
  const spentToday  = sum(ex.filter(e => e.date === today).map(e => e.amount));
  const spentBefore = sum(ex.filter(e => e.date <  today).map(e => e.amount));

  // the number that actually changes behaviour: what is left, spread over what remains
  const safeToday = remaining > 0 ? (spendable - spentBefore) / remaining : 0;
  const leftToday = safeToday - spentToday;

  const avg  = d > 0 ? spentTotal / d : 0;
  const bank = status === 'during' ? target * (d - 1) - spentBefore : 0;   // + = ahead, − = behind
  const remainingBudget = spendable - spentTotal;

  const cats = CATS.map(c => {
    const budget = spendable * (t.shares[c.id] || 0) / 100;
    const items  = ex.filter(e => e.cat === c.id);
    const spent  = sum(items.map(e => e.amount));
    const before = sum(items.filter(e => e.date < today).map(e => e.amount));
    const tdy    = sum(items.filter(e => e.date === today).map(e => e.amount));
    const safe   = remaining > 0 ? (budget - before) / remaining : 0;
    const toDate = d > 0 ? budget * d / t.days : 0;
    return Object.assign({}, c, { budget, spent, before, today: tdy, safe, excess: spent - toDate });
  });

  return { today, prepaidTotal, buffer, spendable, target, raw, status, d, remaining,
           spentTotal, spentToday, spentBefore, safeToday, leftToday, avg, bank, remainingBudget, cats };
}

function hotCat(c) {
  const hot = c.cats.slice().sort((a, b) => b.excess - a.excess)[0];
  return (hot && hot.budget > 0 && hot.excess > Math.max(c.target * 0.4, 100)) ? hot : null;
}

function suggestions(c) {
  const t = S.trip, out = [];

  if (c.status === 'before') {
    out.push({ tone: 'ok', h: 'Not started',
      p: money(c.target) + ' a day for ' + t.days + ' days.' });
    return out;
  }
  if (c.status === 'after') {
    const left = c.spendable - c.spentTotal;
    out.push({ tone: left >= 0 ? 'ok' : 'bad', h: left >= 0 ? 'Finished under' : 'Finished over',
      p: money(c.avg) + ' a day against a plan of ' + money(c.target) + '.' });
    return out;
  }

  const food = c.cats[0], last = c.remaining === 1;
  // judge on what the drift costs you TODAY, not on the cumulative figure:
  // being ₹200 behind over five days changes nothing about this afternoon.
  const dailyGap = c.safeToday - c.target;
  const tol = Math.max(c.target * 0.04, 25);

  const foodCap = money(nice(Math.max(0, food.safe)));

  if (c.safeToday <= 0) {
    out.push({ tone: 'bad', h: 'Budget used up', p: 'Only the ' + money(c.buffer) + ' buffer is left.' });
  } else if (dailyGap < -tol) {
    out.push({ tone: 'bad', h: money(-c.bank) + ' over pace',
      p: last ? money(c.safeToday) + ' is all that is left.'
              : 'Hold today to ' + money(nice(c.safeToday)) + ' to finish level. Food ' + foodCap + '.' });
  } else if (dailyGap > tol) {
    out.push({ tone: 'ok', h: money(c.bank) + ' to spare',
      p: last ? money(nice(c.safeToday)) + ' left to use or bring home.'
              : 'Today stretches to ' + money(nice(c.safeToday)) + '. Food up to ' + foodCap + '.' });
  } else {
    out.push({ tone: 'ok', h: 'On plan', p: money(nice(c.safeToday)) + ' today, food around ' + foodCap + '.' });
  }

  const hot = hotCat(c);
  if (hot) out.push({ tone: 'warn', h: hot.label + ' running high', p: money(hot.excess) + ' over its share.' });

  if (c.remainingBudget < 0 && c.safeToday > 0)
    out.push({ tone: 'warn', h: 'Into the buffer', p: money(Math.max(0, c.buffer + c.remainingBudget)) + ' of buffer left.' });

  return out;
}

/* -------------------------------------------------------------- views */

function masthead(c) {
  const dark = currentTheme() === 'dark';
  const name = c ? S.trip.name : 'Trip Budget';
  const right = !c ? ''
    : c.status === 'before' ? 'Starts ' + fmtDate(S.trip.start)
    : c.status === 'after'  ? 'Complete'
    : 'Day ' + c.d + ' / ' + S.trip.days;
  return '<header><div class="mast"><span class="name">' + esc(name) + '</span>' +
    '<span class="right">' + (right ? '<span class="kicker">' + esc(right) + '</span>' : '') +
    '<button class="themebtn" data-act="theme" aria-label="Switch to ' + (dark ? 'light' : 'dark') + ' theme">' +
    (dark ? ICON.sun : ICON.moon) + '</button></span></div>' +
    '<div class="rule2"></div><div class="rule2"></div></header>';
}

function render() {
  const app = $('#app');
  if (!S) {
    app.innerHTML = masthead(null) + formHTML(true) + statusHTML();
    $('#chrome').innerHTML = '';
    setStatus(liveStatus());
    return;
  }
  const c = compute();
  const body = view === 'today'  ? todayHTML(c)
             : view === 'totals' ? totalsHTML(c)
             : view === 'days'   ? daysHTML(c)
             :                     formHTML(false);
  app.innerHTML = masthead(c) + body + statusHTML();

  $('#chrome').innerHTML =
    '<nav class="nav" aria-label="Sections"><div class="in"><div class="tabs">' +
    [['today', 'Today'], ['totals', 'Totals'], ['days', 'Days'], ['settings', 'Trip']]
      .map(x => '<button data-act="tab" data-v="' + x[0] + '"' +
        (view === x[0] ? ' class="on" aria-current="page"' : '') + '>' + x[1] + '</button>').join('') +
    '</div>' +
    '<button class="addbtn" data-act="add">' + ICON.plus + 'Add<span class="lg"> spend</span></button>' +
    '</div></nav>';

  setStatus(liveStatus());
  pulse = false;
}
function statusHTML() { return '<div class="status" id="status"></div>'; }

function expRow(e) {
  const c = catOf(e.cat);
  return '<div class="exp"><div class="mid">' +
    '<div class="ttl">' + esc(e.note || c.label) + '</div>' +
    '<div class="sub">' + c.label + (e.cur && e.cur !== baseCur() && e.orig > 0 ? ' \u00B7 <span class="paid">' + moneyExact(e.orig, e.cur) + '</span>' : '') + '</div></div>' +
    '<div class="amt num">' + money(e.amount) + '</div>' +
    '<button class="iconbtn" data-act="edit" data-id="' + e.id + '" aria-label="Edit this spend">' + ICON.edit + '</button>' +
    '<button class="iconbtn" data-act="del" data-id="' + e.id + '" aria-label="Delete this spend">' + ICON.del + '</button></div>';
}

/* half-circle gauge: arc = budget used, tick = where the plan says you are */
function gaugeHTML(c) {
  const t = S.trip;
  const used = c.spendable > 0 ? c.spentTotal / c.spendable : (c.spentTotal > 0 ? 1.01 : 0);
  const shown = clamp(used, 0, 1);
  const over = used > 1;
  const f = c.status === 'before' ? 0 : (c.status === 'after' ? 1 : c.d / t.days);

  const cx = 160, cy = 156, th = Math.PI * f;
  const px = r => (cx - r * Math.cos(th)).toFixed(1);
  const py = r => (cy - r * Math.sin(th)).toFixed(1);
  const ARC = 'M30 156 A130 130 0 0 1 290 156';

  let pace = '';
  if (c.status === 'during') {
    // same threshold the advice uses, so the two never contradict each other
    const gap = c.safeToday - c.target, tol = Math.max(c.target * 0.04, 25);
    pace = gap < -tol ? '<span class="pace bad">' + money(-c.bank) + ' over pace</span>'
         : gap >  tol ? '<span class="pace ok">' + money(c.bank) + ' under pace</span>'
         :              '<span class="pace ok">On pace</span>';
  }

  const sub = c.status === 'before' ? 'not started' : 'spent · ' + Math.round(f * 100) + '% of days gone';

  return '<section class="band">' +
    '<div class="row"><span class="kicker">The whole trip</span>' + pace + '</div>' +
    '<div class="gauge"><svg viewBox="0 0 320 168" role="img" aria-label="' +
      Math.round(used * 100) + ' percent of the spendable budget used, with ' + Math.round(f * 100) + ' percent of the trip days gone">' +
      '<path d="' + ARC + '" fill="none" stroke="var(--rule)" stroke-width="14" stroke-linecap="round"/>' +
      (shown > 0 ? '<path d="' + ARC + '" fill="none" stroke="' + (over ? 'var(--red)' : 'var(--ink)') +
        '" stroke-width="14" stroke-linecap="round" pathLength="100" stroke-dasharray="' + (shown * 100).toFixed(2) + ' 100"/>' : '') +
      (c.status !== 'before'
        ? '<line x1="' + px(116) + '" y1="' + py(116) + '" x2="' + px(152) + '" y2="' + py(152) +
          '" stroke="var(--red)" stroke-width="2"/><circle cx="' + px(152) + '" cy="' + py(152) + '" r="3.2" fill="var(--red)"/>'
        : '') +
    '</svg><div class="mid"><div class="pct num' + (over ? ' bad' : '') + '">' + Math.round(used * 100) + '%</div>' +
      '<div class="small mut">' + sub + '</div></div></div>' +
    '<div class="ends num"><span>₹0</span><span>' + money(c.spendable) + ' spendable</span></div>' +
    '</section>';
}

/* daily bars against the flat plan line */
function chartHTML(c) {
  const t = S.trip;
  let from = 1, to = t.days;
  if (t.days > 14) { from = clamp(c.d - 9, 1, Math.max(1, t.days - 13)); to = Math.min(t.days, from + 13); }

  const vals = [];
  for (let i = from; i <= to; i++) {
    const ds = addDays(t.start, i - 1);
    vals.push({ i: i, v: sum(S.expenses.filter(e => e.date === ds).map(e => e.amount)) });
  }

  const W = 320, base = 92, ph = 62, top = base - ph;
  const mx = Math.max(c.target * 1.4, Math.max.apply(null, vals.map(x => x.v)), 1);
  const slot = W / vals.length, bw = Math.min(26, slot * 0.6);

  let s = '<svg viewBox="0 0 ' + W + ' 110" width="100%" style="display:block;margin-top:10px" role="img" ' +
          'aria-label="Spending each day against a plan of ' + money(c.target) + ' a day">';
  s += '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" stroke="var(--ink)" stroke-width="1"/>';

  vals.forEach((x, k) => {
    const xx = k * slot + (slot - bw) / 2;
    const isToday = c.status === 'during' && x.i === c.d;
    const future = x.i > c.d;
    if (x.v > 0) {
      const h = Math.max(2, x.v / mx * ph);
      const col = x.v > c.target ? 'var(--red)' : 'var(--ink)';
      s += '<rect x="' + xx.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + bw.toFixed(1) +
           '" height="' + h.toFixed(1) + '" fill="' + col + '"><title>Day ' + x.i + ': ' + money(x.v) + '</title></rect>';
    } else if (future) {
      s += '<rect x="' + xx.toFixed(1) + '" y="' + top + '" width="' + bw.toFixed(1) + '" height="' + ph +
           '" fill="none" stroke="var(--rule)" stroke-dasharray="2 3"/>';
    }
    if (isToday) s += '<rect x="' + xx.toFixed(1) + '" y="' + (base + 3) + '" width="' + bw.toFixed(1) + '" height="2" fill="var(--red)"/>';
    if (vals.length <= 10 || x.i % 2 === from % 2 || isToday)
      s += '<text x="' + (k * slot + slot / 2).toFixed(1) + '" y="107" text-anchor="middle"' +
           (isToday ? ' style="fill:var(--red);font-weight:700"' : '') + '>' + x.i + '</text>';
  });

  const ty = base - c.target / mx * ph;
  s += '<line x1="0" x2="' + W + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) +
       '" stroke="var(--ink)" stroke-width="1" stroke-dasharray="4 4" opacity=".55"/>';
  s += '<text x="' + W + '" y="' + Math.max(9, ty - 5).toFixed(1) + '" text-anchor="end">PLAN ' + money(c.target) + '</text></svg>';

  return s;
}

/* the headline restated in the currency you last spent in, if it isn't the home one */
function localLine(v) {
  const lc = S.trip.lastCur;
  if (!(v > 0) || !lc || lc === baseCur()) return '';
  const r = knownRate(lc);
  if (!r) return '';
  return '<div class="inlocal num">\u2248 ' + money(v / r, lc) + (symbolOf(lc) === '$' ? ' ' + lc : '') + '</div>';
}

function todayHTML(c) {
  let h = '';
  const cls = 'big num' + (pulse ? ' pulse' : '');

  if (c.status === 'before') {
    const n = 1 - c.raw;
    h += '<div class="lead">Leaving in</div><div class="' + cls + '">' + n + ' day' + (n === 1 ? '' : 's') + '</div>' +
         '<div class="small mut undertow">' + money(c.target) + ' a day once you go.</div>';
  } else if (c.status === 'after') {
    const left = c.spendable - c.spentTotal;
    h += '<div class="lead">' + (left >= 0 ? 'Under budget by' : 'Over budget by') + '</div>' +
         '<div class="' + cls + (left < 0 ? ' neg' : '') + '">' + money(Math.abs(left)) + '</div>' +
         '<div class="small mut undertow">' + money(c.avg) + ' a day average.</div>';
  } else {
    const gone = c.safeToday <= 0, over = c.leftToday < 0;
    h += '<div class="lead">' + (gone ? 'Nothing left today' : over ? 'Over today by' : 'Left to spend today') + '</div>' +
         '<div class="' + cls + ((over || gone) ? ' neg' : '') + '">' + (gone ? money(0) : money(over ? -c.leftToday : c.leftToday)) + '</div>' +
         localLine(gone || over ? 0 : c.leftToday) +
         '<div class="row small mut num undertow"><span>Spent ' + money(c.spentToday) + '</span>' +
         '<span>Ceiling ' + money(Math.max(0, c.safeToday)) + '</span></div>';
  }

  h += gaugeHTML(c);

  const avgTone = c.d > 0 ? (c.avg > c.target * 1.05 ? 'bad' : (c.avg < c.target * 0.95 ? 'ok' : '')) : '';
  h += '<div class="tiles">' +
       '<div class="tile"><div class="t">Plan / day</div><div class="v num">' + money(c.target) + '</div></div>' +
       '<div class="tile"><div class="t">Average</div><div class="v num ' + avgTone + '">' + (c.d > 0 ? money(c.avg) : '—') + '</div></div>' +
       '<div class="tile"><div class="t">Left</div><div class="v num ' + (c.remainingBudget < 0 ? 'bad' : '') + '">' + money(c.remainingBudget) + '</div></div>' +
       '</div>';

  h += '<section class="sect"><div class="kicker">Each day vs plan</div>' + chartHTML(c) + '</section>';
  h += suggestions(c).map(s =>
    '<aside class="note ' + s.tone + '"><div class="h">' + esc(s.h) + '</div><p>' + esc(s.p) + '</p></aside>').join('');

  const todays = S.expenses.filter(e => e.date === c.today);
  h += '<section class="sect"><div class="kicker">Today</div><div class="rulet"></div>' +
       (todays.length
         ? todays.slice().reverse().map(expRow).join('') +
           '<div class="lx tot"><span class="l">Today</span><span class="d"></span><span class="v num">' + money(c.spentToday) + '</span></div>'
         : '<p class="empty">Nothing yet today.</p>') +
       '</section>';
  return h;
}

function totalsHTML(c) {
  const t = S.trip, hot = hotCat(c), left = c.remainingBudget;
  let h = '<h2 class="pg">Totals</h2>';

  if (hot) h += '<aside class="note warn"><div class="h">' + esc(hot.label) + ' running high</div>' +
                '<p>' + money(hot.excess) + ' over its share.</p></aside>';

  h += '<section class="sect"><div class="kicker">By category</div><div class="rulet"></div>' +
    c.cats.map(k => {
      const pct = k.budget > 0 ? clamp(k.spent / k.budget * 100, 0, 100) : (k.spent > 0 ? 100 : 0);
      const over = k.spent > k.budget;
      const note = over ? money(k.spent - k.budget) + ' past its share'
                 : c.remaining > 0 ? money(Math.max(0, k.safe)) + ' a day left'
                 : money(k.budget - k.spent) + ' unused';
      return '<div class="cat"><div class="row"><span class="nm">' + k.label + '</span>' +
        '<span class="num small">' + money(k.spent) + ' <span class="mut">of ' + money(k.budget) + '</span></span></div>' +
        '<div class="meter' + (over ? ' over' : '') + '"><div style="width:' + pct.toFixed(1) + '%"></div></div>' +
        '<div class="note2">' + note + (hot && hot.id === k.id ? ' · running high' : '') + '</div></div>';
    }).join('') + '</section>';

  h += '<section class="sect"><div class="kicker">The budget</div><div class="rulet"></div>' +
    '<div class="lx"><span class="l">Total</span><span class="d"></span><span class="v num">' + money(t.total) + '</span></div>' +
    '<div class="lx sub"><span class="l">Prepaid</span><span class="d"></span><span class="v num">− ' + money(c.prepaidTotal) + '</span></div>' +
    '<div class="lx sub"><span class="l">Buffer, ' + t.bufferPct + '%</span><span class="d"></span><span class="v num">− ' + money(c.buffer) + '</span></div>' +
    '<div class="lx tot"><span class="l">Spendable</span><span class="d"></span><span class="v num">' + money(c.spendable) + '</span></div>' +
    '<div class="lx"><span class="l">Spent</span><span class="d"></span><span class="v num">' + money(c.spentTotal) + '</span></div>' +
    '<div class="lx fin"><span class="l">' + (left >= 0 ? 'Left' : 'Over by') + '</span><span class="d"></span>' +
      '<span class="v num' + (left < 0 ? ' bad' : '') + '">' + money(Math.abs(left)) + '</span></div>' +
    '</section>';

  if (t.prepaid.length) {
    h += '<section class="sect"><div class="kicker">Prepaid</div><div class="rulet"></div>' +
      t.prepaid.map(p => '<div class="lx"><span class="l">' + esc(p.label) + '</span><span class="d"></span>' +
        '<span class="v num">' + money(p.amount) + '</span></div>').join('') + '</section>';
  }
  return h;
}

function daysHTML(c) {
  const dates = [...new Set(S.expenses.map(e => e.date))].sort().reverse();
  let h = '<h2 class="pg">Days</h2>';
  if (!dates.length) return h + '<p class="empty">Nothing logged yet.</p>';

  dates.forEach(ds => {
    const items = S.expenses.filter(e => e.date === ds);
    const tot = sum(items.map(e => e.amount));
    const dn = dayNum(S.trip.start, ds);
    const inTrip = dn >= 1 && dn <= S.trip.days;
    const isToday = ds === c.today;
    const diff = tot - c.target;
    // a day still in progress has not come in over or under anything yet
    const flag = (isToday || ds > c.today || Math.abs(diff) <= c.target * 0.05) ? ''
      : diff > 0 ? '<span class="flag bad">' + money(diff) + ' over</span>'
                 : '<span class="flag ok">' + money(-diff) + ' under</span>';
    h += '<section class="daygrp">' +
      '<div class="daynum' + (isToday ? ' now' : '') + '" aria-hidden="true">' + (inTrip ? dn : '·') + '</div>' +
      '<div class="daybody"><div class="dayhead"><span class="dt">' + fmtDate(ds) + (isToday ? ' · today' : '') + '</span>' +
      '<span class="dayright"><span class="daysum num">' + money(tot) + '</span>' + flag + '</span></div>' +
      items.slice().reverse().map(expRow).join('') + '</div></section>';
  });
  return h;
}

/* ------------------------------------------------------- the trip form */

function freshDraft() {
  if (S) {
    const t = S.trip;
    return { name: t.name, currency: t.currency, total: String(t.total), start: t.start, days: String(t.days),
             buffer: String(t.bufferPct),
             prepaid: t.prepaid.map(p => ({ label: p.label, amount: String(p.amount) })),
             shares: Object.assign({}, t.shares) };
  }
  return { name: '', currency: 'INR', total: '', start: todayStr(), days: '7', buffer: '5', prepaid: [], shares: Object.assign({}, DEFAULT_SHARES) };
}

function formHTML(isNew) {
  if (!F) F = freshDraft();
  let h = '';
  if (isNew) h += '<h1 class="pg">Set up the trip</h1>' +
                  '<p class="pgsub">A strict budget in, a daily ceiling out.</p>';
  else       h += '<h2 class="pg">Trip</h2><p class="pgsub">Your spends stay put.</p>';

  h += '<div class="card" style="margin-top:14px">' +
    '<label class="f" style="margin-top:0">Trip name<input data-f="name" value="' + esc(F.name) + '" placeholder="Goa, December" autocomplete="off"></label>' +
    currencyField() +
    '<label class="f">Total budget, ' + esc(symbolOf(F.currency)) + '<input data-f="total" type="number" inputmode="decimal" min="0" value="' + esc(F.total) + '" placeholder="35000"></label>' +
    '<div class="grid2">' +
      '<label class="f">Start date<input data-f="start" type="date" value="' + esc(F.start) + '"></label>' +
      '<label class="f">Days<input data-f="days" type="number" inputmode="numeric" min="1" max="365" value="' + esc(F.days) + '"></label>' +
    '</div>' +
    '<label class="f">Emergency buffer, % held back<input data-f="buffer" type="number" inputmode="decimal" min="0" max="50" value="' + esc(F.buffer) + '"></label>' +
    '<p class="hint">Held back before the daily figure is worked out.</p>' +

    '<label class="f" style="margin-top:20px">Paid before leaving</label>' +
    '<p class="hint">Flights, hotels. Comes off the top, never touches your daily average.</p>' +
    F.prepaid.map((p, i) =>
      '<div class="ppr"><input data-pl="' + i + '" value="' + esc(p.label) + '" placeholder="Flight" aria-label="What it was for">' +
      '<input data-pa="' + i + '" type="number" inputmode="decimal" value="' + esc(p.amount) + '" placeholder="' + esc(symbolOf(F.currency)) + '" aria-label="Amount">' +
      '<button class="iconbtn" data-act="rmpp" data-i="' + i + '" aria-label="Remove this item">' + ICON.x + '</button></div>').join('') +
    '<button class="linkbtn" data-act="addpp">+ Add an item</button>' +

    '<label class="f" style="margin-top:18px">Split of what is left, %</label>' +
    '<div class="shares">' + CATS.map(k =>
      '<span>' + k.label + '</span><input data-sh="' + k.id + '" type="number" inputmode="decimal" min="0" max="100" value="' +
      esc(F.shares[k.id]) + '" aria-label="' + k.label + ' percent">').join('') + '</div>' +
    '<div class="hint" id="shareSum"></div>' +
    '<div class="err" id="formErr" role="alert"></div>' +
    '<button class="btn primary block" data-act="savetrip">' + (isNew ? 'Start tracking' : 'Save changes') + '</button>' +
    '</div>';

  if (!isNew) {
    h += '<section class="sect"><div class="kicker">Backup</div><div class="rulet"></div></section>' +
      '<div class="card" style="margin-top:12px">' +
      '<p class="hint" style="margin-top:0">Saved automatically. A backup is a JSON copy you keep yourself.</p>' +
      '<div class="btnrow"><button class="btn" data-act="export">Download backup</button>' +
      '<button class="btn" data-act="copyjson">Copy backup</button></div>' +
      '<label class="f">Restore from a backup<textarea data-imp placeholder="Paste backup text here"></textarea></label>' +
      '<div class="btnrow"><button class="btn" data-act="import">Restore</button>' +
      '<label class="btn" style="display:inline-flex;align-items:center;cursor:pointer;margin:0">Choose file' +
      '<input type="file" accept=".json,application/json" data-file style="display:none"></label></div></div>' +
      '<section class="sect"><div class="kicker">Start over</div><div class="rulet"></div></section>' +
      '<div class="card" style="margin-top:12px"><button class="btn danger block" data-act="reset">Delete this trip and all its spends</button></div>';
  }
  setTimeout(updateShareSum, 0);
  return h;
}

function curOptions(selected, short, order) {
  const codes = (order || []).filter(isCur);
  Object.keys(CURRENCIES).forEach(k => { if (codes.indexOf(k) < 0) codes.push(k); });
  return codes.map(k => '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' +
    (short ? k : k + ' \u2014 ' + CURRENCIES[k]) + '</option>').join('');
}
function currencyField() {
  // the budget's currency can't move once spends are converted into it
  const locked = !!(S && S.expenses.length);
  return '<label class="f">Home currency' +
    '<select data-f="currency"' + (locked ? ' disabled' : '') + '>' + curOptions(F.currency, false, ['INR']) + '</select></label>' +
    '<p class="hint">' + (locked ? 'Fixed once spends are logged.' : 'The budget and every total use this. Spends can be in any currency.') + '</p>';
}

function updateShareSum() {
  const el = $('#shareSum');
  if (!el || !F) return;
  const s = sum(CATS.map(k => Number(F.shares[k.id]) || 0));
  el.innerHTML = Math.abs(s - 100) < 0.5
    ? 'Adds up to 100%.'
    : '<span style="color:var(--red)">Adds up to ' + (Math.round(s * 10) / 10) + '%. It needs to be 100%.</span>';
}

function saveTrip() {
  const err = m => { $('#formErr').textContent = m; };
  const total = Number(F.total), days = Math.round(Number(F.days)), buf = Number(F.buffer) || 0;
  const prepaid = F.prepaid
    .map(p => ({ id: uid(), label: p.label.trim() || 'Prepaid', amount: Number(p.amount) || 0 }))
    .filter(p => p.amount > 0);
  const shares = {}; let s = 0;
  CATS.forEach(k => { shares[k.id] = Number(F.shares[k.id]) || 0; s += shares[k.id]; });

  if (!(total > 0)) return err('Enter the total budget.');
  if (!validDate(F.start)) return err('Pick a start date.');
  if (!(days >= 1 && days <= 365)) return err('The trip has to be 1 to 365 days.');
  if (buf < 0 || buf > 50) return err('The buffer has to be between 0 and 50%.');
  if (sum(prepaid.map(p => p.amount)) + total * buf / 100 >= total)
    return err('Prepaid items and the buffer use up the whole budget.');
  if (Math.abs(s - 100) >= 0.5) return err('The split has to add up to 100%.');

  const locked = !!(S && S.expenses.length);
  const currency = locked ? S.trip.currency : (isCur(F.currency) ? F.currency : 'INR');
  const lastCur = S && isCur(S.trip.lastCur) ? S.trip.lastCur : currency;
  const trip = { name: F.name.trim() || 'My trip', currency: currency, lastCur: lastCur,
                 total: total, start: F.start, days: days, bufferPct: buf, prepaid: prepaid, shares: shares };
  const wasNew = !S;
  if (S) S.trip = trip; else S = { trip: trip, expenses: [], updatedAt: 0 };
  F = null; view = 'today'; queueSave(); render();
  track(wasNew ? 'trip_created' : 'trip_updated', { trip_days: days, prepaid_items: prepaid.length, buffer_pct: buf, currency: currency });
  refreshRates(currency);
  toast(wasNew ? 'Trip set up' : 'Saved');
}

/* ------------------------------------------------------ add / edit sheet */

function openSheet(id) {
  const today = todayStr();
  if (id) {
    const e = S.expenses.find(x => x.id === id);
    if (!e) return;
    A = { id: id, amount: String(e.orig), cat: e.cat, note: e.note, date: e.date, showDate: e.date !== today,
          cur: e.cur, rate: e.cur === baseCur() ? 1 : e.rate, rateSrc: 'saved' };
  } else {
    A = { id: null, amount: '', cat: 'food', note: '', date: today, showDate: false, cur: S.trip.lastCur || baseCur() };
    pickRate();
  }
  A.inv = invFor(A.cur, A.rate);
  drawSheet();
  if (A.cur !== baseCur()) waitForLiveRate();
  setTimeout(() => { const i = $('#amtIn'); if (i) i.focus(); }, 60);
}

/* ask for the rate the way people say it: whichever side reads as a number above 0.1 */
function invFor(cur, rate) {
  if (!(rate > 0)) {
    const b = MAGNITUDE[baseCur()], c = MAGNITUDE[cur];
    rate = b && c ? b / c : 1;
  }
  return rate < 0.1;
}
function pickRate() {
  const live = liveRate(A.cur), last = lastUsedRate(A.cur);
  if (A.cur === baseCur()) { A.rate = 1; A.rateSrc = 'base'; }
  else if (live) { A.rate = live; A.rateSrc = 'live'; }
  else if (last) { A.rate = last; A.rateSrc = 'last'; }
  else { A.rate = null; A.rateSrc = null; }
}
/* a fresher rate may land while the sheet is open; take it unless the person typed their own */
function waitForLiveRate() {
  const cur = A.cur;
  refreshRates(baseCur()).then(() => {
    if (!A || A.cur !== cur || A.rateSrc === 'manual' || A.rateSrc === 'saved') return;
    const live = liveRate(cur);
    if (live && (A.rateSrc !== 'live' || A.rate !== live)) {
      A.rate = live; A.rateSrc = 'live'; A.inv = invFor(cur, live); A.editRate = false; updateFx();
    }
  });
}
function rateLabel() {
  const b = baseCur();
  return A.inv ? money(1, b) + ' = ' + numStr(1 / A.rate) + ' ' + A.cur
               : '1 ' + A.cur + ' = ' + symbolOf(b) + numStr(A.rate);
}
function convHTML() {
  const amt = Number(A.amount);
  return amt > 0 && A.rate > 0 ? '≈ ' + money(amt * A.rate) : '';
}
function fxHTML() {
  const b = baseCur();
  if (A.cur === b) return '';
  const src = A.rateSrc === 'live'
      ? (RATES && Date.now() - RATES.at > 36 * 3600e3 ? 'rate from ' + fmtDate(new Date(RATES.at).toISOString().slice(0, 10)) : 'today’s rate') +
        ' · <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates by Exchange Rate API</a>'
    : A.rateSrc === 'last' ? 'your last ' + A.cur + ' rate'
    : A.rateSrc === 'saved' ? 'rate when logged'
    : A.rateSrc === 'manual' ? 'your rate' : '';
  if (A.editRate || !(A.rate > 0)) {
    const shown = A.rate > 0 ? numStr(A.inv ? 1 / A.rate : A.rate) : '';
    const lab = A.inv ? money(1, b) + ' buys how many ' + A.cur + '?' : '1 ' + A.cur + ' is how many ' + symbolOf(b) + '?';
    return '<div class="fxline"><span class="conv num" id="fxConv">' + convHTML() + '</span></div>' +
      '<label class="f" style="margin-top:8px">' + esc(lab) +
      '<input data-a="rate" id="rateIn" type="number" inputmode="decimal" min="0" step="any" value="' + esc(shown) + '"></label>' +
      (A.rate > 0 ? '' : '<p class="hint">No rate saved for ' + A.cur + ' yet, and none could be fetched.</p>');
  }
  return '<div class="fxline"><span class="conv num" id="fxConv">' + convHTML() + '</span>' +
    '<span class="num">' + esc(rateLabel()) + '</span>' +
    '<button class="linkbtn" data-act="editrate">Change</button></div>' +
    '<p class="hint" style="margin-top:0">' + src + '</p>';
}
function updateFx() { const el = $('#fx'); if (el) el.innerHTML = fxHTML(); }
function updateConv() { const el = $('#fxConv'); if (el) el.innerHTML = convHTML(); }
function setCur(cur) {
  if (!isCur(cur) || cur === A.cur) return;
  A.cur = cur; A.editRate = false;
  pickRate();
  A.inv = invFor(cur, A.rate);
  drawSheet();
  if (cur !== baseCur()) waitForLiveRate();
  const i = $('#amtIn'); if (i) i.focus();
}

function drawSheet() {
  const today = todayStr();
  $('#overlay').innerHTML =
    '<div class="overlay" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="' +
    (A.id ? 'Edit spend' : 'Add spend') + '">' +
    '<h3>' + (A.id ? 'Edit spend' : 'What did you spend?') + '</h3>' +
    '<div class="amtrow">' +
      '<input id="amtIn" class="amtin num" data-a="amount" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="' +
        esc(A.amount) + '" aria-label="Amount in ' + esc(CURRENCIES[A.cur]) + '">' +
      '<select class="cursel" data-a="cur" aria-label="Currency paid in">' +
        curOptions(A.cur, true, [baseCur(), S.trip.lastCur].concat(S.expenses.map(e => e.cur))) + '</select>' +
    '</div>' +
    '<div class="fx" id="fx">' + fxHTML() + '</div>' +
    '<div class="chips">' + CATS.map(k =>
      '<button class="chip' + (A.cat === k.id ? ' on' : '') + '" data-act="pickcat" data-c="' + k.id + '"' +
      (A.cat === k.id ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + k.label + '</button>').join('') + '</div>' +
    '<input data-a="note" style="margin-top:14px" placeholder="Note, e.g. lunch at the beach shack" value="' + esc(A.note) + '" autocomplete="off" aria-label="Note">' +
    (A.showDate
      ? '<label class="f">Day<input data-a="date" type="date" max="' + today + '" value="' + esc(A.date) + '"></label>'
      : '<div class="row" style="margin-top:10px"><span class="small mut">' + (A.date === today ? 'Today, ' : '') + fmtDate(A.date) + '</span>' +
        '<button class="linkbtn" data-act="showdate">Another day</button></div>') +
    '<div class="err" id="sheetErr" role="alert"></div>' +
    '<div style="display:flex;gap:10px;margin-top:4px">' +
    '<button class="btn" data-act="closesheetbtn">Cancel</button>' +
    '<button class="btn primary" style="flex:1" data-act="saveexp">' + (A.id ? 'Save' : 'Add it') + '</button></div></div></div>';
}

function saveExp() {
  const orig = Number(A.amount), base = baseCur(), foreign = A.cur !== base;
  const rate = foreign ? Number(A.rate) : 1;
  if (!(orig > 0)) { $('#sheetErr').textContent = 'Enter an amount above zero.'; return; }
  if (!(rate > 0)) { $('#sheetErr').textContent = 'Enter the exchange rate for ' + A.cur + '.'; return; }
  if (!validDate(A.date)) { $('#sheetErr').textContent = 'Pick a valid day.'; return; }
  const fields = { cat: A.cat, note: A.note.trim(), date: A.date, cur: A.cur, orig: orig, rate: rate,
                   amount: foreign ? Math.round(orig * rate * 100) / 100 : orig };
  if (A.id) {
    const e = S.expenses.find(x => x.id === A.id);
    if (e) Object.assign(e, fields);
  } else {
    S.expenses.push(Object.assign({ id: uid() }, fields));
  }
  S.trip.lastCur = A.cur;
  const wasNew = !A.id;
  track(wasNew ? 'spend_logged' : 'spend_edited', { category: A.cat, backdated: A.date !== todayStr(), has_note: !!A.note.trim(),
        currency: A.cur, foreign: foreign });
  A = null;
  $('#overlay').innerHTML = '';
  pulse = true;
  queueSave(); render();
  toast(wasNew ? 'Logged' : 'Updated');
}

/* --------------------------------------------------------------- misc UI */

let toastT = null;
function toast(m) {
  const el = $('#toast');
  el.innerHTML = '<div class="toast" role="status">' + esc(m) + '</div>';
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.innerHTML = ''; }, 2200);
}

let confirmFn = null;
function confirmBox(msg, yes, fn) {
  confirmFn = fn;
  $('#overlay').innerHTML =
    '<div class="overlay" style="align-items:center"><div class="dlg" role="alertdialog" aria-modal="true"><p>' + esc(msg) + '</p>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end">' +
    '<button class="btn" data-act="cfno">Cancel</button>' +
    '<button class="btn danger" data-act="cfyes">' + esc(yes) + '</button></div></div></div>';
}

function backupText() {
  return JSON.stringify({ app: 'trip-budget', version: 2, exportedAt: new Date().toISOString(),
                          trip: S.trip, expenses: S.expenses }, null, 2);
}
function importText(txt) {
  try {
    const o = JSON.parse(txt);
    if (!o || !o.trip || !Array.isArray(o.expenses)) throw new Error('shape');
    const next = normalize(o);
    if (!(next.trip.total > 0)) throw new Error('empty');
    S = next; F = null; view = 'today';
    queueSave(); render(); toast('Backup restored'); track('backup_restored');
  } catch (e) { toast('That does not look like a backup file'); }
}

async function doExport() {
  const name = 'trip-budget-' + todayStr() + '.json';
  const text = backupText();
  if (saver) {                                   // inside Claude
    try { await saver.save({ filename: name, data: text }); toast('Backup saved'); }
    catch (e) { if (!e || e.code !== 'declined') toast('Could not save it. Try Copy backup.'); }
    return;
  }
  try {                                          // ordinary web page
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Backup downloaded');
  } catch (e) { toast('Could not download it. Try Copy backup.'); }
}

/* ---------------------------------------------------------------- events */

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'closesheet') { if (ev.target !== el) return; A = null; $('#overlay').innerHTML = ''; return; }
  if (act === 'closesheetbtn') { A = null; $('#overlay').innerHTML = ''; return; }

  switch (act) {
    case 'tab': view = el.dataset.v; F = null; render(); window.scrollTo(0, 0); track('tab_view', { tab: view }); break;
    case 'theme': applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true); render(); track('theme_changed', { theme: currentTheme() }); break;
    case 'add': openSheet(null); break;
    case 'edit': openSheet(el.dataset.id); break;
    case 'del': {
      const id = el.dataset.id;
      confirmBox('Delete this spend?', 'Delete', () => {
        S.expenses = S.expenses.filter(e => e.id !== id);
        queueSave(); render(); toast('Deleted'); track('spend_deleted');
      });
      break;
    }
    case 'pickcat': A.cat = el.dataset.c; drawSheet(); { const i = $('#amtIn'); if (i) i.focus(); } break;
    case 'showdate': A.showDate = true; drawSheet(); break;
    case 'editrate': A.editRate = true; updateFx(); { const r = $('#rateIn'); if (r) r.focus(); } break;
    case 'saveexp': saveExp(); break;
    case 'addpp': F.prepaid.push({ label: '', amount: '' }); render(); break;
    case 'rmpp': F.prepaid.splice(Number(el.dataset.i), 1); render(); break;
    case 'savetrip': saveTrip(); break;
    case 'export': track('backup_downloaded'); doExport(); break;
    case 'copyjson':
      track('backup_copied');
      try { await navigator.clipboard.writeText(backupText()); toast('Backup copied'); }
      catch (e) {
        const ta = $('[data-imp]');
        if (ta) { ta.value = backupText(); ta.select(); toast('Copy the text from the box'); }
      }
      break;
    case 'import': {
      const ta = $('[data-imp]');
      if (ta && ta.value.trim()) importText(ta.value); else toast('Paste a backup first');
      break;
    }
    case 'reset':
      confirmBox('This deletes the trip and every spend in it. Download a backup first if you might want it.',
        'Delete it all', () => {
          S = null; F = null; view = 'today';
          track('trip_reset');
          writeLocal(); if (cloudRef) flush();
          render();
        });
      break;
    case 'cfyes': { const f = confirmFn; confirmFn = null; $('#overlay').innerHTML = ''; if (f) f(); break; }
    case 'cfno': confirmFn = null; $('#overlay').innerHTML = ''; break;
  }
});

document.addEventListener('input', ev => {
  const t = ev.target;
  if (A && t.dataset.a) {
    const k = t.dataset.a;
    if (k === 'cur') { setCur(t.value); return; }
    if (k === 'rate') {
      const v = Number(t.value);
      A.rate = v > 0 ? (A.inv ? 1 / v : v) : null;
      A.rateSrc = 'manual';
      updateConv();
      return;
    }
    A[k] = t.value;
    if (k === 'amount') updateConv();
    return;
  }
  if (F && t.dataset.f === 'currency') { F.currency = t.value; render(); return; }
  if (!F) return;
  if (t.dataset.f !== undefined) F[t.dataset.f] = t.value;
  else if (t.dataset.sh !== undefined) { F.shares[t.dataset.sh] = t.value; updateShareSum(); }
  else if (t.dataset.pl !== undefined) F.prepaid[Number(t.dataset.pl)].label = t.value;
  else if (t.dataset.pa !== undefined) F.prepaid[Number(t.dataset.pa)].amount = t.value;
});

document.addEventListener('change', ev => {
  const t = ev.target;
  // some mobile browsers only fire change, not input, for <select>
  if (A && t.dataset.a === 'cur') { setCur(t.value); return; }
  if (F && t.dataset.f === 'currency' && F.currency !== t.value) { F.currency = t.value; render(); return; }
  if (t.dataset.file !== undefined && t.files && t.files[0]) {
    const r = new FileReader();
    r.onload = () => importText(String(r.result));
    r.readAsText(t.files[0]);
  }
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && A && ev.target.tagName === 'INPUT' && ev.target.type !== 'date') { ev.preventDefault(); saveExp(); }
  if (ev.key === 'Escape') {
    if (A) { A = null; $('#overlay').innerHTML = ''; }
    else if (confirmFn) { confirmFn = null; $('#overlay').innerHTML = ''; }
  }
});

boot();
