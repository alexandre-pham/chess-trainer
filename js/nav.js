// Navigation between pages: one page shown at a time, every nav item always visible.
import { $ } from './util.js';

/* ================= pages ================= */
const NAV_FOR = {today: 'toToday', setup: 'toSetup', train: 'toTrain', coords: 'toCoords', progress: 'toProgress', settings: 'toSettings'};
const PAGES = Object.keys(NAV_FOR);
const leaveHooks = [];
let current = null;

// called with the page being left and the page being opened
function onLeave(fn){ leaveHooks.push(fn); }
function showPage(id, scroll = true){
  if(current && current !== id) leaveHooks.forEach(f => f(current, id));
  current = id;
  PAGES.forEach(p => $(p).hidden = p !== id);
  for(const [p, b] of Object.entries(NAV_FOR)){
    if(p !== id) continue;
    document.querySelectorAll('.nav-item').forEach(n => { const on = n.id === b; n.classList.toggle('on', on); if(on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
  }
  if(scroll) window.scrollTo(0, 0);
}
const currentPage = () => current;

export { currentPage, onLeave, showPage };
