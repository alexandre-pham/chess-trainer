// The training board: game state, judging your moves, opponent moves, drawing, navigation.
import { $, esc, pct, posKey } from './util.js';
import { LINES, PIECES, POS } from './data.js';
import { S, bookMoves, candidates, fenAfter, nameAfter, selFamilies, shortestLine } from './book.js';
import { cards, dueCards, grade, logMove, progressCounts, saveCards, srsMult } from './srs.js';
import { Explorer, minGames, scoreFor } from './explorer.js';
import { Coach, Web, cancelCoach, coachExplain, explainLast, renderCoach, renderInsight } from './coach.js';
import { Engine, fmtEval, fmtLine, pvToSan, renderEngineNote, uciMove, waitEngine } from './engine.js';
import { Daily, nextWeak, openToday, renderDayBar } from './daily.js';

/* ================= game state ================= */
// phases: 'book' (named lines of your selection), 'stats' (Lichess explorer), 'engine' (Stockfish)
let phase = 'book', phaseEndName = null, game, status = 'idle', lastNamed = null, wrongInfo = null, selectedSq = null, hintOn = false, arrowsList = [];
let lastFeedback = null, explainInfo = null, nameFresh = false, reviewing = null, failedHere = null, sessionId = 0;
const userMarks = [];
const stats = {good:0, bad:0};
const files = 'abcdefgh';
const moveNo = () => +game.fen().split(' ')[5];

let redo = []; // moves undone with the back arrow, newest last
function resetLine(){
  cancelCoach(); sessionId++; redo = [];
  game = new Chess(); phase = 'book'; phaseEndName = null; userMarks.length = 0; lastFeedback = null; explainInfo = null;
  lastNamed = null; wrongInfo = null; selectedSq = null; hintOn = false; arrowsList = []; failedHere = null; reviewing = null;
}
function startLine(){ resetLine(); updateName(); renderAll(); nextTurn(); }
function startReview(){
  const due = dueCards();
  if(!due.length){ startLine(); return; }
  startReviewKey(due[0][0]);
}

// start the trainer on one review card's position
function startReviewKey(key){
  const c = cards[key]; if(!c){ startLine(); return; }
  resetLine(); reviewing = key;
  for(const m of c.path){ if(!game.move(m)) break; userMarks.push('r'); updateName(); }
  phase = candidates(game.fen()).length ? 'book' : (Explorer.enabled() ? 'stats' : 'engine');
  if(phase !== 'book') phaseEndName = lastNamed;
  nameFresh = false; status = 'user'; renderAll();
  // check right away whether real games reach this position; if not, say so and use Stockfish
  if(phase === 'stats'){ const sid = sessionId, fen = game.fen(); Explorer.get(fen).then(ex => { if(sid === sessionId && phase === 'stats' && game.fen() === fen && (!ex || ex.total < minGames() || !ex.moves.length)){ phase = 'engine'; statsEnd = {name: lastNamed, total: ex ? ex.total : 0}; renderStatus(); } }); }
}
function finish(){ status = 'done'; reviewing = null; if(Daily.active === 'new') Daily.count('new'); renderAll(); }
function recomputeName(){
  lastNamed = null; const g = new Chess();
  for(const m of game.history()){ g.move(m); const p = POS[posKey(g.fen())]; if(p && p[1]) lastNamed = LINES[p[0]]; }
  nameFresh = false;
}
function recomputePhase(){
  if(candidates(game.fen()).length){ phase = 'book'; phaseEndName = null; return; }
  if(phase === 'book'){ phase = Explorer.enabled() ? 'stats' : 'engine'; phaseEndName = lastNamed; }
}
function navBack(){
  if(!game || !game.history().length || $('train').hidden) return;
  cancelCoach(); sessionId++;
  if(status === 'wrong'){ game.undo(); userMarks.pop(); wrongInfo = null; }  // drop the wrong move, as with Try again
  else { const m = game.undo(); redo.push({san: m.san, mark: userMarks.pop()}); }
  afterNav();
}
function navForward(){
  if(!redo.length || $('train').hidden) return;
  cancelCoach(); sessionId++;
  if(status === 'wrong'){ game.undo(); userMarks.pop(); wrongInfo = null; }
  const r = redo.pop(); game.move(r.san); userMarks.push(r.mark); afterNav();
}
function navFirst(){ while(game && game.history().length) navBackSilent(); afterNav(); }
function navLast(){ while(redo.length){ const r = redo.pop(); game.move(r.san); userMarks.push(r.mark); } afterNav(); }
function navBackSilent(){
  cancelCoach(); sessionId++;
  if(status === 'wrong'){ game.undo(); userMarks.pop(); wrongInfo = null; status = 'browse'; return; }
  const m = game.undo(); redo.push({san: m.san, mark: userMarks.pop()});
}
function afterNav(){
  explainInfo = null; lastFeedback = null; arrowsList = []; selectedSq = null; hintOn = false; failedHere = null; reviewing = null; wrongInfo = null;
  recomputeName(); recomputePhase();
  if(!redo.length){ nextTurn(); return; }        // back at the live position: carry on
  status = game.turn() === S.color ? 'user' : 'browse';
  renderAll();
}
 

