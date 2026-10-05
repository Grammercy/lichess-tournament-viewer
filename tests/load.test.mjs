import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTournamentData } from '../src/load.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const game=id=>({id,status:'started',moves:'',players:{white:{user:{name:'White'}},black:{user:{name:'Black'}}}});

function harness(t,type='tournament'){
  const originalFetch=globalThis.fetch;
  const requests=[],events=[];
  globalThis.fetch=(url,{signal,body})=>new Promise((resolve,reject)=>{
    const target=new URL(url,'https://viewer.example');
    const request={path:target.pathname,query:target.searchParams,bodyIds:body,signal,reply:resolve};
    signal.addEventListener('abort',()=>{reject(signal.reason);request.body?.error(signal.reason);},{once:true});
    requests.push(request);
  });
  const controller=new AbortController();
  const operation=loadTournamentData({type,id:'abcdefgh'},controller.signal,{
    onInfo:(info,tournament)=>events.push({type:'info',info,tournament}),
    onRankings:players=>events.push({type:'rankings',players}),
    onGame:game=>events.push({type:'game',game}),
    onGamesComplete:()=>events.push({type:'complete'})
  });
  // Tests intentionally leave requests pending before checking their order.
  operation.catch(()=>{});
  t.after(async()=>{controller.abort();await operation.catch(()=>{});globalThis.fetch=originalFetch;});
  const request=(suffix='',kind=type)=>requests.find(item=>item.path===`/lichess/api/${kind}/abcdefgh${suffix}`);
  const activeExport=()=>requests.find(item=>item.path==='/lichess/api/games/export/_ids');
  function stream(suffix,kind=type){
    const item=request(suffix,kind);
    const body=new ReadableStream({start(controller){item.body=controller;}});
    item.reply(new Response(body));
    return {send:value=>item.body.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`)),end:()=>item.body.close()};
  }
  return {requests,events,controller,operation,request,stream,activeExport};
}

test('ongoing metadata displays before the export ends, and only active histories load before completion',async t=>{
  const h=harness(t,'swiss');
  const games=h.stream('/games'),rankings=h.stream('/results');
  h.request().reply(Response.json({name:'Swiss'}));
  const finished={...game('history1'),status:'mate',moves:undefined};
  const active={...game('active01'),moves:undefined};
  games.send(finished);games.send(active);
  await tick();
  assert.deepEqual(h.events.map(event=>event.type),['info','game','game']);
  assert.equal(h.activeExport(),undefined,'history exports wait for discovery to release its reader');
  assert.equal(h.request('/games').query.get('moves'),'false');
  assert.equal(h.request('/games').query.get('clocks'),'false');
  assert.equal(h.request('/games').query.get('opening'),'false');
  games.end();rankings.end();
  await tick();
  assert.equal(h.activeExport().bodyIds,'active01');
  assert.ok(!h.events.some(event=>event.type==='complete'));
  h.activeExport().reply(new Response(`${JSON.stringify({...active,moves:'e4',clocks:[18000]})}\n`));
  await h.operation;
  assert.deepEqual(h.events.filter(event=>event.type==='game').map(event=>event.game.id),['history1','active01','active01']);
  assert.equal(h.events.at(-1).type,'complete');
});

test('switching tournaments cancels active history loading without delivering late data',async t=>{
  const h=harness(t);
  const games=h.stream('/games'),rankings=h.stream('/results');
  h.request().reply(Response.json({name:'Arena'}));
  games.send({...game('active01'),moves:undefined});games.end();rankings.end();
  await tick();
  assert.equal(h.activeExport().bodyIds,'active01');
  h.controller.abort();
  h.activeExport().reply(new Response(`${JSON.stringify(game('active01'))}\n`));
  await assert.rejects(h.operation,{name:'AbortError'});
  assert.ok(h.requests.every(request=>request.signal.aborted));
  assert.deepEqual(h.events.filter(event=>event.type==='game').map(event=>event.game.id),['active01']);
  assert.ok(!h.events.some(event=>event.type==='complete'));
});

test('an active-history rate limit cancels other loading work and preserves the retry delay',async t=>{
  const h=harness(t);
  const games=h.stream('/games');h.stream('/results');
  h.request().reply(Response.json({name:'Arena'}));
  games.send({...game('active01'),moves:undefined});games.end();
  await tick();
  h.activeExport().reply(new Response(null,{status:429,headers:{'Retry-After':'90'}}));
  await assert.rejects(h.operation,error=>error.status===429&&error.retryAfter===90);
  assert.ok(h.requests.every(request=>request.signal.aborted));
  assert.deepEqual(h.events.filter(event=>event.type==='game').map(event=>event.game.id),['active01']);
  assert.ok(!h.events.some(event=>event.type==='complete'));
});

test('details, rankings, and games start together; games display while rankings are pending',async t=>{
  const h=harness(t);
  assert.equal(h.requests.length,3);
  const games=h.stream('/games'),rankings=h.stream('/results');
  games.send(game('first001'));
  await tick();
  assert.deepEqual(h.events,[],'games must wait for tournament confirmation');
  h.request().reply(Response.json({name:'Arena',standing:{players:[{name:'White',rank:1}]}}));
  await tick();
  assert.deepEqual(h.events.map(event=>event.type),['info','game']);
  games.send(game('second02'));
  await tick();
  assert.equal(h.events.filter(event=>event.type==='game').length,2);
  games.end();
  await tick();
  assert.equal(h.events.at(-1).type,'complete','the game loading state ends before rankings finish');
  rankings.send({username:'Black',rank:1});rankings.end();
  const result=await h.operation;
  assert.deepEqual(result.info.rankingPlayers,[{username:'Black',rank:1}]);
  assert.equal(h.events.at(-1).type,'rankings');
});

test('rankings and an entire game export can arrive before details without losing games',async t=>{
  const h=harness(t,'swiss');
  const games=h.stream('/games'),rankings=h.stream('/results');
  rankings.send({username:'White',rank:1});rankings.end();
  games.send(game('early001'));games.send(game('early002'));games.end();
  await tick();
  assert.deepEqual(h.events,[]);
  h.request().reply(Response.json({name:'Swiss',round:2}));
  const result=await h.operation;
  assert.equal(result.tournament.type,'swiss');
  assert.deepEqual(h.events.map(event=>event.type),['info','rankings','game','game','complete']);
});

test('Arena 404 cancels its streams and retries all three as Swiss without leaking games',async t=>{
  const h=harness(t);
  const arenaGames=h.stream('/games');h.stream('/results');
  arenaGames.send(game('obsolete'));
  await tick();
  h.request().reply(new Response(null,{status:404}));
  await tick();
  assert.equal(h.requests.length,6);
  assert.ok(h.requests.slice(0,3).every(request=>request.signal.aborted));
  assert.deepEqual(h.events,[]);
  const swissGames=h.stream('/games','swiss'),swissRankings=h.stream('/results','swiss');
  h.request('','swiss').reply(Response.json({name:'Swiss'}));
  swissGames.send(game('swiss001'));swissGames.end();swissRankings.end();
  const result=await h.operation;
  assert.equal(result.tournament.type,'swiss');
  assert.deepEqual(h.events.filter(event=>event.type==='game').map(event=>event.game.id),['swiss001']);
});

test('cancellation stops all three requests and suppresses buffered games and late details',async t=>{
  const h=harness(t);
  const games=h.stream('/games');h.stream('/results');
  games.send(game('obsolete'));
  await tick();
  h.controller.abort();
  h.request().reply(Response.json({name:'Late details'}));
  await assert.rejects(h.operation,{name:'AbortError'});
  assert.ok(h.requests.every(request=>request.signal.aborted));
  assert.deepEqual(h.events,[]);
});

test('a rate-limited game export aborts sibling requests and preserves retry information',async t=>{
  const h=harness(t);
  h.stream('/results');
  h.request().reply(Response.json({name:'Arena'}));
  await tick();
  h.request('/games').reply(new Response(null,{status:429,headers:{'Retry-After':'90'}}));
  await assert.rejects(h.operation,error=>error.status===429&&error.retryAfter===90);
  assert.ok(h.requests.every(request=>request.signal.aborted));
  assert.deepEqual(h.events.map(event=>event.type),['info']);
});

test('a ranking failure preserves the completed export and does not retry a valid Arena as Swiss',async t=>{
  const h=harness(t);
  const games=h.stream('/games');
  h.request().reply(Response.json({name:'Arena'}));
  games.send(game('visible1'));games.end();
  await tick();
  assert.equal(h.events.at(-1).type,'complete');
  h.request('/results').reply(new Response(null,{status:404}));
  await assert.rejects(h.operation,error=>error.status===404);
  assert.equal(h.requests.length,3);
  assert.deepEqual(h.events.filter(event=>event.type==='game').map(event=>event.game.id),['visible1']);
});
