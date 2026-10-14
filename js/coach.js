// The coach: in-browser model or OpenAI-compatible server, prompts, follow-up questions.
import { $, esc, pct, sleep } from './util.js';
import { S, fenAfter } from './book.js';
import { WEB_MODELS, webName } from './settings.js';
import { Explorer } from './explorer.js';
import { analyseMistake, evalWords, lineFens } from './analysis.js';
import { wikiFor } from './wikibooks.js';
import { explainInfo, files, game, lastNamed, phase, renderStatus, setExplainInfo, wrongInfo } from './trainer.js';
import { Engine, fmtEval, fmtLine, pvToSan, renderEngineNote, waitEngine } from './engine.js';

/* ================= coach (OpenAI-compatible endpoint) ================= */
/* in-browser model (WebLLM on WebGPU) */
const Web = {
  engine: null, state: 'idle', loadedId: '', loadingId: '', promise: null, progress: null, error: '', queue: Promise.resolve(),
  supported(){ return !!navigator.gpu; },
  idleTimer: null,
  // free the graphics memory: after 10 minutes without a question, or on request
  async unload(){
    clearTimeout(this.idleTimer);
    if(!this.engine || this.state !== 'ready') return;
    try{ await this.engine.unload(); }catch(e){}
    this.engine = null; this.state = 'idle'; this.loadedId = ''; this.loadingId = ''; this.promise = null;
    renderWebProgress(); renderEngineNote();
  },
  touch(){ clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => this.unload(), 10 * 60 * 1000); },
  load(){
    if(!this.supported()) return Promise.reject(new Error('WebGPU is not available in this browser.'));
    if(this.state === 'ready' && this.loadedId === S.webModel) return Promise.resolve();
    if(this.promise && this.loadingId === S.webModel) return this.promise;
    const id = S.webModel; this.loadingId = id; this.state = 'loading'; this.error = ''; this.progress = null; renderWebProgress();
    const cb = r => { if(this.loadingId === id){ this.progress = r; renderWebProgress(); } };
    this.promise = (async () => {
      const webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm');
      if(this.engine){ if(this.engine.setInitProgressCallback) this.engine.setInitProgressCallback(cb); await this.engine.reload(id); }
      else this.engine = await webllm.CreateMLCEngine(id, {initProgressCallback: cb});
      if(this.loadingId !== id) return;
      this.state = 'ready'; this.loadedId = id; this.promise = null; this.touch(); renderWebProgress(); renderEngineNote();
    })().catch(e => {
      if(this.loadingId === id){ this.state = 'failed'; this.error = (e && e.message) || String(e); this.promise = null; renderWebProgress(); }
      throw e;
    });
    return this.promise;
  },
  async run(prompt, {signal, onText} = {}){
    await this.load();
    const job = this.queue.then(async () => {
      if(signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
      const onAbort = () => { try{ this.engine.interruptGenerate(); }catch(e){} };
      if(signal) signal.addEventListener('abort', onAbort);
      let raw = '';
      const clean = s => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
      try{
        const stream = await this.engine.chat.completions.create({
          messages: Array.isArray(prompt) ? prompt : [{role: 'system', content: COACH_SYSTEM}, {role: 'user', content: prompt}],
          stream: true, temperature: 0.3, max_tokens: 400, extra_body: {enable_thinking: false}
        });
        for await (const chunk of stream){
          const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
          if(d){ raw += d; if(onText) onText({text: clean(raw)}); }
        }
      } finally { if(signal) signal.removeEventListener('abort', onAbort); }
      if(signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
      return {text: clean(raw)};
    });
    this.queue = job.catch(() => {});
    job.finally(() => this.touch()).catch(() => {});
    return job;
  }
};
function renderWebProgress(){
  const bar = $('webBar'), help = $('webHelp'), btn = $('webLoad');
  const sameModel = Web.loadingId === S.webModel || Web.loadedId === S.webModel;
  if(!Web.supported()){ bar.style.width = '0'; help.textContent = 'This browser has no WebGPU. Use a recent Chrome or Edge, or switch to Ollama.'; btn.disabled = true; }
  else if(Web.state === 'ready' && Web.loadedId === S.webModel){ bar.style.width = '100%'; help.textContent = `${webName(S.webModel)} is loaded and uses about ${(WEB_MODELS.find(m => m[0] === S.webModel) || [0,0,'?'])[2]} GB of memory. It is unloaded by itself after 10 minutes without a question, or when you close the page.`; btn.disabled = false; btn.textContent = 'Unload now'; }
  else if(Web.state === 'loading' && sameModel){ const p = Web.progress; bar.style.width = Math.round(((p && p.progress) || 0) * 100) + '%'; help.textContent = (p && p.text) || 'Starting…'; btn.disabled = true; }
  else if(Web.state === 'failed' && sameModel){ bar.style.width = '0'; help.textContent = 'The model could not be loaded: ' + Web.error + ' Try a smaller one.'; btn.disabled = false; }
  else { bar.style.width = '0'; help.textContent = `Runs on your graphics card and uses memory only while it is loaded. ${S.webWhen === 'start' ? 'It loads when you start training' : 'It loads the first time you ask the coach (a few seconds once downloaded)'}, and is unloaded after 10 minutes without a question.`; btn.disabled = false; }
  if(!(Web.state === 'ready' && Web.loadedId === S.webModel)) btn.textContent = 'Load the model';
  if(window.__coachLive){ if(wrongInfo && wrongInfo.coachState === 'thinking') renderCoach(wrongInfo); if(explainInfo && explainInfo.coachState === 'thinking') renderCoach(explainInfo); }
}
const COACH_SYSTEM = 'You are a concise, accurate chess opening coach. Answer in plain text.';
const Coach = {
  available(){
    if(S.coachMode === 'browser') return Web.supported();
    if(S.coachMode === 'server') return !!(S.coachUrl && S.coachModel);
    return false;
  },
  label(){ return S.coachMode === 'browser' ? `${webName(S.webModel)} in the browser` : S.coachModel; },
  run(prompt, opts = {}){ return S.coachMode === 'browser' ? Web.run(prompt, opts) : this.runServer(prompt, opts); },
  async runServer(prompt, {signal, onText} = {}){
    const headers = {'Content-Type': 'application/json'};
    if(S.coachKey) headers.Authorization = 'Bearer ' + S.coachKey;
    let res;
    try{
      res = await fetch(S.coachUrl, {method: 'POST', headers, signal, body: JSON.stringify({
        model: S.coachModel, stream: true, temperature: 0.3,
        messages: Array.isArray(prompt) ? prompt : [{role: 'system', content: COACH_SYSTEM}, {role: 'user', content: prompt}]
      })});
    }catch(e){
      if(e.name === 'AbortError') throw e;
      throw new Error(`Could not reach the coach at ${S.coachUrl}. Check that the server is running and accepts requests from this page (for Ollama, set OLLAMA_ORIGINS).`);
    }
    if(!res.ok){ let t = ''; try{ t = (await res.text()).slice(0, 200); }catch(e){} throw new Error(`The coach answered with an error (${res.status}). ${t}`); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', raw = '';
    const clean = s => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
    while(true){
      const {done, value} = await reader.read(); if(done) break;
      buf += dec.decode(value, {stream: true});
      const parts = buf.split('\n'); buf = parts.pop();
      for(const line of parts){
        const l = line.trim(); if(!l.startsWith('data:')) continue;
        const d = l.slice(5).trim(); if(d === '[DONE]') continue;
        try{ const j = JSON.parse(d); const delta = j.choices && j.choices[0] && (j.choices[0].delta || {}).content; if(delta){ raw += delta; if(onText) onText({text: clean(raw)}); } }catch(e){}
      }
    }
    return {text: clean(raw)};
  }
};


/* ================= coach prompts ================= */
let coachCtl = null;
// a fresh controller for a new coach request (cancels the previous one)
function newCoachCtl(){ cancelCoach(); coachCtl = new AbortController(); return coachCtl; }
function cancelCoach(){ if(coachCtl){ try{ coachCtl.abort(); }catch(e){} coachCtl = null; } }
function historyText(sans){ let s = ''; sans.forEach((m, i) => { if(i % 2 === 0) s += (i/2 + 1) + '. '; s += m + ' '; }); return s.trim(); }
const LANG = {en: 'English', fr: 'French'};
// the app's own analysis (always correct) and the Wikibooks text, shown above the coach
function renderInsight(info, target){
  const el = target || document.getElementById('insight'); if(!el || !info) return;
  let h = '';
  if(info.analysis && info.analysis.length) h += `<div class="ins-h">What happens</div><ul class="ins-list">${info.analysis.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  if(info.wiki === 'loading') h += '<div class="ins-wiki ins-muted">Looking for an explanation of this opening on Wikibooks…</div>';
  else if(info.wiki) h += `<details class="ins-wiki"><summary>What the opening books say: ${esc(fmtLine(new Chess().fen(), info.wiki.moves))}</summary><div class="ins-wtext">${esc(info.wiki.text)}</div><a href="${esc(info.wiki.url)}" target="_blank" rel="noopener">Read the full page on Wikibooks</a> <span class="ins-muted">(Chess Opening Theory, CC BY-SA)</span></details>`;
  el.innerHTML = h; el.style.display = h ? '' : 'none';
}
const wikiQuick = sans => Promise.race([wikiFor(sans), sleep(6000).then(() => null)]);
function factsBlock(info){
  let t = '';
  if(info.analysis && info.analysis.length) t += 'Facts computed by the app (always correct):\n' + info.analysis.map(x => '- ' + x).join('\n') + '\n';
  if(info.wiki && info.wiki.text) t += `\nWhat a human-written opening book (Wikibooks) says about the position after ${fmtLine(new Chess().fen(), info.wiki.moves)}:\n"${info.wiki.text.slice(0, 1200)}"\n`;
  return t;
}
const SUMMARY_RULES = 'Use only the facts and the opening-book text above. Do not mention any move, piece or square that does not appear above. If the facts do not explain something, leave it out.';
async function coachExplain(info){
  const colorName = S.color === 'w' ? 'White' : 'Black';
  const played = game.history().slice(0, -1);
  // 1. the app's own analysis
  const e = info.engine, bestSan = info.cands && info.cands[0] && info.cands[0].san;
  const toWhite = c => c == null ? null : (S.color === 'w' ? c : -c);   // the engine values are from your side
  info.analysis = analyseMistake({before: info.before, played: info.move.san, playedLine: e ? e.refutation : [], best: bestSan, bestLine: (e && e.bestLine) || [], evPlayed: e ? toWhite(e.you) : null, evBest: e ? toWhite(e.book) : null});
  info.checkFens = [...lineFens(info.before, [info.move.san, ...(e ? e.refutation : [])]), ...(bestSan ? lineFens(info.before, [bestSan, ...((e && e.bestLine) || [])]) : [])];
  info.fens = [info.before, e ? e.afterFen : fenAfter(info.before, info.move.san)];
  // 2. the human explanation of the opening
  info.wiki = played.length && played.length <= 30 ? 'loading' : null;
  if(wrongInfo === info) renderInsight(info);
  if(info.wiki === 'loading'){ info.wiki = await wikiQuick(played); if(wrongInfo !== info) return; renderInsight(info); }
  // 3. a short AI summary of those facts, checked before it is shown
  if(!Coach.available()){ info.coachState = 'unavail'; return; }
  const candTxt = info.cands.slice(0, 4).map(c => {
    const bits = [];
    if(c.label) bits.push(`leads to "${c.label}"`);
    if(c.share != null) bits.push(`played in ${pct(c.share)} of games, ${colorName} scores ${pct(c.score)}`);
    if(c.ev != null) bits.push(`Stockfish ${fmtEval(c.ev)}`);
    return c.san + (bits.length ? ' (' + bits.join(', ') + ')' : '');
  }).join('; ');
  const context = info.phase === 'book' ? (info.otherName ? `${info.move.san} is a known move but leads to "${info.otherName}", outside the chosen repertoire.` : `${info.move.san} is not in the opening book.`)
    : info.phase === 'stats' ? `The named theory has ended; the main moves come from games of ${Explorer.label()}.` : 'The named theory has ended; moves are judged by the engine.';
  const lines = e ? `Engine line after ${info.move.san}: ${fmtLine(e.afterFen, e.refutation)}.${e.bestLine && e.bestLine.length ? ` Engine line after ${bestSan}: ${fmtLine(fenAfter(info.before, bestSan), e.bestLine)}.` : ''}` : '';
  const prompt = `The student plays ${colorName} and is training: ${S.sel.join(', ')}.
Moves so far: ${historyText(played) || '(start of game)'}
Current opening: ${lastNamed ? lastNamed[1] : 'start position'}
The student played ${info.move.san}. ${context}
Main moves here: ${candTxt}
${lines}
Pieces before the move:
${pieceLists(new Chess(info.before))}

${factsBlock(info)}
In ${LANG[S.lang]}, write 2 or 3 short sentences that explain, in plain words, the idea of ${bestSan || 'the main move'} and what goes wrong with ${info.move.san}. ${SUMMARY_RULES} Plain text, no markdown, no lists.`;
  info.prompt = prompt; info.thread = [];
  info.coachState = 'thinking'; renderCoach(info);
  cancelCoach(); const ctl = new AbortController(); coachCtl = ctl;
  try{
    const res = await Coach.run(prompt, {signal: ctl.signal, onText: () => { if(wrongInfo === info && info.coachState !== 'streaming'){ info.coachState = 'streaming'; renderCoach(info); } }});
    if(wrongInfo !== info) return;
    const v = verifyCoach(res.text, info); info.coach = v.text; info.removed = v.removed;
    info.coachState = 'done'; renderCoach(info);
  }catch(err){
    if(err.name === 'AbortError' || wrongInfo !== info) return;
    info.coachState = 'error'; info.coachError = err.message; renderCoach(info);
  }
}
/* ---- checking what the model wrote, sentence by sentence ---- */
// a sentence is removed if it names a move that is not in the facts, or a piece on a square where there is none
const SAN_RE = /(?:^|[^A-Za-z0-9])((?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8])(?:=?[QRBN])?)(?=[+#!?]|[^A-Za-z0-9]|$)/g;
const PIECE_RE = /\b(king|queen|rook|bishop|knight|pawn)\s+on\s+([a-h][1-8])\b/gi;
const PT = {king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p'};
function sansIn(text){ const out = new Set(); for(const m of (text || '').matchAll(SAN_RE)) out.add(m[1]); return out; }
function verifyCoach(text, info, extra){
  const allowed = sansIn([info.prompt, ...(info.thread || []).map(t => t.qFull), extra].join('\n'));
  const boards = (info.checkFens || info.fens || []).map(f => { try{ return new Chess(f); }catch(e){ return null; } }).filter(Boolean);
  const pieceThere = (t, sq) => !boards.length || boards.some(b => { const p = b.get(sq); return p && p.type === t; });
  let removed = 0;
  const kept = (text || '').split(/(?<=[.!?])\s+/).filter(sent => {
    for(const m of sent.matchAll(SAN_RE)) if(!allowed.has(m[1])){ removed++; return false; }
    for(const m of sent.matchAll(PIECE_RE)) if(!pieceThere(PT[m[1].toLowerCase()], m[2])){ removed++; return false; }
    return true;
  });
  return {text: kept.join(' ').trim(), removed};
}
/* ---- facts about a position, so a small model cannot invent pieces or pawns ---- */
const PNAME = {k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn'};
const PLURAL = {k: 'King', q: 'Queens', r: 'Rooks', b: 'Bishops', n: 'Knights', p: 'Pawns'};
function pieceLists(g){
  const by = {w: {}, b: {}};
  for(const f of files) for(let r = 1; r <= 8; r++){ const sq = f + r, pc = g.get(sq); if(pc) (by[pc.color][pc.type] = by[pc.color][pc.type] || []).push(sq); }
  const side = c => 'kqrbnp'.split('').filter(t => by[c][t]).map(t => (by[c][t].length > 1 ? PLURAL[t] : PNAME[t]) + ' ' + by[c][t].join(' ')).join(', ');
  const pawnFiles = c => new Set((by[c].p || []).map(sq => sq[0]));
  const wf = pawnFiles('w'), bf = pawnFiles('b');
  const missing = set => files.split('').filter(f => !set.has(f)).map(f => f + '-pawn');
  const open = files.split('').filter(f => !wf.has(f) && !bf.has(f));
  return `White: ${side('w')}.\nBlack: ${side('b')}.\n` +
    `White has no ${missing(wf).join(', ') || 'missing pawns'}. Black has no ${missing(bf).join(', ') || 'missing pawns'}.` +
    (open.length ? ` Open files (no pawns at all): ${open.join(', ')}.` : ' There are no fully open files.');
}
function asSide(fen, color){ const f = fen.split(' '); f[1] = color; f[3] = '-'; return f.join(' '); }
function moveFacts(fenBefore, san){
  const g = new Chess(fenBefore), m = g.move(san); if(!m) return '';
  const who = m.color === 'w' ? 'White' : 'Black', opp = m.color === 'w' ? 'Black' : 'White';
  const parts = [];
  if(m.flags.includes('k') || m.flags.includes('q')) parts.push(`${who} castled ${m.flags.includes('k') ? 'kingside' : 'queenside'}.`);
  else parts.push(`${who}'s ${PNAME[m.piece].toLowerCase()} went from ${m.from} to ${m.to}` + (m.captured ? `, capturing ${opp}'s ${PNAME[m.captured].toLowerCase()} on ${m.flags.includes('e') ? 'en passant' : m.to}` : '') + (m.promotion ? `, promoting to a ${PNAME[m.promotion].toLowerCase()}` : '') + '.');
  if(g.in_check()) parts.push(`It gives check.`);
  // what the moved piece now attacks
  try{
    const t = new Chess(asSide(g.fen(), m.color));
    const hits = t.moves({square: m.to, verbose: true}).filter(x => x.captured).map(x => `${PNAME[x.captured].toLowerCase()} on ${x.to}`);
    if(hits.length) parts.push(`From ${m.to} it now attacks ${opp}'s ${hits.join(', ')}.`);
  }catch(e){}
  // can the opponent take on the destination square?
  const takers = g.moves({verbose: true}).filter(x => x.to === m.to && x.captured).map(x => `${PNAME[x.piece].toLowerCase()} from ${x.from}`);
  parts.push(takers.length ? `${opp} can capture on ${m.to} with: ${takers.join(', ')}.` : `${opp} cannot capture on ${m.to}.`);
  return parts.join(' ');
}
const GROUND = 'Only mention pieces and pawns that appear in the lists above, on the squares given. Never suggest moving a pawn or piece that is not listed. If you are not sure about a concrete claim, stay general.';
async function explainLast(){
  const hist = game.history(); if(!hist.length) return;
  const mover = hist.length % 2 === 1 ? 'White' : 'Black';
  const info = {coach: '', coachState: Coach.available() ? 'thinking' : 'unavail'}; setExplainInfo(info); renderStatus();
  const how = phase === 'engine' ? 'an engine-approved move played after theory ended' : phase === 'stats' ? `a popular move among ${Explorer.label()}` : 'a standard theory move';
  const last = hist[hist.length - 1], g0 = new Chess(); hist.slice(0, -1).forEach(m => g0.move(m));
  const before = g0.fen(); g0.move(last); const after = g0.fen();
  let eng = '', pvAfter = [], wEv = null;
  await waitEngine();
  if(Engine.available()){
    const r = await Engine.analyse(after, 12);
    if(explainInfo !== info) return;
    if(r){
      wEv = after.split(' ')[1] === 'w' ? r.cp : -r.cp; pvAfter = pvToSan(after, r.pv, 6);
      eng = `Stockfish after ${last}: ${evalWords(wEv)}. Expected continuation: ${fmtLine(after, pvAfter)}.`;
    }
  }
  info.analysis = analyseMistake({before, played: last, playedLine: pvAfter});
  if(wEv != null) info.analysis.unshift(`After ${last}, Stockfish sees ${evalWords(wEv)}.`);
  info.checkFens = lineFens(before, [last, ...pvAfter]); info.fens = [after, before];
  info.wiki = hist.length <= 30 ? 'loading' : null; renderInsight(info);
  if(info.wiki === 'loading'){ info.wiki = await wikiQuick(hist); if(explainInfo !== info) return; renderInsight(info); }
  if(!Coach.available()) return;
  const prompt = `The student plays ${S.color === 'w' ? 'White' : 'Black'}.
Moves: ${historyText(hist)}
Current opening: ${lastNamed ? lastNamed[1] : 'start position'}
The last move was ${last} by ${mover}, ${how}.
Pieces after the move:
${pieceLists(g0)}
${eng}

${factsBlock(info)}
In ${LANG[S.lang]}, write 2 or 3 short sentences about the idea of ${last} and the plans that usually follow. ${SUMMARY_RULES} Plain text, no markdown.`;
  info.prompt = prompt; info.thread = [];
  cancelCoach(); const ctl = new AbortController(); coachCtl = ctl;
  try{
    const res = await Coach.run(prompt, {signal: ctl.signal, onText: () => { if(explainInfo === info && info.coachState !== 'streaming'){ info.coachState = 'streaming'; renderCoach(info); } }});
    if(explainInfo === info){ const v = verifyCoach(res.text, info); info.coach = v.text; info.removed = v.removed; info.coachState = 'done'; renderCoach(info); }
  }catch(e){ if(e.name !== 'AbortError' && explainInfo === info){ info.coachState = 'error'; info.coachError = e.message; renderCoach(info); } }
}
/* ---- follow-up questions ---- */
const FOLLOW_SYSTEM = COACH_SYSTEM + ' The student may ask follow-up questions. Base your answers on the facts in the conversation; when the student mentions moves, facts and Stockfish analysis for those moves are added to the question. If something cannot be checked from these facts, say so in one sentence rather than guessing. Keep answers to 2 to 5 sentences.';
// moves written in a question (Qb3, 13.Qxe4, ...Nxe4, nf3): add their facts and a Stockfish check
async function factsForQuestion(info, q){
  const toks = [...new Set((q.match(/\b(?:O-O-O|O-O|0-0-0|0-0|[KQRBNkqrbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBNqrbn])?)\b/g) || []))].slice(0, 4);
  const out = [];
  for(const raw of toks){
    const variants = [raw.replace(/0/g, 'O'), raw.length > 2 && 'kqrbn'.includes(raw[0]) ? raw[0].toUpperCase() + raw.slice(1) : null].filter(Boolean);
    let hit = null;
    for(const fen of info.fens || []) for(const v of variants){ if(hit) break; try{ const m = new Chess(fen).move(v); if(m) hit = {fen, san: m.san}; }catch(e){} }
    if(!hit || out.some(o => o.san === hit.san && o.fen === hit.fen)) continue;
    let ev = '';
    if(Engine.available()){
      const after = fenAfter(hit.fen, hit.san), r = await Engine.analyse(after, 12);
      if(r){ const wEv = after.split(' ')[1] === 'w' ? r.cp : -r.cp;
        ev = ` Stockfish after ${hit.san}: ${Math.abs(wEv) >= 9000 ? (wEv > 0 ? 'White mates' : 'Black mates') : (wEv >= 0 ? '+' : '−') + (Math.abs(wEv) / 100).toFixed(1)} (positive is better for White); best continuation: ${fmtLine(after, pvToSan(after, r.pv, 5))}.`; }
    }
    out.push({san: hit.san, fen: hit.fen, text: `${hit.san}: ${moveFacts(hit.fen, hit.san)}${ev}`});
  }
  return out.length ? '\n\n(Facts for the moves in this question:\n' + out.map(o => o.text).join('\n') + ')' : '';
}
function coachMessages(info, upto){
  const msgs = [{role: 'system', content: FOLLOW_SYSTEM}, {role: 'user', content: info.prompt}, {role: 'assistant', content: info.coach}];
  const before = info.thread.slice(0, info.thread.indexOf(upto)).slice(-3);  // keep the conversation short for small models
  for(const t of before){ msgs.push({role: 'user', content: t.qFull || t.q}); if(t.a) msgs.push({role: 'assistant', content: t.a}); }
  msgs.push({role: 'user', content: upto.qFull + `\n\nAnswer in ${LANG[S.lang]}.`});
  return msgs;
}
async function askFollowUp(info, el, q){
  q = (q || '').trim(); if(!q || info.asking) return;
  const t = {q, a: '', state: 'thinking'}; info.thread.push(t); info.draft = ''; info.asking = true; renderCoach(info, el);
  try{
    t.qFull = q + await factsForQuestion(info, q);
    const ctl = new AbortController(); info.ctl = ctl;
    const r = await Coach.run(coachMessages(info, t), {signal: ctl.signal});
    const v = verifyCoach(r.text, info, t.qFull);
    t.a = v.text || 'I can only answer from the facts above, and could not answer this one reliably.'; t.removed = v.removed; t.state = 'done';
  }catch(e){ if(e.name !== 'AbortError'){ t.state = 'error'; t.a = e.message || 'The coach could not answer.'; } }
  info.asking = false; renderCoach(info, el);
}
function threadHtml(info){
  if(!info.thread || info.coachState !== 'done') return '';
  const items = info.thread.map(t => `<div class="fu-q">${esc(t.q)}</div><div class="fu-a ${t.state === 'error' ? 'err' : ''}">${t.state === 'thinking' ? 'Thinking…' : esc(t.a)}${t.removed ? `<span class="ins-muted"> (${t.removed} sentence${t.removed > 1 ? 's' : ''} removed by the check)</span>` : ''}</div>`).join('');
  return items + `<div class="fu-row"><input class="fu-in" type="text" placeholder="Ask a follow-up, e.g. Why not Qxe4?" value="${esc(info.draft || '')}" ${info.asking ? 'disabled' : ''}><button class="btn fu-go" ${info.asking ? 'disabled' : ''}>Ask</button></div>`;
}
function renderCoach(info, target){
  const el = target || document.getElementById('coach'); if(!el) return;
  const hadFocus = document.activeElement && document.activeElement.classList.contains('fu-in') && el.contains(document.activeElement);
  if(!info || info.coachState === 'unavail' || info.coachState === 'idle'){ el.style.display = 'none'; return; }
  el.style.display = '';
  if(info.coachState === 'thinking'){
    const loading = S.coachMode === 'browser' && Web.state === 'loading';
    const pr = loading && Web.progress ? ` ${Math.round((Web.progress.progress || 0) * 100)}%` : '';
    el.className = 'coach thinking'; el.innerHTML = '<span class="lbl">Coach</span>' + (loading ? `Loading ${esc(webName(S.webModel))}…${pr}` : 'Thinking…');
  }
  else if(info.coachState === 'error'){ el.className = 'coach thinking'; el.innerHTML = '<span class="lbl">Coach</span>' + esc(info.coachError || 'The explanation could not be loaded.'); }
  else if(info.coachState === 'streaming'){ el.className = 'coach thinking'; el.innerHTML = '<span class="lbl">AI summary</span>Writing, then checking against the position…'; }
  else {
    const note = info.removed ? `<div class="ins-muted" style="font-size:12.5px;margin-top:4px">${info.removed} sentence${info.removed > 1 ? 's were' : ' was'} removed: ${info.removed > 1 ? 'they' : 'it'} named moves or pieces that are not in the position.</div>` : '';
    const main = info.coach ? esc(info.coach) : '<span class="ins-muted">The AI summary did not pass the check against the position, so it is hidden. The facts above are reliable.</span>';
    el.className = 'coach'; el.innerHTML = '<span class="lbl">AI summary, checked against the position</span><div class="fu-main">' + main + '</div>' + note + threadHtml(info);
    const inp = el.querySelector('.fu-in');
    if(inp){
      inp.oninput = () => { info.draft = inp.value; };
      inp.onkeydown = e => { e.stopPropagation(); if(e.key === 'Enter'){ e.preventDefault(); askFollowUp(info, el, inp.value); } };
      el.querySelector('.fu-go').onclick = () => askFollowUp(info, el, inp.value);
      if(hadFocus || (info.thread.length && !info.asking)){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }
}

export { Coach, GROUND, LANG, PNAME, SUMMARY_RULES, Web, cancelCoach, coachExplain, explainLast, factsBlock, historyText, moveFacts, newCoachCtl, pieceLists, renderCoach, renderInsight, renderWebProgress, verifyCoach, wikiQuick };
