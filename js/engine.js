// Stockfish in a background worker.
import { $, sleep } from './util.js';
import { S } from './book.js';
import { Explorer } from './explorer.js';
import { Coach, Web } from './coach.js';

/* ================= engine ================= */
const Engine = {
  w: null, state: 'idle', mode: '', queue: Promise.resolve(), handler: null,
  available(){ return this.state === 'ready'; },
  send(cmd){ if(this.mode === 'worker') this.w.postMessage(cmd); },
  onLine(line){
    if(line === 'uciok' && this.state === 'loading'){ clearTimeout(this.timer); this.state = 'ready'; this.send('setoption name Hash value 16'); renderEngineNote(); }
    if(this.handler) this.handler(line);
  },
  init(){
    if(this.state !== 'idle') return;
    this.state = 'loading';
    try{
      // Stockfish (stockfish.js 10, compiled to JavaScript) runs in a background worker
      this.w = new Worker(new URL('../vendor/stockfish.js', import.meta.url));
      this.mode = 'worker';
      this.timer = setTimeout(() => { if(this.state === 'loading') this.fail(); }, 20000);
      this.w.onmessage = e => this.onLine(typeof e.data === 'string' ? e.data : '');
      this.w.onerror = () => { if(this.state === 'loading') this.fail(); };
      this.w.postMessage('uci');
    }catch(e){ this.fail(); }
  },
  fail(){ clearTimeout(this.timer); this.state = 'failed'; this.mode = ''; try{ this.w && this.w.terminate(); }catch(e){} renderEngineNote(); },
  analyse(fen, depth, multipv){
    multipv = multipv || 1;
    const run = () => new Promise(resolve => {
      if(this.state !== 'ready') return resolve(null);
      const lines = [];
      const timer = setTimeout(() => this.send('stop'), 6000);
      this.handler = line => {
        if(line.startsWith('info') && line.includes(' pv ') && line.includes('score')){
          const mm = line.match(/score (cp|mate) (-?\d+)/), pv = line.split(' pv ')[1];
          const k = +((line.match(/ multipv (\d+)/) || [0, 1])[1]) - 1;
          if(mm) lines[k] = {cp: mm[1] === 'cp' ? +mm[2] : (+mm[2] > 0 ? 10000 - +mm[2] : -10000 - +mm[2]), pv: pv.trim().split(' ')};
        } else if(line.startsWith('bestmove')){
          clearTimeout(timer); this.handler = null;
          const ls = lines.filter(Boolean); resolve(ls.length ? {cp: ls[0].cp, pv: ls[0].pv, lines: ls} : null);
        }
      };
      this.send('setoption name MultiPV value ' + multipv); this.send('position fen ' + fen);
      this.send('go depth ' + depth + ' movetime ' + 4000);
    });
    const p = this.queue.then(run); this.queue = p.catch(() => {}); return p;
  }
};
async function waitEngine(){ for(let i=0;i<80 && Engine.state === 'loading';i++) await sleep(300); }
const uciMove = (g, u) => g.move({from: u.slice(0,2), to: u.slice(2,4), promotion: u[4]});
function renderEngineNote(){
  const parts = [];
  if(Engine.state === 'ready') parts.push('Stockfish is ready' + (Engine.mode === 'inline' ? ' (running in the page, it may pause briefly while thinking).' : '.'));
  else if(Engine.state === 'failed') parts.push('Stockfish could not start in this browser.');
  else parts.push('Loading Stockfish…');
  parts.push(Explorer.enabled() ? `Statistics: ${Explorer.label()}.` : 'Statistics are off (no Lichess token).');
  parts.push(Coach.available() ? `Coach: ${Coach.label()}${S.coachMode === 'browser' && Web.state === 'loading' ? ' (loading)' : ''}.` : 'Coach is off.');
  $('engineNote').textContent = parts.join(' ');
}
function pvToSan(fen, pv, max){
  const g = new Chess(fen), out = [];
  for(const u of pv.slice(0, max)){ const m = uciMove(g, u); if(!m) break; out.push(m.san); }
  return out;
}
function fmtLine(fen, sans){
  let n = +fen.split(' ')[5], w = fen.split(' ')[1] === 'w'; const s = [];
  sans.forEach((x, i) => { if(w) s.push(n + '. ' + x); else s.push(i === 0 ? n + '… ' + x : x); if(!w) n++; w = !w; });
  return s.join(' ');
}
const fmtEval = cp => Math.abs(cp) >= 9000 ? (cp > 0 ? 'mate for you' : 'mate against you') : (cp >= 0 ? '+' : '−') + (Math.abs(cp)/100).toFixed(1);

export { Engine, fmtEval, fmtLine, pvToSan, renderEngineNote, uciMove, waitEngine };
