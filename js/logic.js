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

export { mergeCards, mergeTime, repertoireExit, schedule, unionInto };
