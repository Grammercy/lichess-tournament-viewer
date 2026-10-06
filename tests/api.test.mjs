import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readNdjson, tournamentInfo, discoverTournamentGames, tournamentPgn } from '../src/api.js';
import worker from '../dist/server/index.js';

test('NDJSON handles split UTF-8 characters, heartbeats, and a final line without newline',async()=>{
  const bytes=new TextEncoder().encode('\n{"name":"José"}\n\n{"id":"last"}');
  const stream=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}});
  const items=[];await readNdjson(new Response(stream),x=>items.push(x));
  assert.deepEqual(items,[{name:'José'},{id:'last'}]);
});
test('incremental discovery can stop and cancels the upstream reader',async()=>{
  let canceled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"id":1}\n{"id":2}\n'));},cancel(){canceled=true;}});
  const items=[];await readNdjson(new Response(stream),item=>{items.push(item);return false;});
  assert.deepEqual(items,[{id:1}]);assert.equal(canceled,true);
});
test('Worker serves bundled assets and restricts proxy endpoints and request bodies',async()=>{
  assert.equal((await worker.fetch(new Request('https://viewer.example/'))).status,200);
  assert.equal((await worker.fetch(new Request('https://viewer.example/pieces/wN.svg'))).headers.get('content-type'),'image/svg+xml');
  for(const endpoint of ['/lichess/api/account','/lichess/https://example.com','/lichess/api/tournament/../../account'])assert.equal((await worker.fetch(new Request(`https://viewer.example${endpoint}`))).status,400);
  assert.equal((await worker.fetch(new Request('https://viewer.example/lichess/api/games/export/_ids',{method:'POST',body:'not,a,game-id'}))).status,400);
});
test('Worker serves the Homura PNG without corrupting its bytes',async()=>{
  const response=await worker.fetch(new Request('https://viewer.example/homura.png'));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL('../public/homura.png',import.meta.url)));
  const head=await worker.fetch(new Request('https://viewer.example/homura.png',{method:'HEAD'}));
  assert.equal(head.status,200);
  assert.equal(head.headers.get('content-type'),'image/png');
  assert.equal(await head.text(),'');
});

test('Arena and Swiss load full ranking streams through the permitted proxy and refresh them',async()=>{
  const originalFetch=globalThis.fetch;
  const requests=[];
  let leader='First';
  globalThis.fetch=async(url,options)=>{
    if(typeof url==='string'&&url.startsWith('/lichess/'))return worker.fetch(new Request(`https://viewer.example${url}`,options));
    requests.push({url,accept:options.headers.Accept});
    if(new URL(url).pathname.endsWith('/results'))return new Response(`{"username":"${leader}","rank":1}\n{"username":"BeyondPageOne","rank":40}\n`,{headers:{'Content-Type':'application/x-ndjson'}});
    return Response.json({standing:{players:[{name:'First',rank:1}]}});
  };
  try{
    for(const type of ['tournament','swiss']){
      const signal=new AbortController().signal;
      const info=await tournamentInfo({type,id:'abcdefgh'},signal);
      assert.deepEqual(info.rankingPlayers,[{username:'First',rank:1},{username:'BeyondPageOne',rank:40}]);
      leader='NewLeader';
      assert.equal((await tournamentInfo({type,id:'abcdefgh'},signal)).rankingPlayers[0].username,'NewLeader');
      leader='First';
    }
    assert.equal(requests.length,8);
    assert.ok(requests.filter(r=>r.url.includes('/results')).every(r=>r.accept==='application/x-ndjson'));
  }finally{globalThis.fetch=originalFetch;}
});

test('Arena and Swiss discover metadata through the proxy, then export only ongoing histories',async()=>{
  const originalFetch=globalThis.fetch;
  const requests=[];
  const history={id:'history1',status:'mate',players:{}};
  const active={id:'active01',status:'started',players:{}};
  globalThis.fetch=async(url,options)=>{
    if(typeof url==='string'&&url.startsWith('/lichess/'))return worker.fetch(new Request(`https://viewer.example${url}`,options));
    const target=new URL(url);requests.push({target,body:options.body});
    const games=target.pathname.endsWith('/games')?[history,active]:[{...active,moves:'e4',clocks:[17500]}];
    return new Response(games.map(game=>JSON.stringify(game)).join('\n')+'\n');
  };
  try{
    for(const type of ['tournament','swiss']){
      const games=[];
      await discoverTournamentGames({type,id:'abcdefgh'},new AbortController().signal,game=>games.push(game));
      assert.deepEqual(games.map(game=>game.id),['history1','active01','active01']);
      assert.equal(games.at(-1).moves,'e4');
    }
    assert.equal(requests.length,4);
    for(const request of requests.filter(request=>request.target.pathname.endsWith('/games'))){
      for(const key of ['moves','clocks','opening'])assert.equal(request.target.searchParams.get(key),'false');
    }
    assert.ok(requests.filter(request=>request.target.pathname.endsWith('/export/_ids')).every(request=>request.body==='active01'));
  }finally{globalThis.fetch=originalFetch;}
});

test('Arena and Swiss export full PGN with clocks and openings through the public proxy',async()=>{
  const originalFetch=globalThis.fetch,requests=[];
  const pgn='[White "White"]\n[Black "Black"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n';
  globalThis.fetch=async(url,options)=>{
    if(url.startsWith('/lichess/'))return worker.fetch(new Request(`https://viewer.example${url}`,options));
    requests.push({url:new URL(url),options});
    return new Response(pgn,{headers:{'Content-Type':'application/x-chess-pgn'}});
  };
  try{
    for(const type of ['tournament','swiss'])assert.equal(await tournamentPgn({type,id:'abcdefgh'},new AbortController().signal),pgn);
    assert.equal(requests.length,2);
    for(const {url,options} of requests){
      assert.equal(options.headers.Accept,'application/x-chess-pgn');
      for(const key of ['moves','clocks','opening'])assert.equal(url.searchParams.get(key),'true');
      assert.equal(url.searchParams.has('player'),false);
      assert.equal(options.headers.Authorization,undefined);
    }
    for(const endpoint of ['/lichess/api/token','/lichess/api/study','/lichess/api/study/abcdefgh/import-pgn'])assert.equal((await worker.fetch(new Request(`https://viewer.example${endpoint}`,{method:'POST',body:'anything'}))).status,400);
  }finally{globalThis.fetch=originalFetch;}
});
