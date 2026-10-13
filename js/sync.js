// Merging progress from a file or another device, and GitHub Gist sync.
import { $, esc, store } from './util.js';
import { cards, moveLog } from './srs.js';
import { renderSel } from './setup.js';
import { game, renderStatus } from './trainer.js';
import { coordLog, coordRounds } from './squares.js';
import { Daily } from './daily.js';
import { timeLog } from './progress.js';

/* ---- merging progress from another device or file: newest card wins, histories are combined ---- */
function mergeProgress(data){
  let changed = false;
  for(const [k, c] of Object.entries(data.cards || {})) if(!cards[k] || (c.seen || 0) > (cards[k].seen || 0)){ cards[k] = c; changed = true; }
  if(Array.isArray(data.log)){
    const key = e => e[0] + '|' + e[1] + '|' + e[2], seen = new Set(moveLog.map(key));
    for(const e of data.log) if(!seen.has(key(e))){ moveLog.push(e); seen.add(key(e)); changed = true; }
    if(changed){ moveLog.sort((a,b) => a[0] - b[0]); if(moveLog.length > 30000) moveLog.splice(0, moveLog.length - 30000); }
  }
  // coordinate answers and speed rounds: combine both histories
  const unionInto = (arr, extra, keyf) => { const seen = new Set(arr.map(keyf)); let add = false; for(const e of extra || []) if(!seen.has(keyf(e))){ arr.push(e); seen.add(keyf(e)); add = true; } if(add) arr.sort((a,b) => a[0] - b[0]); return add; };
  if(typeof coordLog !== 'undefined'){
    if(unionInto(coordLog, data.coordLog, e => e[0] + '|' + e[2])){ if(coordLog.length > 30000) coordLog.splice(0, coordLog.length - 30000); store.set('coordLog', coordLog); changed = true; }
    if(unionInto(coordRounds, data.coordRounds, e => e[0] + '|' + e[1])){ store.set('coordRounds', coordRounds); changed = true; }
    if(data.time && typeof data.time === 'object'){
      // each device's record: keep the larger count per day and activity
      for(const [dev, days] of Object.entries(data.time)){ const mine = timeLog[dev] = timeLog[dev] || {};
        for(const [d, acts] of Object.entries(days || {})){ const md = mine[d] = mine[d] || {};
          for(const [a, sec] of Object.entries(acts || {})) if((md[a] || 0) < sec){ md[a] = sec; changed = true; } } }
      if(changed) store.set('time', timeLog);
    }
    if(Array.isArray(data.dailyDays)){ const add = data.dailyDays.filter(d => !Daily.days.includes(d)); if(add.length){ Daily.days.push(...add); Daily.days.sort(); store.set('dailyDays', Daily.days); changed = true; } }
  }
  if(changed){ store.set('cards', cards); store.set('log', moveLog); }
  return changed;
}

