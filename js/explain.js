// Explanations without AI: facts computed from the position and Stockfish, and the Wikibooks text of the opening.
import { esc, sleep } from './util.js';
import { S } from './book.js';
import { analyseMistake, evalWords } from './analysis.js';
import { wikiFor } from './wikibooks.js';
import { explainInfo, game, renderStatus, setExplainInfo, wrongInfo } from './trainer.js';
import { Engine, fmtLine, pvToSan, waitEngine } from './engine.js';

const PNAME = {k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn'};

// the app's own analysis and the Wikibooks text
function renderInsight(info, target){
  const el = target || document.getElementById('insight'); if(!el || !info) return;
  let h = '';
  if(info.analysis && info.analysis.length) h += `<div class="ins-h">What happens</div><ul class="ins-list">${info.analysis.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  if(info.wiki === 'loading') h += '<div class="ins-wiki ins-muted">Looking for an explanation of this opening on Wikibooks…</div>';
  else if(info.wiki) h += `<details class="ins-wiki"><summary>What the opening books say: ${esc(fmtLine(new Chess().fen(), info.wiki.moves))}</summary><div class="ins-wtext">${esc(info.wiki.text)}</div><a href="${esc(info.wiki.url)}" target="_blank" rel="noopener">Read the full page on Wikibooks</a> <span class="ins-muted">(Chess Opening Theory, CC BY-SA)</span></details>`;
  el.innerHTML = h; el.style.display = h ? '' : 'none';
}
const wikiQuick = sans => Promise.race([wikiFor(sans), sleep(6000).then(() => null)]);

// a wrong move in training: what the move allows, what the main move does, and the opening's explanation
async function explainMistake(info){
  const played = game.history().slice(0, -1);
  const e = info.engine, bestSan = info.cands && info.cands[0] && info.cands[0].san;
  const toWhite = c => c == null ? null : (S.color === 'w' ? c : -c);   // the engine values are from your side
  info.analysis = analyseMistake({before: info.before, played: info.move.san, playedLine: e ? e.refutation : [], best: bestSan, bestLine: (e && e.bestLine) || [], evPlayed: e ? toWhite(e.you) : null, evBest: e ? toWhite(e.book) : null});
  info.wiki = played.length && played.length <= 30 ? 'loading' : null;
  if(wrongInfo === info) renderInsight(info);
  if(info.wiki === 'loading'){ info.wiki = await wikiQuick(played); if(wrongInfo === info) renderInsight(info); }
}

// "Explain the last move": Stockfish's view of the position and the opening's explanation
async function explainLast(){
  const hist = game.history(); if(!hist.length) return;
  const info = {}; setExplainInfo(info); renderStatus();
  const last = hist[hist.length - 1], g0 = new Chess(); hist.slice(0, -1).forEach(m => g0.move(m));
  const before = g0.fen(); g0.move(last); const after = g0.fen();
  let pvAfter = [], wEv = null;
  await waitEngine();
  if(Engine.available()){
    const r = await Engine.analyse(after, 12);
    if(explainInfo !== info) return;
    if(r){ wEv = after.split(' ')[1] === 'w' ? r.cp : -r.cp; pvAfter = pvToSan(after, r.pv, 6); }
  }
  info.analysis = analyseMistake({before, played: last, playedLine: pvAfter});
  if(wEv != null) info.analysis.unshift(`After ${last}, Stockfish sees ${evalWords(wEv)}.`);
  info.wiki = hist.length <= 30 ? 'loading' : null; renderInsight(info);
  if(info.wiki === 'loading'){ info.wiki = await wikiQuick(hist); if(explainInfo === info) renderInsight(info); }
}

export { PNAME, explainLast, explainMistake, renderInsight, wikiQuick };
