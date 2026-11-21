// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mergeCards, mergeTime, repertoireExit, schedule, unionInto } from '../js/logic.js';
const { Chess } = createRequire(import.meta.url)('../vendor/chess.js');

const DAY = 86400000, NOW = 1_700_000_000_000;
const fresh = () => ({ease: 2.5, ivl: 0, reps: 0, lapses: 0, due: 0});

test('schedule: good answers grow the interval 1, 3, then by the ease', () => {
  const c = fresh();
  schedule(c, 'good', NOW); assert.equal(c.ivl, 1); assert.equal(c.due, NOW + DAY);
  schedule(c, 'good', NOW); assert.equal(c.ivl, 3);
  schedule(c, 'good', NOW); assert.equal(c.ivl, Math.round(3 * 2.6));
  assert.ok(c.ease <= 3);
});

test('schedule: a miss comes back in 10 minutes and lowers the ease, never below 1.3', () => {
  const c = {...fresh(), ivl: 20, reps: 4, ease: 1.4};
  schedule(c, 'again', NOW);
  assert.deepEqual([c.ivl, c.reps, c.lapses, c.due], [0, 0, 1, NOW + 10 * 60000]);
  assert.equal(c.ease, 1.3);
});

test('schedule: hard keeps at least one day', () => {
  const c = schedule(fresh(), 'hard', NOW);
  assert.equal(c.ivl, 1); assert.equal(c.due, NOW + DAY);
});

test('mergeCards: the most recently seen card wins', () => {
  const mine = {a: {seen: 10, ivl: 1}, b: {seen: 50, ivl: 7}};
  const changed = mergeCards(mine, {a: {seen: 20, ivl: 3}, b: {seen: 40, ivl: 0}, c: {seen: 1, ivl: 1}});
  assert.equal(changed, true);
  assert.deepEqual([mine.a.ivl, mine.b.ivl, mine.c.ivl], [3, 7, 1]);
  assert.equal(mergeCards(mine, {b: {seen: 40}}), false);
});

test('unionInto: adds missing entries once, sorted by time, capped from the oldest', () => {
  const key = e => e[0] + '|' + e[1];
  const log = [[1, 'x'], [5, 'x']];
  assert.equal(unionInto(log, [[3, 'x'], [5, 'x'], [7, 'x']], key, 3), true);
  assert.deepEqual(log, [[3, 'x'], [5, 'x'], [7, 'x']]);
  assert.equal(unionInto(log, [[5, 'x']], key), false);
  assert.equal(unionInto(log, undefined, key), false);
});

test('mergeTime: keeps the larger count per device, day and activity', () => {
  const t = {d1: {'2026-11-01': {lines: 60, review: 30}}};
  assert.equal(mergeTime(t, {d1: {'2026-11-01': {lines: 40, review: 90}}, d2: {'2026-11-02': {lines: 5}}}), true);
  assert.deepEqual(t, {d1: {'2026-11-01': {lines: 60, review: 90}}, d2: {'2026-11-02': {lines: 5}}});
  assert.equal(mergeTime(t, {d1: {'2026-11-01': {lines: 60}}}), false);
});

// a tiny repertoire: 1. e4 e5 2. Nf3 Nc6 3. Bb5, and 1. e4 c5 2. Nf3
function book(lines){
  const next = new Map();
  for(const l of lines){ const g = new Chess(); for(const m of l.split(' ')){ const k = g.fen().split(' ').slice(0, 4).join(' '); (next.get(k) || next.set(k, new Set()).get(k)).add(m); g.move(m); } }
  return fen => [...(next.get(fen.split(' ').slice(0, 4).join(' ')) || [])].map(san => ({san}));
}
const cand = book(['e4 e5 Nf3 Nc6 Bb5', 'e4 c5 Nf3']);

test('repertoireExit: you left the book', () => {
  const {verdict} = repertoireExit('e4 e5 Bc4 Nf6'.split(' '), 'w', cand, Chess);
  assert.equal(verdict.kind, 'you'); assert.equal(verdict.ply, 2);
  assert.deepEqual(verdict.best, ['Nf3']); assert.deepEqual(verdict.path, ['e4', 'e5']);
});

test('repertoireExit: your opponent left the book', () => {
  const {verdict} = repertoireExit('e4 e5 Nf3 d6'.split(' '), 'w', cand, Chess);
  assert.deepEqual([verdict.kind, verdict.ply, verdict.played], ['opp', 3, 'd6']);
});

test('repertoireExit: the opponent avoided the opening on move one', () => {
  const r = repertoireExit('d4 d5'.split(' '), 'b', cand, Chess);
  assert.equal(r.verdict, null); assert.deepEqual(r.outAt, {ply: 0, played: 'd4'});
});

test('repertoireExit: the book ended, or the game ended in the book', () => {
  assert.equal(repertoireExit('e4 c5 Nf3 d6'.split(' '), 'w', cand, Chess).verdict.kind, 'end');
  assert.equal(repertoireExit('e4 e5'.split(' '), 'w', cand, Chess).verdict.kind, 'short');
});
