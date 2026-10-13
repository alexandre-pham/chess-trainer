// Small helpers: element lookup, saved settings in the browser, text escaping.
import { PIECES } from './data.js';

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const store = {
  get(k, d){ try{ const v = localStorage.getItem('ot:'+k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('ot:'+k, JSON.stringify(v)); }catch(e){} }
};
function fnv(s){ let x = 0x811c9dc5; for(let i=0;i<s.length;i++){ x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16); }
const posKey = fen => fnv(fen.split(' ').slice(0,3).join(' '));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = x => Math.round(x * 100) + '%';

// random strings for sign-in and device ids
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomStr = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

export { $, b64url, esc, pct, posKey, randomStr, sleep, store };

/* start-up: event bindings and first renders, called once by main.js */
function init(){
  document.querySelectorAll('img[data-p]').forEach(i => i.src = PIECES[i.dataset.p]);
}
export { init };
