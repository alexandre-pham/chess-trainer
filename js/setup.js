// The Openings page: search list, variation, colour, mini board.
import { $, esc, store } from './util.js';
import { LINES, PIECES } from './data.js';
import { FAM, FAM_NAMES, LINE_PLIES, QUICK, S, matches, rebuildSel, selFlags } from './book.js';
import { progressCounts } from './srs.js';

/* ================= setup UI ================= */
function renderColor(){ $('asW').setAttribute('aria-pressed', S.color === 'w'); $('asB').setAttribute('aria-pressed', S.color === 'b'); renderSel(); renderMini(); }

 
 
 

function setSel(prefix){ S.sel = prefix ? [prefix] : []; store.set('sel', S.sel); renderSetup(); }
const famOf = p => p ? p.split(':')[0] : '';
function famLabel(fam){ const e = [...FAM.get(fam).ecos].sort(); return `${fam} (${e.length > 1 ? e[0] + '–' + e[e.length-1] : e[0]})`; }
function previewLine(cur){
  const all = LINES.filter(l => matches(l[1], cur));
  if(!all.length) return null;
  const exact = all.filter(l => l[1] === cur), pool = exact.length ? exact : all;
  const plies = l => l[2].split(' ').length;
  if(!cur.includes(':')) return pool.reduce((a, b) => plies(b) < plies(a) ? b : a); // a whole family: show its defining moves
  const short = pool.filter(l => plies(l) <= 10);
  return short.length ? short.reduce((a, b) => plies(b) > plies(a) ? b : a) : pool.reduce((a, b) => plies(b) < plies(a) ? b : a);
}
function renderPickers(){
  const cur = S.sel[0] || '', fam = famOf(cur);
  const opt = f => `<option value="${esc(f)}">${esc(famLabel(f))}</option>`;
  $('famSel').innerHTML = '<option value="">Choose an opening…</option>' +
    `<optgroup label="Popular">${QUICK.filter(q => FAM.has(q)).map(opt).join('')}</optgroup>` +
    `<optgroup label="All openings, A to Z">${FAM_NAMES.map(opt).join('')}</optgroup>`;
  $('famSel').value = fam;
  const f = fam && FAM.get(fam);
  if(!f){ $('varSel').innerHTML = '<option>Choose an opening first</option>'; $('varSel').disabled = true; }
  else {
    const vars = [...f.vars.entries()].sort((a,b) => b[1] - a[1]);
    $('varSel').disabled = !vars.length;
    $('varSel').innerHTML = `<option value="${esc(fam)}">All variations (${f.lines.length} lines)</option>` +
      vars.map(([v, n]) => `<option value="${esc(v)}">${esc(v.slice(fam.length + 2))} (${n} line${n > 1 ? 's' : ''})</option>`).join('');
    $('varSel').value = cur;
  }
  const l = cur && previewLine(cur);
  $('preview').innerHTML = l ? `<b>${esc(l[0])}</b>${esc(l[2].split(' ').map((m, i) => i % 2 === 0 ? (i/2 + 1) + '. ' + m : m).join(' '))}` : '';
}

function renderSel(){
  rebuildSel();
  const n = selFlags.reduce((a,b) => a + b, 0);
  $('selList').innerHTML = S.sel.map(p => `<li><span>${esc(p)}</span></li>`).join('');
  $('selEmpty').hidden = S.sel.length > 0;
  $('start').disabled = n === 0;
  $('selMeta').textContent = n ? `${n} named line${n > 1 ? 's' : ''} in this selection.` : '';
  const pc = progressCounts();
  $('reviewSetup').hidden = !pc.due;
  $('reviewSetup').textContent = `Review ${pc.due} due position${pc.due > 1 ? 's' : ''}`;
  $('progSetup').innerHTML = pc.total ? `<span><b>${pc.total}</b>seen</span><span><b>${pc.known}</b>mastered</span><span><b>${pc.due}</b>to review</span>` : '';
}
function renderSetup(){ renderPickers(); renderSel(); renderOpList(); renderMini(); }

/* --- opening search list --- */
const FAM_INFO = new Map();

