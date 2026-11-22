// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parsePgn, studyPgnUrl } from '../js/logic.js';
const { Chess } = createRequire(import.meta.url)('../vendor/chess.js');

const STUDY = `[Event "My Catalan: Main line"]
[Site "https://lichess.org/study/abcdEFGH/ijklMNOP"]
[Result "*"]
[Orientation "white"]
[StudyName "My Catalan"]
[ChapterName "Main line"]

1. d4 Nf6 2. c4 e6 3. g3 { the Catalan } d5 (3... Bb4+ 4. Bd2 Be7 $6) 4. Bg2 dxc4!? (4... Be7 5. Nf3 0-0 6. 0-0) 5. Nf3 *

[Event "My Catalan: Against the KID"]
[Orientation "white"]

1. d4 Nf6 2. c4 g6 3. g3 Bg7 4. Bg2 O-O 5. Nc3 d6 6. Nf3 1-0
`;

test('parsePgn: chapters, sidelines, comments and symbols', () => {
  const r = parsePgn(STUDY, Chess);
  assert.equal(r.study, 'My Catalan'); assert.equal(r.skipped, 0);
  assert.deepEqual(r.chapters.map(c => [c.name, c.orientation, c.lines.length]), [['Main line', 'white', 3], ['Against the KID', 'white', 1]]);
  assert.deepEqual(r.chapters[0].lines.map(l => l.join(' ')), [
    'd4 Nf6 c4 e6 g3 d5 Bg2 dxc4 Nf3',
    'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O',
    'd4 Nf6 c4 e6 g3 Bb4+ Bd2 Be7']);
});

test('parsePgn: one game without headers, nested sidelines, bad moves', () => {
  const r = parsePgn('1. e4 c5 (1... e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6) 2. Nf3 d6 3. Qxh7', Chess);
  assert.deepEqual(r.chapters[0].lines.map(l => l.join(' ')), ['e4 c5 Nf3 d6', 'e4 e5 Nf3 Nc6', 'e4 e5 Bc4 Nf6']);
  assert.equal(r.skipped, 1);
  assert.equal(parsePgn('[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n\n1. Kb2', Chess).skipped, 1);
});

test('studyPgnUrl: study and chapter links', () => {
  assert.equal(studyPgnUrl('https://lichess.org/study/abcdEFGH'), 'https://lichess.org/api/study/abcdEFGH.pgn');
  assert.equal(studyPgnUrl('lichess.org/study/abcdEFGH/ijklMNOP#3'), 'https://lichess.org/api/study/abcdEFGH/ijklMNOP.pgn');
  assert.equal(studyPgnUrl('https://example.com'), null);
});
