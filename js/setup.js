// The Openings page: search list, variation, colour, mini board.
import { $, esc, store } from './util.js';
import { LINES, PIECES } from './data.js';
import { FAM, FAM_NAMES, LINE_PLIES, MINE, QUICK, S, isMine, matches, myReps, oppChoices, rebuildSel, saveMyReps, selFlags } from './book.js';
import { parsePgn, studyPgnUrl } from './logic.js';
import { progressCounts } from './srs.js';
import { Explorer } from './explorer.js';

/* ================= setup UI ================= */
function renderColor(){ $('asW').setAttribute('aria-pressed', S.color === 'w'); $('asB').setAttribute('aria-pressed', S.color === 'b'); renderOpp(); renderSel(); renderMini(); }

 
 
 

function setSel(prefix){
  S.sel = prefix ? [prefix] : []; store.set('sel', S.sel);
  // your own repertoire is for the colour you prepared it for
  const r = isMine(prefix) && myReps().find(r => r.name === famOf(prefix));
  if(r && r.color !== S.color){ S.color = r.color; store.set('color', r.color); renderColor(); }
  renderSetup();
}
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
  const f = fam && FAM.get(fam), mine = isMine(fam) && myReps().find(r => r.name === fam);
  if(mine){
    // your repertoire's chapters
    const chs = [...new Set(mine.lines.map(l => l.c).filter(Boolean))];
    $('varSel').disabled = !chs.length;
    $('varSel').innerHTML = `<option value="${esc(fam)}">All chapters (${mine.lines.length} lines)</option>` +
      chs.map(c => { const n = mine.lines.filter(l => l.c === c).length; return `<option value="${esc(fam + ': ' + c)}">${esc(c)} (${n} line${n > 1 ? 's' : ''})</option>`; }).join('');
    $('varSel').value = cur;
  }
  else if(!f){ $('varSel').innerHTML = '<option>Choose an opening first</option>'; $('varSel').disabled = true; }
  else {
    const vars = [...f.vars.entries()].sort((a,b) => b[1] - a[1]);
    $('varSel').disabled = !vars.length;
    $('varSel').innerHTML = `<option value="${esc(fam)}">All variations (${f.lines.length} lines)</option>` +
      vars.map(([v, n]) => `<option value="${esc(v)}">${esc(v.slice(fam.length + 2))} (${n} line${n > 1 ? 's' : ''})</option>`).join('');
    $('varSel').value = cur;
  }
  const l = cur && previewLine(cur);
  $('preview').innerHTML = l ? `<b>${esc(l[0] || (S.color === 'w' ? 'White' : 'Black'))}</b>${esc(l[2].split(' ').map((m, i) => i % 2 === 0 ? (i/2 + 1) + '. ' + m : m).join(' '))}` : '';
}

