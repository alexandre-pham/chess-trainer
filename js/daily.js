// Today's practice plan, master games and the check of your own games.
import { $, esc, posKey, store } from './util.js';
import { LINES, POS } from './data.js';
import { S, candidates, selFamilies } from './book.js';
import { cards, dueCards, relevantCards, saveCards } from './srs.js';
import { previewLine, renderSetup } from './setup.js';
import { Sync } from './sync.js';
import { Explorer } from './explorer.js';
import { Coach, GROUND, LANG, cancelCoach, historyText, pieceLists, renderCoach } from './coach.js';
import { enterTraining, startLine, startReview, startReviewKey } from './trainer.js';
import { C, fmtMoves, openCoords } from './squares.js';
import { R, openReview } from './review.js';
import { dayKey, fmtDay } from './progress.js';

/* ================= daily practice ================= */
// A plan for each day, built from widely shared study advice: short daily sessions, warm up, clear your reviews
// before adding new lines, work on your repeated mistakes, learn the plans and not only the moves, and check your own games.
const BUDGETS = {
  10: {warm: 1, review: 10, newLines: 1, weak: 0, ideas: false},
  20: {warm: 2, review: 20, newLines: 2, weak: 3, ideas: true},
  30: {warm: 2, review: 30, newLines: 3, weak: 5, ideas: true}
};
const Daily = {
  plan: store.get('daily', null), days: store.get('dailyDays', []), budget: store.get('dailyBudget', 20), active: null, weakQueue: [],
  today(){ return dayKey(Date.now()); },
  ensure(){
    const sel = (S.sel[0] || '') + '|' + S.color;
    if(this.plan && this.plan.date === this.today() && this.plan.sel === sel && this.plan.budget === this.budget) return this.plan;
    const keep = this.plan && this.plan.date === this.today() && this.plan.sel === sel ? this.plan : null;  // budget changed: keep counts
    const B = BUDGETS[this.budget], due = dueCards().length;
    const hard = relevantCards().filter(([k, c]) => c.lapses > 0).length;
    const steps = [
      {id: 'warm', title: 'Warm up on the squares', why: 'A short speed round makes reading and finding squares automatic, so your attention stays on the chess.', target: B.warm, unit: 'speed round'},
      {id: 'review', title: 'Review what is due', why: 'Positions come back just before you would forget them. Clearing these first protects what you have already learned.', target: Math.min(due, B.review), unit: 'position'},
      {id: 'new', title: 'Learn new lines', why: due > B.review * 2 ? 'Skipped today: you have a large review backlog, and adding new lines on top of it makes everything harder to retain.' : 'A few new lines a day, not more: small steps stick better than long cramming sessions.', target: due > B.review * 2 ? 0 : B.newLines, unit: 'line'},
      {id: 'weak', title: 'Fix your repeated mistakes', why: 'The positions you have missed most get focused, repeated practice.', target: Math.min(B.weak, hard), unit: 'position'},
      {id: 'ideas', title: 'Understand the plans', why: 'Knowing why the moves are played lets you find good moves when your opponent leaves the book.', target: B.ideas ? 1 : 0, unit: 'read'},
      {id: 'games', title: 'Check your own games', why: 'Comparing your recent games with your repertoire shows exactly where you went wrong in real play.', target: Explorer.enabled() ? 1 : 0, unit: 'check'}
    ].filter(s => s.target > 0);
    steps.forEach(s => { const old = keep && keep.steps.find(o => o.id === s.id); s.done = old ? Math.min(old.done, s.target) : 0; });
    this.plan = {date: this.today(), sel, budget: this.budget, steps};
    this.save(); return this.plan;
  },
  save(){ store.set('daily', this.plan); },
  step(id){ return this.plan && this.plan.steps.find(s => s.id === id); },
  count(id, n){
    const s = this.step(id); if(!s || this.active !== id) return;
    s.done = Math.min(s.target, s.done + (n || 1)); this.save();
    if(this.plan.steps.every(x => x.done >= x.target) && !this.days.includes(this.plan.date)){
      this.days.push(this.plan.date); store.set('dailyDays', this.days); if(window.Sync) Sync.schedule();
    }
    renderDayBar();
  },
  streak(){
    const set = new Set(this.days); let n = 0; const d = new Date();
    if(!set.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);  // today not finished yet: count up to yesterday
    while(set.has(dayKey(d.getTime()))){ n++; d.setDate(d.getDate() - 1); }
    return n;
  }
};
function stepLabel(s){ return `${s.done} of ${s.target} ${s.unit}${s.target > 1 ? 's' : ''}`; }
function renderToday(){
  if(!S.sel.length){ $('tdPlan').innerHTML = '<div class="pg-panel"><p style="margin:0">Choose an opening first: the plan is built around it.</p><div class="inline" style="margin-top:10px"><button class="btn primary" id="tdPick">Choose an opening</button></div></div>'; $('tdPick').onclick = () => { closeToday(true); }; $('tdHead').textContent = ''; return; }
  const plan = Daily.ensure(), streak = Daily.streak();
  const mins = `About ${Daily.budget} minutes.`;
  $('tdHead').innerHTML = `${esc(S.sel[0])}, as ${S.color === 'w' ? 'White' : 'Black'}. ${mins} ${streak ? `<b>${streak}-day streak.</b>` : ''}`;
  $('tdBudget').innerHTML = [10, 20, 30].map(m => `<button data-bud="${m}" aria-pressed="${Daily.budget === m}">${m} min</button>`).join('');
  $('tdBudget').querySelectorAll('[data-bud]').forEach(b => b.onclick = () => { Daily.budget = +b.dataset.bud; store.set('dailyBudget', Daily.budget); renderToday(); });
  const firstOpen = plan.steps.find(s => s.done < s.target);
  $('tdPlan').innerHTML = plan.steps.map((s, i) => {
    const done = s.done >= s.target;
    return `<div class="td-step ${done ? 'is-done' : ''} ${s === firstOpen ? 'is-next' : ''}">
      <div class="td-num">${done ? '✓' : i + 1}</div>
      <div class="td-body"><div class="td-title">${esc(s.title)}</div><div class="td-why">${esc(s.why)}</div><div class="td-count">${stepLabel(s)}</div></div>
      <div><button class="btn ${s === firstOpen ? 'primary' : ''}" data-step="${s.id}">${done ? 'Again' : s.done ? 'Continue' : 'Start'}</button></div>
    </div>`;
  }).join('') + (firstOpen ? '' : '<div class="pg-panel td-done"><b>Today\'s practice is complete.</b> Come back tomorrow to keep your streak going.</div>');
  $('tdPlan').querySelectorAll('[data-step]').forEach(b => b.onclick = () => runStep(b.dataset.step));
  // last two weeks
  const set = new Set(Daily.days), cells = [];
  for(let i = 13; i >= 0; i--){ const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d.getTime()); cells.push(`<span class="td-day ${set.has(k) ? 'on' : ''}" title="${fmtDay(k)}">${d.toLocaleDateString(undefined, {weekday: 'narrow'})}</span>`); }
  $('tdDays').innerHTML = cells.join('');
}
function runStep(id){
  Daily.active = id;
  const s = Daily.step(id);
  if(id === 'warm'){ C.mode = 'speed'; C.side = S.color; openCoords(); return; }
  if(id === 'review'){ enterTraining(); startReview(); return; }
  if(id === 'new'){ enterTraining(); startLine(); return; }
  if(id === 'weak'){
    Daily.weakQueue = relevantCards().filter(([k, c]) => c.lapses > 0).sort((a, b) => b[1].lapses - a[1].lapses).slice(0, s.target).map(x => x[0]);
    enterTraining(); nextWeak(); return;
  }
  if(id === 'ideas'){ showIdeas(); return; }
  if(id === 'games'){ checkGames(); return; }
}
function nextWeak(){ const k = Daily.weakQueue.shift(); if(k) startReviewKey(k); else startLine(); }
// the bar shown on the training and squares pages while a step is running
function renderDayBar(){
  document.querySelectorAll('.daybar').forEach(el => {
    const s = Daily.active && Daily.step(Daily.active);
    if(!s){ el.hidden = true; return; }
    el.hidden = false;
    const done = s.done >= s.target;
    el.innerHTML = `<span>Today: <b>${esc(s.title)}</b>, ${stepLabel(s)}${done ? '. Done.' : ''}</span><button class="btn ${done ? 'primary' : 'quiet'}">${done ? 'Next step' : 'Back to the plan'}</button>`;
    el.querySelector('button').onclick = openToday;
  });
}
// "Understand the plans": the coach explains the main position, plus master games to replay
async function showIdeas(){
  openToday(true);
  const line = previewLine(S.sel[0]) || LINES[0];
  const g = new Chess(); line[2].split(' ').forEach(m => g.move(m));
  const box = $('tdExtra'); box.hidden = false;
  box.innerHTML = `<div class="pg-panel"><h2>The plans in ${esc(line[1])}</h2><div class="td-moves">${esc(fmtMoves(line[2].split(' '), 0).join(' '))}</div><div id="tdIdeasText" class="coach">${Coach.available() ? 'Asking the coach…' : 'Turn on the coach in the setup page to get an explanation here.'}</div><div id="tdGamesList"></div><div class="inline" style="margin-top:12px"><button class="btn primary" id="tdIdeasDone">Done</button></div></div>`;
  $('tdIdeasDone').onclick = () => { Daily.count('ideas'); box.hidden = true; renderToday(); };
  box.scrollIntoView({block: 'start'});
  // master games that reached this position (needs the Lichess connection)
  if(Explorer.enabled()){
    try{
      const res = await fetch(`https://explorer.lichess.ovh/masters?topGames=4&moves=0&fen=${encodeURIComponent(g.fen())}`, {headers: {Authorization: 'Bearer ' + S.token}});
      if(res.ok){
        const j = await res.json(), tg = j.topGames || [];
        if(tg.length) $('tdGamesList').innerHTML = '<p style="margin:14px 0 6px;font-weight:600">Master games from this position, to replay on Lichess:</p><ul class="td-games">' + tg.map(t => `<li><a href="https://lichess.org/${encodeURIComponent(t.id)}" target="_blank" rel="noopener">${esc(t.white.name)} – ${esc(t.black.name)}</a>, ${esc(String(t.year || ''))} (${t.winner === 'white' ? '1–0' : t.winner === 'black' ? '0–1' : '½–½'})</li>`).join('') + '</ul>';
      }
    }catch(e){}
  }
  if(!Coach.available()) return;
  const color = S.color === 'w' ? 'White' : 'Black';
  const prompt = `The student plays ${color} in ${line[1]}.
Main line: ${historyText(line[2].split(' '))}
Pieces in the resulting position:
${pieceLists(g)}

In ${LANG[S.lang]}, explain in 5 to 7 short sentences the typical plans for ${color} in this position: where the pieces usually go, which pawn breaks matter, and what the opponent aims for. ${GROUND} Plain text, no markdown, no lists.`;
  try{
    const info = {coach: '', coachState: 'thinking', prompt, thread: [], fens: [g.fen()]}; window.__ideasInfo = info;
    const el = () => $('tdIdeasText');
    const r = await Coach.run(prompt, {onText: ({text}) => { if(text){ info.coach = text; info.coachState = 'streaming'; renderCoach(info, el()); } }});
    info.coach = r.text; info.coachState = 'done'; renderCoach(info, el());
  }catch(e){ const el = $('tdIdeasText'); if(el) el.textContent = e.message || 'The coach could not answer.'; }
}
// "Check your own games": where did you leave your repertoire in your recent Lichess games?
async function checkGames(){
  openToday(true);
  const box = $('tdExtra'); box.hidden = false;
  box.innerHTML = '<div class="pg-panel"><h2>Your recent games</h2><div id="tdGamesOut">Loading your games from Lichess…</div><div class="inline" style="margin-top:12px"><button class="btn primary" id="tdGamesDone">Done</button></div></div>';
  $('tdGamesDone').onclick = () => { Daily.count('games'); box.hidden = true; renderToday(); };
  box.scrollIntoView({block: 'start'});
  const out = $('tdGamesOut');
  try{
    let user = S.user;
    if(!user || user === 'Lichess'){
      const a = await fetch('https://lichess.org/api/account', {headers: {Authorization: 'Bearer ' + S.token}});
      if(a.ok){ user = (await a.json()).username; S.user = user; store.set('user', user); }
    }
    if(!user) throw new Error('Could not find your Lichess username.');
    // all recent finished games (any speed, rated or casual); each one is either analysed or listed with the reason it was left out
    const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=30&opening=true&moves=true&clocks=false&evals=true`,
      {headers: {Authorization: 'Bearer ' + S.token, Accept: 'application/x-ndjson'}});
    if(!res.ok) throw new Error('Lichess answered with an error (' + res.status + ').');
    const games = (await res.text()).split('\n').filter(Boolean).map(l => { try{ return JSON.parse(l); }catch(e){ return null; } }).filter(Boolean);
    const me = user.toLowerCase(), colorName = c => c === 'w' ? 'White' : 'Black';
    const mv = n => `${Math.floor(n / 2) + 1}${n % 2 ? '…' : '.'}`;
    const rows = [], others = [];
    for(const gm of games){
      const wName = ((gm.players.white.user || {}).name || '').toLowerCase();
      const myColor = wName === me ? 'w' : 'b';
      const opp = myColor === 'w' ? gm.players.black : gm.players.white;
      const oppName = (opp.user && opp.user.name) || (opp.aiLevel ? 'Stockfish level ' + opp.aiLevel : 'Anonymous');
      const opening = gm.opening && gm.opening.name ? gm.opening.name : '';
      const sans = (gm.moves || '').split(' ').filter(Boolean);
      const base = {gm, oppName};
      if(gm.variant && gm.variant !== 'standard'){ others.push({...base, why: `${gm.variant} variant`}); continue; }
      if(myColor !== S.color){ others.push({...base, why: `you had ${colorName(myColor)}${opening ? ` (${opening})` : ''}`}); continue; }
      const g = new Chess();
      let entered = false, oppIn = false, verdict = null, outAt = null;
      for(let i = 0; i < sans.length && i < 40; i++){
        const fen = g.fen(), c = candidates(fen);
        if(!c.length){ if(entered) verdict = {kind: 'end', ply: i}; break; }
        const mine = g.turn() === S.color, played = sans[i];
        if(!c.some(x => x.san === played)){
          if(!mine && !oppIn){ outAt = {ply: i, played}; break; }   // the opponent avoided your opening right away
          verdict = mine ? {kind: 'you', ply: i, fen, played, best: c.slice(0, 3).map(x => x.san), path: sans.slice(0, i)} : {kind: 'opp', ply: i, played};
          break;
        }
        if(mine) entered = true; else oppIn = true;
        g.move(played);
      }
      if(!verdict && entered && oppIn) verdict = {kind: 'short', ply: Math.min(sans.length, 40)};  // the game ended while still in the book
      if(!verdict || !entered || !oppIn){
        others.push({...base, why: outAt ? `your opponent avoided your opening with ${mv(outAt.ply)} ${outAt.played}${opening ? ` (${opening})` : ''}` : sans.length < 2 ? 'too short' : `a different opening${opening ? `: ${opening}` : ''}`});
        continue;
      }
      rows.push({...base, verdict, mv});
    }
    const dateOf = gm => new Date(gm.createdAt).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
    const kindOf = gm => `${esc(gm.speed || '')}${gm.rated ? '' : ', casual'}`;
    const link = (gm, name) => `<a href="https://lichess.org/${encodeURIComponent(gm.id)}" target="_blank" rel="noopener">vs ${esc(name)}</a>`;
    const otherHtml = others.length ? `<details style="margin-top:10px"><summary>${others.length} other recent game${others.length > 1 ? 's' : ''}, not in ${esc(S.sel[0])} as ${colorName(S.color)}</summary><ul class="hard">` +
      others.map(o => `<li><div><div class="hm">${link(o.gm, o.oppName)}, ${kindOf(o.gm)}, ${dateOf(o.gm)}</div><div class="hs">Left out: ${esc(o.why)}.</div></div><button class="btn" data-review="${esc(o.gm.id)}">Review</button></li>`).join('') + '</ul></details>' : '';
    const note = `<p class="help" style="color:var(--muted);margin:10px 0 0">Your last ${games.length} finished games on Lichess, all speeds. A game still in progress appears once it is over.</p>`;
    if(!rows.length){ out.innerHTML = `<p style="margin:0">None of your last ${games.length} games reached ${esc(S.sel[0])} with you as ${colorName(S.color)}.</p>` + otherHtml + note; return; }
    const yours = rows.filter(r => r.verdict.kind === 'you');
    out.innerHTML = `<p style="margin:0 0 8px">${rows.length} recent game${rows.length > 1 ? 's' : ''} in this opening. You left your repertoire in ${yours.length}.</p><ul class="hard">` + rows.map((r, i) => {
      const v = r.verdict;
      const what = v.kind === 'you' ? `You played <b>${r.mv(v.ply)} ${esc(v.played)}</b>; the book continues ${v.best.map(esc).join(', ')}.`
        : v.kind === 'opp' ? `Your opponent left the book with ${r.mv(v.ply)} ${esc(v.played)}. You were on track until then.`
        : v.kind === 'short' ? 'The game ended while you were still in the book.' : `You followed the book until it ended at move ${Math.floor(v.ply / 2) + 1}.`;
      return `<li><div><div class="hm">${link(r.gm, r.oppName)}, ${kindOf(r.gm)}, ${dateOf(r.gm)}</div><div class="hs" style="font-size:13.5px;color:var(--ink)">${what}</div></div><div class="inline" style="flex:none"><button class="btn primary" data-review="${esc(r.gm.id)}">Review</button>${v.kind === 'you' ? `<button class="btn" data-fix="${i}">Practise</button>` : ''}</div></li>`;
    }).join('') + '</ul>' + otherHtml + note;
    out.querySelectorAll('[data-review]').forEach(b => b.onclick = () => { const gm = games.find(x => x.id === b.dataset.review); if(gm) openReview(gm); });
    out.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => {
      const v = rows[+b.dataset.fix].verdict, key = posKey(v.fen);
      // make it a review card that is due now, then practise it
      const g = new Chess(); v.path.forEach(m => g.move(m)); let name = ''; const gg = new Chess();
      for(const m of v.path){ gg.move(m); const p = POS[posKey(gg.fen())]; if(p && p[1]) name = LINES[p[0]][1]; }
      if(!cards[key]) cards[key] = {path: v.path, color: S.color, fams: [...selFamilies()], name, ease: 2.5, ivl: 0, reps: 0, lapses: 1, due: 0, seen: Date.now()};
      else { cards[key].due = 0; cards[key].lapses = Math.max(1, cards[key].lapses); }
      saveCards(); Daily.count('games'); Daily.active = null; enterTraining(); startReviewKey(key);
    });
  }catch(e){ out.textContent = (e && e.message) || 'Could not load your games.'; }
}
let tdFrom = 'setup';
function openToday(keepActive, keepExtra){
  if(!keepActive) Daily.active = null;
  cancelCoach(); clearInterval(C.timer); C.timer = null; C.round = null;
  ['setup', 'train', 'progress', 'coords', 'review'].forEach(id => $(id).hidden = true); R.token++;
  $('today').hidden = false; if(!keepExtra) $('tdExtra').hidden = true;
  $('toSetup').hidden = true; $('toToday').hidden = true; $('toCoords').hidden = false; $('toProgress').hidden = false;
  renderToday(); renderDayBar(); if(keepExtra && !$('tdExtra').hidden) $('tdExtra').scrollIntoView({block: 'start'}); else window.scrollTo(0, 0);
}
function closeToday(toSetup){ $('today').hidden = true; $('toToday').hidden = false; $('setup').hidden = false; renderSetup(); }

export { Daily, nextWeak, openToday, renderDayBar };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  $('toToday').onclick = () => openToday();
  $('tdBack').onclick = () => closeToday();
}
export { init };
