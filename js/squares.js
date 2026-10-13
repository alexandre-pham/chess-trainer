// The Squares page: coordinate exercises and speed rounds.
import { $, esc, pct, store } from './util.js';
import { LINES, PIECES } from './data.js';
import { LINE_PLIES, S, famFlags, selFlags } from './book.js';
import { renderSetup } from './setup.js';
import { Sync } from './sync.js';
import { PNAME, cancelCoach } from './coach.js';
import { BRUSH, files, game, renderAll } from './trainer.js';
import { Daily, openToday, renderDayBar } from './daily.js';

/* ================= coordinates trainer ================= */
// every answer about a square: [time, side seen from, square, correct 1/0, exercise]
let coordLog = store.get('coordLog', []);
// speed rounds: [time, side, score, mistakes]
let coordRounds = store.get('coordRounds', []);
function logSquare(sq, ok){
  coordLog.push([Date.now(), C.orient, sq, ok ? 1 : 0, C.mode[0]]);
  if(coordLog.length > 30000) coordLog = coordLog.slice(-30000);
  store.set('coordLog', coordLog); if(window.Sync) Sync.schedule();
}
const ALL_SQ = []; 
function squareStats(side){
  const st = {}; ALL_SQ.forEach(q => st[q] = {n: 0, miss: 0});
  for(const e of coordLog.slice(-6000)) if(e[1] === side && st[e[2]]){ st[e[2]].n++; if(!e[3]) st[e[2]].miss++; }
  return st;
}
// squares you miss (or have rarely seen) come up more often
function weightedSquare(side, exclude){
  const st = squareStats(side);
  const w = ALL_SQ.map(q => q === exclude ? 0 : 1 + (st[q].n ? 5 * st[q].miss / st[q].n : 0) + (st[q].n < 2 ? 1 : 0));
  let r = Math.random() * w.reduce((a,b) => a + b, 0);
  for(let i = 0; i < ALL_SQ.length; i++){ r -= w[i]; if(r <= 0) return ALL_SQ[i]; }
  return ALL_SQ[0];
}
const C = {mode: store.get('cMode', 'read'), side: store.get('cSide', 'w'), orient: 'w', fen: null, hl: {}, arrows: [], q: null, ok: 0, bad: 0, sel: null, timer: null, end: 0, round: null};
const COLOR = c => c === 'w' ? 'White' : 'Black';
const MODES = [['read', 'Read the move'], ['play', 'Play from notation'], ['find', 'Find the squares'], ['speed', 'Speed round']];

function cPool(){
  const idx = [];
  LINES.forEach((l, i) => { if(LINE_PLIES[i] >= 4 && (!S.sel.length || famFlags[i] || selFlags[i])) idx.push(i); });
  return idx.length ? idx : LINES.map((l, i) => i).filter(i => LINE_PLIES[i] >= 4);
}
function randomLine(minPlies){
  const pool = cPool().filter(i => LINE_PLIES[i] >= (minPlies || 4));
  const list = pool.length ? pool : cPool();
  return LINES[list[Math.floor(Math.random() * list.length)]];
}
function pickOrient(){ C.orient = C.side === 'm' ? (Math.random() < .5 ? 'w' : 'b') : C.side; }

