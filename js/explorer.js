// Lichess Opening Explorer: move statistics for a position.
import { S } from './book.js';

/* ================= Lichess explorer ================= */
const Explorer = {
  cache: new Map(), lastError: '', blockedUntil: 0,
  enabled(){ return !!S.token; },
  reset(){ this.cache.clear(); this.lastError = ''; },
  label(){ return S.exDb === 'masters' ? 'masters' : `Lichess players rated ${S.ratings[0]}–${S.ratings[S.ratings.length-1]}${S.ratings[S.ratings.length-1] === 2500 ? '+' : ''}`; },
  async get(fen){
    if(!this.enabled()) return null;
    const key = S.exDb + S.ratings.join(',') + '|' + fen.split(' ').slice(0,4).join(' ');
    if(this.cache.has(key)) return this.cache.get(key);
    if(Date.now() < this.blockedUntil) return null;
    const url = S.exDb === 'masters'
      ? `https://explorer.lichess.ovh/masters?moves=15&topGames=0&fen=${encodeURIComponent(fen)}`
      : `https://explorer.lichess.ovh/lichess?variant=standard&speeds=blitz,rapid,classical&ratings=${S.ratings.join(',')}&moves=15&topGames=0&recentGames=0&fen=${encodeURIComponent(fen)}`;
    try{
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
      const res = await fetch(url, {headers: {Authorization: 'Bearer ' + S.token}, signal: ctl.signal});
      clearTimeout(t);
      if(res.status === 401){ this.lastError = 'Lichess refused the token. Check that you copied it completely.'; return null; }
      if(res.status === 429){ this.lastError = 'Lichess asks to slow down. Statistics pause for a minute.'; this.blockedUntil = Date.now() + 61000; return null; }
      if(!res.ok){ this.lastError = 'The Lichess explorer answered with an error (' + res.status + ').'; return null; }
      const j = await res.json();
      const total = (j.white || 0) + (j.draws || 0) + (j.black || 0);
      const moves = (j.moves || []).map(m => {
        const n = m.white + m.draws + m.black;
        return {san: m.san, uci: m.uci, n, share: total ? n / total : 0, white: n ? m.white / n : 0, draws: n ? m.draws / n : 0, black: n ? m.black / n : 0};
      });
      const out = {total, moves, opening: j.opening || null};
      this.cache.set(key, out); this.lastError = '';
      return out;
    }catch(e){
      this.lastError = 'Could not reach the Lichess explorer. If you opened this file directly from disk, try serving it from a local web server.';
      return null;
    }
  }
};
const minGames = () => S.exDb === 'masters' ? 8 : 40;
// share the side to move scores with a move
const scoreFor = (m, color) => color === 'w' ? m.white + m.draws / 2 : m.black + m.draws / 2;

export { Explorer, minGames, scoreFor };
