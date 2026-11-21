// Pure logic with no browser dependencies, covered by the tests in tests/.

/* ================= spaced repetition ================= */
// SM-2 style: the card's next interval, ease and due time after an answer ('again', 'hard' or 'good')
const DAY = 86400000;
function schedule(c, result, now){
  if(result === 'again'){ c.lapses++; c.reps = 0; c.ivl = 0; c.ease = Math.max(1.3, c.ease - 0.2); c.due = now + 10 * 60000; }
  else if(result === 'hard'){ c.ivl = Math.max(1, Math.round(c.ivl * 1.2)); c.ease = Math.max(1.3, c.ease - 0.15); c.due = now + c.ivl * DAY; }
  else { c.reps++; c.ivl = c.reps === 1 ? 1 : c.reps === 2 ? 3 : Math.max(c.ivl + 1, Math.round(c.ivl * c.ease)); c.ease = Math.min(3, c.ease + 0.05); c.due = now + c.ivl * DAY; }
  return c;
}

/* ================= merging progress ================= */
// newest card wins; returns true when something changed
function mergeCards(cards, extra){
  let changed = false;
  for(const [k, c] of Object.entries(extra || {})) if(!cards[k] || (c.seen || 0) > (cards[k].seen || 0)){ cards[k] = c; changed = true; }
  return changed;
}
// adds the entries of `extra` missing from `arr` (by key), keeps it sorted by time and at most `max` long
function unionInto(arr, extra, keyf, max = Infinity){
  const seen = new Set(arr.map(keyf)); let add = false;
  for(const e of extra || []) if(!seen.has(keyf(e))){ arr.push(e); seen.add(keyf(e)); add = true; }
  if(add){ arr.sort((a, b) => a[0] - b[0]); if(arr.length > max) arr.splice(0, arr.length - max); }
  return add;
}
// each device's time record: keep the larger count per day and activity
function mergeTime(timeLog, extra){
  let changed = false;
  for(const [dev, days] of Object.entries(extra || {})){ const mine = timeLog[dev] = timeLog[dev] || {};
    for(const [d, acts] of Object.entries(days || {})){ const md = mine[d] = mine[d] || {};
      for(const [a, sec] of Object.entries(acts || {})) if((md[a] || 0) < sec){ md[a] = sec; changed = true; } } }
  return changed;
}

/* ================= your games against your repertoire ================= */
// Follows a game's moves through the book (`candidates(fen)` lists the book moves) and says where it left it:
// {verdict, outAt}. verdict.kind: 'you' (you left the book), 'opp' (your opponent did), 'end' (the book ended),
// 'short' (the game ended in the book); null when the game never reached your opening (outAt: the opponent avoided it).
function repertoireExit(sans, color, candidates, Chess, maxPlies = 40){
  const g = new Chess();
  let entered = false, oppIn = false, verdict = null, outAt = null;
  for(let i = 0; i < sans.length && i < maxPlies; i++){
    const fen = g.fen(), c = candidates(fen);
    if(!c.length){ if(entered) verdict = {kind: 'end', ply: i}; break; }
    const mine = g.turn() === color, played = sans[i];
    if(!c.some(x => x.san === played)){
      if(!mine && !oppIn){ outAt = {ply: i, played}; break; }   // the opponent avoided your opening right away
      verdict = mine ? {kind: 'you', ply: i, fen, played, best: c.slice(0, 3).map(x => x.san), path: sans.slice(0, i)} : {kind: 'opp', ply: i, played};
      break;
    }
    if(mine) entered = true; else oppIn = true;
    g.move(played);
  }
  if(!verdict && entered && oppIn) verdict = {kind: 'short', ply: Math.min(sans.length, maxPlies)};  // the game ended while still in the book
  return {verdict: verdict && entered && oppIn ? verdict : null, outAt};
}

/* ================= chess.com ================= */
// chess.com rating to Lichess rating, same strength (approximate, from published comparisons)
const CC_TO_LICHESS = [[400, 900], [800, 1250], [1200, 1550], [1600, 1850], [2000, 2150], [2400, 2500], [2800, 2850]];
function toLichessRating(cc){
  const t = CC_TO_LICHESS;
  if(cc <= t[0][0]) return t[0][1] - (t[0][0] - cc);
  for(let i = 1; i < t.length; i++){
    const [x0, y0] = t[i - 1], [x1, y1] = t[i];
    if(cc <= x1) return Math.round(y0 + (cc - x0) * (y1 - y0) / (x1 - x0));
  }
  return cc + (t[t.length - 1][1] - t[t.length - 1][0]);
}
// the Lichess explorer's rating groups closest to a rating: its own group and the nearer neighbour
const RATING_GROUPS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
function ratingGroups(r){
  const G = RATING_GROUPS;
  if(r < G[0]) return [G[0], G[1]];
  let i = G.length - 1; while(G[i] > r) i--;
  if(i === G.length - 1) return [G[i - 1], G[i]];
  const upper = r - G[i] >= (G[i + 1] - G[i]) / 2;
  return upper || i === 0 ? [G[i], G[i + 1]] : [G[i - 1], G[i]];
}
// the time control you play most on chess.com, from /pub/player/{user}/stats
const CC_CLASSES = {chess_bullet: 'bullet', chess_blitz: 'blitz', chess_rapid: 'rapid', chess_daily: 'daily'};
function mostPlayed(stats){
  let best = null;
  for(const [k, tc] of Object.entries(CC_CLASSES)){
    const s = stats && stats[k]; if(!s || !s.last) continue;
    const r = s.record || {}, games = (r.win || 0) + (r.loss || 0) + (r.draw || 0);
    if(!best || games > best.games) best = {timeClass: tc, rating: s.last.rating, games};
  }
  return best;
}
// Lichess explorer speeds for a chess.com time class
const SPEEDS_FOR = {bullet: ['bullet'], blitz: ['blitz'], rapid: ['rapid', 'classical'], daily: ['correspondence']};