/* --- board --- */
function cSquares(){ const s = []; for(let r=0;r<8;r++) for(let f=0;f<8;f++){ const rank = C.orient === 'w' ? 8 - r : r + 1, file = C.orient === 'w' ? f : 7 - f; s.push(files[file] + rank); } return s; }
function cRender(){
  const g = new Chess(C.fen || undefined);
  $('cBoard').innerHTML = cSquares().map(sq => {
    const fi = files.indexOf(sq[0]), light = (fi + +sq[1]) % 2 === 0, p = g.get(sq);
    const cls = ['sq', light ? 'l' : 'd']; if(C.hl[sq]) cls.push(...C.hl[sq].split(' '));
    return `<div class="${cls.join(' ')}" data-sq="${sq}">${p ? `<img src="${PIECES[p.color + p.type.toUpperCase()]}" alt="">` : ''}</div>`;
  }).join('');
  const cen = sq => { let f = files.indexOf(sq[0]), r = 8 - +sq[1]; if(C.orient === 'b'){ f = 7 - f; r = 7 - r; } return [f * 100 + 50, r * 100 + 50]; };
  $('cArrows').innerHTML = `<defs><marker id="cah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${BRUSH.g}"/></marker></defs>` +
    C.arrows.map(([a, b]) => { const [x1,y1] = cen(a), [x2,y2] = cen(b), dx = x2-x1, dy = y2-y1, len = Math.hypot(dx,dy);
      return `<line x1="${x1}" y1="${y1}" x2="${x2 - dx/len*30}" y2="${y2 - dy/len*30}" stroke="${BRUSH.g}" stroke-opacity=".85" stroke-width="16" stroke-linecap="round" marker-end="url(#cah)"/>`; }).join('');
}

/* --- panel helpers --- */
function cAsk(src, prompt, opts = {}){
  $('cSrc').textContent = src || ''; $('cPrompt').innerHTML = prompt; $('cLine').innerHTML = opts.line || '';
  $('cInputRow').hidden = !opts.input; $('cInput').value = ''; $('cInput').placeholder = opts.placeholder || '';
  $('cFeedback').hidden = true; cActions(opts.actions || []);
  if(opts.input) setTimeout(() => $('cInput').focus(), 0);
}
function cActions(list){
  $('cActions').innerHTML = '';
  list.forEach(([label, fn, kind]) => { const b = document.createElement('button'); b.className = 'btn' + (kind ? ' ' + kind : ''); b.textContent = label; b.onclick = fn; $('cActions').appendChild(b); });
}
function cFeedback(good, html, next){
  const f = $('cFeedback'); f.hidden = false; f.className = 'status ' + (good ? 'good' : 'bad');
  f.innerHTML = `<div class="st-title">${good ? 'Right' : 'Not quite'}</div>${html ? `<div class="st-body">${html}</div>` : ''}`;
  if(good) C.ok++; else C.bad++;
  cStats();
  if(next) cActions([['Next', next, 'primary']]);
}
function cStats(){
  $('cOk').textContent = C.ok; $('cBad').textContent = C.bad;
  if(C.mode !== 'speed'){ $('cTimer').textContent = C.ok + C.bad ? pct(C.ok / (C.ok + C.bad)) : '–'; $('cTimerLbl').textContent = 'accuracy'; }
}

