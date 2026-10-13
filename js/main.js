// Starts the app: navigation between pages and first render.
import { $ } from './util.js';
import { S } from './book.js';
import { renderColor, renderSetup } from './setup.js';
import { checkExplorer, renderAuth, renderCoachMode, renderExplorerChoices } from './settings.js';
import { Sync, renderSync } from './sync.js';
import { cancelCoach } from './coach.js';
import { enterTraining, game, newSession, renderAll, setTrainAlive, startLine, syncStats, trainAlive } from './trainer.js';
import { C } from './squares.js';
import { Daily, openToday } from './daily.js';
import { R } from './review.js';
import './data.js';
import './srs.js';
import './explorer.js';
import './engine.js';
import './progress.js';
import { init as init_util } from './util.js';
import { init as init_book } from './book.js';
import { init as init_setup } from './setup.js';
import { init as init_settings } from './settings.js';
import { init as init_sync } from './sync.js';
import { init as init_trainer } from './trainer.js';
import { init as init_squares } from './squares.js';
import { init as init_daily } from './daily.js';
import { init as init_review } from './review.js';
import { init as init_progress } from './progress.js';

/* ================= navigation between pages ================= */
const SECTIONS = ['setup', 'settings', 'train', 'review', 'today', 'coords', 'progress'];
const NAV_FOR = {setup: 'toSetup', settings: 'toSettings', train: 'toTrain', review: 'toToday', today: 'toToday', coords: 'toCoords', progress: 'toProgress'};
const NAV_BTNS = ['toToday', 'toSetup', 'toTrain', 'toCoords', 'toProgress', 'toSettings'];
function syncNav(){
  const vis = SECTIONS.find(s => !$(s).hidden);
  NAV_BTNS.forEach(b => { const on = NAV_FOR[vis] === b; $(b).classList.toggle('on', on); if(on) $(b).setAttribute('aria-current', 'page'); else $(b).removeAttribute('aria-current'); });
}

function leavePage(){ if(C.timer){ clearInterval(C.timer); C.timer = null; C.round = null; } R.token++; }
function showOnly(id){ SECTIONS.forEach(s => $(s).hidden = s !== id); window.scrollTo(0, 0); }

/* ================= boot ================= */
      

 
  

export { syncNav };

/* start-up: event bindings and first renders, called once by main.js */
function start(){
  new MutationObserver(recs => {
    for(const r of recs){ if(SECTIONS.includes(r.target.id) && !r.target.hidden) SECTIONS.forEach(s => { if(s !== r.target.id && !$(s).hidden) $(s).hidden = true; }); }
    syncNav();
  }).observe(document.querySelector('.wrap'), {attributes: true, attributeFilter: ['hidden'], subtree: true});
  $('toSetup').onclick = () => { leavePage(); cancelCoach(); newSession(); Daily.active = null; setTrainAlive(false); showOnly('setup'); renderSetup(); };
  $('toSettings').onclick = () => { leavePage(); showOnly('settings'); };
  $('toTrain').onclick = () => {
    leavePage();
    if(trainAlive && game){ enterTraining(); renderAll(); }
    else if(S.sel.length){ enterTraining(); startLine(); }
    else $('toSetup').onclick();
  };
  $('pgEmptyGo').onclick = () => openToday();
  renderColor();
  renderSetup();
  renderExplorerChoices();
  renderAuth();
  renderCoachMode();
  window.__coachLive = true;
  checkExplorer();
  // ask the browser to keep this site's data (progress, downloaded models) instead of clearing it when space runs low
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  renderSync();
  if(Sync.connected()) Sync.syncNow();
  renderSetup();
  syncStats();
  syncNav();
}

// start the app
init_util(); init_book(); init_setup(); init_settings(); init_sync(); init_trainer(); init_squares(); init_daily(); init_review(); init_progress();
start();
