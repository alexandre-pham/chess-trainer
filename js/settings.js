// The Settings page: Lichess sign-in, move statistics and backup controls.
import { $, b64url, esc, randomStr, store } from './util.js';
import { S } from './book.js';
import { cards, moveLog } from './srs.js';
import { renderSel } from './setup.js';
import { mergeProgress } from './sync.js';
import { Explorer } from './explorer.js';
import { coordLog, coordRounds } from './squares.js';
import { Daily } from './daily.js';
import { timeLog } from './progress.js';

/* --- connection settings --- */
/* --- Lichess sign-in (OAuth 2 with PKCE: you log in on lichess.org, this page never sees your password) --- */
const LICHESS = 'https://lichess.org';
const redirectUri = () => location.origin + location.pathname;
function setToken(tok, user){
  S.token = tok || ''; S.user = user || '';
  store.set('token', S.token); store.set('user', S.user);
  $('lichessToken').value = S.user ? '' : S.token;
  Explorer.reset(); renderAuth(); checkExplorer();
}

function renderAuth(){
  const el = $('lichessAuth');
  if(S.token && S.user){
    el.innerHTML = `<div class="who"><span>Connected as <b>${esc(S.user)}</b></span><button class="btn quiet" id="lichessOut">Disconnect</button></div>`;
    $('lichessOut').onclick = lichessLogout;
  } else if(S.token){
    el.innerHTML = `<div class="who"><span>Using a personal token</span><button class="btn quiet" id="lichessOut">Remove</button></div>`;
    $('lichessOut').onclick = () => setToken('', '');
  } else {
    const canOAuth = location.protocol === 'http:' || location.protocol === 'https:';
    el.innerHTML = `<button class="btn lichess-btn" id="lichessIn" ${canOAuth ? '' : 'disabled'}>Connect with Lichess</button>` +
      (canOAuth ? '<p class="help">Takes you to the Lichess sign-in page and brings you back here. Your password goes to Lichess only; this page receives a read-only key that stays in this browser.</p>'
       : `<p class="help">Signing in needs the page to be opened through a web address, not as a file. In the folder that contains this file, run <code>python3 -m http.server 8000</code>, then open <a href="http://localhost:8000/${esc(location.pathname.split('/').pop())}">http://localhost:8000/${esc(location.pathname.split('/').pop())}</a>. Your progress is stored per address, so use Export and Import below to bring it over. You can also paste a personal token instead.</p>`);
    if(canOAuth) $('lichessIn').onclick = lichessLogin;
  }
}
// Sign-in happens in this same tab: you go to lichess.org and come straight back here, connected.
// (A popup cannot be closed automatically once it has visited Lichess's protected sign-in pages.)
async function lichessLogin(){
  const verifier = randomStr(48), state = randomStr(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set('pkce', {verifier, state, at: Date.now()});
  location.href = `${LICHESS}/oauth?` + new URLSearchParams({response_type: 'code', client_id: 'opening-trainer', redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, state}).toString();
}
async function finishLogin(code, state){
  const p = store.get('pkce', null);
  store.set('pkce', null);
  if(!p || p.state !== state){ $('exConn').className = 'conn err'; $('exConn').textContent = 'The Lichess sign-in could not be verified. Try again.'; return; }
  try{
    const res = await fetch(`${LICHESS}/api/token`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: redirectUri(), client_id: 'opening-trainer'})});
    if(!res.ok) throw new Error('Lichess refused the sign-in (' + res.status + ').');
    const tok = (await res.json()).access_token;
    let user = '';
    try{ const a = await fetch(`${LICHESS}/api/account`, {headers: {Authorization: 'Bearer ' + tok}}); if(a.ok) user = (await a.json()).username || ''; }catch(e){}
    setToken(tok, user || 'Lichess');
  }catch(e){ $('exConn').className = 'conn err'; $('exConn').textContent = e.message; }
}
async function lichessLogout(){
  const tok = S.token; setToken('', '');
  try{ await fetch(`${LICHESS}/api/token`, {method: 'DELETE', headers: {Authorization: 'Bearer ' + tok}}); }catch(e){} // revoke the key on Lichess
}

