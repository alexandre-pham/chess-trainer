// The Squares page: play famous games on the board from their written moves.
import { $, esc, pct, store } from './util.js';
import { PIECES } from './data.js';
import { Sync } from './sync.js';
import { files } from './trainer.js';
import { Daily, renderDayBar } from './daily.js';
import { showPage } from './nav.js';

/* ================= play from notation ================= */
// every answer about a square: [time, side seen from, square, correct 1/0, exercise]
let coordLog = store.get('coordLog', []);
// speed rounds from earlier versions: kept so syncing and backups do not lose them
let coordRounds = store.get('coordRounds', []);
function logSquare(sq, ok){
  coordLog.push([Date.now(), C.orient, sq, ok ? 1 : 0, 'p']);
  if(coordLog.length > 30000) coordLog = coordLog.slice(-30000);
  store.set('coordLog', coordLog); if(window.Sync) Sync.schedule();
}
const C = {side: store.get('cSide', 'w'), len: store.get('cLen', 30), next: store.get('cNext', 0), orient: 'w', fen: null, hl: {}, ok: 0, bad: 0, sel: null, q: null};
const COLOR = c => c === 'w' ? 'White' : 'Black';
const WARM_LEN = 10;  // moves played for Today's warm-up
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
}

/* --- panel helpers --- */
function cAsk(prompt, opts = {}){
  $('cPrompt').innerHTML = prompt; $('cLine').innerHTML = opts.line || '';
  $('cFeedback').hidden = true; cActions(opts.actions || []);
}
function cActions(list){
  $('cActions').innerHTML = '';
  list.forEach(([label, fn, kind]) => { const b = document.createElement('button'); b.className = 'btn' + (kind ? ' ' + kind : ''); b.textContent = label; b.onclick = fn; $('cActions').appendChild(b); });
}
function cStats(){ $('cOk').textContent = C.ok; $('cBad').textContent = C.bad; $('cAcc').textContent = C.ok + C.bad ? pct(C.ok / (C.ok + C.bad)) : '–'; }
const fmtMoves = (sans, from) => sans.map((m, i) => { const ply = from + i; return (ply % 2 === 0 ? (ply / 2 + 1) + '. ' : (i === 0 ? Math.floor(ply / 2) + 1 + '… ' : '')) + m; });

// famous games: data/games.json (moves from pgnmentor.com collections), loaded the first time, played in order
let GAMES = null;
async function nextGame(){
  if(!GAMES){ const r = await fetch(new URL('../data/games.json', import.meta.url)); if(!r.ok) throw new Error('Could not load the games collection.'); GAMES = (await r.json()).famous; }
  const g = GAMES[C.next % GAMES.length];
  C.next = (C.next + 1) % GAMES.length; store.set('cNext', C.next);
  return {label: `${g.w} – ${g.b}`, sub: [g.title, g.where, g.result].filter(Boolean).join(', '), moves: g.moves.split(' ')};
}
async function qPlay(){
  pickOrient(); C.q = null;
  cAsk('Loading the game…');
  let game;
  try{ game = await nextGame(); }catch(e){ cAsk(esc(e.message), {actions: [['Try again', qPlay, 'primary']]}); return; }
  const len = Daily.active === 'warm' ? WARM_LEN : C.len;
  const plies = len ? len * 2 : game.moves.length, sans = game.moves.slice(0, plies), whole = sans.length === game.moves.length;
  const g = new Chess(); let i = 0, tries = 0, firstTry = 0;
  C.fen = g.fen(); C.hl = {}; C.sel = null; cRender();
  const head = `<div class="c-game"><b>${esc(game.label)}</b>${game.sub ? ', ' + esc(game.sub) : ''}</div>`;
  // one row per move: number, White's move, Black's move
  const cell = j => j < sans.length ? `<span class="${j < i ? 'done' : j === i ? 'now' : 'todo'}">${esc(sans[j])}</span>` : '<span></span>';
  const showLine = () => { let rows = ''; for(let j = 0; j < sans.length; j += 2) rows += `<span class="n">${j / 2 + 1}.</span>${cell(j)}${cell(j + 1)}`; return head + `<div class="c-moves">${rows}</div>`; };
  const keepInView = () => { const box = $('cLine').querySelector('.c-moves'), n = box && box.querySelector('.now'); if(n) box.scrollTop = n.offsetTop - box.clientHeight / 2; };
  const ask = () => { cAsk(i < sans.length ? `Play <b>${esc(sans[i])}</b> for ${COLOR(g.turn())}.` : 'Done.', {line: showLine(), actions: [['Skip this game', qPlay]]}); keepInView(); };
  ask();
  C.q = {onClick(sq){
    if(i >= sans.length) return;
    const p = g.get(sq);
    if(!C.sel || (p && p.color === g.turn())){ if(p && p.color === g.turn()){ C.sel = sq; C.hl = {[sq]: 'pick'}; cRender(); } return; }
    const want = new Chess(g.fen()).move(sans[i]);
    const mv = g.move({from: C.sel, to: sq, promotion: want.promotion || 'q'});
    if(mv && mv.san === want.san){
      if(!tries){ firstTry++; logSquare(want.to, true); }
      i++; tries = 0; C.sel = null; C.hl = {[mv.from]: 'good', [mv.to]: 'good'}; C.fen = g.fen(); cRender();
      if(i >= sans.length){
        cAsk(whole ? 'End of the game.' : `Stopped after move ${Math.ceil(sans.length / 2)}.`, {line: showLine()});
        C.ok += firstTry; C.bad += sans.length - firstTry; cStats();
        $('cFeedback').hidden = false; $('cFeedback').className = 'status ' + (firstTry === sans.length ? 'good' : 'bad');
        $('cFeedback').innerHTML = `<div class="st-title">${firstTry} of ${sans.length} moves on the first try</div>`;
        cActions([['Next game', qPlay, 'primary']]);
        if(Daily.active === 'warm') Daily.count('warm');
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

/* --- controls --- */
function cRenderControls(){
  $('cLen').value = String(C.len); $('cLenF').hidden = Daily.active === 'warm';
  $('cSides').innerHTML = [['w', 'White'], ['b', 'Black'], ['m', 'Both']].map(([v, l]) => `<button data-cside="${v}" aria-pressed="${C.side === v}">${l}</button>`).join('');
  $('cSides').querySelectorAll('[data-cside]').forEach(b => b.onclick = () => { C.side = b.dataset.cside; store.set('cSide', C.side); cRenderControls(); pickOrient(); cRender(); });
}
function openCoords(){ showPage('coords'); renderDayBar(); C.ok = 0; C.bad = 0; cStats(); cRenderControls(); qPlay(); }

export { C, coordLog, coordRounds, fmtMoves, openCoords };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  $('cBoardWrap').addEventListener('contextmenu', e => e.preventDefault());
  $('cBoardWrap').addEventListener('pointerdown', ev => {
    if(ev.button !== 0) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY), s = el && el.closest && el.closest('#cBoard .sq');
    if(s && C.q && C.q.onClick) C.q.onClick(s.dataset.sq);
  });
  $('toCoords').onclick = () => { Daily.active = null; openCoords(); };
  // a new length restarts the same game
  $('cLen').onchange = e => { C.len = +e.target.value; store.set('cLen', C.len); if(GAMES){ C.next = (C.next + GAMES.length - 1) % GAMES.length; qPlay(); } };
}
export { init };