const normSan = s => s.trim().replace(/[+#!?x=\s]/g, '').replace(/0/g, 'O').replace(/^o-?o(-?o)?$/i, m => m.toUpperCase());
const normSq = s => s.trim().toLowerCase().replace(/\s/g, '');
const fmtMoves = (sans, from) => sans.map((m, i) => { const ply = from + i; return (ply % 2 === 0 ? (ply / 2 + 1) + '. ' : (i === 0 ? Math.floor(ply / 2) + 1 + '… ' : '')) + m; });

/* --- exercise 1: read the move --- */
function qRead(){
  pickOrient();
  const line = randomLine(5), sans = line[2].split(' ');
  const k = 2 + Math.floor(Math.random() * (sans.length - 2));
  const g = new Chess(); sans.slice(0, k).forEach(m => g.move(m));
  C.fen = g.fen(); const m = g.move(sans[k]);
  C.hl = {}; C.arrows = [[m.from, m.to]]; cRender();
  cAsk(`${line[1]}, move ${Math.floor(k / 2) + 1}`, `${COLOR(m.color)} plays the arrow. Write the move.`, {input: true, placeholder: 'e.g. Nf3'});
  C.q = {onSubmit(v){
    if(!v.trim()) return;
    C.q.onSubmit = null; const ok = normSan(v) === normSan(m.san);
    C.hl = {[m.from]: ok ? 'good' : 'mark', [m.to]: ok ? 'good' : 'bad'}; cRender();
    logSquare(m.to, ok);
    cFeedback(ok, ok ? `${esc(m.san)}: the ${PNAME[m.piece].toLowerCase()} goes from ${m.from} to ${m.to}.` : `It was <b>${esc(m.san)}</b>: the ${PNAME[m.piece].toLowerCase()} goes from ${m.from} to ${m.to}${m.captured ? ', capturing on ' + m.to : ''}.`, qRead);
  }};
}

/* --- exercise 2: play a written line on the board --- */
function qPlay(){
  pickOrient();
  const line = randomLine(6), sans = line[2].split(' ').slice(0, Math.min(LINE_PLIES[LINES.indexOf(line)], 6 + Math.floor(Math.random() * 5)));
  const g = new Chess(); let i = 0, tries = 0, firstTry = 0;
  C.fen = g.fen(); C.hl = {}; C.arrows = []; C.sel = null; cRender();
  const showLine = () => fmtMoves(sans, 0).map((t, j) => `<span class="${j < i ? 'done' : j === i ? 'now' : 'todo'}">${esc(t)}</span>`).join(' ');
  const ask = () => cAsk(line[1], i < sans.length ? `Play <b>${esc(sans[i])}</b> for ${COLOR(g.turn())}.` : 'Line complete.', {line: showLine(), actions: [['Skip this line', qPlay]]});
  ask();
  C.q = {onClick(sq){
    if(i >= sans.length) return;
    const p = g.get(sq);
    if(!C.sel || (p && p.color === g.turn())){ if(p && p.color === g.turn()){ C.sel = sq; C.hl = {[sq]: 'pick'}; cRender(); } return; }
    const want = new Chess(g.fen()).move(sans[i]);
    const mv = g.move({from: C.sel, to: sq, promotion: 'q'});
    if(mv && mv.san === want.san){
      if(!tries) firstTry++;
      if(!tries) logSquare(want.to, true); i++; tries = 0; C.sel = null; C.hl = {[mv.from]: 'good', [mv.to]: 'good'}; C.fen = g.fen(); cRender();
      if(i >= sans.length){
        cAsk(line[1], 'Line complete.', {line: showLine()});
        C.ok += firstTry; C.bad += sans.length - firstTry; cStats();
        $('cFeedback').hidden = false; $('cFeedback').className = 'status ' + (firstTry === sans.length ? 'good' : 'bad');
        $('cFeedback').innerHTML = `<div class="st-title">${firstTry} of ${sans.length} moves on the first try</div>`;
        cActions([['Next', qPlay, 'primary']]);
      } else ask();
    } else {
      if(mv) g.undo();
      tries++; if(tries === 1) logSquare(want.to, false);
      C.sel = null;
      C.hl = tries >= 2 ? {[want.from]: 'target', [want.to]: 'target'} : {[sq]: 'bad'};
      cRender();
      $('cFeedback').hidden = false; $('cFeedback').className = 'status bad';
      $('cFeedback').innerHTML = `<div class="st-title">Not that square</div><div class="st-body">${tries >= 2 ? `${esc(sans[i])} goes from ${want.from} to ${want.to} (outlined).` : 'Try again.'}</div>`;
    }
  }};
}

/* --- exercise 3: find squares in a real position --- */
function qFind(){
  pickOrient();
  const line = randomLine(8), sans = line[2].split(' ');
  const k = Math.max(4, Math.floor(sans.length * (.5 + Math.random() * .5)));
  const g = new Chess(); sans.slice(0, k).forEach(m => g.move(m));
  C.fen = g.fen(); C.hl = {}; C.arrows = [];
  const pieces = []; for(const sq of ALL_SQ){ const p = g.get(sq); if(p) pieces.push({sq, ...p}); }
  const src = `${line[1]}, after move ${Math.ceil(k / 2)}`;
  const kind = Math.random();
  if(kind < .35){
    // "where is it?": a piece that is unique on the board (bishops by square colour)
    const label = p => p.type === 'b' ? `${COLOR(p.color)}'s ${(files.indexOf(p.sq[0]) + +p.sq[1]) % 2 === 0 ? 'light' : 'dark'}-squared bishop` : `${COLOR(p.color)}'s ${PNAME[p.type].toLowerCase()}`;
    const uniq = pieces.filter(p => p.type !== 'p' && pieces.filter(o => label(o) === label(p)).length === 1);
    const t = uniq[Math.floor(Math.random() * uniq.length)];
    const typing = Math.random() < .5;
    cRender();
    if(typing){
      cAsk(src, `On which square is ${label(t)}?`, {input: true, placeholder: 'e.g. f3'});
      C.q = {onSubmit(v){ if(!v.trim()) return; C.q.onSubmit = null; const ok = normSq(v) === t.sq; C.hl = {[t.sq]: ok ? 'good' : 'mark'}; cRender(); logSquare(t.sq, ok); cFeedback(ok, ok ? '' : `It is on <b>${t.sq}</b> (highlighted).`, qFind); }};
    } else {
      cAsk(src, `Click the square of ${label(t)}.`);
      C.q = {onClick(sq){ C.q.onClick = null; const ok = sq === t.sq; C.hl = ok ? {[sq]: 'good'} : {[sq]: 'bad', [t.sq]: 'mark'}; cRender(); logSquare(t.sq, ok); cFeedback(ok, ok ? `Yes, ${t.sq}.` : `You clicked ${sq}. It is on <b>${t.sq}</b>.`, qFind); }};
    }
  } else if(kind < .7){
    // name the highlighted piece's square
    const t = pieces[Math.floor(Math.random() * pieces.length)];
    C.hl = {[t.sq]: 'mark'}; cRender();
    cAsk(src, `Which square is the highlighted ${COLOR(t.color).toLowerCase()} ${PNAME[t.type].toLowerCase()} on?`, {input: true, placeholder: 'e.g. c6'});
    C.q = {onSubmit(v){ if(!v.trim()) return; C.q.onSubmit = null; const ok = normSq(v) === t.sq; C.hl = {[t.sq]: ok ? 'good' : 'bad'}; cRender(); logSquare(t.sq, ok); cFeedback(ok, ok ? '' : `It is <b>${t.sq}</b>.`, qFind); }};
  } else {
    // every square a piece can move to
    const cand = pieces.filter(p => 'nbrq'.includes(p.type)).map(p => {
      const f = g.fen().split(' '); f[1] = p.color; f[3] = '-';
      let to = []; try{ to = [...new Set(new Chess(f.join(' ')).moves({square: p.sq, verbose: true}).map(m => m.to))]; }catch(e){}
      return {...p, to};
    }).filter(p => p.to.length >= 2 && p.to.length <= 9);
    if(!cand.length) return qFind();
    const t = cand[Math.floor(Math.random() * cand.length)], picked = new Set();
    const paint = () => { C.hl = {[t.sq]: 'mark'}; picked.forEach(q => C.hl[q] = 'pick'); cRender(); };
    paint();
    cAsk(src, `Click every square the ${COLOR(t.color).toLowerCase()} ${PNAME[t.type].toLowerCase()} on ${t.sq} can move to, then check.`, {actions: [['Check', () => C.q.done(), 'primary']]});
    C.q = {onClick(sq){ if(sq === t.sq) return; picked.has(sq) ? picked.delete(sq) : picked.add(sq); paint(); },
      done(){
        C.q.onClick = null; const want = new Set(t.to); C.hl = {[t.sq]: 'mark'};
        let ok = picked.size === want.size;
        want.forEach(q => { const hit = picked.has(q); C.hl[q] = hit ? 'good' : 'miss'; if(!hit) ok = false; logSquare(q, hit); });
        picked.forEach(q => { if(!want.has(q)){ C.hl[q] = 'bad'; ok = false; logSquare(q, false); } });
        cRender();
        cFeedback(ok, ok ? `All ${want.size} squares.` : `Green: found. Orange ring: missed. Red: not reachable. The squares were ${[...want].sort().join(', ')}.`, qFind);
      }};
  }
}

/* --- exercise 4: 30-second speed round --- */
function qSpeedIntro(){
  pickOrient(); C.fen = null; C.hl = {}; C.arrows = []; cRender();
  clearInterval(C.timer); $('cTimer').textContent = '30'; $('cTimerLbl').textContent = 'seconds left';
  cAsk('', `30 seconds: click the named square, or type the outlined one. Seen from ${COLOR(C.orient)}'s side.`, {actions: [['Start', speedStart, 'primary']]});
  C.q = null;
}
function speedStart(){
  C.round = {score: 0, wrong: 0, orient: C.orient}; C.end = Date.now() + 30000;
  const line = randomLine(8), sans = line[2].split(' '), g = new Chess(); sans.forEach(m => g.move(m)); C.fen = g.fen();
  clearInterval(C.timer);
  C.timer = setInterval(() => { const left = Math.max(0, Math.ceil((C.end - Date.now()) / 1000)); $('cTimer').textContent = left; if(left <= 0) speedEnd(); }, 200);
  speedNext();
}
function speedNext(prev){
  const sq = weightedSquare(C.orient, prev);
  const flash = (ok, shown) => { C.hl = {[shown]: ok ? 'good' : 'bad'}; cRender(); setTimeout(() => { if(C.round) speedNext(sq); }, ok ? 150 : 450); };
  const answer = ok => { logSquare(sq, ok); if(ok) C.round.score++; else C.round.wrong++; $('cOk').textContent = C.round.score; $('cBad').textContent = C.round.wrong; };
  if(Math.random() < .6){
    C.hl = {}; cRender(); cAsk('', `Click <b>${sq}</b>`);
    C.q = {onClick(s){ C.q.onClick = null; const ok = s === sq; answer(ok); flash(ok, ok ? s : sq); }};
  } else {
    C.hl = {[sq]: 'target'}; cRender(); cAsk('', 'Type the outlined square', {input: true});
    C.q = {onType(v){ if(normSq(v).length >= 2){ C.q.onType = null; const ok = normSq(v) === sq; answer(ok); flash(ok, sq); } }};
  }
}
function speedEnd(){
  clearInterval(C.timer); C.timer = null;
  const r = C.round; C.round = null; if(!r) return;
  C.q = null; C.hl = {}; cRender();
  coordRounds.push([Date.now(), r.orient, r.score, r.wrong]); store.set('coordRounds', coordRounds); if(window.Sync) Sync.schedule();
  if(Daily.active === 'warm') Daily.count('warm');
  const mine = coordRounds.filter(x => x[1] === r.orient), prev = mine.slice(0, -1);
  const best = Math.max(...mine.map(x => x[2]));
  cAsk('', `${r.score} squares in 30 seconds${r.wrong ? `, ${r.wrong} wrong` : ''}.`, {actions: [['Another round', speedStart, 'primary']]});
  $('cFeedback').hidden = false; $('cFeedback').className = 'status ' + (r.score >= best ? 'good' : 'done');
  $('cFeedback').innerHTML = `<div class="st-title">${r.score >= best && prev.length ? 'New best' : prev.length ? `Your best: ${best}` : 'First round recorded'}</div>` +
    (prev.length ? `<div class="st-body">Average of your previous rounds from ${COLOR(r.orient)}'s side: ${(prev.slice(-5).reduce((a, x) => a + x[2], 0) / Math.min(5, prev.length)).toFixed(1)}.</div>` : '');
  renderCoordStats();
}

/* --- stats on the page --- */
function renderCoordStats(){
  const side = C.side === 'b' ? 'b' : 'w';
  const rounds = coordRounds.filter(x => C.side === 'm' || x[1] === C.side).slice(-30);
  if(!rounds.length) $('cRounds').innerHTML = '<p class="help" style="color:var(--muted);margin:0">No speed rounds yet.</p>';
  else {
    const last5 = rounds.slice(-5), before = rounds.slice(0, -5);
    const avg = a => (a.reduce((s, x) => s + x[2], 0) / a.length).toFixed(1);
    const W = 760, H = 160, L = 30, B = 20, max = Math.max(10, ...rounds.map(x => x[2])), bw = (W - L) / Math.max(rounds.length, 10);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Speed round scores">`;
    for(const g of [0, .5, 1]){ const y = 8 + (H - 8 - B) * (1 - g); svg += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text class="axis" x="${L - 6}" y="${y + 4}" text-anchor="end">${Math.round(max * g)}</text>`; }
    rounds.forEach((x, i) => { const h = (H - 8 - B) * x[2] / max; svg += `<rect x="${L + i * bw + bw * .15}" y="${H - B - h}" width="${bw * .7}" height="${Math.max(h, 1)}" rx="3" fill="${x[1] === 'w' ? 'var(--accent)' : 'var(--muted)'}"><title>${new Date(x[0]).toLocaleDateString()}: ${x[2]} right, ${x[3]} wrong (${COLOR(x[1])}'s side)</title></rect>`; });
    $('cRounds').innerHTML = `<p style="margin:0 0 8px">Average of your last ${last5.length} round${last5.length > 1 ? 's' : ''}: <b>${avg(last5)}</b>${before.length ? `, before that: ${avg(before)}` : ''}. Best: <b>${Math.max(...rounds.map(x => x[2]))}</b>.</p>` + svg + '</svg>';
  }
  // heat map of misses for the chosen side
  const st = squareStats(side);
  $('cHeatTitle').textContent = `Squares you miss most, seen from ${COLOR(side)}'s side`;
  let svg = '<svg viewBox="0 0 800 800" role="img" aria-label="Miss rate per square">';
  cSquaresFor(side).forEach((sq, i) => {
    const x = (i % 8) * 100, y = Math.floor(i / 8) * 100, s = st[sq], rate = s.n ? s.miss / s.n : 0;
    const light = (files.indexOf(sq[0]) + +sq[1]) % 2 === 0;
    svg += `<rect x="${x}" y="${y}" width="100" height="100" fill="${light ? 'var(--sq-light)' : 'var(--sq-dark)'}"/>`;
    if(s.n) svg += `<rect x="${x}" y="${y}" width="100" height="100" fill="#B0402D" fill-opacity="${Math.min(.85, rate * 1.4)}"><title>${sq}: ${s.miss} missed of ${s.n}</title></rect>`;
    svg += `<text x="${x + 50}" y="${y + 60}" text-anchor="middle" font-size="26" fill="#172231" fill-opacity=".55">${sq}</text>`;
  });
  $('cHeat').innerHTML = svg + '</svg>';
  const worst = ALL_SQ.filter(q => st[q].n >= 2 && st[q].miss).sort((a, b) => st[b].miss / st[b].n - st[a].miss / st[a].n).slice(0, 6);
  $('cHeatList').innerHTML = worst.length ? '<ul style="margin:0;padding-left:18px">' + worst.map(q => `<li><b>${q}</b>: missed ${st[q].miss} of ${st[q].n}</li>`).join('') + '</ul><p class="help" style="color:var(--muted)">These come up more often in speed rounds.</p>' : '<p class="help" style="color:var(--muted);margin:0">Answer a few questions and your weak squares show up here.</p>';
}
function cSquaresFor(side){ const s = []; for(let r=0;r<8;r++) for(let f=0;f<8;f++){ const rank = side === 'w' ? 8 - r : r + 1, file = side === 'w' ? f : 7 - f; s.push(files[file] + rank); } return s; }

/* --- navigation --- */
function cRenderControls(){
  $('cModes').innerHTML = MODES.map(([v, l]) => `<button class="chip" data-cmode="${v}" aria-pressed="${C.mode === v}">${l}</button>`).join('');
  $('cModes').querySelectorAll('[data-cmode]').forEach(b => b.onclick = () => { C.mode = b.dataset.cmode; store.set('cMode', C.mode); cStart(); });
  $('cSides').innerHTML = [['w', 'White'], ['b', 'Black'], ['m', 'Both']].map(([v, l]) => `<button data-cside="${v}" aria-pressed="${C.side === v}">${l}</button>`).join('');
  $('cSides').querySelectorAll('[data-cside]').forEach(b => b.onclick = () => { C.side = b.dataset.cside; store.set('cSide', C.side); cStart(); });
}
function cStart(){
  clearInterval(C.timer); C.timer = null; C.round = null; C.ok = 0; C.bad = 0; C.sel = null;
  cRenderControls(); cStats(); renderCoordStats();
  ({read: qRead, play: qPlay, find: qFind, speed: qSpeedIntro})[C.mode]();
  if(C.mode === 'speed'){ $('cOk').textContent = 0; $('cBad').textContent = 0; }
}
let cFrom = 'setup';
function openCoords(){
  cFrom = !$('train').hidden ? 'train' : !$('progress').hidden ? 'progress' : !$('today').hidden ? 'today' : 'setup';
  cancelCoach();
  ['setup', 'train', 'progress', 'today', 'review'].forEach(id => $(id).hidden = true); $('toToday').hidden = false; renderDayBar();
  $('coords').hidden = false; $('toSetup').hidden = true; $('toCoords').hidden = true; $('toProgress').hidden = false;
  cStart(); window.scrollTo(0, 0);
}
function closeCoords(){
  clearInterval(C.timer); C.timer = null; C.round = null;
  $('coords').hidden = true; $('toCoords').hidden = false;
  if(cFrom === 'today' || Daily.active){ openToday(); return; }
  if(cFrom === 'train' && game){ $('train').hidden = false; $('toSetup').hidden = false; renderAll(); }
  else { $('setup').hidden = false; renderSetup(); }
}
 

export { C, coordLog, coordRounds, fmtMoves, openCoords };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  for(const f of 'abcdefgh') for(let r = 1; r <= 8; r++) ALL_SQ.push(f + r);
  $('cBoardWrap').addEventListener('contextmenu', e => e.preventDefault());
  $('cBoardWrap').addEventListener('pointerdown', ev => {
    if(ev.button !== 0) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY), s = el && el.closest && el.closest('#cBoard .sq');
    if(s && C.q && C.q.onClick) C.q.onClick(s.dataset.sq);
  });
  $('cCheck').onclick = () => C.q && C.q.onSubmit && C.q.onSubmit($('cInput').value);
  $('cInput').addEventListener('keydown', e => {
    if(e.key !== 'Enter') return;
    e.preventDefault();
    if(C.q && C.q.onSubmit) C.q.onSubmit($('cInput').value);
    else { const nb = [...$('cActions').querySelectorAll('button')].find(b => b.textContent === 'Next'); if(nb) nb.click(); }  // Enter again: next question
  });
  $('cInput').addEventListener('input', e => { if(C.q && C.q.onType) C.q.onType(e.target.value); });
  document.addEventListener('keydown', e => {
    if($('coords').hidden || e.key !== 'Enter' || e.target === $('cInput')) return;
    const nb = [...$('cActions').querySelectorAll('button')].find(b => b.textContent === 'Next'); if(nb){ e.preventDefault(); nb.click(); }
  });
  $('toCoords').onclick = () => { Daily.active = null; openCoords(); };
  $('cBack').onclick = closeCoords;
}
export { init };
