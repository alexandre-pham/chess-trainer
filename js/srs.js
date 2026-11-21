// Spaced repetition: one card per position, review intervals, and the log of your answers.
import { posKey, store } from './util.js';
import { S, selFamilies } from './book.js';
import { Sync } from './sync.js';
import { phase } from './trainer.js';
import { schedule } from './logic.js';

/* ================= spaced repetition ================= */
// One card per position where you have to find the move. SM-2 style intervals.
let cards = store.get('cards', {});
// every first attempt at a position: [time, opening, color, correct 1/0, phase]
let moveLog = store.get('log', []);
function logMove(ok){
  moveLog.push([Date.now(), S.sel[0] || '', S.color, ok ? 1 : 0, phase[0]]);
  if(moveLog.length > 30000) moveLog = moveLog.slice(-30000);
  store.set('log', moveLog);
  if(window.Sync) Sync.schedule();
}
const saveCards = () => { store.set('cards', cards); if(window.Sync) Sync.schedule(); };
function cardFor(key){ return cards[key]; }
function grade(key, result, ctx){
  const now = Date.now();
  const c = cards[key] || {path: ctx.path, color: ctx.color, fams: [], name: ctx.name, ease: 2.5, ivl: 0, reps: 0, lapses: 0, due: 0};
  c.fams = [...new Set([...(c.fams || []), ...(ctx.fams || [])])];
  schedule(c, result, now);
  c.seen = now; if(ctx.name) c.name = ctx.name; cards[key] = c; saveCards();
}
function relevantCards(){
  const fams = selFamilies();
  return Object.entries(cards).filter(([k,c]) => c.color === S.color && (c.fams || []).some(f => fams.has(f)));
}
function dueCards(){ const now = Date.now(); return relevantCards().filter(([k,c]) => c.due <= now).sort((a,b) => (a[1].due - b[1].due) || (b[1].lapses - a[1].lapses) || (b[1].path.length - a[1].path.length)); }
function progressCounts(){
  const rc = relevantCards(), now = Date.now();
  return {due: rc.filter(([k,c]) => c.due <= now).length, known: rc.filter(([k,c]) => c.ivl >= 7).length, total: rc.length};
}
function cardsFor(selKey, color){
  const fam = selKey.split(':')[0];
  return Object.entries(cards).filter(([k,c]) => c.color === color && (c.fams || []).includes(fam));
}
// weight multiplier for an opponent move, based on the position you would face next
function srsMult(fenAfter){
  const c = cardFor(posKey(fenAfter));
  if(!c) return 1;
  return c.due <= Date.now() ? 4 : 0.35;
}

export { cards, cardsFor, dueCards, grade, logMove, moveLog, progressCounts, relevantCards, saveCards, srsMult };
