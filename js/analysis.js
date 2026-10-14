// Plain-language facts about a move, computed from the position and Stockfish lines (no AI).
import { fmtLine } from './engine.js';

/* ================= deterministic analysis ================= */
// Plain-language facts computed from the position and Stockfish's lines. No AI: these sentences are always correct.
const VAL = {p: 1, n: 3, b: 3, r: 5, q: 9, k: 0};
const NAME = {p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'};
const SIDE = c => c === 'w' ? 'White' : 'Black';
const FILES = 'abcdefgh';
function boardPieces(g){ const out = []; for(const f of FILES) for(let r = 1; r <= 8; r++){ const sq = f + r, p = g.get(sq); if(p) out.push({sq, ...p}); } return out; }
const materialOf = g => boardPieces(g).reduce((s, p) => s + (p.color === 'w' ? 1 : -1) * VAL[p.type], 0);
// pieces of colour `by` that can capture on `sq` (a stand-in enemy piece is put there when needed)
function attackersOf(g, sq, by){
  const f = g.fen().split(' '); f[1] = by; f[3] = '-';
  let t; try{ t = new Chess(f.join(' ')); }catch(e){ return []; }
  const here = t.get(sq);
  if(!here || here.color === by){ t.remove(sq); t.put({type: 'n', color: by === 'w' ? 'b' : 'w'}, sq); }
  try{ return t.moves({verbose: true}).filter(m => m.to === sq && m.captured).map(m => ({type: m.piece, from: m.from})); }catch(e){ return []; }
}
// pieces of `color` that are loose: attacked and undefended, or attacked by something cheaper
function loosePieces(g, color){
  const opp = color === 'w' ? 'b' : 'w', out = [];
  for(const p of boardPieces(g)){
    if(p.color !== color || p.type === 'k') continue;
    const att = attackersOf(g, p.sq, opp); if(!att.length) continue;
    const cheapest = att.reduce((a, b) => VAL[b.type] < VAL[a.type] ? b : a);
    const def = attackersOf(g, p.sq, color);
    if(!def.length) out.push({...p, by: cheapest, why: 'undefended'});
    else if(VAL[cheapest.type] < VAL[p.type]) out.push({...p, by: cheapest, why: 'cheaper'});
  }
  return out;
}
// pawn structure
function pawnFiles(g, color){ const m = {}; for(const p of boardPieces(g)) if(p.type === 'p' && p.color === color) (m[p.sq[0]] = m[p.sq[0]] || []).push(+p.sq[1]); return m; }
function isolated(g, color){ const pf = pawnFiles(g, color); return Object.keys(pf).filter(f => { const i = FILES.indexOf(f); return !pf[FILES[i - 1]] && !pf[FILES[i + 1]]; }); }
function doubled(g, color){ const pf = pawnFiles(g, color); return Object.keys(pf).filter(f => pf[f].length > 1); }
function passed(g, color){
  const mine = pawnFiles(g, color), theirs = pawnFiles(g, color === 'w' ? 'b' : 'w'), out = [];
  for(const [f, ranks] of Object.entries(mine)) for(const r of ranks){
    const i = FILES.indexOf(f), ahead = rr => color === 'w' ? rr > r : rr < r;
    const blocked = [FILES[i - 1], f, FILES[i + 1]].some(ff => ff && (theirs[ff] || []).some(ahead));
    if(!blocked) out.push(f + r);
  }
  return out;
}
const amount = n => n >= 9 ? 'about a queen\'s worth of material' : n >= 5 ? (n === 5 ? 'a rook' : `${n} points of material (about a rook or more)`) : n === 4 ? 'a piece and a pawn' : n === 3 ? 'a piece' : n === 2 ? 'two pawns or the exchange' : 'a pawn';
// "two pawns", "a knight and a pawn"
const NUMW = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
function pieceList(types){
  const c = {}; types.forEach(t => c[t] = (c[t] || 0) + 1);
  const parts = Object.entries(c).sort((a, b) => VAL[b[0]] - VAL[a[0]]).map(([t, n]) => n === 1 ? `a ${NAME[t]}` : `${NUMW[n] || n} ${NAME[t]}s`);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
}
// what one side gained and lost over a list of moves (played move included)
function tradeWords(moves, side){
  const won = moves.filter(m => m.color === side && m.captured).map(m => m.captured);
  const lost = moves.filter(m => m.color !== side && m.captured).map(m => m.captured);
  const net = won.reduce((a, t) => a + VAL[t], 0) - lost.reduce((a, t) => a + VAL[t], 0);
  if(!net) return {net, text: ''};
  if(!won.length) return {net, text: `has lost ${pieceList(lost)}`};
  if(!lost.length) return {net, text: `wins ${pieceList(won)}`};
  return {net, text: net > 0 ? `wins ${pieceList(won)} for ${pieceList(lost)}` : `gives ${pieceList(lost)} for ${pieceList(won)}`};
}
// how good a position is, in words, from White's point of view (centipawns)
function evalWords(cp){
  if(Math.abs(cp) >= 9000) return cp > 0 ? 'a forced mate for White' : 'a forced mate for Black';
  const a = Math.abs(cp), side = cp > 0 ? 'White' : 'Black';
  return a < 35 ? 'a roughly equal position' : a < 100 ? `a slight edge for ${side}` : a < 200 ? `a clear advantage for ${side}` : `a winning position for ${side}`;
}
// play a line and report material won and the moves' notable features
function runLine(fen, sans, plies){
  // play the legal part of the line
  const t = new Chess(fen), all = [];
  for(const s of sans.slice(0, plies)){ const m = t.move(s); if(!m) break; all.push(m); }
  // stop at a quiet point: never right after a capture whose recapture we cannot see, nor just before a recapture
  let k = all.length;
  while(k > 0 && ((k === all.length && all[k - 1].captured) || (k < all.length && all[k].captured))) k--;
  const g = new Chess(fen), start = materialOf(g), moves = all.slice(0, k);
  moves.forEach(m => g.move(m.san));
  return {g, moves, gain: materialOf(g) - start};
}
function describeReply(m, g){
  let t = `${SIDE(m.color)}'s best reply is ${m.san}`;
  if(m.captured) t += `, taking the ${NAME[m.captured]} on ${m.to}`;
  if(g.in_checkmate()) t += ', which is checkmate';
  else if(g.in_check()) t += m.captured ? ' with check' : ', a check';
  return t + '.';
}
/* Facts about a move compared with the better one.
   played/best: SAN; playedLine/bestLine: Stockfish's moves after each; evPlayed/evBest: White's point of view. */
function analyseMistake({before, played, playedLine = [], best = null, bestLine = [], evPlayed = null, evBest = null}){
  const out = [], g0 = new Chess(before), mover = g0.turn(), opp = mover === 'w' ? 'b' : 'w', sgn = mover === 'w' ? 1 : -1;
  const gA = new Chess(before), mv = gA.move(played); if(!mv) return out;
  // 1. what the evaluation says
  if(evPlayed != null && evBest != null && best && best !== played){
    const loss = (evBest - evPlayed) * sgn;
    if(loss >= 45) out.push(`Stockfish rates ${best} as ${evalWords(evBest)} and ${played} as ${evalWords(evPlayed)}.`);
    else out.push(`${played} and ${best} are rated almost the same by Stockfish (${evalWords(evPlayed)}).`);
  }
  // 2. the opponent's best answer
  if(playedLine.length){
    const g = new Chess(gA.fen()), r = g.move(playedLine[0]);
    if(r) out.push(describeReply(r, g));
  }
  // 3. material along the engine line after the played move
  if(playedLine.length >= 2){
    const L = runLine(gA.fen(), playedLine, 6), net = (L.gain + (materialOf(gA) - materialOf(g0))) * sgn;
    const line = fmtLine(gA.fen(), playedLine.slice(0, L.moves.length)), tw = tradeWords([mv, ...L.moves], mover);
    if(net <= -1) out.push(`After ${played} ${line}, ${SIDE(mover)} ${tw.text || 'has lost ' + amount(-net)}.`);
    else if(net >= 1) out.push(`${SIDE(mover)} ${tw.text || 'wins ' + amount(net)} after ${played} ${line}, but Stockfish still prefers the other move.`);
    else if(evPlayed != null && evBest != null && (evBest - evPlayed) * sgn >= 45) out.push(`Material stays level after ${played} ${line}: the difference is about position and activity, not material.`);
  }
  // 4. material along the better line
  if(best && best !== played && bestLine.length){
    const gB = new Chess(before), bm = gB.move(best);
    if(bm){
      const L = runLine(gB.fen(), bestLine, 6), net = (L.gain + (materialOf(gB) - materialOf(g0))) * sgn;
      const line = fmtLine(gB.fen(), bestLine.slice(0, L.moves.length)), tw = tradeWords([bm, ...L.moves], mover);
      if(net >= 1) out.push(`With ${best} instead, ${SIDE(mover)} ${tw.text || 'wins ' + amount(net)}: ${fmtLine(before, [best])} ${line}.`);
      else if(net <= -1) out.push(`${best} ${tw.text ? tw.text.replace(/^has lost/, 'gives up').replace(/^gives/, 'gives') : 'gives up ' + amount(-net)} for the initiative: ${fmtLine(before, [best])} ${line}.`);
    }
  }
  // 5. pieces left loose by the move
  const wasLoose = new Set(loosePieces(g0, mover).map(p => p.sq));
  const nowLoose = loosePieces(gA, mover).filter(p => !wasLoose.has(p.sq) || p.sq === mv.to).sort((a, b) => VAL[b.type] - VAL[a.type]).slice(0, 2);
  for(const p of nowLoose) out.push(`After ${played}, ${SIDE(mover)}'s ${NAME[p.type]} on ${p.sq} is attacked by the ${NAME[p.by.type]} on ${p.by.from} and ${p.why === 'undefended' ? 'not defended' : 'worth more than its attacker'}.`);
  // 6. pawn structure created by the move
  const newIso = isolated(gA, mover).filter(f => !isolated(g0, mover).includes(f));
  const newDbl = doubled(gA, mover).filter(f => !doubled(g0, mover).includes(f));
  const newPassOpp = passed(gA, opp).filter(s => !passed(g0, opp).includes(s));
  if(newIso.length) out.push(`${played} leaves ${SIDE(mover)} an isolated pawn on the ${newIso.join(' and ')}-file.`);
  if(newDbl.length) out.push(`${played} gives ${SIDE(mover)} doubled pawns on the ${newDbl.join(' and ')}-file.`);
  if(newPassOpp.length) out.push(`${played} gives ${SIDE(opp)} a passed pawn on ${newPassOpp.join(' and ')}.`);
  return out;
}
// every position along the lines, used to check what the coach writes
function lineFens(fen, sans){ const g = new Chess(fen), out = [g.fen()]; for(const s of sans){ if(!g.move(s)) break; out.push(g.fen()); } return out; }

export { analyseMistake, evalWords, lineFens };
