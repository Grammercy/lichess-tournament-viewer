import test from 'node:test';
import assert from 'node:assert/strict';
import { gamePosition, parseTournament, clockValues } from '../src/model.js';

test('accepts Arena, Swiss and bare IDs, and rejects other hosts and routes',()=>{
  assert.deepEqual(parseTournament(' lichess.org/swiss/abcdefgh '),{type:'swiss',id:'abcdefgh'});
  assert.deepEqual(parseTournament('https://lichess.org/tournament/abcdefgh?x=1'),{type:'tournament',id:'abcdefgh'});
  assert.deepEqual(parseTournament('abcdefgh'),{type:'tournament',id:'abcdefgh'});
  for(const input of ['https://evil.example/tournament/abcdefgh','https://lichess.org.evil.example/tournament/abcdefgh','https://lichess.org/abcdefgh','bad','javascript:alert(1)'])assert.throws(()=>parseTournament(input));
});
test('updates the board incrementally and handles en passant',()=>{
  const prefix={variant:'standard',moves:'e4 a6 e5 d5'};
  const old=gamePosition(prefix);
  const game={...prefix,moves:`${prefix.moves} exd6`};
  const updated=gamePosition(game,old);
  assert.equal(updated.fen,gamePosition(game).fen);
  assert.equal(updated.squares[35],null); // d5 was captured en passant
  assert.equal(updated.squares[43],'wP'); // white pawn now on d6
  assert.notEqual(old.fen,updated.fen);
});
test('custom positions support promotion and clock colors when Black starts',()=>{
  const game={variant:'fromPosition',initialFen:'7k/P7/8/8/8/8/8/7K w - - 0 1',moves:'a8=Q+'};
  assert.equal(gamePosition(game).squares[56],'wQ');
  const clocks=clockValues({initialFen:'7k/8/8/8/8/8/8/7K b - - 0 1',clock:{initial:180},clocks:[14000]});
  assert.deepEqual(clocks,{white:180,black:140});
});
test('all Lichess variants can initialize, and illegal moves are reported',()=>{
  for(const variant of ['standard','chess960','antichess','kingOfTheHill','threeCheck','atomic','horde','racingKings','crazyhouse'])assert.equal(gamePosition({variant,moves:''}).squares.length,64);
  assert.throws(()=>gamePosition({variant:'standard',moves:'e5'}));
});
