#!/usr/bin/env node
// Analyses your chess.com games with Stockfish and prints what costs you points.
// Usage: node tools/analyse-games.mjs --user NAME [--games N] [--days N] [--months N] [--since YYYY-MM-DD]
//        [--time rapid|blitz|bullet|daily|all] [--nodes N] [--workers N] [--json FILE] [--no-cache]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(HERE, '..', 'vendor');
const { Chess } = createRequire(import.meta.url)(join(VENDOR, 'chess.js'));
const DAY = 86400000;

/* ================= options ================= */
const HELP = `Analyses your chess.com games with Stockfish and prints what costs you points.

  node tools/analyse-games.mjs --user NAME [which games] [options]

Which games (combine them; with none, the last 30 days):
  --games N         the last N games
  --days N          games of the last N days
  --months N        games of the last N months
  --since DATE      games since DATE (YYYY-MM-DD)

Options:
  --time CLASS      rapid (default), blitz, bullet, daily or all
  --nodes N         Stockfish effort per position (default 200000; lower is faster)
  --workers N       Stockfish copies running at once (default: your cores minus 2)
  --json FILE       also save every move's evaluation to FILE
  --no-cache        analyse again games already analysed`;

function parseArgs(argv){
  const o = {time: 'rapid', nodes: 200000, workers: Math.max(1, availableParallelism() - 2), cache: true};
  for(let i = 0; i < argv.length; i++){
    const a = argv[i], v = () => { const x = argv[++i]; if(x == null) throw new Error(`${a} needs a value`); return x; };
    if(a === '--user') o.user = v();
    else if(a === '--games') o.games = +v();
    else if(a === '--days') o.days = +v();
    else if(a === '--months') o.months = +v();
    else if(a === '--since') o.since = v();
    else if(a === '--time') o.time = v();
    else if(a === '--nodes') o.nodes = +v();
    else if(a === '--workers') o.workers = +v();
    else if(a === '--json') o.json = v();
    else if(a === '--no-cache') o.cache = false;
    else if(a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  for(const k of ['games', 'days', 'months', 'nodes', 'workers']) if(o[k] != null && !(o[k] > 0)) throw new Error(`--${k} must be a positive number`);
  if(o.since && isNaN(Date.parse(o.since))) throw new Error('--since must be a date like 2026-11-01');
  if(!['rapid', 'blitz', 'bullet', 'daily', 'all'].includes(o.time)) throw new Error('--time must be rapid, blitz, bullet, daily or all');
  if(!o.games && !o.days && !o.months && !o.since) o.days = 30;
  return o;
}
// the oldest end time allowed by --days, --months and --since (the most recent of them), or 0
function cutoff(o, now = Date.now()){
  const c = [0];
  if(o.days) c.push(now - o.days * DAY);
  if(o.months){ const d = new Date(now); d.setMonth(d.getMonth() - o.months); c.push(d.getTime()); }
  if(o.since) c.push(Date.parse(o.since));
  return Math.max(...c);
}

/* ================= chess.com ================= */
async function get(url){
  const r = await fetch(url, {headers: {'User-Agent': 'chess-trainer analyse-games'}});
  if(r.status === 404) throw new Error('No chess.com player with this username.');
  if(!r.ok) throw new Error(`chess.com answered ${r.status} for ${url}`);
  return r.json();
}
// newest first, only standard chess of the chosen time class, within the cut-off and the --games count
async function fetchGames(o){
  const user = o.user.toLowerCase(), from = cutoff(o);
  const {archives = []} = await get(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  const out = [];
  for(let i = archives.length - 1; i >= 0; i--){
    const [y, m] = archives[i].split('/').slice(-2).map(Number);
    if(Date.UTC(y, m, 1) < from) break;   // the whole month ended before the cut-off
    const {games = []} = await get(archives[i]);
    for(const g of games.slice().reverse()){
      if(g.rules !== 'chess' || (o.time !== 'all' && g.time_class !== o.time)) continue;
      if(g.end_time * 1000 < from) continue;
      out.push(g); if(o.games && out.length >= o.games) return out;
    }
  }
  return out;
}

/* ================= Stockfish ================= */
class Engine {
  constructor(nodes){
    this.nodes = nodes; this.buf = ''; this.waiter = null; this.last = null; this.ready = null;
    this.p = spawn(process.execPath, [join(VENDOR, 'stockfish-19-lite-single.js')]);
    this.p.stdout.on('data', d => {
      this.buf += d; let i;
      while((i = this.buf.indexOf('\n')) >= 0){
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if(line.startsWith('info') && line.includes(' score ') && line.includes(' pv ')) this.last = line;
        else if(line.startsWith('bestmove') && this.waiter){ const w = this.waiter; this.waiter = null; w(line.split(' ')[1]); }
        else if(line === 'readyok' && this.ready){ const r = this.ready; this.ready = null; r(); }
      }
    });
    this.send('uci'); this.send('setoption name Hash value 32');
  }
  send(s){ this.p.stdin.write(s + '\n'); }
  isReady(){ return new Promise(r => { this.ready = r; this.send('isready'); }); }
  // score from the side to move, mate as ±(10000 - n)
  evaluate(fen){
    return new Promise(r => {
      this.last = null;
      this.waiter = best => {
        const m = this.last && this.last.match(/score (cp|mate) (-?\d+)/);
        const cp = !m ? 0 : m[1] === 'cp' ? +m[2] : +m[2] > 0 ? 10000 - +m[2] : -10000 - +m[2];
        r({cp, best});
      };
      this.send('position fen ' + fen); this.send(`go nodes ${this.nodes}`);
    });
  }
  quit(){ this.send('quit'); }
}

const clockOf = c => { const m = c.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
const header = (pgn, k) => (pgn.match(new RegExp(`\\[${k} "([^"]*)"`)) || [])[1] || '';
async function analyseGame(eng, g, user){
  const ch = new Chess();
  if(!ch.load_pgn(g.pgn || '')) return null;
  const moves = ch.history({verbose: true});
  const clocks = [...g.pgn.matchAll(/\[%clk ([0-9:.]+)\]/g)].map(m => clockOf(m[1]));
  const color = g.white.username.toLowerCase() === user.toLowerCase() ? 'w' : 'b';
  const me = color === 'w' ? g.white : g.black, opp = color === 'w' ? g.black : g.white;
  const b = new Chess(g.initial_setup || undefined), plies = [];
  let prev = await eng.evaluate(b.fen());
  for(let i = 0; i < moves.length; i++){
    const fen = b.fen(), t = new Chess(fen), u = prev.best;
    const bm = u && u !== '(none)' ? t.move({from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4]}) : null;
    b.move(moves[i].san);
    const next = b.in_checkmate() ? {cp: -10000} : b.game_over() ? {cp: 0} : await eng.evaluate(b.fen());
    plies.push({san: moves[i].san, mover: moves[i].color, before: prev.cp, after: -next.cp, best: bm ? bm.san : null, clock: clocks[i] ?? null, fen});
    prev = next;
  }
  return {url: g.url, end: g.end_time * 1000, timeClass: g.time_class, color, me: me.rating, opp: opp.username, oppRating: opp.rating,
    result: me.result, oppResult: opp.result, opening: openingName(header(g.pgn, 'ECOUrl') || g.eco), plies};
}

/* ================= reading the evaluations ================= */
const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);  // as Lichess
const VAL = {n: 3, b: 3, r: 5, q: 9};
const material = fen => [...fen.split(' ')[0]].reduce((a, c) => a + (VAL[c.toLowerCase()] || 0), 0);
const phaseOf = (ply, fen) => ply < 24 ? 'opening' : material(fen) <= 26 ? 'endgame' : 'middlegame';
const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', 'timevsinsufficient', '50move'];
const points = r => r === 'win' ? 1 : DRAWS.includes(r) ? 0.5 : 0;
const kindOf = loss => loss >= 30 ? 'blunder' : loss >= 20 ? 'mistake' : loss >= 10 ? 'inaccuracy' : null;
const clockBand = c => c == null ? 'unknown' : c < 60 ? 'under 1 min' : c < 180 ? '1–3 min' : 'over 3 min';
const moveLabel = (i, san) => `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'} ${san}`;
function openingName(ecoUrl){
  const slug = (ecoUrl || '').split('/openings/')[1] || '';
  const words = []; for(const w of slug.split('-')){ const m = w.match(/^(.*?)\.*\d+\./); if(m){ if(m[1]) words.push(m[1]); break; } words.push(w); }
  return decodeURIComponent(words.join(' ')) || 'Unknown opening';
}

// "Queens Gambit Accepted Rosenthal Variation" → "Queens Gambit Accepted": the name up to its variation
const FAMILY_END = /^(Defense|Defence|Gambit|Opening|Game|Attack|System|Accepted|Declined)$/;
function family(name){
  const w = name.split(' '); let end = -1;
  w.forEach((x, i) => { if(FAMILY_END.test(x) && i < 4) end = i; });
  if(end >= 0 && w[end + 1] && /^(Accepted|Declined)$/.test(w[end + 1])) end++;
  return end >= 0 ? w.slice(0, end + 1).join(' ') : w.slice(0, 2).join(' ');
}
// per game: its moves read from your side, its worst move, whether a win slipped away
function readGame(g){
  const out = {g, pts: points(g.result), mine: [], peak: 0, swing: null, worst: null, oppBlunders: 0, missed: 0};
  g.plies.forEach((p, i) => {
    const loss = winPct(p.before) - winPct(p.after);
    if(p.mover !== g.color){
      if(loss >= 30 && winPct(-p.after) >= 60 && g.plies[i + 1]){
        out.oppBlunders++;
        const q = g.plies[i + 1]; if(winPct(q.before) - winPct(q.after) >= 20) out.missed++;
      }
      return;
    }
    const next = g.plies[i + 1];
    const m = {i, san: p.san, best: p.best, loss, kind: kindOf(loss), phase: phaseOf(i, p.fen), clock: p.clock, before: p.before,
      allowsMate: p.after <= -9000 || (next && next.before >= 9000), allowsCapture: !!(next && next.best && next.best.includes('x'))};
    out.mine.push(m);
    out.peak = Math.max(out.peak, winPct(p.before));
    if(!out.worst || loss > out.worst.loss) out.worst = m;
    // the move that turned a game you did not win: from not lost to lost
    if(!out.swing && out.pts < 1 && winPct(p.before) > 30 && winPct(p.after) <= 20) out.swing = m;
  });
  // accuracy per move as Lichess computes it, averaged
  out.accuracy = out.mine.length ? out.mine.reduce((a, m) => a + Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, m.loss)) - 3.1669)), 0) / out.mine.length : null;
  out.thrown = out.pts < 1 && out.peak >= 85;
  return out;
}

