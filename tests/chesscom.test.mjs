// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ccOpening, mostPlayed, normChesscomGame, normLichessGame, ratingGroups, toLichessRating } from '../js/logic.js';
const { Chess } = createRequire(import.meta.url)('../vendor/chess.js');

test('toLichessRating: higher on Lichess, the gap shrinking with strength', () => {
  assert.equal(toLichessRating(1200), 1550);
  assert.equal(toLichessRating(1000), 1400);
  assert.ok(toLichessRating(800) - 800 > toLichessRating(2000) - 2000);
  assert.ok(toLichessRating(300) < toLichessRating(400));
  assert.equal(toLichessRating(3000), 3050);
});

test('ratingGroups: own group and the nearer neighbour', () => {
  assert.deepEqual(ratingGroups(1550), [1400, 1600]);
  assert.deepEqual(ratingGroups(1450), [1200, 1400]);
  assert.deepEqual(ratingGroups(1050), [1000, 1200]);
  assert.deepEqual(ratingGroups(700), [1000, 1200]);
  assert.deepEqual(ratingGroups(2300), [2000, 2200]);
  assert.deepEqual(ratingGroups(2400), [2200, 2500]);
  assert.deepEqual(ratingGroups(2700), [2200, 2500]);
});

test('mostPlayed: the time control with the most games', () => {
  const stats = {
    chess_rapid: {last: {rating: 1300}, record: {win: 10, loss: 8, draw: 2}},
    chess_blitz: {last: {rating: 1180}, record: {win: 150, loss: 140, draw: 22}},
    chess_bullet: {last: {rating: 900}, record: {win: 3, loss: 4, draw: 0}},
    tactics: {highest: {rating: 2000}}
  };
  assert.deepEqual(mostPlayed(stats), {timeClass: 'blitz', rating: 1180, games: 312});
  assert.equal(mostPlayed({}), null);
});

test('ccOpening: name from the chess.com opening link', () => {
  assert.equal(ccOpening('https://www.chess.com/openings/Catalan-Opening-Open-Defense-4...dxc4-5.Bg2'), 'Catalan Opening Open Defense');
  assert.equal(ccOpening('https://www.chess.com/openings/Kings-Indian-Defense'), 'Kings Indian Defense');
  assert.equal(ccOpening(undefined), '');
});

const ccGame = (extra = {}) => ({
  url: 'https://www.chess.com/game/live/1', uuid: 'u1', end_time: 1763600000, rated: true, time_class: 'blitz', rules: 'chess',
  white: {username: 'Alex'}, black: {username: 'Bob'}, eco: 'https://www.chess.com/openings/Catalan-Opening',
  pgn: '[Event "Live Chess"]\n[Result "1-0"]\n\n1. d4 {[%clk 0:03:00]} 1... Nf6 {[%clk 0:03:00]} 2. c4 {[%clk 0:02:59]} 2... e6 3. g3 1-0', ...extra
});

test('normChesscomGame: your colour, opponent, moves without clock comments', () => {
  const g = normChesscomGame(ccGame(), 'alex', Chess);
  assert.deepEqual([g.site, g.myColor, g.oppName, g.variant, g.speed, g.createdAt], ['chess.com', 'w', 'Bob', 'standard', 'blitz', 1763600000000]);
  assert.deepEqual(g.sans, ['d4', 'Nf6', 'c4', 'e6', 'g3']);
  assert.equal(g.opening, 'Catalan Opening');
  assert.equal(normChesscomGame(ccGame(), 'BOB', Chess).myColor, 'b');
});

test('normChesscomGame: variants and odd start positions are not read as standard games', () => {
  assert.equal(normChesscomGame(ccGame({rules: 'chess960'}), 'alex', Chess).variant, 'chess960');
  const odd = normChesscomGame(ccGame({initial_setup: '8/8/8/8/8/8/8/K6k w - - 0 1'}), 'alex', Chess);
  assert.equal(odd.variant, 'unreadable'); assert.deepEqual(odd.sans, []);
});

test('normLichessGame: same shape, analysis link from your side', () => {
  const g = normLichessGame({id: 'abc', variant: 'standard', speed: 'rapid', rated: false, createdAt: 5, moves: 'e4 c5',
    players: {white: {user: {name: 'Bob'}}, black: {user: {name: 'Alex'}}}, opening: {name: 'Sicilian Defense'}}, 'alex');
  assert.deepEqual([g.myColor, g.oppName, g.analyse, g.opening], ['b', 'Bob', 'https://lichess.org/abc/black', 'Sicilian Defense']);
  assert.deepEqual(g.sans, ['e4', 'c5']);
});
