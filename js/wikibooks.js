// Human-written opening explanations from the Wikibooks Chess Opening Theory book.

/* ================= Wikibooks opening explanations ================= */
// Human-written text from the Wikibooks "Chess Opening Theory" book (CC BY-SA), one page per position.
const WB_API = 'https://en.wikibooks.org/w/api.php';
const wbCache = new Map();
function wbTitle(sans){
  let t = 'Chess_Opening_Theory';
  sans.forEach((s, i) => { const n = Math.floor(i / 2) + 1, m = s.replace(/[+#!?]/g, ''); t += '/' + (i % 2 === 0 ? `${n}._${m}` : `${n}...${m}`); });
  return t;
}
// keep the explanation, drop the theory tables, references and editing notes
function wbClean(text){
  let t = text.replace(/\r/g, '');
  const cut = t.search(/\n\s*(Theory table|References|Statistics|See also|External links|Further reading|Notes)\b/i);
  if(cut > 0) t = t.slice(0, cut);
  t = t.split('\n').map(l => l.trim()).filter(l => l && !/^(When contributing|This page|Please|Wikipedia has|Edit|\{\{|Chess Opening Theory)/i.test(l) && !/^[\-=]+$/.test(l)).join('\n\n');
  if(t.length > 1400){ const end = t.lastIndexOf('.', 1400); t = t.slice(0, end > 400 ? end + 1 : 1400) + ' …'; }
  return t.trim();
}
async function wbFetch(title){
  if(wbCache.has(title)) return wbCache.get(title);
  const p = (async () => {
    const q = new URLSearchParams({action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', format: 'json', origin: '*', titles: title});
    try{
      const r = await fetch(`${WB_API}?${q}`); if(!r.ok) return null;
      const j = await r.json(), page = Object.values((j.query && j.query.pages) || {})[0];
      if(!page || page.missing !== undefined) return null;
      let text = page.extract || '';
      if(!text){  // no plain-text extracts on this wiki: parse the page and strip the markup
        const q2 = new URLSearchParams({action: 'parse', prop: 'text', redirects: '1', format: 'json', origin: '*', page: title});
        const r2 = await fetch(`${WB_API}?${q2}`); if(!r2.ok) return null;
        const j2 = await r2.json(), html = j2.parse && j2.parse.text && (j2.parse.text['*'] || j2.parse.text);
        if(!html) return null;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('table, .navbox, .mw-editsection, sup, style, .infobox').forEach(e => e.remove());
        text = [...doc.querySelectorAll('h2, h3, p, li')].map(e => e.textContent).join('\n');
      }
      text = wbClean(text);
      return text.length >= 80 ? {title, text, url: 'https://en.wikibooks.org/wiki/' + encodeURI(title)} : null;
    }catch(e){ return null; }
  })();
  wbCache.set(title, p); return p;
}
// the page for this sequence of moves, or for the nearest earlier position that has one
async function wikiFor(sans){
  for(let k = Math.min(sans.length, 30); k >= Math.max(1, sans.length - 4); k--){
    const page = await wbFetch(wbTitle(sans.slice(0, k)));
    if(page) return {...page, plies: k, moves: sans.slice(0, k)};
  }
  return null;
}

export { wikiFor };
