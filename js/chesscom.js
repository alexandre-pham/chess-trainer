// Chess.com public API: your profile and your recent games (read-only, no sign-in).
import { normChesscomGame } from './logic.js';

/* ================= chess.com ================= */
const API = 'https://api.chess.com/pub/player/';
async function ccGet(url){
  let res;
  try{ res = await fetch(url); }catch(e){ throw new Error('Could not reach chess.com.'); }
  if(res.status === 404) throw new Error('No chess.com player with this username.');
  if(res.status === 429) throw new Error('Chess.com asks to slow down. Try again in a minute.');
  if(!res.ok) throw new Error('Chess.com answered with an error (' + res.status + ').');
  return res.json();
}
const ccStats = user => ccGet(API + encodeURIComponent(user.toLowerCase()) + '/stats');
// your last `max` finished games, newest first, from the most recent monthly archives
async function ccRecentGames(user, max){
  const {archives = []} = await ccGet(API + encodeURIComponent(user.toLowerCase()) + '/games/archives');
  const games = [];
  for(let i = archives.length - 1; i >= 0 && i >= archives.length - 3 && games.length < max; i--){
    const month = await ccGet(archives[i]);
    games.push(...(month.games || []).slice().reverse());
  }
  return games.slice(0, max).map(g => normChesscomGame(g, user, Chess));
}

export { ccRecentGames, ccStats };
