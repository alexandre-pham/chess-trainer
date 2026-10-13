// Game review: analysis of your Lichess games and playable lines.
import { $, esc, posKey, sleep, store } from './util.js';
import { LINES, PIECES, POS } from './data.js';
import { S, bookMoves, selFamilies } from './book.js';
import { cards, saveCards } from './srs.js';
import { Coach, GROUND, LANG, cancelCoach, historyText, moveFacts, newCoachCtl, pieceLists, renderCoach } from './coach.js';
import { BRUSH, enterTraining, files, startReviewKey } from './trainer.js';
import { Engine, fmtLine, pvToSan, uciMove, waitEngine } from './engine.js';
import { openToday } from './daily.js';

/* ================= game review ================= */
// Replays one of your Lichess games: book moves, Stockfish evaluation of every move, your mistakes with the better move,
// the coach to explain them, and positions to practise.
const R = {gm: null, sans: [], fens: [], moves: [], evals: [], best: [], pvs: [], judg: [], ply: 0, my: 'w', bookEnd: 0, token: 0, source: '', info: null};
const wc = cp => 2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1;  // winning chances, as Lichess computes them
const JUDG = {Inaccuracy: '?!', Mistake: '?', Blunder: '??'};
function evalText(cp){ if(cp == null) return '…'; if(Math.abs(cp) >= 9000) return cp > 0 ? 'White mates' : 'Black mates'; return (cp >= 0 ? '+' : '−') + (Math.abs(cp) / 100).toFixed(1); }
function judgeMove(j){
  // move j goes from fens[j-1] to fens[j]
  if(R.source === 'lichess') return;
  const a = R.evals[j - 1], b = R.evals[j];
  if(a == null || b == null) return;
  const uci = R.moves[j - 1].from + R.moves[j - 1].to + (R.moves[j - 1].promotion || '');
  if(R.best[j - 1] === uci){ R.judg[j] = null; return; }
  const white = j % 2 === 1, loss = (wc(a) - wc(b)) * (white ? 1 : -1);
  R.judg[j] = loss >= .3 ? 'Blunder' : loss >= .2 ? 'Mistake' : loss >= .1 ? 'Inaccuracy' : null;
}
function openReview(gm){
  R.token++; const tok = R.token;
  cancelCoach();
  ['setup', 'train', 'progress', 'coords', 'today'].forEach(id => $(id).hidden = true);
  $('review').hidden = false; $('toToday').hidden = false; $('toCoords').hidden = false; $('toProgress').hidden = false; $('toSetup').hidden = true;
  rStopAuto(); R.gm = gm; R.info = null; R.var = null; R.sel = null; R.vEval = new Map();
  R.sans = (gm.moves || '').split(' ').filter(Boolean);
  const me = (S.user || '').toLowerCase();
  R.my = ((gm.players.white.user || {}).name || '').toLowerCase() === me ? 'w' : 'b';
  const g = new Chess(); R.fens = [g.fen()]; R.moves = [];
  for(const s of R.sans){ const m = g.move(s); if(!m) break; R.moves.push(m); R.fens.push(g.fen()); }
  const N = R.moves.length;
  R.evals = new Array(N + 1).fill(null); R.best = new Array(N + 1).fill(null); R.pvs = new Array(N + 1).fill(null); R.judg = new Array(N + 1).fill(null);
  // how far the game followed the opening book (any opening)
  R.bookEnd = 0; for(let i = 0; i < N; i++){ const bm = bookMoves(R.fens[i]); if(bm[R.moves[i].san]) R.bookEnd = i + 1; else break; }
  R.ply = Math.min(N, R.bookEnd + 1);
  // analysis already done on Lichess? use it, otherwise run Stockfish here
  if(Array.isArray(gm.analysis) && gm.analysis.length){
    R.source = 'lichess'; R.evals[0] = 20;
    gm.analysis.forEach((a, k) => {
      if(k + 1 > N) return;
      R.evals[k + 1] = a.mate != null ? (a.mate > 0 ? 10000 - a.mate : -10000 - a.mate) : a.eval;
      if(a.judgment) R.judg[k + 1] = a.judgment.name;
      if(a.best) R.best[k] = a.best;
      if(a.variation) R.pvs[k] = a.variation.split(' ').slice(0, 6);
    });
    for(let j = 1; j <= R.bookEnd; j++) R.judg[j] = null;  // book moves are not judged
  } else { R.source = 'local'; analyseGame(tok); }
  const opp = R.my === 'w' ? gm.players.black : gm.players.white;
  const oppName = (opp.user && opp.user.name) || (opp.aiLevel ? 'Stockfish level ' + opp.aiLevel : 'Anonymous');
  const result = gm.winner ? (gm.winner === (R.my === 'w' ? 'white' : 'black') ? 'You won' : 'You lost') : (gm.status === 'draw' || gm.status === 'stalemate' ? 'Draw' : '');
  $('rEco').textContent = gm.opening ? (gm.opening.eco || '') : '';
  $('rTitle').textContent = gm.opening ? gm.opening.name : 'Your game';
  $('rSub').innerHTML = `vs ${esc(oppName)}, ${esc(gm.speed || '')}, ${new Date(gm.createdAt).toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}${result ? '. ' + result : ''}. <a href="https://lichess.org/${encodeURIComponent(gm.id)}" target="_blank" rel="noopener">Open on Lichess</a>`;
  rRenderAll(); window.scrollTo(0, 0);
}
async function analyseGame(tok){
  Engine.init(); await sleep(50); await waitEngine();
  if(!Engine.available()){ $('rProgress').textContent = 'Stockfish is not available, so the game cannot be analysed here.'; return; }
  const N = R.moves.length;
  for(let i = 0; i <= N; i++){
    if(tok !== R.token) return;
    const r = await Engine.analyse(R.fens[i], 11);
    if(tok !== R.token) return;
    if(r){
      const toMove = R.fens[i].split(' ')[1];
      R.evals[i] = toMove === 'w' ? r.cp : -r.cp;
      R.best[i] = r.pv[0]; R.pvs[i] = pvToSan(R.fens[i], r.pv, 6);
    } else if(new Chess(R.fens[i]).in_checkmate()) R.evals[i] = R.fens[i].split(' ')[1] === 'w' ? -10000 : 10000;
    if(i > R.bookEnd) judgeMove(i);
    $('rProgress').textContent = i < N ? `Analysing move ${Math.floor(i / 2) + 1} of ${Math.ceil(N / 2)}…` : '';
    if(i % 2 === 1 || i === N){ rRenderMoves(); rRenderGraph(); rRenderSummary(); if(R.ply === i || R.ply === i + 1) rRenderNote(); }
  }
}
function rSquares(){ const s = []; for(let r=0;r<8;r++) for(let f=0;f<8;f++){ const rank = R.my === 'w' ? 8 - r : r + 1, file = R.my === 'w' ? f : 7 - f; s.push(files[file] + rank); } return s; }
function rRenderBoard(){
  if(R.var) return rVarBoard();
  const g = new Chess(R.fens[R.ply]), m = R.moves[R.ply - 1], j = R.judg[R.ply];
  $('rBoard').innerHTML = rSquares().map((sq, idx) => {
    const fi = files.indexOf(sq[0]), light = (fi + +sq[1]) % 2 === 0, p = g.get(sq), cls = ['sq', light ? 'l' : 'd'];
    if(m && (m.from === sq || m.to === sq)) cls.push(j === 'Blunder' || j === 'Mistake' ? 'wrong' : 'last');
    if(R.sel === sq) cls.push('sel');
    let inner = p ? `<img src="${PIECES[p.color + p.type.toUpperCase()]}" alt="">` : '';
    if(R.sel && g.moves({square: R.sel, verbose: true}).some(x => x.to === sq)) inner += p ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if(idx % 8 === 0) inner += `<span class="coord r">${sq[1]}</span>`;
    if(idx >= 56) inner += `<span class="coord f">${sq[0]}</span>`;
    return `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
  }).join('');
  // green arrow: the better move in the previous position, shown on a judged move
  const cen = sq => { let f = files.indexOf(sq[0]), r = 8 - +sq[1]; if(R.my === 'b'){ f = 7 - f; r = 7 - r; } return [f * 100 + 50, r * 100 + 50]; };
  let svg = `<defs><marker id="rah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${BRUSH.best}"/></marker></defs>`;
  const b = j && R.best[R.ply - 1];
  if(b){ const [x1,y1] = cen(b.slice(0,2)), [x2,y2] = cen(b.slice(2,4)), dx = x2-x1, dy = y2-y1, len = Math.hypot(dx,dy);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2 - dx/len*30}" y2="${y2 - dy/len*30}" stroke="${BRUSH.best}" stroke-opacity=".85" stroke-width="16" stroke-linecap="round" marker-end="url(#rah)"/>`; }
  $('rArrows').innerHTML = svg;
}
function rRenderMoves(){
  let s = '';
  R.moves.forEach((m, i) => {
    const j = i + 1, jd = R.judg[j];
    if(i % 2 === 0) s += `<span class="n">${i/2 + 1}.</span> `;
    const cls = ['m', 'r-mv']; if(j === R.ply) cls.push('cur'); if(j <= R.bookEnd) cls.push('book'); if(jd) cls.push('j-' + jd.toLowerCase());
    if((j % 2 === 1) === (R.my === 'w')) cls.push('u');
    s += `<span class="${cls.join(' ')}" data-ply="${j}">${esc(m.san)}${jd ? JUDG[jd] : ''}</span> `;
  });
  $('rMoves').innerHTML = s;
  $('rMoves').querySelectorAll('[data-ply]').forEach(el => el.onclick = () => rGo(+el.dataset.ply));
  const cur = $('rMoves').querySelector('.cur'); if(cur) cur.scrollIntoView({block: 'nearest'});
}
function rRenderGraph(){
  const N = R.moves.length; if(!N){ $('rGraph').innerHTML = ''; return; }
  const W = 560, H = 90, x = i => i / N * W, y = cp => H / 2 - wc(cp) * (H / 2 - 4);
  const pts = []; R.evals.forEach((e, i) => { if(e != null) pts.push([x(i), y(e)]); });
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evaluation through the game"><rect width="${W}" height="${H}" fill="var(--sq-dark)" fill-opacity=".35"/>`;
  if(pts.length > 1) svg += `<path d="M0,${H} L${pts.map(p => p.join(',')).join(' L')} L${pts[pts.length-1][0]},${H} Z" fill="var(--surface)" fill-opacity=".95"/><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>`;
  svg += `<line x1="0" x2="${W}" y1="${H/2}" y2="${H/2}" stroke="var(--muted)" stroke-opacity=".5" stroke-dasharray="3 3"/>`;
  R.judg.forEach((jd, j) => { if(jd && R.evals[j] != null) svg += `<circle cx="${x(j)}" cy="${y(R.evals[j])}" r="3.5" fill="${jd === 'Blunder' ? 'var(--bad)' : jd === 'Mistake' ? '#D9822B' : 'var(--warn)'}"/>`; });
  svg += `<line x1="${x(R.ply)}" x2="${x(R.ply)}" y1="0" y2="${H}" stroke="var(--ink)" stroke-width="1.5"/></svg>`;
  $('rGraph').innerHTML = svg;
  $('rGraph').querySelector('svg').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); rGo(Math.round((e.clientX - r.left) / r.width * N)); };
}
function rRenderSummary(){
  const count = (side) => { const c = {Inaccuracy: 0, Mistake: 0, Blunder: 0}; R.judg.forEach((jd, j) => { if(jd && ((j % 2 === 1) === (side === 'w'))) c[jd]++; }); return c; };
  const me = count(R.my), op = count(R.my === 'w' ? 'b' : 'w');
  const line = c => `${c.Inaccuracy} inaccurac${c.Inaccuracy === 1 ? 'y' : 'ies'}, ${c.Mistake} mistake${c.Mistake === 1 ? '' : 's'}, ${c.Blunder} blunder${c.Blunder === 1 ? '' : 's'}`;
  const bookTxt = R.bookEnd ? `The game followed known opening theory until move ${Math.ceil(R.bookEnd / 2)} (${R.bookEnd % 2 ? 'White' : 'Black'}'s ${R.moves[R.bookEnd - 1].san}).` : 'The game left known opening theory on the first move.';
  $('rSum').innerHTML = `<div><b>You:</b> ${line(me)}</div><div><b>Opponent:</b> ${line(op)}</div><div style="margin-top:6px">${bookTxt}</div><div class="help" style="color:var(--muted);margin-top:6px">${R.source === 'lichess' ? 'Using the computer analysis from Lichess.' : 'Analysed here by Stockfish.'} <span id="rProgress"></span></div>`;
}
function rRenderNote(){
  if(R.var) return rVarNote();
  const j = R.ply, el = $('rNote'), acts = [];
  if(j === 0){ el.className = 'status'; el.innerHTML = '<div class="st-title">Starting position</div><div class="st-body">Use ▶ or the → key to go through the game, or click a move.</div>'; $('rActions').innerHTML = ''; return; }
  const m = R.moves[j - 1], mover = j % 2 === 1 ? 'w' : 'b', mine = mover === R.my, jd = R.judg[j];
  const num = `${Math.ceil(j / 2)}${mover === 'w' ? '.' : '…'} ${m.san}`;
  const p = POS[posKey(R.fens[j])];
  let title, body = '', cls = 'status';
  if(j <= R.bookEnd){ title = `${num}: book move`; body = p && p[1] ? esc(LINES[p[0]][1]) + '.' : 'Known opening theory.'; cls += ' good'; }
  else if(jd){
    title = `${num}${JUDG[jd]} ${mine ? 'Your' : 'Your opponent\'s'} ${jd.toLowerCase()}`; cls += jd === 'Inaccuracy' ? ' warn' : ' bad';
    const b = R.best[j - 1]; let bestSan = '';
    if(b){ const g = new Chess(R.fens[j - 1]); const bm = uciMove(g, b); if(bm) bestSan = bm.san; }
    body = bestSan ? `Better was <b>${esc(bestSan)}</b> (green arrow).` : '';
    if(R.pvs[j - 1] && R.pvs[j - 1].length) body += ` Best line: ${esc(fmtLine(R.fens[j - 1], R.pvs[j - 1].slice(0, 5)))}.`;
    if(R.pvs[j] && R.pvs[j].length) body += ` After ${esc(m.san)}: ${esc(fmtLine(R.fens[j], R.pvs[j].slice(0, 4)))}.`;
    if(R.pvs[j - 1] && R.pvs[j - 1].length) acts.push(['Play the best line', () => rStartVar(j - 1, R.pvs[j - 1], `Best line instead of ${num}`)]);
    if(R.pvs[j] && R.pvs[j].length) acts.push([`Play what follows ${m.san}`, () => rStartVar(j, R.pvs[j], `After ${num}`)]);
    if(Coach.available()) acts.push(['Explain with the coach', () => rExplain(j, bestSan)]);
    if(mine) acts.push(['Practise this position', () => rPractise(j)]);
  } else { title = num; if(j === R.bookEnd + 1 && R.bookEnd) body = mine ? 'You left the opening book here.' : 'Your opponent left the opening book here.'; }
  body += ` <span class="r-eval">Evaluation: ${evalText(R.evals[j])}</span>`;
  el.className = cls; el.innerHTML = `<div class="st-title">${title}</div><div class="st-body">${body}</div><div id="rCoach" class="coach" style="display:none"></div>`;
  if(R.info && R.info.ply === j) renderCoach(R.info, $('rCoach'));
  $('rActions').innerHTML = '';
  acts.forEach(([l, fn]) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = l; b.onclick = fn; $('rActions').appendChild(b); });
}
function rRenderAll(){ rRenderBoard(); rRenderMoves(); rRenderGraph(); rRenderSummary(); rRenderNote(); }
function rGo(ply){ rStopAuto(); R.var = null; R.sel = null; R.ply = Math.max(0, Math.min(R.moves.length, ply)); rRenderBoard(); rRenderMoves(); rRenderGraph(); rRenderNote(); }
/* ---- playing a line on the review board: engine lines, or your own moves ---- */
// R.var: {startPly, base, sans, i, label}; the board shows the position after the first i moves of the line
function rStopAuto(){ if(R.auto){ clearInterval(R.auto); R.auto = null; } }
function rStartVar(startPly, sans, label){
  rStopAuto(); cancelCoach();
  R.var = {startPly, base: R.fens[startPly], sans: [...sans], i: 0, label}; R.sel = null;
  rVarRender();
  // play the line by itself, one move a second; any click or key stops it
  if(sans.length) R.auto = setInterval(() => { if(!R.var || R.var.i >= R.var.sans.length){ rStopAuto(); rVarRender(); return; } R.var.i++; rVarRender(); }, 1000);
}
function rVarState(){
  const g = new Chess(R.var.base), fens = [g.fen()], moves = [];
  for(const s of R.var.sans){ const m = g.move(s); if(!m) break; fens.push(g.fen()); moves.push(m); }
  return {fens, moves};
}
function rVarStep(d){ rStopAuto(); R.var.i = Math.max(0, Math.min(R.var.sans.length, R.var.i + d)); R.sel = null; rVarRender(); }
function rExitVar(){ rStopAuto(); R.var = null; R.sel = null; rRenderBoard(); rRenderMoves(); rRenderGraph(); rRenderNote(); }
function rVarRender(){ rRenderBoard(); rRenderNote(); }
// Stockfish's view of a position in the line (cached)
function rEvalOf(fen){
  R.vEval = R.vEval || new Map();
  if(!R.vEval.has(fen)) R.vEval.set(fen, (async () => {
    await waitEngine(); if(!Engine.available()) return null;
    const r = await Engine.analyse(fen, 12); if(!r) return null;
    const wEv = fen.split(' ')[1] === 'w' ? r.cp : -r.cp;
    return {wEv, best: r.pv[0], line: pvToSan(fen, r.pv, 6)};
  })());
  return R.vEval.get(fen);
}
async function rVarEngineMove(){
  rStopAuto();
  const st = rVarState(), fen = st.fens[R.var.i], e = await rEvalOf(fen);
  if(!R.var || !e || !e.best) return;
  const san = uciMove(new Chess(fen), e.best).san;
  R.var.sans = R.var.sans.slice(0, R.var.i).concat(san); R.var.i++;
  rVarRender();
}
function rVarBoard(){
  const st = rVarState(), fen = st.fens[R.var.i], g = new Chess(fen), last = st.moves[R.var.i - 1], next = st.moves[R.var.i];
  const legal = R.sel ? g.moves({square: R.sel, verbose: true}) : [];
  $('rBoard').innerHTML = rSquares().map((sq, idx) => {
    const fi = files.indexOf(sq[0]), light = (fi + +sq[1]) % 2 === 0, p = g.get(sq), cls = ['sq', light ? 'l' : 'd'];
    if(last && (last.from === sq || last.to === sq)) cls.push('last');
    if(R.sel === sq) cls.push('sel');
    let inner = p ? `<img src="${PIECES[p.color + p.type.toUpperCase()]}" alt="">` : '';
    if(legal.some(m => m.to === sq)) inner += p ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if(idx % 8 === 0) inner += `<span class="coord r">${sq[1]}</span>`;
    if(idx >= 56) inner += `<span class="coord f">${sq[0]}</span>`;
    return `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
  }).join('');
  // a light arrow shows the next move of the line
  const cen = sq => { let f = files.indexOf(sq[0]), r = 8 - +sq[1]; if(R.my === 'b'){ f = 7 - f; r = 7 - r; } return [f * 100 + 50, r * 100 + 50]; };
  let svg = `<defs><marker id="rah2" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${BRUSH.best}"/></marker></defs>`;
  if(next && !R.auto){ const [x1,y1] = cen(next.from), [x2,y2] = cen(next.to), dx = x2-x1, dy = y2-y1, len = Math.hypot(dx,dy);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2 - dx/len*30}" y2="${y2 - dy/len*30}" stroke="${BRUSH.best}" stroke-opacity=".45" stroke-width="16" stroke-linecap="round" marker-end="url(#rah2)"/>`; }
  $('rArrows').innerHTML = svg;
}
function rVarNote(){
  const st = rVarState(), el = $('rNote');
  const toks = []; let n = +R.var.base.split(' ')[5], w = R.var.base.split(' ')[1] === 'w';
  st.moves.forEach((m, k) => {
    const num = w ? `${n}. ` : (k === 0 ? `${n}… ` : '');
    toks.push(`<span class="n">${num}</span><span class="m r-vm ${k + 1 === R.var.i ? 'cur' : ''} ${k + 1 > R.var.i ? 'todo' : ''}" data-k="${k + 1}">${esc(m.san)}</span>`);
    if(!w) n++; w = !w;
  });
  const fen = st.fens[R.var.i], mate = new Chess(fen);
  el.className = 'status r-var';
  el.innerHTML = `<div class="st-title">${esc(R.var.label)}</div>
    <div class="r-vline"><span class="r-vm ${R.var.i === 0 ? 'cur' : ''}" data-k="0">Start</span> ${toks.join(' ') || '<span class="help" style="color:var(--muted)">Move a piece to start your line.</span>'}</div>
    <div class="st-body" id="rVarEval">${mate.in_checkmate() ? '<b>Checkmate.</b>' : mate.in_draw() ? '<b>Draw.</b>' : '<span class="r-eval">Stockfish is looking at this position…</span>'}</div>
    <p class="help" style="color:var(--muted);margin:8px 0 0">Move the pieces to try your own moves. ◀ ▶ or the arrow keys step through the line.</p>`;
  el.querySelectorAll('[data-k]').forEach(t => t.onclick = () => { rStopAuto(); R.var.i = +t.dataset.k; R.sel = null; rVarRender(); });
  $('rActions').innerHTML = '';
  [[R.auto ? 'Pause' : 'Stockfish plays the next move', R.auto ? () => { rStopAuto(); rVarRender(); } : rVarEngineMove],
   ['Start the line again', () => { rStopAuto(); R.var.i = 0; R.sel = null; rVarRender(); }],
   ['Back to the game', rExitVar, 'primary']].forEach(([l, fn, k]) => { const b = document.createElement('button'); b.className = 'btn' + (k ? ' ' + k : ''); b.textContent = l; b.onclick = fn; $('rActions').appendChild(b); });
  if(!mate.in_checkmate() && !mate.in_draw()){
    const v = R.var, i = v.i;
    rEvalOf(fen).then(e => {
      if(R.var !== v || v.i !== i || !$('rVarEval')) return;
      if(!e){ $('rVarEval').innerHTML = '<span class="r-eval">Stockfish is not available.</span>'; return; }
      const best = e.best ? uciMove(new Chess(fen), e.best) : null;
      $('rVarEval').innerHTML = `Evaluation: <b>${evalText(e.wEv)}</b> <span class="r-eval">(positive is better for White)</span>${best ? `. Stockfish's best continuation: <b>${esc(fmtLine(fen, e.line.slice(0, 1)))}</b> ${esc(fmtLine(fen, e.line.slice(0, 5)).replace(fmtLine(fen, e.line.slice(0, 1)), '').trim())}` : ''}.`;
    });
  }
}

async function rExplain(j, bestSan){
  const before = R.fens[j - 1], m = R.moves[j - 1], mover = j % 2 === 1 ? 'White' : 'Black', jd = R.judg[j];
  const info = {coach: '', coachState: 'thinking', thread: [], fens: [before, R.fens[j]], ply: j}; R.info = info;
  renderCoach(info, $('rCoach'));
  const prompt = `This is a real game. ${mover} ${mover === (R.my === 'w' ? 'White' : 'Black') ? '(the student)' : "(the student's opponent)"} played ${Math.ceil(j / 2)}${mover === 'White' ? '.' : '...'} ${m.san}, judged a ${jd.toLowerCase()} by Stockfish.
Moves: ${historyText(R.sans.slice(0, j))}
Position before the move (FEN): ${before}
Stockfish evaluation before: ${evalText(R.evals[j - 1])}; after ${m.san}: ${evalText(R.evals[j])} (positive is better for White).
${bestSan ? `Better was ${bestSan}. Best line: ${fmtLine(before, (R.pvs[j - 1] || []).slice(0, 6))}.` : ''}
${R.pvs[j] && R.pvs[j].length ? `Engine's best continuation after ${m.san}: ${fmtLine(R.fens[j], R.pvs[j].slice(0, 5))}.` : ''}
What ${m.san} did: ${moveFacts(before, m.san)}
${bestSan ? `What ${bestSan} would do: ${moveFacts(before, bestSan)}` : ''}
Pieces before the move:
${pieceLists(new Chess(before))}

In ${LANG[S.lang]}, explain in 3 to 5 short sentences why ${m.san} was a ${jd.toLowerCase()} and what ${bestSan || 'the better move'} achieves instead. Only state concrete variations that appear above. ${GROUND} Plain text, no markdown, no lists.`;
  info.prompt = prompt;
  const ctl = newCoachCtl();
  try{
    const r = await Coach.run(prompt, {signal: ctl.signal, onText: ({text}) => { if(R.info === info && text){ info.coach = text; info.coachState = 'streaming'; if(R.ply === j) renderCoach(info, $('rCoach')); } }});
    info.coach = r.text; info.coachState = 'done';
  }catch(e){ if(e.name === 'AbortError') return; info.coachState = 'error'; info.coachError = e.message; }
  if(R.ply === j) renderCoach(info, $('rCoach'));
}
function rPractise(j){
  const before = R.fens[j - 1], key = posKey(before), path = R.sans.slice(0, j - 1);
  let name = ''; const gg = new Chess(); for(const mv of path){ gg.move(mv); const p = POS[posKey(gg.fen())]; if(p && p[1]) name = LINES[p[0]][1]; }
  if(!cards[key]) cards[key] = {path, color: R.my, fams: [...selFamilies(), name.split(':')[0]].filter(Boolean), name, ease: 2.5, ivl: 0, reps: 0, lapses: 1, due: 0, seen: Date.now()};
  else { cards[key].due = 0; cards[key].lapses = Math.max(1, cards[key].lapses); }
  saveCards();
  if(S.color !== R.my){ S.color = R.my; store.set('color', S.color); }
  closeReview(true); enterTraining(); startReviewKey(key);
}
function closeReview(silent){
  R.token++; cancelCoach();
  $('review').hidden = true;
  if(!silent){ openToday(true, true); }
}

   

export { R, openReview };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  // moving pieces on the review board: in a line, or starting a new one from the game position
  $('rBoardWrap').addEventListener('pointerdown', ev => {
    if(ev.button !== 0) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY), s = el && el.closest && el.closest('#rBoard .sq'); if(!s) return;
    rStopAuto();
    const sq = s.dataset.sq;
    const fen = R.var ? rVarState().fens[R.var.i] : R.fens[R.ply], g = new Chess(fen), p = g.get(sq);
    if(R.sel && R.sel !== sq && !(p && p.color === g.turn())){
      const m = g.move({from: R.sel, to: sq, promotion: 'q'});
      R.sel = null;
      if(m){
        if(!R.var) R.var = {startPly: R.ply, base: R.fens[R.ply], sans: [], i: 0, label: `Your line from move ${Math.floor(R.ply / 2) + 1}`};
        if(R.var.sans[R.var.i] === m.san) R.var.i++;  // same as the line: just step forward
        else { R.var.sans = R.var.sans.slice(0, R.var.i).concat(m.san); R.var.i++; if(!/^Your line/.test(R.var.label)) R.var.label = `Your line from move ${Math.floor(R.var.startPly / 2) + 1}`; }
      }
      return R.var ? rVarRender() : rRenderBoard();
    }
    R.sel = p && p.color === g.turn() && R.sel !== sq ? sq : null;
    if(R.var) rVarBoard(); else { rRenderBoard(); }
  });
  $('rBack').onclick = () => closeReview();
  $('rFirst').onclick = () => R.var ? rVarStep(-999) : rGo(0);
  $('rPrev').onclick = () => R.var ? rVarStep(-1) : rGo(R.ply - 1);
  $('rNext').onclick = () => R.var ? rVarStep(1) : rGo(R.ply + 1);
  $('rLast').onclick = () => R.var ? rVarStep(999) : rGo(R.moves.length);
  document.addEventListener('keydown', e => {
    if($('review').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if(/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '')) return;
    const k = {ArrowLeft: -1, ArrowRight: 1}[e.key];
    if(R.var){ if(k){ e.preventDefault(); rVarStep(k); } else if(e.key === 'Home'){ e.preventDefault(); rVarStep(-999); } else if(e.key === 'End'){ e.preventDefault(); rVarStep(999); } else if(e.key === 'Escape'){ rExitVar(); } return; }
    if(k){ e.preventDefault(); rGo(R.ply + k); } else if(e.key === 'Home'){ e.preventDefault(); rGo(0); } else if(e.key === 'End'){ e.preventDefault(); rGo(R.moves.length); }
  });
}
export { init };