// the opponent's opening: any opening that starts like yours, or one of its variations
function setOpp(p){ S.opp = p; store.set('opp', p); renderOpp(); renderSel(); }
function renderOpp(){
  const list = S.sel.length ? oppChoices() : [];
  if(S.opp && !list.includes(S.opp.split(':')[0])){ S.opp = ''; store.set('opp', ''); }
  const fam = S.opp.split(':')[0], f = fam && FAM.get(fam);
  $('oppFam').disabled = !S.sel.length;
  $('oppFam').innerHTML = '<option value="">Anything: the moves real players choose</option>' + list.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('oppFam').value = fam;
  $('oppVar').hidden = !f || !f.vars.size; $('oppHelp').hidden = !S.opp;
  if(f) $('oppVar').innerHTML = `<option value="${esc(fam)}">All variations (${f.lines.length} lines)</option>` +
    [...f.vars.entries()].sort((a,b) => b[1] - a[1]).map(([v, n]) => `<option value="${esc(v)}">${esc(v.slice(fam.length + 2))} (${n} line${n > 1 ? 's' : ''})</option>`).join('');
  if(f) $('oppVar').value = S.opp;
}
// punish mode: the opponent plays the mistakes players at your level often make
function renderPunish(){
  $('punishSeg').innerHTML = [[0, 'Plays well'], [1, 'Makes common mistakes']].map(([v, l]) => `<button data-pun="${v}" aria-pressed="${S.punish === v}">${l}</button>`).join('');
  $('punishSeg').querySelectorAll('[data-pun]').forEach(b => b.onclick = () => { S.punish = +b.dataset.pun; store.set('punish', S.punish); renderPunish(); });
  $('punishHelp').hidden = !S.punish;
  $('punishHelp').textContent = Explorer.enabled() ? 'When players at your level often get a move wrong here, the opponent plays it and you find the punishment. The line ends there.'
    : 'Connect Lichess in Settings first: its statistics show which mistakes players at your level make.';
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
function renderSetup(){ renderPickers(); renderOpp(); renderPunish(); renderSel(); renderOpList(); renderMini(); }

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
  // your own repertoires first
  const mine = myReps().filter(r => !q || r.name.toLowerCase().includes(q));
  const mineHtml = mine.length ? '<div class="op-group">My repertoires</div>' + mine.map(r => `<div class="op-row mine" role="option" tabindex="0" data-sel="${esc(r.name)}" aria-selected="${r.name === curFam}"><span class="op-eco-c">${r.color === 'w' ? 'White' : 'Black'}</span><span><span class="op-n">${esc(r.name.slice(MINE.length))}</span><span class="op-m">${esc(r.lines[0].m.split(' ').slice(0, 6).map((m, i) => i % 2 === 0 ? (i / 2 + 1) + '. ' + m : m).join(' '))}</span></span><span class="op-c">${r.lines.length} line${r.lines.length > 1 ? 's' : ''} <button class="op-del" data-delrep="${esc(r.name)}" title="Delete this repertoire" aria-label="Delete ${esc(r.name)}">✕</button></span></div>`).join('') : '';
  let html;
  if(!rows.length && mine.length) html = '';
  else if(!rows.length) html = `<div class="op-none">No opening matches “${esc(raw)}”. Try an ECO code like B20 or moves like 1. d4 Nf6.</div>`;
  else if(!q){
    const pop = QUICK.filter(f => FAM.has(f)).map(f => rows.find(r => r.fam === f)).filter(Boolean);
    html = (pop.length ? '<div class="op-group">Popular</div>' + pop.map(row).join('') : '') + '<div class="op-group">All openings, A to Z</div>' + rows.map(row).join('');
  } else html = rows.map(row).join('');
  const el = $('opList'), top = el.scrollTop; el.innerHTML = mineHtml + html; el.scrollTop = top;
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

/* --- importing your own lines --- */
let impColor = null;   // chosen by you, or else taken from the study's board orientation
function renderImpColor(){ $('impColor').querySelectorAll('[data-c]').forEach(b => b.setAttribute('aria-pressed', String((impColor || S.color) === b.dataset.c))); }
function impSay(text, kind){ $('impMsg').className = 'conn' + (kind ? ' ' + kind : ''); $('impMsg').textContent = text; }
async function importLines(){
  const link = $('impLink').value.trim();
  let text = $('impPgn').value;
  if(link){
    const url = studyPgnUrl(link);
    if(!url){ impSay('This is not a Lichess study link. It looks like https://lichess.org/study/…', 'err'); return; }
    impSay('Downloading the study…');
    try{
      const r = await fetch(url);
      if(r.status === 404 || r.status === 403){ impSay('Lichess did not share this study. Make it public or unlisted, or paste its PGN instead.', 'err'); return; }
      if(!r.ok){ impSay(`Lichess answered with an error (${r.status}).`, 'err'); return; }
      text = await r.text();
    }catch(e){ impSay('Could not reach Lichess. Check your connection, or paste the PGN instead.', 'err'); return; }
  }
  if(!text.trim()){ impSay('Paste a Lichess study link or a PGN first.', 'err'); return; }
  const p = parsePgn(text, Chess);
  const seen = new Set(), lines = [];
  const named = p.chapters.length > 1;
  // up to move 40: openings, not whole games
  for(const ch of p.chapters) for(const l of ch.lines){ const m = l.slice(0, 80).join(' '); if(seen.has(m)) continue; seen.add(m); lines.push(named && ch.name ? {c: ch.name.replace(/[:,]/g, ' -').trim(), m} : {m}); }
  if(!lines.length){ impSay('No moves could be read from this PGN.', 'err'); return; }
  const name = MINE + (($('impName').value.trim() || p.study || 'My repertoire').replace(/[:,]/g, ' -').trim());
  const orient = p.chapters.map(c => c.orientation).find(Boolean);
  const color = impColor || (orient === 'black' ? 'b' : orient === 'white' ? 'w' : S.color);
  const reps = myReps().filter(r => r.name !== name), replaced = reps.length < myReps().length;
  reps.push({name, color, lines, at: Date.now()});
  saveMyReps(reps);
  $('impBox').hidden = true; $('impOpen').hidden = false;
  setSel(name);
  const note = `${replaced ? 'Updated' : 'Imported'} ${name.slice(MINE.length)}: ${lines.length} line${lines.length > 1 ? 's' : ''}, as ${color === 'w' ? 'White' : 'Black'}.` + (p.skipped ? ` ${p.skipped} part${p.skipped > 1 ? 's' : ''} could not be read (a chapter from a set-up position, or an illegal move).` : '');
  $('selMeta').textContent = note;
}
function deleteRep(name){
  if(!confirm(`Delete ${name.slice(MINE.length)}? Your progress on its positions is kept.`)) return;
  saveMyReps(myReps().filter(r => r.name !== name));
  if(famOf(S.sel[0] || '') === name) setSel(''); else renderSetup();
}

export { previewLine, renderColor, renderSel, renderSetup };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  $('asW').onclick = () => { S.color = 'w'; store.set('color','w'); renderColor(); };
  $('asB').onclick = () => { S.color = 'b'; store.set('color','b'); renderColor(); };
  $('maxMove').value = String(S.maxMove);
  $('maxMove').onchange = e => { S.maxMove = +e.target.value; store.set('maxMove', S.maxMove); };
  $('useEngine').value = String(S.useEngine);
  $('useEngine').onchange = e => { S.useEngine = +e.target.value; store.set('useEngine', S.useEngine); };
  $('famSel').onchange = e => setSel(e.target.value);
  $('varSel').onchange = e => setSel(e.target.value);
  $('oppFam').onchange = e => setOpp(e.target.value);
  $('oppVar').onchange = e => setOpp(e.target.value);
  FAM.forEach((f, fam) => {
    const best = f.lines.reduce((a, b) => LINE_PLIES[b] < LINE_PLIES[a] ? b : a, f.lines[0]);
    const san = LINES[best][2], e = [...f.ecos].sort();
    const num = san.split(' ').map((m, i) => i % 2 === 0 ? (i/2 + 1) + '. ' + m : m).join(' ');
    const first = san.split(' ')[0];
    FAM_INFO.set(fam, {eco: e.length > 1 ? e[0] + '–' + e[e.length-1] : e[0], ecos: e.join(' ').toLowerCase(), san: san.toLowerCase(), num, first: first === 'e4' ? 'e4' : first === 'd4' ? 'd4' : 'other', n: f.lines.length, low: fam.toLowerCase()});
  });
  $('opList').addEventListener('click', e => {
    const d = e.target.closest('[data-delrep]'); if(d){ e.stopPropagation(); deleteRep(d.dataset.delrep); return; }
    const b = e.target.closest('[data-sel]'); if(b) setSel(b.dataset.sel);
  });
  $('impOpen').onclick = () => { ['impLink', 'impPgn', 'impName', 'impFile'].forEach(id => $(id).value = ''); $('impBox').hidden = false; $('impOpen').hidden = true; impColor = null; renderImpColor(); impSay(''); $('impLink').focus(); };
  $('impCancel').onclick = () => { $('impBox').hidden = true; $('impOpen').hidden = false; };
  $('impColor').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { impColor = b.dataset.c; renderImpColor(); });
  $('impFile').onchange = async e => { const f = e.target.files[0]; if(f){ $('impPgn').value = await f.text(); $('impLink').value = ''; if(!$('impName').value) $('impName').value = f.name.replace(/\.pgn$/i, ''); } };
  $('impGo').onclick = () => importLines().catch(e => impSay(e.message || 'The import failed.', 'err'));
  ['impLink', 'impPgn', 'impName'].forEach(id => $(id).addEventListener('keydown', e => e.stopPropagation()));
  $('opSearch').addEventListener('input', () => { $('opList').scrollTop = 0; renderOpList(); });
  $('opSearch').addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Enter'){ const b = $('opList').querySelector('[data-sel]'); if(b) setSel(b.dataset.sel); } });
}
export { init };
