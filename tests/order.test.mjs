import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTournamentGames } from '../src/model.js';

const game=(id,white,black,createdAt=0,status='started',rating=2500)=>({id,createdAt,status,players:{white:{user:{id:white},rating},black:{user:{name:black},rating}}});
const ids=games=>games.map(game=>game.id);
const info={rankingPlayers:[
  {username:'Leader',rank:1}, {username:'Second',rank:2},
  {username:'Third',rank:3}, {username:'Lower',rank:40}, {username:'Last',rank:60},
],duels:[{id:'rating01'},{id:'rank0002'},{id:'rank0001'}]};

test('either color of the highest-placed player determines order, ahead of ratings and recency',()=>{
  const games=[game('rating01','Lower','Last',100),game('rank0002','Second','Lower',50),game('rank0001','Last','LEADER',1,'started',1500)];
  assert.deepEqual(ids(orderTournamentGames(games,info)),['rank0001','rank0002','rating01']);
  assert.deepEqual(ids(games),['rating01','rank0002','rank0001']);
});

test('rank is primary in all filters, with ongoing and newer games breaking equal-rank ties',()=>{
  const games=[game('rank0002','Second','Lower',100),game('oldfinal','Leader','Lower',1,'mate'),game('newfinal','Leader','Last',2,'draw'),game('ongoing1','Leader','Third',0)];
  assert.deepEqual(ids(orderTournamentGames(games,info)),['ongoing1','newfinal','oldfinal','rank0002']);
  assert.deepEqual(ids(orderTournamentGames(games.filter(g=>g.status!=='started'),info)),['newfinal','oldfinal']);
});

test('refreshing full standings reorders games beyond page one, and unranked players go last',()=>{
  const games=[game('rank0040','Lower','Last'),game('rank0002','Second','Third'),game('unknown1','Unknown','Anonymous')];
  assert.deepEqual(ids(orderTournamentGames(games,info)),['rank0002','rank0040','unknown1']);
  const refreshed={rankingPlayers:[{username:'Lower',rank:1},{username:'Second',rank:40},{username:'Third',rank:50},{username:'Last',rank:60}]};
  assert.deepEqual(ids(orderTournamentGames(games,refreshed)),['rank0040','rank0002','unknown1']);
});