/* ================= games from both sites, in one shape ================= */
// {site, id, url, analyse, variant, myColor, oppName, speed, rated, createdAt, sans, opening}
function normLichessGame(gm, me){
  const wName = ((gm.players.white.user || {}).name || '').toLowerCase();
  const myColor = wName === me.toLowerCase() ? 'w' : 'b';
  const opp = myColor === 'w' ? gm.players.black : gm.players.white;
  const url = 'https://lichess.org/' + encodeURIComponent(gm.id);
  return {site: 'Lichess', id: gm.id, url, analyse: url + (myColor === 'w' ? '/white' : '/black'), variant: gm.variant || 'standard', myColor,
    oppName: (opp.user && opp.user.name) || (opp.aiLevel ? 'Stockfish level ' + opp.aiLevel : 'Anonymous'),
    speed: gm.speed || '', rated: !!gm.rated, createdAt: gm.createdAt, sans: (gm.moves || '').split(' ').filter(Boolean), opening: (gm.opening && gm.opening.name) || ''};
}
// the opening's name from chess.com's link: ".../Sicilian-Defense-Najdorf-Variation-6.Be3" gives "Sicilian Defense Najdorf Variation"
function ccOpening(ecoUrl){
  const slug = (ecoUrl || '').split('/openings/')[1] || '';
  const words = []; for(const w of slug.split('-')){ if(/^\d+\./.test(w)) break; words.push(w); }
  return decodeURIComponent(words.join(' '));
}
function normChesscomGame(g, me, Chess){
  const myColor = (g.white.username || '').toLowerCase() === me.toLowerCase() ? 'w' : 'b';
  const opp = myColor === 'w' ? g.black : g.white;
  const ch = new Chess(), standardStart = !g.initial_setup || g.initial_setup === ch.fen();
  const ok = g.rules === 'chess' && standardStart && ch.load_pgn(g.pgn || '');
  return {site: 'chess.com', id: g.uuid || g.url, url: g.url, analyse: g.url, variant: ok ? 'standard' : g.rules === 'chess' ? 'unreadable' : g.rules, myColor,
    oppName: opp.username || 'Anonymous', speed: g.time_class || '', rated: !!g.rated, createdAt: (g.end_time || 0) * 1000, sans: ok ? ch.history() : [], opening: ccOpening(g.eco)};
}

/* ================= punishing common mistakes ================= */
// your side's score with a move from the explorer ({white, draws, black} as shares of that move's games)
const scoreWith = (m, color) => color === 'w' ? m.white + m.draws / 2 : m.black + m.draws / 2;
// opponent moves that are common at your level and after which your side scores clearly better than usual:
// suspects, to be confirmed by Stockfish. `color` is your colour.
function mistakeSuspects(moves, color, {minShare = 0.04, minGames = 30, gain = 0.04} = {}){
  const tot = moves.reduce((a, m) => a + m.n, 0); if(!tot) return [];
  const usual = moves.reduce((a, m) => a + m.n * scoreWith(m, color), 0) / tot;
  return moves.filter(m => m.share >= minShare && m.n >= minGames && scoreWith(m, color) - usual >= gain)
    .map(m => ({san: m.san, share: m.share, n: m.n, score: scoreWith(m, color), usual}));
}
// confirmed by Stockfish (centipawns, your point of view): the move gives away at least 0.7 and leaves you clearly better
const isMistake = (loss, yourEval) => loss >= 70 && yourEval >= 50;
// your reply: 'punished' keeps nearly all of the advantage, 'partly' stays clearly better, 'missed' lets it go
function punishVerdict(best, you){
  if(you >= best - Math.max(60, best * 0.2)) return 'punished';
  return you >= 50 ? 'partly' : 'missed';
}

export { RATING_GROUPS, SPEEDS_FOR, isMistake, mistakeSuspects, punishVerdict, ccOpening, mergeCards, mergeTime, mostPlayed, normChesscomGame, normLichessGame, ratingGroups, repertoireExit, schedule, toLichessRating, unionInto };