async function nextTurn(){
  const sid = sessionId, fen = game.fen();
  if(game.game_over()){ finish(); return; }
  if(phase === 'book' && !candidates(fen).length){
    phaseEndName = lastNamed;
    phase = Explorer.enabled() ? 'stats' : 'engine';
  }
  if(phase !== 'book' && moveNo() > S.maxMove){ finish(); return; }
  if(phase === 'stats'){
    status = 'loading'; renderStatus();
    const ex = await Explorer.get(fen);
    if(sid !== sessionId || game.fen() !== fen) return;
    if(!ex || ex.total < minGames() || !ex.moves.length){ phase = 'engine'; statsEnd = {name: lastNamed, total: ex ? ex.total : 0, failed: !ex}; }
  }
  if(phase === 'engine' && (!S.useEngine || Engine.state === 'failed')){ finish(); return; }
  if(game.turn() === S.color){ status = 'user'; renderAll(); }
  else { status = 'opp'; renderAll(); setTimeout(() => { if(sid === sessionId) oppMove(); }, 480); }
}
let statsEnd = null;

async function oppMove(){
  if(status !== 'opp') return;
  const sid = sessionId, fen = game.fen();
  let options = [];
  if(phase === 'book'){
    const c = candidates(fen), ex = await Explorer.get(fen);
    if(sid !== sessionId) return;
    const deepest = Math.max(...c.map(x => x.rem));
    options = c.map(x => {
      const em = ex && ex.moves.find(m => m.san === x.san);
      // avoid side lines whose theory stops right away when deeper lines exist
      // (with Lichess statistics, real game frequencies decide instead)
      const dead = !ex && deepest >= 5 && x.rem <= 3 ? 0.15 : 1;
      return {san: x.san, w: (ex ? Math.max(em ? em.n : 0, ex.total * 0.002, 1) : x.w) * dead};
    });
  } else if(phase === 'stats'){
    const ex = await Explorer.get(fen);
    if(sid !== sessionId) return;
    if(ex) options = ex.moves.filter((m, i) => i === 0 || m.share >= 0.03).map(m => ({san: m.san, w: m.n}));
  } else {
    await waitEngine();
    if(!Engine.available()){ if(sid === sessionId) finish(); return; }
    const r = await Engine.analyse(fen, 12, 3);
    if(sid !== sessionId || game.fen() !== fen) return;
    if(r && r.lines.length){
      const best = r.lines[0].cp;
      options = r.lines.filter(l => l.cp >= best - 30).map(l => { const g = new Chess(fen); return {san: uciMove(g, l.pv[0]).san, w: 1}; });
    }
  }
  if(!options.length){ finish(); return; }
  const weights = options.map(o => o.w * srsMult(fenAfter(fen, o.san)));
  let r = Math.random() * weights.reduce((a,b) => a + b, 0), pick = options[0];
  for(let i=0;i<options.length;i++){ r -= weights[i]; if(r <= 0){ pick = options[i]; break; } }
  game.move(pick.san); userMarks.push('o');
  updateName(); nextTurn();
}
function updateName(){
  const p = POS[posKey(game.fen())];
  if(p && p[1]){ const l = LINES[p[0]]; if(!lastNamed || lastNamed[1] !== l[1]){ lastNamed = l; nameFresh = true; } }
}
function cardCtx(before){
  const path = game.history().slice(0, -1);
  return {path, color: S.color, fams: [...selFamilies()], name: lastNamed ? lastNamed[1] : ''};
}
function gradeHere(before, result){
  if(phase === 'engine' && !cards[posKey(before)]) return;  // engine positions are only graded when they are already cards (e.g. from your games)
  const key = posKey(before);
  if(result === 'good' && failedHere === key) return; // already graded as a miss
  grade(key, result, cardCtx(before));
  if(result === 'again') failedHere = key;
}

