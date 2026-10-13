// Loads the opening book and the piece images.

// Loads the opening book and the piece images.

/* ================= data: opening book and piece images ================= */
// openings.json is built from lichess-org/chess-openings (CC0): every named line, plus an index of positions.
const res = await fetch(new URL('../data/openings.json', import.meta.url));
if(!res.ok) throw new Error('Could not load the opening book (data/openings.json).');
const DB = await res.json();
const LINES = DB.lines, POS = DB.pos;
// pieces: cburnett set from Lichess (CC BY-SA 3.0)
const PIECES = Object.fromEntries(['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'].map(k => [k, new URL(`../pieces/${k}.svg`, import.meta.url).href]));

export { LINES, PIECES, POS };
