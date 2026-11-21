// Time tracking, calendar, streaks and the Progress page.
import { $, esc, pct, randomStr, store } from './util.js';
import { S, rebuildSel } from './book.js';
import { cardsFor, moveLog } from './srs.js';
import { Sync } from './sync.js';
import { enterTraining, reviewing, startReviewKey } from './trainer.js';
import { coordLog } from './squares.js';
import { Daily } from './daily.js';
import { currentPage, showPage } from './nav.js';

/* ================= time spent ================= */
// Active time per day and activity. Each browser keeps its own record (so syncing never double counts); totals add them up.
const DEVICE = store.get('device', '') || (() => { const id = randomStr(9); store.set('device', id); return id; })();
let timeLog = store.get('time', {});
const ACTS = {lines: ['Learning lines', '#2A4D8F'], review: ['Reviews', '#2D7A57'], squares: ['Squares', '#B7791F'], games: ['Game review', '#B0402D'], plans: ['Plans and games list', '#7A5AA6']};
const MIN_STREAK = 5;  // minutes needed for a day to count in the streak
let lastInput = Date.now(), tickN = 0;

function currentActivity(){
  const p = currentPage();
  if(p === 'coords') return 'squares';
  if(p === 'train') return reviewing || Daily.active === 'review' || Daily.active === 'weak' ? 'review' : 'lines';
  if(p === 'today' && !$('tdExtra').hidden) return 'plans';
  return null;
}

