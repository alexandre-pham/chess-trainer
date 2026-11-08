// Merging progress from a file or another device, and sync through a Firebase account.
import { $, esc, store } from './util.js';
import { cards, moveLog } from './srs.js';
import { renderSel } from './setup.js';
import { game, renderStatus } from './trainer.js';
import { coordLog, coordRounds } from './squares.js';
import { Daily } from './daily.js';
import { timeLog } from './progress.js';
import { firebaseConfig } from './firebase-config.js';

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

/* ================= accounts and sync (Firebase) ================= */
// Each person signs in with an email and a password. Their progress is stored in Firestore under their own user id,
// and every browser where they sign in shares it. The Firebase library is loaded only when accounts are set up.
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const CHUNK = 700000;   // a Firestore document holds at most 1 MiB, so the progress is split into pieces
// progress that belongs to the person signed in: cleared on sign-out so the next person starts clean
const PERSONAL = ['cards', 'log', 'coordLog', 'coordRounds', 'time', 'dailyDays', 'daily', 'session', 'token', 'user', 'ratings', 'rLines', 'pkce', 'fbHash', 'fbLast'];
let A = null, F = null, auth = null, db = null;

function hash(str){   // cyrb53: tells whether the progress changed without downloading it
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i = 0; i < str.length; i++){ const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-email': 'This email address is not valid.', 'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'An account already exists with this email. Sign in instead.',
  'auth/weak-password': 'Choose a password of at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/operation-not-allowed': 'Email sign-in is not turned on in the Firebase project.',
  'permission-denied': 'The database refused access. Check the Firestore security rules.',
  'unavailable': 'No connection. Your progress is kept here and will sync later.',
  'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': 'Google sign-in is not allowed on this address yet: add it under Authentication > Settings > Authorized domains in the Firebase console.',
  'auth/account-exists-with-different-credential': 'This email already has an account with a password. Sign in with your password instead.'
};
const errText = e => AUTH_ERRORS[e && e.code] || (e && e.message) || 'Something went wrong.';

const Sync = window.Sync = {
  user: null, ready: false, state: 'idle', error: '', notice: '', last: store.get('fbLast', 0), remoteHash: store.get('fbHash', ''),
  timer: null, busy: null, dirty: false,
  configured(){ return !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId); },
  connected(){ return !!(this.user && db); },
  async load(){
    if(!this.configured()) return;
    try{
      const [app, a, f] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
      A = a; F = f;
      const fa = app.initializeApp(firebaseConfig);
      auth = A.getAuth(fa); db = F.getFirestore(fa);
      A.onAuthStateChanged(auth, u => {
        const was = this.user && this.user.uid;
        this.user = u ? {uid: u.uid, email: u.email || ''} : null; this.ready = true;
        renderSync();
        if(u && u.uid !== was) this.syncNow();   // a sign-in on this device sends what is here and gets what is in the account
      });
    }catch(e){ this.ready = true; this.state = 'error'; this.error = 'Could not load the sign-in service. Check your connection and reload the page.'; renderSync(); }
  },
  async run(fn){
    this.state = 'working'; this.error = ''; this.notice = ''; renderSync();
    try{ await fn(); this.state = 'idle'; }catch(e){ this.state = 'error'; this.error = errText(e); }
    renderSync();
  },
  signIn(email, pw){ return this.run(() => A.signInWithEmailAndPassword(auth, email, pw)); },
  signUp(email, pw){ return this.run(() => A.createUserWithEmailAndPassword(auth, email, pw)); },
  // Google sign-in opens a small Google window; closing it is not an error
  signInGoogle(){
    return this.run(async () => {
      try{ await A.signInWithPopup(auth, new A.GoogleAuthProvider()); }
      catch(e){ if(e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return; throw e; }
    });
  },
  resetPassword(email){
    if(!email){ this.state = 'error'; this.error = 'Enter your email above, then tap "Forgot password?" again.'; renderSync(); return; }
    return this.run(async () => { await A.sendPasswordResetEmail(auth, email); this.notice = `If an account exists for ${email}, a reset link is on its way. Check your spam folder too.`; });
  },
  async signOut(){
    await this.syncNow();
    if(this.state === 'error' && !confirm('Your latest progress could not be saved to your account. If you sign out now, it is lost. Sign out anyway?')) return;
    clearTimeout(this.timer);
    await A.signOut(auth);
    // the progress stays safe in the account; this browser forgets it so the next person starts clean
    for(const k of PERSONAL) localStorage.removeItem('ot:' + k);
    location.reload();
  },
  payload(){ return JSON.stringify({app: 'opening-trainer', version: 6, cards, log: moveLog, coordLog, coordRounds, dailyDays: Daily.days, time: timeLog}); },
  // pull, merge, push. Runs one at a time.
  syncNow(){
    if(!this.connected()) return Promise.resolve();
    if(this.busy){ this.dirty = true; return this.busy; }
    clearTimeout(this.timer); this.dirty = false; this.state = 'working'; renderSync();
    const uid = this.user.uid;
    this.busy = (async () => {
      try{
        const metaRef = F.doc(db, 'users', uid), chunk = i => F.doc(db, 'users', uid, 'chunks', String(i));
        const meta = await F.getDoc(metaRef), m = meta.exists() ? meta.data() : null;
        let gotNew = false;
        if(m && m.hash !== this.remoteHash){   // someone else (another device) saved since our last sync
          const parts = await Promise.all(Array.from({length: m.n || 0}, (_, i) => F.getDoc(chunk(i))));
          const text = parts.map(p => p.exists() ? p.data().s : '').join('');
          try{ gotNew = mergeProgress(JSON.parse(text)); }catch(e){ console.warn('could not read the saved progress', e); }
        }
        const text = this.payload(), h = hash(text);
        if(!m || h !== m.hash){
          const pieces = []; for(let i = 0; i < text.length; i += CHUNK) pieces.push(text.slice(i, i + CHUNK));
          const batch = F.writeBatch(db);
          pieces.forEach((s, i) => batch.set(chunk(i), {s}));
          for(let i = pieces.length; i < ((m && m.n) || 0); i++) batch.delete(chunk(i));
          batch.set(metaRef, {n: pieces.length, hash: h, updated: Date.now(), version: 6});
          await batch.commit();
        }
        this.remoteHash = h; store.set('fbHash', h);
        this.state = 'ok'; this.error = ''; this.last = Date.now(); store.set('fbLast', this.last);
        if(gotNew){ if(!$('setup').hidden) renderSel(); else if(!$('train').hidden && game) renderStatus(); }
      }catch(e){ this.state = 'error'; this.error = errText(e); }
      this.busy = null; renderSync();
      if(this.dirty) this.schedule(1500);
    })();
    return this.busy;
  },
  schedule(ms){ if(!this.connected()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.syncNow(), ms || 4000); }
};

