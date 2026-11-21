// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutoff, family, kindOf, openingName, parseArgs, readGame } from '../tools/analyse-games.mjs';

const NOW = Date.UTC(2026, 10, 21, 12);

test('analyse-games: options and which games', () => {
  assert.equal(parseArgs(['--user', 'x']).days, 30);   // nothing chosen: the last 30 days
  const o = parseArgs(['--user', 'x', '--games', '10']);
  assert.equal(o.games, 10); assert.equal(o.days, undefined); assert.equal(cutoff(o, NOW), 0);
  assert.equal(cutoff(parseArgs(['--user', 'x', '--days', '10']), NOW), NOW - 10 * 86400000);
  // combined: the most recent limit wins
  assert.equal(cutoff(parseArgs(['--user', 'x', '--days', '10', '--since', '2026-11-20']), NOW), Date.parse('2026-11-20'));
  assert.throws(() => parseArgs(['--user', 'x', '--games', '0']));
  assert.throws(() => parseArgs(['--user', 'x', '--time', 'classical']));
});

test('analyse-games: opening names', () => {
  assert.equal(openingName('https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation-6.Be3'), 'Sicilian Defense Najdorf Variation');
  assert.equal(openingName('https://www.chess.com/openings/Indian-Game-East-Indian-London-System...4.e3-O-O'), 'Indian Game East Indian London System');
  assert.equal(family('Queens Gambit Accepted Rosenthal Variation'), 'Queens Gambit Accepted');
  assert.equal(family('Ruy Lopez Opening Morphy Defense'), 'Ruy Lopez Opening');
  assert.equal(family('Slav Defense Modern Bishops Game'), 'Slav Defense');
});

test('analyse-games: reading a game', () => {
  assert.equal(kindOf(35), 'blunder'); assert.equal(kindOf(25), 'mistake'); assert.equal(kindOf(12), 'inaccuracy'); assert.equal(kindOf(5), null);
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  // White gets a winning position (+6), throws it away (−4) and loses
  const g = {color: 'w', result: 'resigned', plies: [
    {san: 'e4', mover: 'w', before: 20, after: 600, best: 'e4', clock: 590, fen},
    {san: 'e5', mover: 'b', before: -600, after: -600, best: 'e5', clock: 590, fen},
    {san: 'Qh5', mover: 'w', before: 600, after: -400, best: 'Nf3', clock: 500, fen},
    {san: 'Nc6', mover: 'b', before: 400, after: 400, best: 'Qxh5', clock: 580, fen}]};
  const r = readGame(g);
  assert.equal(r.pts, 0); assert.equal(r.worst.san, 'Qh5'); assert.equal(r.worst.kind, 'blunder');
  assert.equal(r.swing.san, 'Qh5'); assert.equal(r.thrown, true);
});
