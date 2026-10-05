import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTournamentGames } from '../src/model.js';

const game=(id,white,black,createdAt=0,status='started')=>({id,createdAt,status,players:{white:{rating:white},black:{rating:black}}});
const ids=games=>games.map(game=>game.id);

test('Arena order matches the Top Games reference rather than recency or tournament rank',()=>{
  const expected=[
    game('tasty001',2223,2397,1),
    game('aslanan1',2471,2124,2),
    game('aurelian',2299,2245,3),
    game('alexgu01',2170,2277,4),
    game('desgamb1',1943,2356,5),
    game('yasin026',2207,2085,6),
  ];
  assert.deepEqual(ids(orderTournamentGames([...expected].reverse(),{})),ids(expected));
});

test('Lichess duels order is authoritative, including ties and changes on refresh',()=>{
  const games=[game('first001',2300,2300),game('second01',2300,2301),game('third001',2400,2400)];
  const info={duels:[{id:'second01'},{id:'first001'}]};
  assert.deepEqual(ids(orderTournamentGames(games,info)),['second01','first001','third001']);
  assert.deepEqual(ids(orderTournamentGames(games,{duels:[{id:'first001'},{id:'third001'}]})),['first001','third001','second01']);
  assert.deepEqual(ids(games),['first001','second01','third001']);
});

test('finished games leave the top list and Swiss retains its recency ordering',()=>{
  const games=[game('finished',2700,2700,10,'mate'),game('newer001',2000,2000,5),game('older001',2300,2300,1),game('oldfinal',2800,2800,0,'draw')];
  const info={duels:[{id:'finished'},{id:'older001'}]};
  assert.deepEqual(ids(orderTournamentGames(games,info)),['older001','newer001','finished','oldfinal']);
  assert.deepEqual(ids(orderTournamentGames(games,info,'swiss')),['newer001','older001','finished','oldfinal']);
  assert.deepEqual(ids(orderTournamentGames([game('unknown1',undefined,undefined),game('rated001',1800,1900)],{})),['rated001','unknown1']);
});