function renderSync(){
  const el = $('syncBox'); if(!el) return;
  if(!Sync.configured()){ el.innerHTML = '<p class="help">Accounts are not set up for this copy of the app, so your progress stays in this browser. Use Export and Import to move it.</p>'; return; }
  if(!Sync.ready){ el.innerHTML = `<div class="conn ${Sync.state === 'error' ? 'err' : ''}">${Sync.state === 'error' ? esc(Sync.error) : 'Loading…'}</div>`; return; }
  const working = Sync.state === 'working';
  if(Sync.user){
    const when = Sync.last ? new Date(Sync.last).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'}) : '';
    const line = working ? 'Syncing…' : Sync.state === 'error' ? Sync.error : when ? `Last synced at ${when}.` : '';
    el.innerHTML = `<div class="who"><span>Signed in as <b>${esc(Sync.user.email)}</b></span><button class="btn quiet" id="syncOut" ${working ? 'disabled' : ''}>Sign out</button></div>
      <div class="conn ${Sync.state === 'error' ? 'err' : ''}">${esc(line)}</div>
      <div class="inline" style="margin-top:6px"><button class="btn" id="syncNow" ${working ? 'disabled' : ''}>Sync now</button></div>`;
    $('syncOut').onclick = () => Sync.signOut();
    $('syncNow').onclick = () => Sync.syncNow();
    return;
  }
  const keep = id => ($(id) || {}).value || '';
  const email = keep('acEmail'), pw = keep('acPw');
  el.innerHTML = `<button class="btn" id="acGoogle" ${working ? 'disabled' : ''}>Continue with Google</button>
    <div class="ac-or">or with an email and a password</div>
    <input type="email" id="acEmail" placeholder="Email" autocomplete="username" ${working ? 'disabled' : ''}>
    <input type="password" id="acPw" placeholder="Password (6 characters or more)" autocomplete="current-password" ${working ? 'disabled' : ''}>
    <div class="inline"><button class="btn" id="acIn" ${working ? 'disabled' : ''}>${working ? 'Please wait…' : 'Sign in'}</button><button class="btn quiet" id="acUp" ${working ? 'disabled' : ''}>Create account</button><button class="btn quiet" id="acReset" ${working ? 'disabled' : ''}>Forgot password?</button></div>
    <div class="conn ${Sync.state === 'error' ? 'err' : ''}">${esc(Sync.state === 'error' ? Sync.error : Sync.notice)}</div>
    <p class="help">With an account, your progress is saved online and shared by every device where you sign in. Without one, it stays in this browser only.</p>`;
  $('acEmail').value = email; $('acPw').value = pw;
  const vals = () => [$('acEmail').value.trim(), $('acPw').value];
  $('acIn').onclick = () => { const [e, p] = vals(); Sync.signIn(e, p); };
  $('acUp').onclick = () => { const [e, p] = vals(); Sync.signUp(e, p); };
  $('acReset').onclick = () => Sync.resetPassword(vals()[0]);
  $('acGoogle').onclick = () => Sync.signInGoogle();
  $('acPw').onkeydown = ev => { if(ev.key === 'Enter') $('acIn').click(); };
}

export { Sync, mergeProgress, renderSync };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  // the GitHub gist sync is gone: forget its token
  ['ghToken', 'ghGist', 'ghLogin', 'ghLast'].forEach(k => localStorage.removeItem('ot:' + k));
  Sync.load();
  // pick up changes from your other devices when you come back to this tab, and save before leaving
  document.addEventListener('visibilitychange', () => { if(!Sync.connected()) return; if(document.visibilityState === 'visible') Sync.syncNow(); else if(Sync.timer) Sync.syncNow(); });
}
export { init };
