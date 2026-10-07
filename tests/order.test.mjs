import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTournamentGames, currentSwissRoundGames } from '../src/model.js';

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

test('Swiss games put every ongoing game before finished games, then use tournament rank',()=>{
  const games=[game('leader01','Leader','Lower',100,'mate'),game('second01','Second','Third',50),game('unknown1','Unknown','Anonymous',200)];
  assert.deepEqual(ids(orderTournamentGames(games,info,{playingFirst:true})),['second01','unknown1','leader01']);
  games[1].status='resign';
  assert.deepEqual(ids(orderTournamentGames(games,info,{playingFirst:true})),['unknown1','leader01','second01']);
});

test('Swiss retains early results and unplayed pairings until the next round begins',()=>{
  const old={...game('oldgame1','Leader','Lower',1000,'mate'),lastMoveAt:5000};
  const unplayed={...game('unplayed','Third','Last',10000,'noStart'),lastMoveAt:10000};
  const done={...game('donegame','Leader','Second',10001,'mate'),lastMoveAt:15000};
  const active={...game('active01','Lower','NewPlayer',10002),lastMoveAt:11000};
  const games=[active,old,done,unplayed];
  assert.deepEqual(ids(currentSwissRoundGames(games,{round:2})),['unplayed','donegame','active01']);
  active.status='draw';active.lastMoveAt=20000;
  assert.deepEqual(ids(currentSwissRoundGames(games,{round:2,nbOngoing:0})),['unplayed','donegame','active01']);
  const next=game('nextgame','Leader','Third',21000);
  assert.deepEqual(ids(currentSwissRoundGames([...games,next],{round:3})),['nextgame']);
  assert.deepEqual(ids(games),['active01','oldgame1','donegame','unplayed']);
});

test('Swiss finds a new round even when its players had byes or the previous result is stale',()=>{
  const old={...game('oldgame1','Leader','Lower',1000,'mate'),lastMoveAt:5000};
  const next=game('nextgame','Second','Third',10000);
  assert.deepEqual(ids(currentSwissRoundGames([old,next],{round:2})),['nextgame']);
  old.status='started';
  const repeat=game('repeat01','LEADER','Third',10000);
  assert.deepEqual(ids(currentSwissRoundGames([old,repeat],{round:2})),['repeat01']);
  assert.deepEqual(currentSwissRoundGames([],{round:0}),[]);
});