function dayTotals(d){
  const t = {}; for(const dev of Object.values(timeLog)) for(const [a, s] of Object.entries(dev[d] || {})) t[a] = (t[a] || 0) + s;
  return t;
}
const sumSec = t => Object.values(t).reduce((a, b) => a + b, 0);
const fmtMin = sec => { const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
function addDays(d, n){ const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + n); return dayKey(x.getTime()); }
function timeStreaks(){
  const active = d => sumSec(dayTotals(d)) >= MIN_STREAK * 60;
  let cur = 0, d = dayKey(Date.now());
  if(!active(d)) d = addDays(d, -1);           // today not reached yet: the streak runs up to yesterday
  while(active(d)){ cur++; d = addDays(d, -1); }
  const all = new Set(); for(const dev of Object.values(timeLog)) Object.keys(dev).forEach(k => all.add(k));
  let best = 0, run = 0, prev = null;
  [...all].filter(active).sort().forEach(k => { run = prev && addDays(prev, 1) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; });
  return {cur, best: Math.max(best, cur)};
}
let calMonth = null, calPick = null;
function renderTime(){
  const today = dayKey(Date.now()), tt = sumSec(dayTotals(today));
  const weekSum = start => { let s = 0; for(let i = 0; i < 7; i++) s += sumSec(dayTotals(addDays(start, i))); return s; };
  const now = new Date(), dow = (now.getDay() + 6) % 7, monday = addDays(today, -dow);
  const thisWeek = weekSum(monday);
  let lastWeek = 0; for(let i = 0; i <= dow; i++) lastWeek += sumSec(dayTotals(addDays(monday, i - 7)));  // same days last week
  const st = timeStreaks(), plan = Daily.streak();
  const diff = thisWeek - lastWeek;
  $('tmSum').innerHTML = `
    <div class="card"><div class="big">${fmtMin(tt)}</div><div class="lbl">Today</div></div>
    <div class="card"><div class="big">${fmtMin(thisWeek)}</div><div class="lbl">This week (since Monday)</div><div class="delta ${diff > 60 ? 'up' : diff < -60 ? 'down' : 'flat'}">${lastWeek ? `${diff >= 0 ? '+' : '−'}${fmtMin(Math.abs(diff))} compared with the same days last week (${fmtMin(lastWeek)})` : 'Nothing recorded on the same days last week'}</div></div>
    <div class="card"><div class="big">${st.cur} day${st.cur === 1 ? '' : 's'}</div><div class="lbl">Current streak: days with at least ${MIN_STREAK} minutes</div><div class="delta flat">Best: ${st.best} day${st.best === 1 ? '' : 's'}. Daily plan completed: ${plan} day${plan === 1 ? '' : 's'} in a row.</div></div>`;
  // month calendar
  if(!calMonth) calMonth = today.slice(0, 7);
  const [y, mo] = calMonth.split('-').map(Number), first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const plans = new Set(Daily.days);
  const level = sec => sec <= 0 ? 0 : sec < 600 ? 1 : sec < 1200 ? 2 : sec < 2400 ? 3 : 4;
  let cal = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="cal-h">${d}</div>`).join('') + '<div class="cal-e"></div>'.repeat(lead);
  let monthSec = 0, monthDays = 0;
  for(let d = 1; d <= days; d++){
    const k = `${calMonth}-${String(d).padStart(2, '0')}`, sec = sumSec(dayTotals(k)); monthSec += sec; if(sec >= MIN_STREAK * 60) monthDays++;
    cal += `<button class="cal-d l${level(sec)} ${k === today ? 'today' : ''} ${k === calPick ? 'pick' : ''}" data-day="${k}" title="${fmtDay(k)}: ${fmtMin(sec)}"><span>${d}</span>${plans.has(k) ? '<i class="cal-plan" title="Daily plan completed">✓</i>' : ''}${sec ? `<small>${Math.round(sec / 60)}′</small>` : ''}</button>`;
  }
  $('tmCalTitle').textContent = first.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
  $('tmCal').innerHTML = cal;
  $('tmCalSum').textContent = `${fmtMin(monthSec)} this month, ${monthDays} day${monthDays === 1 ? '' : 's'} with at least ${MIN_STREAK} minutes.`;
  $('tmCal').querySelectorAll('[data-day]').forEach(b => b.onclick = () => { calPick = calPick === b.dataset.day ? null : b.dataset.day; renderTime(); });
  const pick = calPick || today, pt = dayTotals(pick);
  $('tmDay').innerHTML = `<b>${fmtDay(pick)}${pick === today ? ' (today)' : ''}:</b> ${sumSec(pt) ? Object.keys(ACTS).filter(a => pt[a]).map(a => `<span class="tm-chip"><i style="background:${ACTS[a][1]}"></i>${ACTS[a][0]} ${fmtMin(pt[a])}</span>`).join(' ') : 'no practice recorded.'}${plans.has(pick) ? ' <span class="tm-chip">✓ Daily plan completed</span>' : ''}`;
  const has = moveLog.length + coordLog.length > 0; $('pgEmpty').hidden = has; $('tmSum').hidden = !has;
}

/* ================= progress page ================= */
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDay = k => new Date(k + 'T12:00').toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
function openProgress(){
  showPage('progress');
  // openings you have practised, most recent first
  const recent = new Map();
  for(const e of moveLog){ const k = e[1] + '|' + e[2]; recent.set(k, Math.max(recent.get(k) || 0, e[0])); }
  const cur = (S.sel[0] || '') + '|' + S.color;
  if(S.sel[0] && !recent.has(cur)) recent.set(cur, 0);
  const keys = [...recent.entries()].sort((a,b) => b[1] - a[1]).map(x => x[0]);
  $('pgOpening').innerHTML = keys.length ? keys.map(k => { const [o, c] = k.split('|'); return `<option value="${esc(k)}">${esc(o)}, as ${c === 'w' ? 'White' : 'Black'}</option>`; }).join('') : '<option value="">Nothing practised yet</option>';
  $('pgOpening').value = recent.has(cur) ? cur : (keys[0] || '');
  renderProgress();
}
function renderProgress(){
  renderTime();
  const v = $('pgOpening').value;
  if(!v){ $('pgSum').innerHTML = '<div class="card"><div class="lbl">Train a few lines first; your results will appear here.</div></div>'; $('pgChart').innerHTML = $('pgPos').innerHTML = $('pgHard').innerHTML = ''; return; }
  const [open, color] = v.split('|');
  const log = moveLog.filter(e => e[1] === open && e[2] === color);
  // group by day
  const days = new Map();
  for(const e of log){ const k = dayKey(e[0]); const d = days.get(k) || {n: 0, ok: 0}; d.n++; d.ok += e[3]; days.set(k, d); }
  const dayList = [...days.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1);
  // recent = last 3 days you trained; before = everything earlier
  const recentDays = new Set(dayList.slice(-3).map(d => d[0]));
  const agg = arr => arr.reduce((a, [, d]) => ({n: a.n + d.n, ok: a.ok + d.ok}), {n: 0, ok: 0});
  const rec = agg(dayList.filter(d => recentDays.has(d[0]))), bef = agg(dayList.filter(d => !recentDays.has(d[0])));
  const acc = a => a.n ? a.ok / a.n : null;
  const today = days.get(dayKey(Date.now()));
  let deltaHtml = '<div class="delta flat">Train on a few more days to see a comparison.</div>';
  if(acc(rec) != null && acc(bef) != null){
    const dlt = Math.round((acc(rec) - acc(bef)) * 100);
    deltaHtml = `<div class="delta ${dlt > 1 ? 'up' : dlt < -1 ? 'down' : 'flat'}">${dlt > 1 ? '+' + dlt + ' points' : dlt < -1 ? dlt + ' points' : 'About the same'} compared with before (${pct(acc(bef))} on ${bef.n} moves)</div>`;
  }
  const cs = cardsFor(open, color), now = Date.now();
  const mastered = cs.filter(([k,c]) => c.ivl >= 7).length, due = cs.filter(([k,c]) => c.due <= now).length, learning = cs.length - mastered;
  $('pgSum').innerHTML = `
    <div class="card"><div class="big">${acc(rec) != null ? pct(acc(rec)) : '–'}</div><div class="lbl">${recentDays.size ? `First-try accuracy, your last ${recentDays.size} training day${recentDays.size > 1 ? 's' : ''} (${rec.n} moves)` : 'No moves played in this opening yet'}</div>${deltaHtml}</div>
    <div class="card"><div class="big">${today ? pct(today.ok / today.n) : '–'}</div><div class="lbl">Today${today ? ` (${today.n} moves)` : ', no moves yet'}</div></div>
    <div class="card"><div class="big">${mastered}<span class="of"> / ${cs.length}</span></div><div class="lbl">Positions mastered out of those you have met</div></div>`;
  // chart: last 30 training days
  const shown = dayList.slice(-30);
  if(shown.length < 2){ $('pgChart').innerHTML = '<p class="help m0">The chart appears after two days of training.</p>'; }
  else {
    const W = 760, H = 220, L = 46, B = 30, T = 10, bw = (W - L) / shown.length;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy per training day">`;
    for(const g of [0, .5, 1]){ const y = T + (H - T - B) * (1 - g); svg += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text class="axis" x="${L - 6}" y="${y + 4}" text-anchor="end">${g * 100}%</text>`; }
    const pts = [];
    shown.forEach(([k, d], i) => {
      const a = d.ok / d.n, x = L + i * bw + bw / 2, y = T + (H - T - B) * (1 - a);
      const bh = Math.max(2, (H - T - B) * a);
      svg += `<rect x="${x - Math.min(14, bw * .35)}" y="${H - B - bh}" width="${Math.min(28, bw * .7)}" height="${bh}" rx="3" fill="var(--accent-soft)"><title>${fmtDay(k)}: ${pct(a)} of ${d.n} moves</title></rect>`;
      pts.push(`${x},${y}`);
      if(shown.length <= 12 || i % Math.ceil(shown.length / 10) === 0 || i === shown.length - 1) svg += `<text class="axis" x="${x}" y="${H - 10}" text-anchor="middle">${fmtDay(k)}</text>`;
    });
    svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`;
    shown.forEach(([k, d], i) => { const [x, y] = pts[i].split(','); svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--accent)"/>`; });
    $('pgChart').innerHTML = svg + '</svg>';
  }
  $('pgPos').innerHTML = `<div class="pg-pos">
    <div><b>${cs.length}</b>positions met</div><div><b>${learning}</b>still learning</div><div><b>${mastered}</b>mastered</div><div><b>${due}</b>to review now</div></div>
    <p class="help">A position is one place in the opening where you must find the move. Answer it right and it comes back after 1 day, then 3, then about a week, then longer. Miss it and it comes back after 10 minutes. It counts as mastered once it has been answered correctly on several separate days (next review a week or more away).</p>`;
  const hard = cs.filter(([k,c]) => c.lapses > 0).sort((a,b) => b[1].lapses - a[1].lapses || a[1].due - b[1].due).slice(0, 8);
  $('pgHard').innerHTML = hard.length ? '<ul class="hard">' + hard.map(([k, c]) => {
    const moves = c.path.map((m, i) => i % 2 === 0 ? (i/2 + 1) + '. ' + m : m).join(' ');
    const next = c.due <= now ? 'due now' : 'next review ' + new Date(c.due).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
    return `<li><div><div class="hm">${esc(moves || 'Starting position')} …</div><div class="hs">${esc(c.name || '')} · missed ${c.lapses} time${c.lapses > 1 ? 's' : ''} · ${next}</div></div><button class="btn" data-practice="${k}">Practise</button></li>`;
  }).join('') + '</ul>' : '<p class="help m0">No missed positions yet.</p>';
  $('pgHard').querySelectorAll('[data-practice]').forEach(b => b.onclick = () => {
    S.sel = [open]; S.color = color; store.set('sel', S.sel); store.set('color', color); rebuildSel();
    enterTraining(); startReviewKey(b.dataset.practice);
  });
}

export { dayKey, fmtDay, timeLog };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastInput = Date.now(); }, {passive: true, capture: true}));
  setInterval(() => {
    if(document.visibilityState !== 'visible') return;
    const act = currentActivity(); if(!act) return;
    // count only while you are actually working: a click or key in the last 90 seconds
    if(Date.now() - lastInput > 90000) return;
    const d = dayKey(Date.now()), mine = timeLog[DEVICE] = timeLog[DEVICE] || {}, day = mine[d] = mine[d] || {};
    day[act] = (day[act] || 0) + 5;
    store.set('time', timeLog);
    if(++tickN % 12 === 0 && window.Sync) Sync.schedule();   // about once a minute
    if(currentPage() === 'progress') renderTime();
  }, 5000);
  $('tmPrev').onclick = () => { const [y, m] = calMonth.split('-').map(Number), d = new Date(y, m - 2, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; renderTime(); };
  $('tmNext').onclick = () => { const [y, m] = calMonth.split('-').map(Number), d = new Date(y, m, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; renderTime(); };
  $('toProgress').onclick = openProgress;
  $('pgOpening').onchange = renderProgress;
}
export { init };
