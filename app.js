// Trade desk app. Plain JS. The APP_TOKEN arrives once in the #t= fragment, moves to localStorage,
// and the fragment is wiped. It is only ever sent in the Authorization header, never in a URL.
(() => {
  const m = location.hash.match(/[#&]t=([^&]+)/);
  if (m) { localStorage.setItem('desk_token', decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + '#/home'); }
})();
// Plan B (static hosting): the data folder name arrives once in the #d= fragment, moves to localStorage,
// and the fragment is wiped. The app then polls read-only JSON snapshots; nothing is ever written back.
(() => {
  const m = location.hash.match(/[#&]d=([A-Za-z0-9_-]{32,})/);
  if (m) { localStorage.setItem('desk_data', m[1]); history.replaceState(null, '', location.pathname + '#/home'); }
})();
const TOKEN = () => localStorage.getItem('desk_token') || '';
const DATA_BASE = 'https://onirez.github.io/trade-desk-data/d/';
const PLANB = () => !!localStorage.getItem('desk_data') && !TOKEN();
const RO_MSG = 'Read-only here · change it from Telegram';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt$ = v => v == null ? '–' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fmtK = v => v == null ? 'n/a' : '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0));
const fmtP = v => v == null ? '–' : (v >= 1 ? v.toFixed(4) : v.toPrecision(4));
const hhmm = ts => ts ? new Date(ts * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '–';
const short = m => m ? m.slice(0, 4) + '…' + m.slice(-4) : '';

const S = {state: null, lastOk: 0, offline: false, retryIn: 0, range: 'LIVE', unread: 0};

const DC = {};
async function dget(file) {
  const c = DC[file]; if (c && Date.now() - c.t < 20000) return c.v;
  const r = await fetch(DATA_BASE + encodeURIComponent(localStorage.getItem('desk_data')) + '/' + file + '?v=' + Math.floor(Date.now() / 30000), {cache: 'no-store'});
  if (r.status === 404) { const e = new Error('not published'); e.code = 404; throw e; }
  if (!r.ok) throw new Error('http ' + r.status);
  const v = await r.json(); DC[file] = {t: Date.now(), v};
  S.lastOk = Date.now(); setOffline(false);
  if (file === 'state.json' && v.state && Date.now() / 1000 - v.state.ts > 900) {
    const el = $('#offline'); el.hidden = false; el.textContent = 'Last snapshot ' + hhmm(v.state.ts) + ' · the desk may be down';
  }
  return v;
}
async function apiStatic(path) {
  const u = new URL(path, location.href), p = u.pathname.split('/').map(decodeURIComponent);
  if (u.pathname === '/api/state') return (await dget('state.json')).state;
  if (u.pathname === '/api/chart') { const c = await dget('chart.json'); return c[(u.searchParams.get('range') || 'LIVE').toUpperCase()] || c.LIVE; }
  if (u.pathname === '/api/activity') return u.searchParams.get('before') ? {rows: []} : dget('activity.json');
  if (p[2] === 'agents') return (await dget('state.json')).decisions[p[3]] || {rows: []};
  if (p[2] === 'coin') return (await dget('coin/' + encodeURIComponent(p[3]) + '.json')).coin;
  if (p[2] === 'audit') return (await dget('coin/' + encodeURIComponent(p[3]) + '.json')).audit;
  if (u.pathname === '/api/account') return (await dget('state.json')).account;
  if (u.pathname === '/api/settings') return {settings: (await dget('state.json')).settings};
  if (u.pathname === '/api/notifications') return {rows: (await dget('state.json')).notifications};
  if (u.pathname === '/api/search') {
    const q = (u.searchParams.get('q') || '').trim().toLowerCase().replace(/^\$/, '');
    return {rows: (await dget('state.json')).coins.filter(c => c.mint.toLowerCase() === q || (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q)).slice(0, 10)};
  }
  throw new Error('not in snapshot');
}
async function api(path, opts = {}) {
  if (PLANB()) {
    if (opts.method === 'POST') { toast(RO_MSG); return new Promise(() => {}); }
    return apiStatic(path);
  }
  const r = await fetch(path, {...opts, headers: {'Authorization': 'Bearer ' + TOKEN(), 'Content-Type': 'application/json', ...(opts.headers || {})}, cache: 'no-store'});
  if (r.status === 401) { const e = new Error('unauthorized'); e.code = 401; throw e; }
  if (!r.ok) throw new Error('http ' + r.status);
  S.lastOk = Date.now(); setOffline(false);
  return r.json();
}
const post = (p, b) => api(p, {method: 'POST', body: JSON.stringify(b || {})});

let retryTimer = null;
function setOffline(on) {
  const el = $('#offline');
  if (!on) { S.offline = false; el.hidden = true; clearInterval(retryTimer); retryTimer = null; return; }
  if (S.offline) return;
  S.offline = true; S.retryIn = 5; el.hidden = false;
  const draw = () => { el.textContent = `Desk offline · retrying in ${S.retryIn}s · last update ${S.lastOk ? new Date(S.lastOk).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : 'never'}`; };
  draw();
  retryTimer = setInterval(() => { S.retryIn--; if (S.retryIn <= 0) { S.retryIn = 5; render(true); } draw(); }, 1000);
}
function fail(e) {
  if (e && e.code === 401) { $('#view').innerHTML = `<div class="navbar"><div class="title">Trade desk</div></div><div class="card">This link has no valid access token. Open the app once with the private link (…#t=…) that was given to you.</div>`; return; }
  if (e && e.code === 404 && PLANB()) { $('#view').innerHTML = backNav('Trade desk') + `<div class="card">Not in the latest snapshot yet. Snapshots are published about every 7 minutes.</div>`; return; }
  setOffline(true);
}
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }

// ---------- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left
function odometer(el, text) {
  const old = el.dataset.v || '';
  if (reduce || !old || old.length !== text.length) {
    el.innerHTML = [...text].map(ch => /\d/.test(ch) ? `<span class="odo-d"><span class="odo-s" style="transform:translateY(-${ch * 66}px)">${[...'0123456789'].map(d => `<span>${d}</span>`).join('')}</span></span>` : `<span>${esc(ch)}</span>`).join('');
  } else {
    const kids = [...el.children];
    [...text].forEach((ch, i) => {
      if (ch === old[i] || !/\d/.test(ch)) return;
      const s = kids[i] && kids[i].querySelector('.odo-s'); if (!s) return;
      s.style.transitionDelay = ((text.length - 1 - i) * 30) + 'ms';
      s.style.transform = `translateY(-${ch * 66}px)`;
    });
  }
  el.dataset.v = text;
}

// ---------- router
const routes = {home: Home, agents: Agents, activity: Activity, account: Account, coin: Coin, auditor: Auditor};
function route() { const p = (location.hash.replace(/^#\/?/, '') || 'home').split('/'); return {name: routes[p[0]] ? p[0] : 'home', arg: p[1]}; }
let current = null;
async function render(soft) {
  const r = route();
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === r.name || (r.name === 'coin' || r.name === 'auditor') && a.dataset.tab === 'activity' && false));
  if (!soft || current !== r.name + r.arg) { window.scrollTo(0, 0); }
  current = r.name + r.arg;
  try { await routes[r.name](r.arg, soft); } catch (e) { fail(e); }
}
addEventListener('hashchange', () => render(false));

function navbar(title, right = '', left = '') {
  return `<div class="navbar">${left}<div class="title">${title}</div>${right}</div>`;
}
function homeNav() {
  return navbar(`<a href="#/account" class="avatar" aria-label="Account">B</a><span style="margin-left:8px">Trade desk</span><span class="chev">›</span>`,
    `<button class="iconbtn" id="searchBtn" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>
     <button class="iconbtn" id="bellBtn" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>${S.unread ? '<i class="dot"></i>' : ''}</button>`);
}
function backNav(title, extra = '') { return navbar(title, extra, `<button class="back" onclick="history.length>1?history.back():location.hash='#/home'">‹ Back</button>`); }
function wireNav() {
  const s = $('#searchBtn'), b = $('#bellBtn');
  if (s) s.onclick = openSearch;
  if (b) b.onclick = openBell;
}
const skel = (h, mt = 12) => `<div class="skel" style="height:${h}px;margin-top:${mt}px"></div>`;

// ---------- HOME
async function Home(_, soft) {
  const v = $('#view');
  if (!soft || !$('#homeRoot')) {
    v.innerHTML = homeNav() + `<div id="homeRoot">${skel(70, 8)}${skel(20)}${skel(220)}${skel(44)}<div class="sec">Agents</div>${skel(300)}<div class="sec">Activity</div>${skel(60)}${skel(60, 8)}</div>`;
    wireNav();
  }
  const [st, ch, ac] = await Promise.all([api('/api/state'), api('/api/chart?range=' + S.range), api('/api/activity')]);
  S.state = st; S.unread = st.unread;
  const running = Object.values(st.agents).filter(a => a.status === 'running').length;
  const root = $('#homeRoot');
  if (!$('#bal')) {
    root.innerHTML = `<div class="balance-row"><div class="big" id="bal"></div>${st.mode === 'PAPER' ? '<span class="pill paper">PAPER</span>' : ''}</div>
      <div class="today" id="today"></div>
      <div class="chart"><canvas id="lineCv" style="height:220px"></canvas><div id="chartEmpty" class="mut" style="position:absolute;top:45%;width:100%;text-align:center" hidden>Waiting for the first trade</div></div>
      <div class="ranges">${['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map(r => `<button data-r="${r}" class="${r === S.range ? 'on' : ''}">${r}</button>`).join('')}</div>
      <div class="sec"><span id="agentsTitle"></span></div><div class="carousel" id="cards"></div>
      <div class="sec">Activity <a href="#/activity">See all</a></div><div class="list" id="act5"></div>`;
    root.querySelectorAll('.ranges button').forEach(b => b.onclick = () => { S.range = b.dataset.r; root.innerHTML = ''; Home(null, true); });
  }
  odometer($('#bal'), fmt$(st.balance));
  const up = st.todayPct >= 0;
  $('#today').innerHTML = `<span class="${up ? 'up' : 'down'}">${up ? '+' : ''}${st.todayPct.toFixed(2)}%</span> <span class="mut">today</span> <span class="pill mult" style="margin-left:6px">${st.multiplier.toFixed(2)}×</span>`;
  const hasTrade = ch.marks.length > 0;
  $('#chartEmpty').hidden = hasTrade || ch.points.length > 1;
  Charts.line($('#lineCv'), ch.points, ch.start, ch.marks, !soft);
  $('#agentsTitle').textContent = `Agents · ${running} running`;
  $('#cards').innerHTML = agentCards(st.agents);
  drawRings();
  $('#act5').innerHTML = ac.rows.length ? ac.rows.slice(0, 5).map(actRow).join('') : '<div class="empty">Nothing yet tonight</div>';
  const bell = $('#bellBtn'); if (bell) bell.innerHTML = bell.innerHTML.replace(/<i class="dot"><\/i>/, '') + (S.unread ? '<i class="dot"></i>' : '');
}

function agentCards(a) {
  const sd = s => `<span class="sdot ${s === 'running' ? '' : s}"></span>`;
  const sc = a.scanner, au = a.auditor, an = a.analyst, ex = a.executor, rk = a.risk;
  const feed = sc.feed.length ? sc.feed.map(f => `<div class="${f.verdict === 'pass' ? '' : 'killed'}"><a class="nm" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name || f.symbol || short(f.mint))}</a><span class="${f.verdict === 'pass' ? 'up' : 'mut'}">${f.verdict === 'pass' ? '→ auditor' : esc(f.reason)}</span></div>`).join('') : '<div class="mut">Listening for graduations</div>';
  const strips = au.current ? Array.from({length: 8}, (_, i) => { const s = au.current.strips.find(x => x.layer === i + 1); return `<i class="${!s ? '' : s.pass === 1 ? 'ok' : s.pass === 0 ? 'no' : 'nc'}"></i>`; }).join('') : Array.from({length: 8}, () => '<i></i>').join('');
  const auLine = !au.current ? 'No coin taken apart yet' : !au.current.done ? 'taking apart...' : au.current.passed ? '8/8 → Executor' : esc(au.current.reason);
  const exLast = ex.last ? (ex.last.status === 'bought' ? `<div class="s">${esc(ex.last.name)} · ${fmt$(ex.last.size)} · ${ex.stackPct}% of stack</div><div class="s up" style="margin-top:8px">✓ Filled</div><div class="bar"><i style="width:100%"></i></div>`
    : `<div class="s">${esc(ex.last.name)} · ${esc(ex.last.status)}${ex.last.reason ? ' · ' + esc(ex.last.reason) : ''}</div><div class="bar"><i style="width:0"></i></div>`) : `<div class="s">$X · ${ex.stackPct}% of stack</div><div class="s mut" style="margin-top:8px">No trade yet</div><div class="bar"><i style="width:0"></i></div>`;
  return `
  <div class="acard"><h3>${sd(au.status)} Auditor</h3><div class="k">${au.takenApart} taken apart</div><div class="s">${auLine}</div><div class="strips">${strips}</div><div class="s" style="margin-top:10px">${au.rejected} rejected</div></div>
  <div class="acard"><h3 style="color:#64d2ff">${sd(sc.status)} Scanner</h3><div class="k">${sc.pools} pools</div><div class="s">${sc.waiting} in the waiting room</div><div class="feed">${feed}</div></div>
  <div class="acard"><h3 style="color:#ffd60a">${sd(an.status)} Analyst${an.mode === 'rules' ? ' (rules)' : ''}</h3><div class="k">Scoring</div><div class="s">${an.last ? esc(an.last.name || '') + (an.last.pass ? ' · pass' : ' · ' + esc(an.last.reason)) : 'Nothing scored yet'}</div><canvas class="ring" data-score="${an.last ? an.last.score : ''}"></canvas></div>
  <div class="acard"><h3 style="color:#00d35a">${sd(ex.status)} Executor</h3><div class="k">${ex.trades} trades</div>${exLast}</div>
  <div class="acard"><h3 style="color:#ff6b9a">${sd(rk.status)} Risk</h3><div class="k">Guarding</div><div class="s">${rk.open} open${rk.last ? ' · last: ' + (rk.last.reason === 'trail' ? 'Trailed out' : rk.last.reason === 'stop' ? 'Stopped' : esc(rk.last.reason)) : ''}</div>
    <div style="margin-top:auto;display:flex;gap:8px"><span class="pill mono red">stop -${rk.stopPct}%</span><span class="pill mono green">trail ${rk.trailPct}%</span></div></div>`;
}
function drawRings() { document.querySelectorAll('canvas.ring').forEach(c => Charts.ring(c, c.dataset.score === '' ? null : +c.dataset.score)); }

function actRow(r) {
  const icon = {bought: '↗', sold: '✓', stopped: '↓', rejected: '✕'}[r.kind] || '•';
  const href = r.kind === 'rejected' ? `#/auditor/${r.mint}` : `#/coin/${r.mint}`;
  const vcls = r.kind === 'stopped' ? 'down' : r.kind === 'sold' ? (String(r.value).startsWith('-') ? 'down' : 'up') : r.kind === 'rejected' ? 'mut' : '';
  return `<a class="row" href="${href}"><div class="ic ${r.kind}">${icon}</div><div class="mid"><div class="t">${esc(r.title)}</div><div class="st">${esc(r.subtitle)} · ${hhmm(r.ts)}</div></div><div class="v ${vcls}">${esc(r.value)}</div></a>`;
}

// ---------- AGENTS TAB
async function Agents(_, soft) {
  const v = $('#view');
  if (!soft) v.innerHTML = navbar('Agents') + skel(220, 8) + skel(220) + skel(220);
  const st = await api('/api/state');
  const names = ['scanner', 'auditor', 'analyst', 'executor', 'risk'];
  const dec = await Promise.all(names.map(n => api(`/api/agents/${n}/decisions`)));
  const col = {scanner: '#64d2ff', auditor: '#fff', analyst: '#ffd60a', executor: '#00d35a', risk: '#ff6b9a'};
  const count = {scanner: st.agents.scanner.pools + ' pools', auditor: st.agents.auditor.takenApart + ' taken apart', analyst: st.agents.analyst.scored + ' scored', executor: st.agents.executor.trades + ' trades', risk: st.agents.risk.open + ' open'};
  const empty = {scanner: 'Listening for graduations', auditor: 'No coin taken apart yet', analyst: 'Nothing scored yet', executor: 'No signal yet', risk: 'No position yet'};
  v.innerHTML = navbar('Agents') + names.map((n, i) => {
    const a = st.agents[n], locked = n === 'risk' && a.locked;
    return `<div class="card"><div style="display:flex;align-items:center;gap:10px"><span class="sdot ${a.status === 'running' ? '' : a.status}"></span>
      <b style="flex:1;color:${col[n]};font-size:17px">${n[0].toUpperCase() + n.slice(1)}</b><span class="mut" style="font-size:13px">${count[n]} · ${a.status}</span>
      <button class="switch ${a.status !== 'paused' ? 'on' : ''} ${locked ? 'locked' : ''}" data-agent="${n}" aria-label="pause or resume ${n}" ${locked ? 'title="Risk is locked while a position is open"' : ''}></button></div>
      <div style="margin-top:8px">${dec[i].rows.length ? dec[i].rows.map(d => `<div class="lrow" style="font-size:13px"><span class="mut">${hhmm(d.ts)}</span><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" style="flex:1;color:#0a84ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name || short(d.mint))}</a><span style="text-align:right">${esc(d.verdict)} · <span class="mut">${esc(d.reason || '')}</span></span></div>`).join('') : `<div class="empty">${empty[n]}</div>`}</div>
      <a href="#/account" data-sec="${n}" class="mut" style="display:flex;min-height:44px;align-items:center;color:#0a84ff">Settings ›</a></div>`;
  }).join('');
  v.querySelectorAll('.switch').forEach(b => b.onclick = async () => {
    if (b.classList.contains('locked')) { toast("Risk can't be paused while a position is open"); return; }
    const on = b.classList.contains('on');
    const r = await post(`/api/agents/${b.dataset.agent}/${on ? 'pause' : 'resume'}`);
    toast(r.message); Agents(null, true);
  });
  v.querySelectorAll('[data-sec]').forEach(a => a.onclick = () => sessionStorage.setItem('scrollTo', a.dataset.sec));
}

// ---------- ACTIVITY
async function Activity(_, soft) {
  const v = $('#view');
  if (!soft) v.innerHTML = navbar('Activity') + skel(60, 8) + skel(60, 8) + skel(60, 8);
  const ac = await api('/api/activity');
  v.innerHTML = navbar('Activity') + `<div class="list" id="actList">${ac.rows.length ? ac.rows.map(actRow).join('') : '<div class="empty">Nothing yet tonight</div>'}</div>` +
    (ac.rows.length === 30 ? `<button class="btn ghost" id="more">Load more</button>` : '');
  const more = $('#more');
  if (more) more.onclick = async () => { const last = ac.rows[ac.rows.length - 1].id; const n = await api('/api/activity?before=' + last); $('#actList').insertAdjacentHTML('beforeend', n.rows.map(actRow).join('')); ac.rows.push(...n.rows); if (n.rows.length < 30) more.remove(); };
}

// ---------- COIN
async function Coin(mint, soft) {
  const v = $('#view');
  if (!soft) v.innerHTML = backNav('') + skel(48, 8) + skel(70) + skel(240) + skel(120) + skel(52);
  const c = await api('/api/coin/' + encodeURIComponent(mint));
  const st = S.state || await api('/api/state');
  const p = c.position;
  const since = p && c.price ? (c.price / p.entry - 1) * 100 : null;
  const age = c.ageMin == null ? '' : c.ageMin >= 60 ? Math.floor(c.ageMin / 60) + 'h old' : c.ageMin + 'm old';
  const shield = c.audit ? `<span class="chip ${c.audit.passed ? '' : 'red'}">⛨ ${c.audit.passed ? '8/8' : c.audit.layersChecked + '/8'}</span>` : '';
  const left = p ? Math.max(0, p.timeoutAt - Date.now() / 1000) : 0;
  v.innerHTML = backNav('', st.mode === 'PAPER' ? '<span class="pill paper">PAPER</span>' : '') + `
   <div class="hdr">${c.logo ? `<img class="logo" src="${esc(c.logo)}" alt="" referrerpolicy="no-referrer">` : '<div class="logo"></div>'}<div style="flex:1"><h1 style="margin:0">${esc(c.name || short(c.mint))}</h1>
   <div class="mut" style="font-size:13px">${esc(c.symbol || '')} · Solana${age ? ' · ' + age : ''}</div></div>${shield}</div>
   <div style="font:700 44px var(--disp);margin-top:14px">${c.price == null ? '<span class="mut">no price yet</span>' : '$' + fmtP(c.price)}</div>
   ${since != null ? `<div class="${since >= 0 ? 'up' : 'down'}" style="font-weight:600">${since >= 0 ? '▲' : '▼'} ${Math.abs(since).toFixed(2)}% since entry</div>` : ''}
   <div class="chart" style="height:240px"><canvas id="candles" style="height:240px"></canvas>${c.candles.length ? '' : '<div class="mut" style="position:absolute;top:45%;width:100%;text-align:center">Candles start with the first price poll</div>'}</div>
   <div class="card stats"><div><span>Market cap</span><b>${fmtK(c.marketCap)}</b></div><div><span>Liquidity</span><b>${fmtK(c.liquidity)}</b></div>
   <div><span>24h volume</span><b>${fmtK(c.volume24h)}</b></div><div><span>Holders</span><b>${c.holders == null ? 'n/a' : c.holders.toLocaleString()}</b></div></div>
   ${p ? `<div class="card"><div style="font-weight:600">Your position · ${fmt$(p.sizeUsd)} in · Executor</div>
     <div class="lrow"><span class="mut">Stop line</span><span class="val">$${fmtP(p.stopPrice)} · -${p.stopPct}%</span></div>
     <div class="lrow"><span class="mut">Trail line</span><span class="val">${p.trailActive ? '$' + fmtP(p.trailLine) : 'starts at +' + (st.agents ? '' : '') + 'trail_start'}</span></div>
     <div class="lrow"><span class="mut">Time left to timeout</span><span class="val">${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m</span></div></div>` : ''}
   <a class="btn ${p ? 'sell' : ''}" href="${esc(c.coin_url)}" target="_blank" rel="noopener noreferrer">${p ? 'Sell on pump.fun' : 'Buy on pump.fun'}</a>
   <a class="btn ghost" href="#/auditor/${esc(c.mint)}">Auditor report</a>`;
  if (p && !p.trailActive) { const s = await api('/api/settings'); v.querySelectorAll('.lrow .val')[1].textContent = 'starts at +' + s.settings['risk.trail_start_pct'].value + '%'; }
  Charts.candles($('#candles'), c.candles, p ? p.exitLine : null, p ? p.entry : null);
}

// ---------- AUDITOR SCREEN
async function Auditor(mint, soft) {
  const v = $('#view');
  if (!soft) v.innerHTML = backNav('Auditor') + skel(260, 8) + skel(44) + skel(360);
  const a = await api('/api/audit/' + encodeURIComponent(mint));
  const name = esc(a.name || short(a.mint));
  const discs = Array.from({length: 8}, (_, i) => `<div class="disc" id="disc${i + 1}" style="top:${i * 28}px;z-index:${8 - i}">${i + 1}</div>`).join('');
  let verdict = '';
  if (!a.run) verdict = `<div class="empty">No coin taken apart yet</div><button class="btn blue" id="auditNow">Take it apart now</button>`;
  else if (!a.run.done) verdict = `<div class="verdict mut">taking apart...</div>`;
  else if (a.run.passed) verdict = `<div class="verdict up">Cleared · 8/8 parts</div><div class="mut" style="text-align:center">${a.sentSize ? 'Sent to Executor · ' + fmt$(a.sentSize) : 'Sent to Executor'}</div>`;
  else verdict = `<div class="verdict down">Rejected · ${esc(a.run.reason)}</div><div class="mut" style="text-align:center">Trade desk won't buy ${name}</div>`;
  v.innerHTML = backNav('Auditor') + `<h1 style="text-align:center">${name}</h1>
    <div class="discs">${discs}<div class="beam" id="beam" style="top:-6px" ${a.layers.length ? '' : 'hidden'}></div></div>
    <div id="verdict" style="visibility:hidden">${verdict}</div>
    <div class="card" id="layers">${a.layers.length ? a.layers.map(l => `<div class="lrow"><span>${l.n} · ${esc(l.name)}</span><span class="val ${l.pass === true ? 'up' : l.pass === false ? 'down' : 'ter'}">${esc(l.value)}</span></div>`).join('') : '<div class="empty">No coin taken apart yet</div>'}</div>
    <div class="card"><div class="lrow"><span>Take apart before buying</span><button class="switch ${a.enabled ? 'on' : ''}" id="audTog" aria-label="Take apart before buying"></button></div></div>
    <a class="btn" href="${esc(a.coin_url)}" target="_blank" rel="noopener noreferrer">Open on pump.fun</a>`;
  // beam: 350ms per layer top to bottom, then 150ms to green/red. Only layers the server sent.
  const paint = (l) => { const d = $('#disc' + l.n); if (d) d.classList.add(l.pass === true ? 'ok' : l.pass === false ? 'no' : 'nc'); };
  if (reduce || soft) { a.layers.forEach(paint); $('#verdict').style.visibility = 'visible'; }
  else {
    for (const l of a.layers) { const b = $('#beam'); if (!b) return; b.style.top = ((l.n - 1) * 28 + 16) + 'px'; await new Promise(r => setTimeout(r, 350)); await new Promise(r => setTimeout(r, 150)); paint(l); }
    const vd = $('#verdict'); if (vd) vd.style.visibility = 'visible';
  }
  const an = $('#auditNow'); if (an) an.onclick = async () => { await post('/api/audit/' + mint); toast('Auditor is taking it apart…'); setTimeout(() => Auditor(mint), 4000); };
  $('#audTog').onclick = async () => {
    const on = $('#audTog').classList.contains('on');
    if (on && !(confirm('Turn off the Auditor? Coins will go to the Analyst without being taken apart.') && confirm('Sure? This removes the 8 safety layers.'))) return;
    const r = await post('/api/settings', {key: 'auditor.enabled', value: !on}); toast(r.message || r.error); Auditor(mint, true);
  };
}

// ---------- ACCOUNT
async function Account(_, soft) {
  const v = $('#view');
  if (!soft) v.innerHTML = navbar('Account') + skel(44, 8) + skel(60) + skel(120) + skel(400);
  const [ac, s] = await Promise.all([api('/api/account'), api('/api/settings')]);
  const groups = {};
  Object.entries(s.settings).forEach(([k, d]) => { const g = k.split('.')[0]; (groups[g] = groups[g] || []).push([k, d]); });
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const label = k => k.split('.').slice(1).join(' ').replace(/_/g, ' ');
  const ctrl = (k, d) => {
    if (k === 'desk.mode') return `<span class="mut">${esc(d.value)}</span>`;
    if (d.kind === 'bool') return `<button class="switch ${d.value ? 'on' : ''}" data-k="${k}" data-bool="1" aria-label="${k}"></button>`;
    if (d.kind.startsWith('choice:')) return `<select class="field" style="width:130px;height:36px" data-k="${k}">${d.kind.slice(7).split(',').map(o => `<option ${o === d.value ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    if (d.kind === 'int' || d.kind === 'float') return `<input type="number" data-k="${k}" value="${d.value}" step="${d.kind === 'int' ? 1 : 'any'}" ${d.min != null ? `min="${d.min}"` : ''} ${d.max != null ? `max="${d.max}"` : ''}>`;
    return `<input type="text" data-k="${k}" value="${esc(d.value)}" style="width:170px" placeholder="${k === 'desk.wallet_address' ? 'public address (optional)' : ''}">`;
  };
  const slider = (k, d) => (d.kind === 'int' || d.kind === 'float') && d.min != null && d.max != null && (d.max - d.min) <= 100000 && k !== 'desk.mode'
    ? `<input type="range" data-r="${k}" min="${d.min}" max="${d.max}" step="${d.kind === 'int' ? 1 : (d.max - d.min) / 1000}" value="${d.value}">` : '';
  v.innerHTML = navbar('Account') + `
   <div class="grp">Mode</div><div class="card"><div class="seg"><button data-mode="PAPER" class="${ac.mode === 'PAPER' ? 'on' : ''}">PAPER</button><button data-mode="LIVE" class="${ac.mode === 'LIVE' ? 'on' : ''}">LIVE</button></div>
     <div class="mut" style="font-size:13px;margin-top:8px">Even in LIVE the desk never buys or sells: it only sends you the pump.fun button.</div>
     <div class="lrow"><span>Stack</span><span class="val">${fmt$(ac.stack)}</span></div>${ac.ticketWarning ? `<div class="down" style="font-size:13px;padding:6px 0">${esc(ac.ticketWarning)}</div>` : ''}</div>
   <div class="grp">pump.fun</div><div class="list">
     ${ac.profile_url ? `<a class="lrow" href="${esc(ac.profile_url)}" target="_blank" rel="noopener noreferrer"><span>Your pump.fun profile</span><span class="val" style="color:#0a84ff">${short(ac.wallet)} ›</span></a>`
       : `<div class="lrow"><span>Your pump.fun profile</span><span class="mut" style="font-size:13px">add a public wallet address below</span></div>`}</div>
   <div class="grp">Notifications</div><div class="list">
     <div class="lrow"><span>Telegram</span><span class="${ac.telegram.connected ? 'up' : 'mut'}">${ac.telegram.connected ? 'connected' : ac.telegram.configured ? 'send /start to the bot' : 'not set up'}</span></div>
     <button class="lrow" id="testPush" style="width:100%;color:#0a84ff">Send test push</button>
     ${standalone ? `<button class="lrow" id="enablePush" style="width:100%;color:#0a84ff">Enable notifications${ac.pushSubs ? ' · ' + ac.pushSubs + ' device(s)' : ''}</button>` : `<div class="lrow"><span class="mut" style="font-size:13px">Web push: add the app to your home screen first</span></div>`}</div>
   <div class="grp">Command</div><div class="card"><input class="field" id="cmd" placeholder="why X · buy X · set stop to -8% · status" autocapitalize="off"><div id="cmdOut" style="white-space:pre-line;font-size:14px;margin-top:8px"></div></div>
   ${Object.entries(groups).map(([g, items]) => `<div class="grp" id="grp-${g}">${g[0].toUpperCase() + g.slice(1)}</div><div class="list">${items.map(([k, d]) =>
     `<div class="set"><div class="top"><span>${esc(label(k))}</span>${ctrl(k, d)}</div>${slider(k, d)}</div>`).join('')}</div>`).join('')}
   <div style="height:24px"></div>`;
  if (PLANB()) {
    v.querySelectorAll('input,select,button[data-bool],[data-mode],#testPush,#cmd').forEach(e => { e.disabled = true; });
    ['#enablePush', '#testPush'].forEach(s => { const e = $(s); if (e) e.remove(); });
    v.querySelectorAll('.lrow').forEach(r => { if (/^Web push/.test(r.textContent.trim())) r.remove(); });
    const cmd = $('#cmd'); if (cmd) cmd.closest('.card').previousElementSibling.remove(), cmd.closest('.card').remove();
    v.querySelector('.navbar').insertAdjacentHTML('afterend', `<div class="card" style="font-size:14px">Read-only view · snapshot ${hhmm((await dget('state.json')).state.ts)}, refreshed about every 7 min. Change settings, pause or mode from the Telegram bot: <span class="mut">set stop to -8% · pause analyst · paper · status</span>. No web push here: alerts come on Telegram.</div>`);
  }
  const save = async (k, val) => { try { const r = await post('/api/settings', {key: k, value: val}); toast(r.message); } catch (e) { toast('Rejected: out of range'); Account(null, true); } };
  v.querySelectorAll('input[data-k],select[data-k]').forEach(i => i.onchange = () => { save(i.dataset.k, i.value); const r = v.querySelector(`[data-r="${i.dataset.k}"]`); if (r) r.value = i.value; });
  v.querySelectorAll('input[data-r]').forEach(r => { r.oninput = () => { v.querySelector(`[data-k="${r.dataset.r}"]`).value = (+r.value).toFixed(r.step >= 1 ? 0 : 2); }; r.onchange = () => save(r.dataset.r, r.value); });
  v.querySelectorAll('button[data-bool]').forEach(b => b.onclick = async () => {
    const on = b.classList.contains('on');
    if (b.dataset.k === 'auditor.enabled' && on && !(confirm('Turn off the Auditor?') && confirm('Sure? This removes the 8 safety layers.'))) return;
    await save(b.dataset.k, !on); b.classList.toggle('on');
  });
  v.querySelectorAll('[data-mode]').forEach(b => b.onclick = async () => {
    const mode = b.dataset.mode; if (mode === ac.mode) return;
    let confirmTxt = null;
    if (mode === 'LIVE') { confirmTxt = prompt('Type LIVE to confirm. The desk will still never buy for you.'); if (confirmTxt !== 'LIVE') return; }
    const r = await post('/api/mode', {mode, confirm: confirmTxt}); toast(r.message); Account(null, true);
  });
  if (PLANB()) return;
  $('#testPush').onclick = async () => { const r = await post('/api/test_push'); toast(r.ok ? 'Sent · ' + Object.entries(r.channels).map(([k, x]) => k + ': ' + (typeof x === 'string' ? x : JSON.stringify(x))).join(' · ') : r.error); };
  const ep = $('#enablePush'); if (ep) ep.onclick = () => enablePush(ac.vapidPublicKey);
  $('#cmd').onkeydown = async e => { if (e.key !== 'Enter') return; const r = await post('/api/command', {text: e.target.value}); $('#cmdOut').innerHTML = r.replies.map(x => esc(x.text) + (x.buttons || []).filter(b => b.url).map(b => ` <a style="color:#0a84ff" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.text)}</a>`).join('')).join('\n\n'); };
  const sec = sessionStorage.getItem('scrollTo'); if (sec) { sessionStorage.removeItem('scrollTo'); const el = $('#grp-' + sec); if (el) el.scrollIntoView(); }
}

async function enablePush(vapid) {
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast('Notifications not allowed'); return; }
    const key = Uint8Array.from(atob(vapid.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - vapid.length % 4) % 4)), c => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
    await post('/api/push', sub.toJSON()); toast('Notifications on');
  } catch (e) { toast('Could not enable: ' + e.message); }
}

// ---------- search + bell
function openSearch() {
  const d = $('#sheet'); d.hidden = false;
  d.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><input class="field" id="q" placeholder="Name, symbol or mint" autocapitalize="off" autofocus><button class="back" id="qx">Cancel</button></div><div class="list" id="qr" style="margin-top:12px"></div>`;
  $('#qx').onclick = () => { d.hidden = true; };
  let t; $('#q').oninput = e => { clearTimeout(t); t = setTimeout(async () => { const q = e.target.value.trim(); if (!q) { $('#qr').innerHTML = ''; return; }
    const r = await api('/api/search?q=' + encodeURIComponent(q));
    $('#qr').innerHTML = r.rows.length ? r.rows.map(x => `<a class="row" href="#/coin/${x.mint}" onclick="document.getElementById('sheet').hidden=true"><div class="mid"><div class="t">${esc(x.name || short(x.mint))}</div><div class="st">${esc(x.symbol || '')} · ${short(x.mint)}</div></div></a>`).join('') : '<div class="empty">No coin found</div>'; }, 250); };
}
async function openBell() {
  const d = $('#sheet'); d.hidden = false;
  d.innerHTML = navbar('Notifications', `<button class="back" id="bx">Done</button>`) + skel(60);
  $('#bx').onclick = () => { d.hidden = true; };
  const r = await api('/api/notifications'); S.unread = 0;
  d.innerHTML = navbar('Notifications', `<button class="back" id="bx">Done</button>`) + `<div class="list">${r.rows.length ? r.rows.map(n => `<a class="row" href="${esc(n.url || '#')}" target="_blank" rel="noopener noreferrer"><div class="mid"><div class="st">Trade desk · ${hhmm(n.ts)}</div><div class="t" style="white-space:pre-line">${esc(n.text)}</div></div></a>`).join('') : '<div class="empty">No pushes yet</div>'}</div>`;
  $('#bx').onclick = () => { d.hidden = true; render(true); };
}

// ---------- live stream (fetch + Authorization header, so the token never sits in a URL)
async function stream() {
  while (true) {
    try {
      const r = await fetch('/api/stream', {headers: {'Authorization': 'Bearer ' + TOKEN()}, cache: 'no-store'});
      if (r.status === 401) return;
      if (!r.ok || !r.body) throw new Error('stream');
      setOffline(false);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      while (true) {
        const {value, done} = await rd.read(); if (done) break;
        buf += dec.decode(value, {stream: true});
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (chunk.match(/^event: (.*)$/m) || [])[1], data = (chunk.match(/^data: (.*)$/m) || [])[1];
          if (ev) onEvent(ev, data ? JSON.parse(data) : null);
        }
        S.lastOk = Date.now();
      }
    } catch (e) { setOffline(true); }
    await new Promise(r => setTimeout(r, 3000));
  }
}
let soonT = null;
function onEvent(ev, d) {
  if (ev === 'push') { S.unread++; }
  if (ev === 'audit_layer' && route().name === 'auditor' && d && d.mint === route().arg) { clearTimeout(soonT); soonT = setTimeout(() => render(true), 400); return; }
  if (['scan', 'verdict', 'signal', 'fill', 'exit', 'balance', 'activity', 'push', 'audit_layer'].includes(ev)) { clearTimeout(soonT); soonT = setTimeout(() => { if (route().name !== 'account') render(true); }, 600); }
}

if (PLANB()) { render(false); setInterval(() => { if (route().name !== 'account') render(true); }, 60000); }
else if (!TOKEN()) { $('#view').innerHTML = navbar('Trade desk') + `<div class="card">Open the app once with your private link (…#t=…). It then stays on this phone.</div>`; }
else { render(false); stream(); setInterval(() => { if (!S.offline && route().name !== 'account') render(true); }, 15000); }
