// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMistake, mistakeSuspects, punishVerdict } from '../js/logic.js';

// explorer-like moves: share of games, games, and results of that move's games
const mv = (san, n, white, draws, black, total) => ({san, n, share: n / total, white, draws, black});

test('mistakeSuspects: common moves after which your side scores clearly better', () => {
  const T = 10000;
  const moves = [mv('Nf6', 6000, .50, .10, .40, T), mv('Bg4', 1200, .62, .08, .30, T), mv('h6', 2500, .51, .10, .39, T), mv('Qh4', 300, .80, .05, .15, T)];
  const s = mistakeSuspects(moves, 'w');
  assert.deepEqual(s.map(x => x.san), ['Bg4']);           // Qh4 is too rare (3%), h6 is about usual
  assert.ok(s[0].score > s[0].usual + 0.04);
  assert.deepEqual(mistakeSuspects(moves, "b").map(x => x.san), []);  // played as Black, none of these moves is good for you
});

test('mistakeSuspects: needs enough games, and nothing when there are none', () => {
  const moves = [mv('e5', 50, .4, .2, .4, 70), mv('d5', 20, .8, .1, .1, 70)];
  assert.deepEqual(mistakeSuspects(moves, 'w'), []);       // d5 scores well for White but only 20 games
  assert.deepEqual(mistakeSuspects([], 'w'), []);
});

test('isMistake: gives away 0.7 and leaves you clearly better', () => {
  assert.equal(isMistake(120, 90), true);
  assert.equal(isMistake(60, 200), false);                  // not enough lost
  assert.equal(isMistake(150, 20), false);                  // still about equal for you
});

test('punishVerdict: keep nearly all the advantage', () => {
  assert.equal(punishVerdict(150, 110), 'punished');
  assert.equal(punishVerdict(500, 410), 'punished');        // within 20% of a big advantage
  assert.equal(punishVerdict(500, 300), 'partly');
  assert.equal(punishVerdict(150, 20), 'missed');
});