/* ================= GitHub Gist sync ================= */
// Progress lives in one secret gist in your account; every browser with your token reads and writes it.
const GIST_FILE = 'opening-trainer-progress.json';
const Sync = window.Sync = {
  token: store.get('ghToken', ''), gistId: store.get('ghGist', ''), login: store.get('ghLogin', ''),
  state: 'idle', last: store.get('ghLast', 0), error: '', timer: null, busy: null, dirty: false,
  connected(){ return !!(this.token && this.gistId); },
  async api(path, opts = {}){
    const res = await fetch('https://api.github.com' + path, Object.assign({}, opts, {headers: Object.assign({
      Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}, opts.body ? {'Content-Type': 'application/json'} : {})}));
    if(res.status === 401) throw new Error('GitHub refused the token. Check that it is valid and not expired.');
    if(res.status === 403 || res.status === 404) throw new Error('The token cannot use gists. Give it read and write access to Gists.');
    if(!res.ok) throw new Error('GitHub answered with an error (' + res.status + ').');
    return res.status === 204 ? null : res.json();
  },
  payload(){ return JSON.stringify({app: 'opening-trainer', version: 5, updated: Date.now(), cards, log: moveLog, coordLog, coordRounds, dailyDays: Daily.days, time: timeLog}); },
  async readRemote(){
    const g = await this.api('/gists/' + this.gistId);
    const f = g.files && g.files[GIST_FILE];
    if(!f) return null;
    let text = f.content;
    if(f.truncated){ const r = await fetch(f.raw_url); text = await r.text(); }  // large files are not inlined
    try{ return JSON.parse(text); }catch(e){ return null; }
  },
  async connect(token){
    this.token = token.trim(); this.state = 'working'; this.error = ''; renderSync();
    try{
      try{ const u = await this.api('/user'); this.login = u.login || ''; }catch(e){ if(/refused/.test(e.message)) throw e; this.login = ''; }
      // reuse the progress gist if one exists, otherwise create it
      let found = null;
      for(let page = 1; page <= 10 && !found; page++){
        const list = await this.api('/gists?per_page=100&page=' + page);
        found = list.find(g => g.files && g.files[GIST_FILE]);
        if(list.length < 100) break;
      }
      if(found) this.gistId = found.id;
      else {
        const g = await this.api('/gists', {method: 'POST', body: JSON.stringify({description: 'Opening Trainer progress', public: false, files: {[GIST_FILE]: {content: this.payload()}}})});
        this.gistId = g.id;
      }
      store.set('ghToken', this.token); store.set('ghGist', this.gistId); store.set('ghLogin', this.login);
      await this.syncNow();
    }catch(e){ this.state = 'error'; this.error = e.message; this.token = ''; this.gistId = ''; renderSync(); }
  },
  disconnect(){ clearTimeout(this.timer); ['ghToken','ghGist','ghLogin','ghLast'].forEach(k => store.set(k, k === 'ghLast' ? 0 : '')); this.token = this.gistId = this.login = ''; this.state = 'idle'; renderSync(); },
  // pull, merge, push. Runs one at a time.
  syncNow(){
    if(!this.connected()) return Promise.resolve();
    if(this.busy){ this.dirty = true; return this.busy; }
    clearTimeout(this.timer); this.dirty = false; this.state = 'working'; renderSync();
    this.busy = (async () => {
      try{
        const remote = await this.readRemote();
        const gotNew = remote ? mergeProgress(remote) : false;
        const localNewer = !remote || JSON.stringify(remote.cards) !== JSON.stringify(cards) || (remote.log || []).length !== moveLog.length || (remote.coordLog || []).length !== coordLog.length || (remote.coordRounds || []).length !== coordRounds.length || (remote.dailyDays || []).length !== Daily.days.length || JSON.stringify(remote.time || {}) !== JSON.stringify(timeLog);
        if(localNewer) await this.api('/gists/' + this.gistId, {method: 'PATCH', body: JSON.stringify({files: {[GIST_FILE]: {content: this.payload()}}})});
        this.state = 'ok'; this.error = ''; this.last = Date.now(); store.set('ghLast', this.last);
        if(gotNew){ if(!$('setup').hidden) renderSel(); else if(!$('train').hidden && game) renderStatus(); }
      }catch(e){ this.state = 'error'; this.error = e.message; }
      this.busy = null; renderSync();
      if(this.dirty) this.schedule(1500);
    })();
    return this.busy;
  },
  schedule(ms){ if(!this.connected()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.syncNow(), ms || 4000); }
};
function renderSync(){
  const el = $('syncBox'); if(!el) return;
  if(Sync.connected()){
    const when = Sync.last ? new Date(Sync.last).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'}) : '';
    const line = Sync.state === 'working' ? 'Syncing…' : Sync.state === 'error' ? Sync.error : when ? `Last synced at ${when}.` : '';
    el.innerHTML = `<div class="who"><span>Synced with GitHub${Sync.login ? ` as <b>${esc(Sync.login)}</b>` : ''}</span><button class="btn quiet" id="syncOut">Disconnect</button></div>
      <div class="conn ${Sync.state === 'error' ? 'err' : ''}">${esc(line)}</div>
      <div class="inline" style="margin-top:6px"><button class="btn" id="syncNow">Sync now</button></div>`;
    $('syncOut').onclick = () => Sync.disconnect();
    $('syncNow').onclick = () => Sync.syncNow();
  } else {
    el.innerHTML = `<input type="password" id="ghToken" placeholder="GitHub token with Gist access" autocomplete="off">
      <div class="inline"><button class="btn" id="ghConnect" ${Sync.state === 'working' ? 'disabled' : ''}>${Sync.state === 'working' ? 'Connecting…' : 'Sync with GitHub'}</button></div>
      <div class="conn ${Sync.state === 'error' ? 'err' : ''}">${Sync.state === 'error' ? esc(Sync.error) : ''}</div>
      <p class="help">Saves your progress in a secret gist in your GitHub account, so every browser and computer where you enter the token shares it. The token stays in this browser. Secret gists are unlisted, not encrypted: anyone with the gist's link could read it.</p>`;
    $('ghConnect').onclick = () => { const t = $('ghToken').value.trim(); if(t) Sync.connect(t); };
  }
}

export { Sync, mergeProgress, renderSync };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  // pick up changes from your other devices when you come back to this tab, and save before leaving
  document.addEventListener('visibilitychange', () => { if(!Sync.connected()) return; if(document.visibilityState === 'visible') Sync.syncNow(); else if(Sync.timer) Sync.syncNow(); });
}
export { init };