function renderExplorerChoices(){
  $('dbChoice').innerHTML = [['lichess','Lichess players'],['masters','Masters']].map(([v,l]) =>
    `<button class="chip" data-db="${v}" aria-pressed="${S.exDb === v}">${l}</button>`).join('');
  $('dbChoice').querySelectorAll('[data-db]').forEach(b => b.onclick = () => { S.exDb = b.dataset.db; store.set('exDb', S.exDb); Explorer.reset(); renderExplorerChoices(); });
  const R = [1000,1200,1400,1600,1800,2000,2200,2500];
  $('ratingChoice').hidden = S.exDb !== 'lichess';
  $('ratingChoice').innerHTML = '<span class="help" style="margin:0 4px 0 0">Ratings</span>' + R.map(r => `<button class="chip" data-r="${r}" aria-pressed="${S.ratings.includes(r)}">${r}${r === 2500 ? '+' : ''}</button>`).join('');
  $('ratingChoice').querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const r = +b.dataset.r; S.ratings = S.ratings.includes(r) ? S.ratings.filter(x => x !== r) : [...S.ratings, r].sort((a,b) => a-b);
    if(!S.ratings.length) S.ratings = [r];
    store.set('ratings', S.ratings); Explorer.reset(); renderExplorerChoices();
  });
}
async function checkExplorer(){
  const el = $('exConn');
  if(!S.token){ el.className = 'conn'; el.textContent = ''; return; }
  el.className = 'conn'; el.textContent = 'Checking the token…';
  const r = await Explorer.get('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  if(r){ el.className = 'conn ok'; el.textContent = `Connected. ${r.total.toLocaleString()} games in the selected database.`; }
  else { el.className = 'conn err'; el.textContent = Explorer.lastError || 'Could not reach the Lichess explorer.'; }
}
  

/* --- export / import --- */

export { checkExplorer, renderAuth, renderExplorerChoices };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  S.user = store.get('user', '');
  // another tab changed the connection: follow it
  window.addEventListener('storage', e => {
    if(e.key === 'ot:token' || e.key === 'ot:user'){ S.token = store.get('token', ''); S.user = store.get('user', ''); Explorer.reset(); renderAuth(); checkExplorer(); }
  });
  // coming back from the Lichess sign-in page
  (function handleOAuthReturn(){
    const q = new URLSearchParams(location.search);
    if(!q.has('code') && !q.has('error')) return;
    const code = q.get('code'), state = q.get('state'), error = q.get('error');
    history.replaceState(null, '', location.pathname);
    setTimeout(async () => {
      $('lichessAuth').scrollIntoView({block: 'center'});
      if(error){ store.set('pkce', null); $('exConn').className = 'conn err'; $('exConn').textContent = 'Sign-in was cancelled on Lichess.'; return; }
      $('exConn').className = 'conn'; $('exConn').textContent = 'Finishing the connection…';
      await finishLogin(code, state);
    }, 0);
  })();
  $('lichessToken').value = S.user ? '' : S.token;
  $('lichessToken').onchange = e => setToken(e.target.value.trim(), '');
  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({version: 5, cards, log: moveLog, coordLog, coordRounds, dailyDays: Daily.days, time: timeLog})], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'opening-trainer-progress.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => {
    const f = e.target.files[0]; if(!f) return;
    try{
      const data = JSON.parse(await f.text());
      if(!data.cards) throw new Error('No progress found in this file.');
      mergeProgress(data); renderSel(); alert('Progress imported: ' + Object.keys(data.cards).length + ' positions.');
    }catch(err){ alert('This file could not be imported: ' + err.message); }
    e.target.value = '';
  };
}
export { init };