const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
const pct1 = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '–';
const mmss = s => { if(s == null) return '–'; const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const dateOf = t => new Date(t).toISOString().slice(0, 10);
const resultWord = p => p === 1 ? 'won' : p === 0.5 ? 'drew' : 'lost';

function report(games, o){
  const G = games.map(readGame), n = G.length, L = [];
  const say = (...s) => L.push(s.join(''));
  if(!n){ say('No games found for this selection.'); return L.join('\n'); }
  const first = Math.min(...games.map(g => g.end)), last = Math.max(...games.map(g => g.end));
  const score = G.reduce((a, x) => a + x.pts, 0);
  say(`${o.user}: ${n} ${o.time === 'all' ? '' : o.time + ' '}game${n > 1 ? 's' : ''}, ${dateOf(first)} to ${dateOf(last)}`);
  say(`Rating ${games[games.length - 1].me} → ${games[0].me}. Score ${pct(score, n)} (${G.filter(x => x.pts === 1).length} won, ${G.filter(x => x.pts === .5).length} drawn, ${G.filter(x => x.pts === 0).length} lost).`);
  for(const c of ['w', 'b']){ const s = G.filter(x => x.g.color === c); if(s.length) say(`  as ${c === 'w' ? 'White' : 'Black'}: ${pct(s.reduce((a, x) => a + x.pts, 0), s.length)} in ${s.length}`); }
  const abandoned = G.filter(x => x.pts === 1 && x.g.oppResult === 'abandoned').length;
  if(abandoned) say(`  ${abandoned} win${abandoned > 1 ? 's' : ''} by abandonment.`);
  if(n < 20) say('  Few games: read the numbers below as hints, not patterns.');

  // where the points go
  const swings = G.filter(x => x.swing).map(x => x.swing), notWon = G.filter(x => x.pts < 1).length;
  say('\nWHERE THE GAMES YOU DID NOT WIN TURNED');
  if(swings.length){
    const by = k => ['opening', 'middlegame', 'endgame'].map(ph => `${ph} ${swings.filter(s => s.phase === ph).length}`).join(', ');
    say(`  ${swings.length} of ${notWon} turned on one move: ${by()}.`);
    const bands = ['over 3 min', '1–3 min', 'under 1 min'].map(b => `${b} ${swings.filter(s => clockBand(s.clock) === b).length}`).join(', ');
    say(`  Your clock at that move: ${bands}.`);
  } else say('  No single move turned these games.');
  const lostOnTime = G.filter(x => x.pts === 0 && x.g.result === 'timeout').length;
  say(`  Lost on time: ${lostOnTime}.`);

  // your moves
  const mine = G.flatMap(x => x.mine), count = k => mine.filter(m => m.kind === k).length;
  const blunders = mine.filter(m => m.kind === 'blunder');
  say('\nYOUR MOVES');
  say(`  Per game: ${(count('blunder') / n).toFixed(1)} blunders, ${(count('mistake') / n).toFixed(1)} mistakes, ${(count('inaccuracy') / n).toFixed(1)} inaccuracies. Games without a blunder: ${G.filter(x => !x.mine.some(m => m.kind === 'blunder')).length} of ${n}.`);
  say(`  Average accuracy (Lichess formula): ${Math.round(G.reduce((a, x) => a + (x.accuracy || 0), 0) / n)}%.`);
  for(const ph of ['opening', 'middlegame', 'endgame']){
    const ms = mine.filter(m => m.phase === ph); if(!ms.length) continue;
    say(`  ${ph.padEnd(10)}: ${String(ms.length).padStart(5)} moves, blunders ${pct1(ms.filter(m => m.kind === 'blunder').length, ms.length)} of moves, mistakes ${pct1(ms.filter(m => m.kind === 'mistake').length, ms.length)}`);
  }
  if(blunders.length){
    const cap = blunders.filter(m => !m.allowsMate && m.allowsCapture).length, mate = blunders.filter(m => m.allowsMate).length;
    say(`  Blunders: ${cap} left something to capture, ${mate} allowed a mate, ${blunders.length - cap - mate} missed another threat.`);
  }
  const ob = G.reduce((a, x) => a + x.oppBlunders, 0), missed = G.reduce((a, x) => a + x.missed, 0);
  say(`  Your opponents blundered ${ob} time${ob === 1 ? '' : 's'}; your reply let it go ${missed} time${missed === 1 ? '' : 's'}.`);

  // the clock
  say('\nTHE CLOCK');
  const clockAt = mv => median(G.map(x => { const m = x.mine.find(m => Math.floor(m.i / 2) + 1 === mv); return m ? m.clock : null; }));
  say(`  Your clock after move 15: ${mmss(clockAt(15))}, after move 30: ${mmss(clockAt(30))} (median).`);
  for(const b of ['over 3 min', '1–3 min', 'under 1 min']){
    const ms = mine.filter(m => clockBand(m.clock) === b); if(ms.length) say(`  With ${b.padEnd(11)} left: blunder on ${pct1(ms.filter(m => m.kind === 'blunder').length, ms.length)} of ${ms.length} moves`);
  }

  // won positions not won
  const thrown = G.filter(x => x.thrown);
  say('\nWINNING POSITIONS NOT WON');
  say(`  ${thrown.length} game${thrown.length === 1 ? '' : 's'} where you had 85%+ winning chances: ${thrown.filter(x => x.pts === 0).length} lost, ${thrown.filter(x => x.pts === .5).length} drawn.`);
  const stalemates = thrown.filter(x => x.g.result === 'stalemate').length;
  if(stalemates) say(`  ${stalemates} of the draws were stalemates.`);
  for(const x of thrown.slice(0, 6)){
    const s = x.mine.find(m => winPct(m.before) >= 70 && m.loss >= 30) || x.worst;
    say(`  ${dateOf(x.g.end)} ${resultWord(x.pts)} vs ${x.g.opp}: ${moveLabel(s.i, s.san)} (best ${s.best || '?'}), ${x.g.url}`);
  }

  // openings
  say('\nOPENINGS');
  const minGames = Math.max(2, Math.ceil(n / 40));
  const ops = new Map();
  for(const x of G){
    const k = (x.g.color === 'w' ? 'White: ' : 'Black: ') + family(x.g.opening), e = ops.get(k) || {n: 0, pts: 0, ev: []};
    e.n++; e.pts += x.pts;
    const at12 = x.g.plies[24]; if(at12) e.ev.push(Math.max(-1000, Math.min(1000, at12.mover === x.g.color ? at12.before : -at12.before)));
    ops.set(k, e);
  }
  const rows = [...ops].filter(([, e]) => e.n >= minGames).sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  if(!rows.length) say(`  No opening played ${minGames} times or more.`);
  for(const [k, e] of rows){
    const ev = e.ev.length ? Math.round(e.ev.reduce((a, v) => a + v, 0) / e.ev.length) : null;
    say(`  ${k.slice(0, 52).padEnd(52)} ${String(e.n).padStart(3)} games, score ${pct(e.pts, e.n).padStart(4)}, after move 12: ${ev == null ? '–' : (ev >= 0 ? '+' : '') + (ev / 100).toFixed(1)}`);
  }

  // each game, for a short selection
  if(n <= 30){
    say('\nGAMES (newest first)');
    for(const x of G){
      const w = x.worst, bl = x.mine.filter(m => m.kind === 'blunder').length;
      say(`  ${dateOf(x.g.end)} ${x.g.color === 'w' ? 'White' : 'Black'} ${resultWord(x.pts).padEnd(4)} vs ${x.g.opp} (${x.g.oppRating}), ${x.g.opening}`);
      say(`      accuracy ${Math.round(x.accuracy || 0)}%, ${bl} blunder${bl === 1 ? '' : 's'}${w && w.kind ? `, worst ${moveLabel(w.i, w.san)} (best ${w.best || '?'}, ${mmss(w.clock)} left)` : ''}  ${x.g.url}`);
    }
  }
  return L.join('\n');
}

/* ================= running ================= */
async function main(){
  let o;
  try{ o = parseArgs(process.argv.slice(2)); }catch(e){ console.error(e.message + '\n\n' + HELP); process.exit(1); }
  if(o.help || !o.user){ console.log(HELP); process.exit(o.help ? 0 : 1); }
  console.error(`Downloading ${o.user}'s games from chess.com…`);
  const raw = await fetchGames(o);
  console.error(`${raw.length} game${raw.length === 1 ? '' : 's'} selected.`);
  // games analysed before (same Stockfish effort) are read from the cache
  const dir = join(homedir(), '.cache', 'chess-trainer-analysis', o.user.toLowerCase()), file = join(dir, `nodes-${o.nodes}.json`);
  const cache = o.cache && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const todo = raw.filter(g => !cache[g.url]);
  if(todo.length){
    console.error(`Analysing ${todo.length} game${todo.length === 1 ? '' : 's'} with ${Math.min(o.workers, todo.length)} Stockfish cop${Math.min(o.workers, todo.length) === 1 ? 'y' : 'ies'}…`);
    let done = 0; const t0 = Date.now(), queue = [...todo];
    await Promise.all(Array.from({length: Math.min(o.workers, todo.length)}, async () => {
      const eng = new Engine(o.nodes); await eng.isReady();
      while(queue.length){
        const g = queue.shift();
        try{ const a = await analyseGame(eng, g, o.user); if(a) cache[g.url] = a; }catch(e){ console.error(`  skipped ${g.url}: ${e.message}`); }
        done++; process.stderr.write(`\r  ${done}/${todo.length} games, ${Math.round((Date.now() - t0) / 1000)}s`);
      }
      eng.quit();
    }));
    process.stderr.write('\n');
    mkdirSync(dir, {recursive: true}); writeFileSync(file, JSON.stringify(cache));
  }
  const games = raw.map(g => cache[g.url]).filter(Boolean);
  if(o.json) writeFileSync(o.json, JSON.stringify(games, null, 1));
  console.log(report(games, o));
  process.exit(0);
}

export { cutoff, family, kindOf, openingName, parseArgs, points, readGame, report, winPct };
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
