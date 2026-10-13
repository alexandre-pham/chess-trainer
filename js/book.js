// Opening families, your current selection and settings, and book moves for a position.
import { posKey, store } from './util.js';
import { LINES, POS } from './data.js';
import { lastNamed } from './trainer.js';

/* ================= families ================= */
// opening families ("Sicilian Defense") with their lines, variations and ECO codes
const FAM = (() => {
  const fams = new Map();
  LINES.forEach((l, i) => {
    const name = l[1], fam = name.split(':')[0];
    if(!fams.has(fam)) fams.set(fam, {lines:[], vars:new Map(), ecos:new Set()});
    const f = fams.get(fam); f.lines.push(i); f.ecos.add(l[0]);
    const rest = name.slice(fam.length + 2);
    if(rest){ const v = fam + ': ' + rest.split(',')[0]; f.vars.set(v, (f.vars.get(v)||0) + 1); }
  });
  return fams;
})();
const FAM_NAMES = [...FAM.keys()].sort((a,b) => a.localeCompare(b));
const matches = (name, prefix) => name === prefix || name.startsWith(prefix + ':') || name.startsWith(prefix + ',');
const QUICK = ["Sicilian Defense","French Defense","Caro-Kann Defense","Scandinavian Defense","Ruy Lopez","Italian Game","Scotch Game","Vienna Game","Queen's Gambit Declined","Slav Defense","King's Indian Defense","Nimzo-Indian Defense","London System","English Opening"];

/* ================= settings ================= */
const S = {
  color: store.get('color','w'), lang: store.get('lang','en'), sel: store.get('sel', []),
  maxMove: store.get('maxMove', 15), useEngine: store.get('useEngine', 1),
  token: store.get('token', ''), exDb: store.get('exDb', 'lichess'), ratings: store.get('ratings', [1600,1800,2000]),
  coachUrl: store.get('coachUrl', 'http://localhost:11434/v1/chat/completions'), coachModel: store.get('coachModel', 'qwen3:8b'), coachKey: store.get('coachKey', ''),
  coachMode: store.get('coachMode', 'browser'), webWhen: store.get('webWhen', 'demand'), webModel: store.get('webModel', 'Qwen3-4B-q4f16_1-MLC')
};

let selFlags = new Uint8Array(LINES.length);
let famFlags = new Uint8Array(LINES.length);
const LINE_PLIES = LINES.map(l => l[2].split(' ').length);
function rebuildSel(){
  selFlags = new Uint8Array(LINES.length); famFlags = new Uint8Array(LINES.length);
  const fams = S.sel.map(p => p.split(':')[0]);
  LINES.forEach((l,i) => {
    if(S.sel.some(p => matches(l[1], p))) selFlags[i] = 1;
    if(fams.some(f => matches(l[1], f))) famFlags[i] = 1;  // the whole opening family, used when your variation's lines stop
  });
}
const selFamilies = () => new Set(S.sel.map(p => p.split(':')[0]));

/* ================= book queries ================= */
function bookMoves(fen){ const p = POS[posKey(fen)]; return p ? p[2] : {}; }
// book moves from here: first the lines of your selection; if they stop, the other lines of the same opening family
function candidates(fen){
  const f = fen.split(' '), ply = (+f[5] - 1) * 2 + (f[1] === 'b' ? 1 : 0);
  const moves = Object.entries(bookMoves(fen));
  const run = flags => {
    const out = [];
    for(const [san, lst] of moves){
      let w = 0, best = -1, rem = 0;
      for(const i of lst) if(flags[i]){ w++; rem = Math.max(rem, LINE_PLIES[i] - ply - 1); if(best < 0 || LINES[i][2].length < LINES[best][2].length) best = i; }
      if(w) out.push({san, w, line: best, rem});
    }
    return out.sort((a,b) => b.w - a.w);
  };
  let out = run(selFlags); out.wide = false;
  if(!out.length){ out = run(famFlags); out.wide = out.length > 0; }
  return out;
}
function shortestLine(lst){ let b = lst[0]; for(const i of lst) if(LINES[i][2].length < LINES[b][2].length) b = i; return b; }
function nameAfter(fen, san, fallbackIdx){
  const g = new Chess(fen); g.move(san); const p = POS[posKey(g.fen())];
  if(p && p[1]) return LINES[p[0]][1];
  return lastNamed ? lastNamed[1] : (LINES[fallbackIdx] ? LINES[fallbackIdx][1] : 'this opening');
}
const fenAfter = (fen, san) => { const g = new Chess(fen); g.move(san); return g.fen(); };

export { FAM, FAM_NAMES, LINE_PLIES, QUICK, S, bookMoves, candidates, famFlags, fenAfter, matches, nameAfter, rebuildSel, selFamilies, selFlags, shortestLine };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  if(S.sel.length > 1) S.sel = S.sel.slice(0, 1);
}
export { init };
