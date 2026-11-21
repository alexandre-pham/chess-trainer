// Starts the app: navigation between pages and first render.
import { $ } from './util.js';
import { S } from './book.js';
import { showPage } from './nav.js';
import { renderColor, renderSetup } from './setup.js';
import { checkExplorer, renderAuth, renderExplorerChoices } from './settings.js';
import { renderSync } from './sync.js';
import { enterTraining, game, newSession, renderAll, restoreSession, setTrainAlive, startLine, syncStats, trainAlive } from './trainer.js';
import { Daily, openToday } from './daily.js';
import './data.js';
import './srs.js';
import './explorer.js';
import './analysis.js';
import './wikibooks.js';
import './engine.js';
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

/* ================= boot ================= */
function start(){
  $('toSetup').onclick = () => { newSession(); Daily.active = null; setTrainAlive(false); showPage('setup'); renderSetup(); };
  $('toSettings').onclick = () => showPage('settings');
  $('toTrain').onclick = () => {
    if(trainAlive && game){ enterTraining(); renderAll(); }
    else if(S.sel.length){ enterTraining(); startLine(); }
    else $('toSetup').onclick();
  };
  $('pgEmptyGo').onclick = () => openToday();
  showPage('setup', false);
  renderColor();
  renderSetup();
  renderExplorerChoices();
  renderAuth();
  checkExplorer();
  // ask the browser to keep this site's data instead of clearing it when space runs low
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  renderSync();
  syncStats();
  // back to the line in progress if the page was reloaded during training
  restoreSession();
}

// start the app
init_util(); init_book(); init_setup(); init_settings(); init_sync(); init_trainer(); init_squares(); init_daily(); init_review(); init_progress();
start();