/* ================= your move ================= */
function tryUserMove(from, to){
  if(status !== 'user') return false;
  const before = game.fen(), piece = game.get(from);
  const promo = piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
  const m = game.move(promo ? {from, to, promotion: promo} : {from, to});
  if(!m) return false;
  selectedSq = null; hintOn = false; arrowsList = []; explainInfo = null;
  userMarks.push('u');
  if(phase === 'book') judgeBook(before, m);
  else {
    status = 'checking'; lastFeedback = null; renderAll();
    const sid = sessionId;
    // never leave the board stuck on "Checking your move": if anything fails, accept the move and carry on
    (phase === 'stats' ? judgeStats : judgeEngine)(before, m).catch(err => {
      console.error(err);
      if(sid === sessionId && status === 'checking') accept(before, m, {kind: 'unchecked', san: m.san});
    });
  }
  return true;
}
function accept(before, m, feedback, result){
  if(failedHere !== posKey(before)){ stats.good++; logMove(true); if(Daily.active === 'review' || Daily.active === 'weak') Daily.count(Daily.active); }
  gradeHere(before, result || 'good'); failedHere = null; redo = [];
  if(reviewing === posKey(before)) reviewing = null;
  lastFeedback = feedback; updateName(); nextTurn();
}
function reject(info){
  userMarks[userMarks.length - 1] = 'x'; redo = [];
  if(failedHere !== posKey(info.before)){ stats.bad++; logMove(false); if(Daily.active === 'review' || Daily.active === 'weak') Daily.count(Daily.active); }
  gradeHere(info.before, 'again');
  wrongInfo = info; status = 'wrong'; renderAll();
}
function judgeBook(before, m){
  const cands = candidates(before);
  if(cands.some(c => c.san === m.san)){
    accept(before, m, {kind: 'book', san: m.san, before});
    return;
  }
  const all = bookMoves(before);
  const otherName = all[m.san] ? nameAfter(before, m.san, shortestLine(all[m.san])) : null;
  const info = {phase: 'book', before, move: m, cands: cands.map(c => ({san: c.san, label: nameAfter(before, c.san, c.line)})), otherName, engineState: Engine.available() ? 'running' : 'off', coach: '', coachState: 'idle'};
  reject(info);
  enrichMistake(info);
}
async function judgeStats(before, m){
  const sid = sessionId, ex = await Explorer.get(before);
  if(sid !== sessionId) return;
  // too few games here (common for positions from your own games): judge with Stockfish instead
  if(!ex || ex.total < minGames() || !ex.moves.length){ phase = 'engine'; statsEnd = {name: lastNamed, total: ex ? ex.total : 0}; return judgeEngine(before, m); }
  const mv = ex.moves.find(x => x.san === m.san), top = ex.moves[0];
  const popular = ex.moves.filter((x, i) => i === 0 || x.share >= 0.1);
  if(mv && (mv === top || mv.share >= 0.1)){
    accept(before, m, {kind: 'stats', san: m.san, share: mv.share, score: scoreFor(mv, S.color)});
    return;
  }
  const info = {phase: 'stats', before, move: m, mv, cands: popular.slice(0, 4).map(x => ({san: x.san, share: x.share, score: scoreFor(x, S.color)})), total: ex.total, engineState: 'running', coach: '', coachState: 'idle'};
  // is it at least sound? ask the engine before deciding how hard to grade
  await waitEngine();
  if(Engine.available()){
    const e = await engineCompare(before, m, info.cands[0].san);
    if(sid !== sessionId) return;
    info.engine = e; info.engineState = 'done';
    if(e) info.verdict = verdictFor(e.loss);
  } else info.engineState = 'off';
  info.rareButSound = !info.engine || info.engine.loss < 60;
  reject(info);
  coachExplain(info);
}
async function judgeEngine(before, m){
  const sid = sessionId, g = new Chess(before); g.move(m.san);
  await waitEngine();
  if(!Engine.available()){ if(sid === sessionId) accept(before, m, null); return; }
  const rb = await Engine.analyse(before, 12, 3), ra = await Engine.analyse(g.fen(), 12, 1);
  if(sid !== sessionId || status !== 'checking') return;
  if(!rb || !ra){ accept(before, m, null); return; }
  const uci = m.from + m.to + (m.promotion || ''), inTop = rb.lines.find(l => l.pv[0] === uci);
  const best = rb.lines[0].cp, you = inTop ? inTop.cp : -ra.cp, loss = best - you;
  if(loss < 60){ accept(before, m, {kind: 'engine', san: m.san, ev: you}); return; }
  const cands = rb.lines.filter(l => l.cp >= best - 30).map(l => { const gg = new Chess(before); return {san: uciMove(gg, l.pv[0]).san, ev: l.cp}; });
  const info = {phase: 'engine', before, move: m, cands, engineState: 'done', coach: '', coachState: 'idle',
    engine: {you, book: best, loss, refutation: pvToSan(g.fen(), ra.pv, 6), bestLine: pvToSan(before, rb.lines[0].pv, 7).slice(1), afterFen: g.fen()}, verdict: verdictFor(loss)};
  reject(info); coachExplain(info);
}
const verdictFor = loss => loss >= 250 ? 'Blunder' : loss >= 110 ? 'Mistake' : loss >= 45 ? 'Inaccuracy' : 'Playable, but not the main move';
async function engineCompare(before, m, refSan){
  const g = new Chess(before); g.move(m.san);
  const bg = new Chess(before); bg.move(refSan);
  const ra = await Engine.analyse(g.fen(), 13), rb = await Engine.analyse(bg.fen(), 13);
  if(!ra || !rb) return null;
  const you = -ra.cp, book = -rb.cp;
  return {you, book, loss: book - you, refutation: pvToSan(g.fen(), ra.pv, 6), bestLine: pvToSan(bg.fen(), rb.pv, 6), afterFen: g.fen()};
}
async function enrichMistake(info){
  const sid = sessionId;
  const ex = await Explorer.get(info.before);
  if(sid !== sessionId || wrongInfo !== info) return;
  if(ex){
    info.cands.forEach(c => { const em = ex.moves.find(x => x.san === c.san); if(em){ c.share = em.share; c.score = scoreFor(em, S.color); } });
    const mv = ex.moves.find(x => x.san === info.move.san); if(mv) info.mv = mv;
    info.total = ex.total;
    renderStatus();
  }
  await waitEngine();
  if(sid !== sessionId || wrongInfo !== info) return;
  if(Engine.available()){
    info.engineState = 'running'; renderStatus();
    const e = await engineCompare(info.before, info.move, info.cands[0].san);
    if(sid !== sessionId || wrongInfo !== info) return;
    if(e){ info.engine = e; info.verdict = verdictFor(e.loss); }
    info.engineState = 'done';
  } else info.engineState = 'off';
  renderStatus();
  coachExplain(info);
}
function retry(){
  if(status !== 'wrong') return;
  cancelCoach(); game.undo(); userMarks.pop(); wrongInfo = null; arrowsList = []; status = 'user'; lastFeedback = null; renderAll();
}
function showBest(){
  if(status !== 'wrong') return;
  const w = wrongInfo; cancelCoach(); game.undo(); userMarks.pop();
  const m = game.move(w.cands[0].san); userMarks.push('u');
  arrowsList = [[m.from, m.to]]; wrongInfo = null; lastFeedback = {kind: 'shown', san: m.san}; failedHere = null;
  updateName(); nextTurn();
}
function keepMine(){
  if(status !== 'wrong') return;
  const w = wrongInfo; cancelCoach(); wrongInfo = null; userMarks[userMarks.length - 1] = 'u'; stats.bad--;
  // re-grade: a sound but rare move is "hard", not a miss
  const c = cards[posKey(w.before)]; if(c && c.lapses){ c.lapses--; saveCards(); }
  gradeHereForce(w.before, 'hard');
  lastFeedback = {kind: 'kept', san: w.move.san}; updateName(); nextTurn();
}
function gradeHereForce(before, result){ grade(posKey(before), result, cardCtx(before)); failedHere = null; }