let opFilter = 'all';
const normQ = q => q.toLowerCase().replace(/\d+\.(\.\.)?|…/g, ' ').replace(/\s+/g, ' ').trim();
const LINES_LOW = LINES.map(l => l[2].toLowerCase());
const looksLikeMoves = q => /^([kqrbn]?[a-h]?[1-8]?x?[a-h][1-8](=?[qrbn])?[+#]?|o-o(-o)?)( |$)/.test(q);
// lines reached by a move sequence: lines that continue it, or else the deepest line it continues
function linesForMoves(qm){
  const ext = []; LINES_LOW.forEach((l, i) => { if(l === qm || l.startsWith(qm + ' ')) ext.push(i); });
  if(ext.length) return ext;
  let best = -1; LINES_LOW.forEach((l, i) => { if(qm.startsWith(l + ' ') && (best < 0 || l.length > LINES_LOW[best].length)) best = i; });
  return best < 0 ? [] : [best];
}
function renderOpList(){
  const raw = $('opSearch').value.trim(), q = raw.toLowerCase(), qm = normQ(raw), cur = S.sel[0] || '', curFam = famOf(cur);
  $('opFirst').innerHTML = [['all', 'All'], ['e4', '1. e4'], ['d4', '1. d4'], ['other', 'Other first moves']].map(([v, l]) => `<button class="chip" data-f="${v}" aria-pressed="${opFilter === v}">${l}</button>`).join('');
  $('opFirst').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { opFilter = b.dataset.f; renderOpList(); });
  const rows = [];
  // a search by moves: which families, and the most general matching line in each
  const byMoves = new Map();
  if(qm && looksLikeMoves(qm)) for(const li of linesForMoves(qm)){ const f = LINES[li][1].split(':')[0], cur = byMoves.get(f); if(cur == null || LINE_PLIES[li] < LINE_PLIES[cur]) byMoves.set(f, li); }
  for(const fam of FAM_NAMES){
    const i = FAM_INFO.get(fam);
    if(opFilter !== 'all' && i.first !== opFilter) continue;
    let pick = fam, sub = '';
    if(q){
      const hit = i.low.includes(q) || i.ecos.includes(q);
      if(!hit && byMoves.has(fam)){ const name = LINES[byMoves.get(fam)][1]; if(name !== fam){ const v = fam + ': ' + name.slice(fam.length + 2).split(',')[0]; pick = FAM.get(fam).vars.has(v) ? v : fam; sub = pick === fam ? '' : pick.slice(fam.length + 2); } rows.push({fam, pick, sub, i}); continue; }
      if(!hit){
        const v = [...FAM.get(fam).vars.keys()].find(v => v.toLowerCase().includes(q));
        if(!v) continue;
        pick = v; sub = v.slice(fam.length + 2);
      }
    }
    rows.push({fam, pick, sub, i});
  }
  const row = r => `<button class="op-row" role="option" data-sel="${esc(r.pick)}" aria-selected="${r.fam === curFam}"><span class="op-eco-c">${esc(r.i.eco)}</span><span><span class="op-n">${esc(r.fam)}</span>${r.sub ? `<span class="op-v">${esc(r.sub)}</span>` : `<span class="op-m">${esc(r.i.num)}</span>`}</span><span class="op-c">${r.i.n} line${r.i.n > 1 ? 's' : ''}</span></button>`;
  let html;
  if(!rows.length) html = `<div class="op-none">No opening matches “${esc(raw)}”. Try an ECO code like B20 or moves like 1. d4 Nf6.</div>`;
  else if(!q){
    const pop = QUICK.filter(f => FAM.has(f)).map(f => rows.find(r => r.fam === f)).filter(Boolean);
    html = (pop.length ? '<div class="op-group">Popular</div>' + pop.map(row).join('') : '') + '<div class="op-group">All openings, A to Z</div>' + rows.map(row).join('');
  } else html = rows.map(row).join('');
  const el = $('opList'), top = el.scrollTop; el.innerHTML = html; el.scrollTop = top;
}

/* --- mini board of the chosen line --- */
function renderMini(){
  const cur = S.sel[0] || '', l = cur && previewLine(cur), g = new Chess();
  let last = null;
  if(l){ l[2].split(' ').forEach(m => { last = g.move(m) || last; }); }
  const b = g.board(), out = [];
  for(let r = 0; r < 8; r++) for(let f = 0; f < 8; f++){
    const rr = S.color === 'b' ? 7 - r : r, ff = S.color === 'b' ? 7 - f : f;
    const p = b[rr][ff], sq = 'abcdefgh'[ff] + (8 - rr);
    const cls = ((rr + ff) % 2 ? 'd' : '') + (last && (last.from === sq || last.to === sq) ? ' last' : '');
    out.push(`<i class="${cls}">${p ? `<img src="${PIECES[p.color + p.type.toUpperCase()]}" alt="">` : ''}</i>`);
  }
  $('miniBoard').innerHTML = out.join('');
  $('selName').textContent = cur ? (cur.includes(':') ? cur.slice(cur.indexOf(':') + 2) : cur) : '';
  $('selName').hidden = !cur;
  if(cur && cur.includes(':') && !$('preview').textContent.startsWith(famOf(cur) + ' · ')) $('preview').innerHTML = esc(famOf(cur)) + ' · ' + $('preview').innerHTML;
}

export { previewLine, renderColor, renderSel, renderSetup };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  $('asW').onclick = () => { S.color = 'w'; store.set('color','w'); renderColor(); };
  $('asB').onclick = () => { S.color = 'b'; store.set('color','b'); renderColor(); };
  $('lang').value = S.lang;
  $('lang').onchange = e => { S.lang = e.target.value; store.set('lang', S.lang); };
  $('maxMove').value = String(S.maxMove);
  $('maxMove').onchange = e => { S.maxMove = +e.target.value; store.set('maxMove', S.maxMove); };
  $('useEngine').value = String(S.useEngine);
  $('useEngine').onchange = e => { S.useEngine = +e.target.value; store.set('useEngine', S.useEngine); };
  $('famSel').onchange = e => setSel(e.target.value);
  $('varSel').onchange = e => setSel(e.target.value);
  FAM.forEach((f, fam) => {
    const best = f.lines.reduce((a, b) => LINE_PLIES[b] < LINE_PLIES[a] ? b : a, f.lines[0]);
    const san = LINES[best][2], e = [...f.ecos].sort();
    const num = san.split(' ').map((m, i) => i % 2 === 0 ? (i/2 + 1) + '. ' + m : m).join(' ');
    const first = san.split(' ')[0];
    FAM_INFO.set(fam, {eco: e.length > 1 ? e[0] + '–' + e[e.length-1] : e[0], ecos: e.join(' ').toLowerCase(), san: san.toLowerCase(), num, first: first === 'e4' ? 'e4' : first === 'd4' ? 'd4' : 'other', n: f.lines.length, low: fam.toLowerCase()});
  });
  $('opList').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if(b) setSel(b.dataset.sel); });
  $('opSearch').addEventListener('input', () => { $('opList').scrollTop = 0; renderOpList(); });
  $('opSearch').addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Enter'){ const b = $('opList').querySelector('[data-sel]'); if(b) setSel(b.dataset.sel); } });
}
export { init };