/* ================= rendering ================= */
function squares(){ const s = []; for(let r=0;r<8;r++) for(let f=0;f<8;f++){ const rank = S.color === 'w' ? 8 - r : r + 1; const file = S.color === 'w' ? f : 7 - f; s.push(files[file] + rank); } return s; }
let hintSquares = new Set();
async function toggleHint(){
  hintOn = !hintOn; hintSquares = new Set();
  if(hintOn){
    const fen = game.fen();
    let sans = phase === 'book' ? candidates(fen).map(c => c.san) : [];
    if(phase === 'stats'){ const ex = await Explorer.get(fen); if(ex) sans = ex.moves.filter((m, i) => i === 0 || m.share >= 0.1).map(m => m.san); }
    if(phase === 'engine'){ const r = await Engine.analyse(fen, 10, 1); if(r){ const g = new Chess(fen); sans = [uciMove(g, r.pv[0]).san]; } }
    if(game.fen() !== fen) return;
    sans.forEach(s => { const g = new Chess(fen); const m = g.move(s); if(m) hintSquares.add(m.from); });
  }
  renderBoard();
}
function renderBoard(){
  const hist = game.history({verbose:true}), last = hist[hist.length-1];
  const legal = selectedSq && status === 'user' ? game.moves({square: selectedSq, verbose: true}) : [];
  const html = [];
  squares().forEach((sq, idx) => {
    const fi = files.indexOf(sq[0]), rk = +sq[1], light = (fi + rk) % 2 === 0, p = game.get(sq);
    const cls = ['sq', light ? 'l' : 'd'];
    if(last && (last.from === sq || last.to === sq)) cls.push(status === 'wrong' ? 'wrong' : 'last');
    if(selectedSq === sq) cls.push('sel');
    if(hintOn && hintSquares.has(sq)) cls.push('hint');
    const lm = legal.find(m => m.to === sq);
    let inner = p ? `<img src="${PIECES[p.color + p.type.toUpperCase()]}" alt="">` : '';
    if(lm) inner += p ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if(idx % 8 === 0) inner += `<span class="coord r">${sq[1]}</span>`;
    if(idx >= 56) inner += `<span class="coord f">${sq[0]}</span>`;
    html.push(`<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`);
  });
  $('board').innerHTML = html.join('');
  renderArrows();
}
function sqCenter(sq){ let f = files.indexOf(sq[0]), r = 8 - +sq[1]; if(S.color === 'b'){ f = 7 - f; r = 7 - r; } return [f * 100 + 50, r * 100 + 50]; }
/* ---- your own drawings: right-click and drag for arrows, right-click a square for a circle ---- */
// colours as on Lichess: plain green, Shift red, Alt blue, Shift+Alt yellow
const BRUSH = {g: '#15781B', r: '#882020', b: '#003088', y: '#e68f00', best: '#2D7A57'};
let drawings = [], drawingsPly = -1, rdrag = null;
const brushOf = e => e.shiftKey && e.altKey ? 'y' : e.shiftKey ? 'r' : e.altKey ? 'b' : 'g';
function arrowSvg(a, b, color, op){
  const [x1,y1] = sqCenter(a), [x2,y2] = sqCenter(b), dx = x2-x1, dy = y2-y1, len = Math.hypot(dx,dy), ex = x2 - dx/len*30, ey = y2 - dy/len*30;
  return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${BRUSH[color]}" stroke-opacity="${op}" stroke-width="16" stroke-linecap="round" marker-end="url(#ah-${color})"/>`;
}
function circleSvg(sq, color, op){ const [x,y] = sqCenter(sq); return `<circle cx="${x}" cy="${y}" r="45" fill="none" stroke="${BRUSH[color]}" stroke-opacity="${op}" stroke-width="7"/>`; }
function renderArrows(){
  if(game && game.history().length !== drawingsPly){ drawings = []; drawingsPly = game.history().length; }  // a move clears your drawings
  const defs = Object.keys(BRUSH).map(c => `<marker id="ah-${c}" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${BRUSH[c]}"/></marker>`).join('');
  let out = `<defs>${defs}</defs>`;
  out += arrowsList.map(([a,b]) => arrowSvg(a, b, 'best', .8)).join('');
  out += drawings.map(d => d.to ? arrowSvg(d.from, d.to, d.color, .8) : circleSvg(d.from, d.color, .85)).join('');
  if(rdrag && rdrag.to && rdrag.to !== rdrag.from) out += arrowSvg(rdrag.from, rdrag.to, rdrag.color, .5);
  $('arrows').innerHTML = out;
}
function toggleDrawing(from, to, color){
  const i = drawings.findIndex(d => d.from === from && d.to === to);
  if(i >= 0){ const same = drawings[i].color === color; drawings.splice(i, 1); if(same) return; }  // same shape again removes it
  drawings.push({from, to, color});
}

function renderMoves(){
  const h = game.history();
  if(!h.length && !redo.length){ $('moves').innerHTML = `<span class="ph">${S.color === 'w' ? 'You have White. Make the first move.' : 'You have Black. The trainer opens.'}</span>`; return; }
  let s = '';
  h.forEach((m, i) => {
    if(i % 2 === 0) s += `<span class="n">${i/2 + 1}.</span> `;
    const mk = userMarks[i], cls = ['m'];
    if(mk === 'u') cls.push('u'); if(mk === 'x') cls.push('x'); if(i === h.length - 1) cls.push('cur');
    s += `<span class="${cls.join(' ')}">${esc(m)}</span> `;
  });
  if(redo.length){
    let n = h.length;
    for(let i = redo.length - 1; i >= 0; i--, n++){
      if(n % 2 === 0) s += `<span class="n" style="opacity:.45">${n/2 + 1}.</span> `;
      s += `<span class="m" style="opacity:.45">${esc(redo[i].san)}</span> `;
    }
  }
  $('moves').innerHTML = s;
}
function renderName(){
  const el = $('opName');
  if(lastNamed){ el.textContent = lastNamed[1]; $('opEco').textContent = lastNamed[0]; }
  else { el.textContent = 'Starting position'; $('opEco').innerHTML = '&nbsp;'; }
  el.classList.toggle('fresh', nameFresh); if(nameFresh){ nameFresh = false; setTimeout(() => el.classList.remove('fresh'), 1200); }
  $('opSub').textContent = 'Training: ' + S.sel.join(', ');
}
function phaseNote(){
  if(phase === 'stats') return `<span style="color:var(--muted)">Named theory ended in ${esc(phaseEndName ? phaseEndName[1] : 'this line')}. Now following the moves of ${esc(Explorer.label())}, until move ${S.maxMove}.</span>`;
  if(phase === 'engine') return `<span style="color:var(--muted)">${statsEnd && statsEnd.total ? `Only ${statsEnd.total} games reach this position, so` : 'Theory has ended, so'} the trainer now plays strong engine moves until move ${S.maxMove}.${Explorer.enabled() ? '' : ' Connect Lichess to follow real games instead.'}</span>`;
  if(phase === 'book' && game && game.history().length && candidates(game.fen()).wide) return `<span style="color:var(--muted)">The lines of ${esc(S.sel[0])} stop here, so the trainer continues with other ${esc(S.sel[0].split(':')[0])} lines.</span>`;
  return '';
}
function candRow(c){
  const right = [];
  if(c.share != null) right.push(`<span class="pop" aria-hidden="true"><i style="width:${Math.round(c.share*100)}%"></i></span><span class="pct">${pct(c.share)}</span> of games, you score ${pct(c.score)}`);
  if(c.label) right.push(esc(c.label));
  if(c.ev != null) right.push('Stockfish ' + fmtEval(c.ev));
  return `<li><b>${esc(c.san)}</b><span>${right.join(' · ')}</span></li>`;
}
function renderStatus(){
  const st = $('status'), ac = $('actions');
  let cls = 'status', title = '', body = '', acts = [];
  const tag = reviewing ? '<div class="review-tag">Review</div>' : '';
  if(status === 'wrong' && wrongInfo){
    const w = wrongInfo, e = w.engine;
    const soft = w.phase === 'stats' ? w.rareButSound : (e ? e.loss < 110 : !!w.otherName);
    cls += soft ? ' warn' : ' bad';
    if(w.phase === 'stats') title = (w.rareButSound ? 'Not the main move' : (w.verdict || 'Mistake')) + ': ' + esc(w.move.san);
    else title = (e ? w.verdict : (w.otherName ? 'Not in your repertoire' : 'Out of book')) + ': ' + esc(w.move.san);
    if(w.phase === 'book') body = w.otherName ? `${esc(w.move.san)} is a known move, but it leads to <em>${esc(w.otherName)}</em>, not the line you are training.` : `${esc(w.move.san)} is not in the opening book here.`;
    else if(w.phase === 'stats') body = w.mv ? `${esc(w.move.san)} is played in only ${pct(w.mv.share)} of ${w.total.toLocaleString()} games here. Usually played:` : `${esc(w.move.san)} almost never appears in the ${w.total.toLocaleString()} games that reached this position. Usually played:`;
    else body = 'Past the end of theory, moves are judged by Stockfish. Better here:';
    body += `<ul class="book-list">${w.cands.slice(0,4).map(candRow).join('')}</ul>`;
    if(e) body += `<div class="engine"><span class="lbl">Stockfish:</span> ${esc(w.cands[0].san)} ${fmtEval(e.book)}, your move ${fmtEval(e.you)}. ${e.refutation.length ? 'Likely continuation: ' + esc(fmtLine(e.afterFen, e.refutation)) : ''}</div>`;
    else if(w.engineState === 'running') body += `<div class="engine"><span class="lbl">Stockfish is checking the move…</span></div>`;
    body += `<div id="insight" class="insight"></div><div id="coach" class="coach"></div>`;
    acts = [['Try again', retry, 'primary'], [w.phase === 'engine' ? 'Show the best move' : 'Show the main move', showBest]];
    if(w.phase === 'stats' && w.rareButSound) acts.push(['Continue with my move', keepMine]);
  } else if(status === 'done'){
    cls += ' done'; title = 'Line complete';
    body = phase === 'book' ? (lastNamed ? `You reached the end of the known theory in <em>${esc(lastNamed[1])}</em>.` : 'You reached the end of the known theory.')
      : `You played through move ${Math.min(moveNo(), S.maxMove)}${phaseEndName ? `, starting from <em>${esc(phaseEndName[1])}</em>` : ''}.`;
    const due = dueCards().length;
    acts = due ? [[`Review ${due} due position${due > 1 ? 's' : ''}`, startReview, 'primary'], ['Play a new line', startLine]] : [['Play another line', startLine, 'primary']];
    // inside today's plan: offer the step's own next action first
    const ds = Daily.active && Daily.step(Daily.active);
    if(ds && ds.done >= ds.target) acts = [['Next step of today\'s plan', () => openToday(), 'primary'], ...acts.map(a => [a[0], a[1]])];
    else if(Daily.active === 'weak' && Daily.weakQueue.length) acts = [['Next mistake to fix', nextWeak, 'primary'], ...acts.map(a => [a[0], a[1]])];
    if(Coach.available()) acts.push(['Explain the last move', explainLast]);
  } else if(status === 'checking' || status === 'loading'){
    title = status === 'checking' ? 'Checking your move…' : 'Looking up what players choose here…';
    body = phaseNote(); acts = [['Restart line', startLine]];
  } else if(status === 'opp'){
    title = 'Opponent is thinking…'; body = [feedbackLine(), phaseNote()].filter(Boolean).join('<br>');
    acts = [['Restart line', startLine]];
  } else if(status === 'browse'){
    title = 'Going through the game';
    body = `It is the opponent's move here. Step back once more to play a different move yourself, or go forward with ▶.`;
    acts = [['Back to the current position', navLast, 'primary'], ['Restart line', startLine]];
  } else {
    title = reviewing ? 'Find the move you missed before' : redo.length ? `Your move, replaying from move ${moveNo()}` : 'Your move';
    body = redo.length ? `Play a move to continue from here. It is judged as usual, and the later moves are replaced. Use ▶ to step forward instead.<br>${phaseNote()}`
      : [feedbackLine(), phaseNote()].filter(Boolean).join('<br>') || (game.history().length ? '' : 'Play the first move of your opening.');
    acts = [['Hint', toggleHint]];
    if(Coach.available()) acts.push(['Explain the last move', explainLast, '', !game.history().length]);
    acts.push(['Restart line', startLine]);
  }
  st.className = cls;
  st.innerHTML = `${tag}<div class="st-title">${title}</div>${body ? `<div class="st-body">${body}</div>` : ''}`;
  if(status === 'wrong' && wrongInfo){ renderInsight(wrongInfo); renderCoach(wrongInfo); }
  else if(explainInfo){ st.insertAdjacentHTML('beforeend', '<div id="insight" class="insight"></div><div id="coach" class="coach"></div>'); renderInsight(explainInfo); renderCoach(explainInfo); }
  ac.innerHTML = '';
  acts.forEach(([label, fn, kind, dis]) => { const b = document.createElement('button'); b.className = 'btn' + (kind ? ' ' + kind : ''); b.textContent = label; b.onclick = fn; if(dis) b.disabled = true; ac.appendChild(b); });
  const pc = progressCounts();
  $('sGood').textContent = stats.good; $('sBad').textContent = stats.bad; $('sDue').textContent = pc.due; $('sKnown').textContent = pc.known;
  syncStats();
}
function feedbackLine(){
  const f = lastFeedback; if(!f) return '';
  const ok = s => `<span style="color:var(--good);font-weight:600">${s}</span>`;
  if(f.kind === 'book') return ok(`${esc(f.san)} is book.`) + ' Keep going.';
  if(f.kind === 'stats') return ok(`${esc(f.san)} is a main move.`) + ` Played in ${pct(f.share)} of games, you score ${pct(f.score)}.`;
  if(f.kind === 'engine') return ok(`${esc(f.san)} is a good move`) + ` (Stockfish ${fmtEval(f.ev)}).`;
  if(f.kind === 'unchecked') return `${esc(f.san)} could not be checked, so the game simply continues.`;
  if(f.kind === 'shown') return `The main move was <b>${esc(f.san)}</b>. This position will come back for review.`;
  if(f.kind === 'kept') return `You kept ${esc(f.san)}. It is sound, but the main move will be asked again later.`;
  return '';
}
function renderNav(){
  const h = game ? game.history().length : 0;
  $('navBack').disabled = $('navFirst').disabled = !h;
  $('navFwd').disabled = $('navLast').disabled = !redo.length;
}
function renderAll(){ renderBoard(); renderMoves(); renderName(); renderStatus(); renderNav(); }

/* ================= navigation ================= */
let trainAlive = false;  // a training game is in progress (the Train tab returns to it)
function setTrainAlive(v){ trainAlive = v; }
function setExplainInfo(v){ explainInfo = v; }
function newSession(){ sessionId++; }
function enterTraining(){ trainAlive = true; $('progress').hidden = true; $('coords').hidden = true; $('today').hidden = true; $('review').hidden = true; $('toToday').hidden = false; renderDayBar(); $('setup').hidden = true; $('train').hidden = false; $('toSetup').hidden = false; window.scrollTo(0,0); Engine.init(); if(S.coachMode === 'browser' && S.webWhen === 'start' && Web.supported()) Web.load().then(renderEngineNote, renderEngineNote); renderEngineNote(); }

/* ================= input: click and drag ================= */
let drag = null;
const sqAt = (x, y) => { const el = document.elementFromPoint(x, y); const s = el && el.closest && el.closest('.sq'); return s ? s.dataset.sq : null; };

/* --- training stats only once there is something to show --- */
function syncStats(){ const st = document.querySelector('#train .stats'); if(st) st.hidden = ['sGood', 'sBad', 'sDue', 'sKnown'].every(id => $(id).textContent === '0'); }

export { BRUSH, enterTraining, explainInfo, files, game, lastNamed, newSession, phase, renderAll, renderStatus, reviewing, setExplainInfo, setTrainAlive, startLine, startReview, startReviewKey, syncStats, trainAlive, wrongInfo };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  $('navBack').onclick = navBack;
  $('navFwd').onclick = navForward;
  $('navFirst').onclick = () => { if(game && !$('train').hidden) navFirst(); };
  $('navLast').onclick = () => { if(game && !$('train').hidden) navLast(); };
  document.addEventListener('keydown', e => {
    if($('train').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if(/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || ''))) return;
    if(e.key === 'ArrowLeft'){ e.preventDefault(); navBack(); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); navForward(); }
    else if(e.key === 'Home'){ e.preventDefault(); navFirst(); }
    else if(e.key === 'End'){ e.preventDefault(); navLast(); }
  });
  $('boardWrap').addEventListener('contextmenu', e => e.preventDefault());
  $('start').onclick = () => { enterTraining(); startLine(); };
  $('reviewSetup').onclick = () => { enterTraining(); startReview(); };
  $('boardWrap').addEventListener('pointerdown', ev => {
    if(ev.button === 2){
      const sq = sqAt(ev.clientX, ev.clientY); if(!sq || !game) return;
      ev.preventDefault(); drawingsPly = game.history().length;
      rdrag = {from: sq, to: sq, color: brushOf(ev)};
      $('boardWrap').setPointerCapture(ev.pointerId); renderArrows(); return;
    }
    if(ev.button === 0 && drawings.length){ drawings = []; renderArrows(); }  // a normal click clears your drawings
    if(status !== 'user') return;
    const sq = sqAt(ev.clientX, ev.clientY); if(!sq) return;
    const p = game.get(sq);
    if(selectedSq && sq !== selectedSq && !(p && p.color === game.turn())){
      if(tryUserMove(selectedSq, sq)) return;
      selectedSq = null; renderBoard(); return;
    }
    if(p && p.color === game.turn()){
      ev.preventDefault();
      const wasSel = selectedSq === sq; selectedSq = sq; renderBoard();
      const size = $('boardWrap').getBoundingClientRect().width / 8;
      const g = document.createElement('img'); g.className = 'ghost'; g.src = PIECES[p.color + p.type.toUpperCase()];
      g.style.width = g.style.height = size + 'px'; g.style.left = ev.clientX + 'px'; g.style.top = ev.clientY + 'px'; g.style.display = 'none';
      document.body.appendChild(g);
      drag = {from: sq, ghost: g, moved: false, wasSel, x: ev.clientX, y: ev.clientY};
      $('boardWrap').setPointerCapture(ev.pointerId);
    }
  });
  $('boardWrap').addEventListener('pointermove', ev => {
    if(rdrag){ const sq = sqAt(ev.clientX, ev.clientY); if(sq && sq !== rdrag.to){ rdrag.to = sq; renderArrows(); } return; }
    if(!drag) return;
    if(!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 4){
      drag.moved = true; drag.ghost.style.display = 'block';
      const img = document.querySelector(`.sq[data-sq="${drag.from}"] img`); if(img) img.style.opacity = '.3';
    }
    if(drag.moved){ drag.ghost.style.left = ev.clientX + 'px'; drag.ghost.style.top = ev.clientY + 'px'; }
  });
  $('boardWrap').addEventListener('pointerup', ev => {
    if(rdrag){
      const r = rdrag; rdrag = null;
      const to = sqAt(ev.clientX, ev.clientY) || r.to;
      toggleDrawing(r.from, to === r.from ? null : to, r.color); renderArrows(); return;
    }
    if(!drag) return;
    const d = drag; drag = null; d.ghost.remove();
    if(d.moved){ const to = sqAt(ev.clientX, ev.clientY); if(to && to !== d.from && tryUserMove(d.from, to)) return; renderBoard(); }
    else if(d.wasSel){ selectedSq = null; renderBoard(); }
  });
  $('boardWrap').addEventListener('pointercancel', () => { rdrag = null; if(drag){ drag.ghost.remove(); drag = null; renderBoard(); } else renderArrows(); });
}
export { init };
