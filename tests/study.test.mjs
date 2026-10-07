import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePgn } from 'chessops/pgn';
import { isTournamentFinished } from '../src/model.js';
import { startStudyAuthorization, completeStudyAuthorization, splitTournamentPgn, StudyImportJob } from '../src/study.js';

const tournament={type:'tournament',id:'abcdefgh'};
function pgn(count){
  return Array.from({length:count},(_,index)=>`[Event "Test tournament"]\n[Site "https://lichess.org/${String(index).padStart(8,'0')}"]\n[White "José ${index}"]\n[Black "Black ${index}"]\n[Result "1-0"]\n\n1. e4 { [%clk 0:03:00] } e5 2. Nf3 Nc6 1-0\n`).join('\n');
}
function storage(){
  const values=new Map();
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

test('study imports become available only for finished Arena or Swiss tournaments',()=>{
  assert.equal(isTournamentFinished({isFinished:true}),true);
  assert.equal(isTournamentFinished({status:'finished'}),true);
  for(const info of [null,{}, {isFinished:false}, {status:'created'}, {status:'started'}])assert.equal(isTournamentFinished(info),false);
});

test('PGN splitting preserves players, moves, clocks, variants and custom starting positions',()=>{
  const variant='[White "White"]\n[Black "Black"]\n[Result "1-0"]\n[Variant "Chess960"]\n[SetUp "1"]\n[FEN "rkbbqnnr/pppppppp/8/8/8/8/PPPPPPPP/RKBBQNNR w KQkq - 0 1"]\n\n1. e4 e5 1-0';
  const games=splitTournamentPgn(pgn(2)+ '\n'+variant,3);
  assert.equal(games.length,3);
  assert.equal(parsePgn(games[0])[0].headers.get('White'),'José 0');
  assert.deepEqual([...parsePgn(games[0])[0].moves.mainline()].map(move=>move.san),['e4','e5','Nf3','Nc6']);
  assert.match(games[0],/\[%clk 0:03:00\]/);
  const headers=parsePgn(games[2])[0].headers;
  assert.equal(headers.get('Variant'),'Chess960');assert.equal(headers.get('SetUp'),'1');
  assert.equal(headers.get('FEN'),'rkbbqnnr/pppppppp/8/8/8/8/PPPPPPPP/RKBBQNNR w KQkq - 0 1');
});

test('empty, unfinished and incomplete exports fail before any studies can be created',async()=>{
  assert.throws(()=>splitTournamentPgn(''),/no games/);
  assert.throws(()=>splitTournamentPgn('Lichess unavailable'),/invalid game/);
  assert.throws(()=>splitTournamentPgn(pgn(1).replaceAll('1-0','*')),/still finishing/);
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async(url)=>{requests.push(url);return new Response(pgn(1));};
  try {
    const job=new StudyImportJob({tournament,name:'Test study',visibility:'private',expectedCount:2});
    await assert.rejects(job.run('token',new AbortController().signal),/incomplete/);
    assert.equal(requests.length,1);assert.equal(job.studies.length,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('OAuth preserves the player selection, uses PKCE, validates state and never stores the access token',async()=>{
  const session=storage(),intent={tournament,name:'Test study',visibility:'private',gameIds:['00000000'],expectedCount:2,playerFilter:{player:'josé 0',search:'josé 0',label:'José 0'}};
  const url=new URL(await startStudyAuthorization(intent,{storage:session,origin:'https://viewer.example',pathname:'/'}));
  const pending=JSON.parse([...session.values.values()][0]);
  assert.equal(url.origin,'https://lichess.org');assert.equal(url.pathname,'/oauth');
  assert.equal(url.searchParams.get('scope'),'study:write');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('code_challenge'),Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pending.verifier))).toString('base64url'));
  assert.ok(!url.toString().includes(pending.verifier));
  const originalFetch=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async(target,options)=>{
    requests++;
    assert.equal(target,'https://lichess.org/api/token');
    assert.equal(options.body.get('code_verifier'),pending.verifier);assert.equal(options.body.get('client_id'),'viewer.example');
    assert.equal(options.body.get('redirect_uri'),'https://viewer.example/');
    return Response.json({access_token:'secret-token',token_type:'Bearer',expires_in:3600});
  };
  try{
    let restored;
    const result=await completeStudyAuthorization(`https://viewer.example/?code=code&state=${pending.state}`,{storage:session,onIntent:value=>{restored=value;}});
    assert.deepEqual(result,{token:'secret-token',intent});assert.deepEqual(restored,intent);assert.equal(session.values.size,0);
    await assert.rejects(completeStudyAuthorization(`https://viewer.example/?code=code&state=${pending.state}`,{storage:session}),/verify/);
    assert.equal(requests,1);
    await startStudyAuthorization(intent,{storage:session,origin:'https://viewer.example',pathname:'/'});
    await assert.rejects(completeStudyAuthorization('https://viewer.example/?code=code&state=wrong',{storage:session}),/verify/);
    assert.equal(requests,1);
  }finally{globalThis.fetch=originalFetch;}
});

test('canceling or expiring OAuth restores the tournament without exchanging a token',async()=>{
  for(const expired of [false,true]){
    const session=storage(),intent={tournament,name:'Test study',visibility:'unlisted'};
    const url=new URL(await startStudyAuthorization(intent,{storage:session,origin:'https://viewer.example',pathname:'/'}));
    if(expired){const [key,value]=[...session.values.entries()][0];session.setItem(key,JSON.stringify({...JSON.parse(value),createdAt:Date.now()-600001}));}
    let restored;
    await assert.rejects(completeStudyAuthorization(`https://viewer.example/?error=access_denied&state=${url.searchParams.get('state')}`,{storage:session,onIntent:value=>{restored=value;}}),expired?/verify/:/canceled/);
    assert.deepEqual(restored,expired?undefined:intent);assert.equal(session.values.size,0);
  }
  assert.equal(await completeStudyAuthorization('https://viewer.example/?tournament=abcdefgh',{storage:storage()}),null);
  await assert.rejects(startStudyAuthorization({tournament},{storage:{setItem(){throw new Error('blocked');}},origin:'https://viewer.example',pathname:'/'}),/session storage/);
});

test('without a player filter, imports every game into studies of up to 64 chapters',async()=>{
  for(const count of [1,64,65,129]){
    const originalFetch=globalThis.fetch,requests=[],imported=[];
    let studyNumber=0;
    globalThis.fetch=async(url,options)=>{
      requests.push({url,options});
      if(url.startsWith('/lichess/')){
        assert.equal(options.headers.Accept,'application/x-chess-pgn');assert.ok(!url.includes('player='));
        return new Response(pgn(count));
      }
      assert.equal(options.headers.Authorization,'Bearer token');assert.equal(options.credentials,'omit');
      if(url==='https://lichess.org/api/study'){
        studyNumber++;
        assert.equal(options.body.get('visibility'),'private');
        assert.ok(options.body.get('name').length<=100);
        for(const key of ['computer','explorer','cloneable','shareable','chat'])assert.equal(options.body.get(key),'everyone');
        return Response.json({id:`study00${studyNumber}`});
      }
      const games=parsePgn(options.body.get('pgn'));
      assert.ok(games.length<=64);assert.equal(options.body.get('initial'),'true');
      imported.push(...games.map(game=>game.headers.get('Site')));
      return Response.json({chapters:games.map((_,index)=>({id:String(index).padStart(8,'0')})),error:null});
    };
    try{
      const job=new StudyImportJob({tournament,name:'X'.repeat(100),visibility:'private',expectedCount:count});
      const phases=[];
      const studies=await job.run('token',new AbortController().signal,progress=>phases.push(progress.phase));
      assert.equal(studies.length,Math.ceil(count/64));assert.equal(job.imported,count);
      assert.equal(new Set(imported).size,count);assert.equal(phases.at(-1),'complete');
      assert.ok(studies.every(study=>study.total===study.imported));
      const priorRequests=requests.length;
      await job.run('token',new AbortController().signal);assert.equal(requests.length,priorRequests);
    }finally{globalThis.fetch=originalFetch;}
  }
});

test('filtered imports split only selected games into studies and retry only their remaining chapters',async()=>{
  const originalFetch=globalThis.fetch,imports=[],totals=[];
  let creates=0;
  globalThis.fetch=async(url,options)=>{
    if(url.startsWith('/lichess/'))return new Response(pgn(140));
    if(url.endsWith('/api/study')){creates++;return Response.json({id:`study00${creates}`});}
    const sites=parsePgn(options.body.get('pgn')).map(game=>game.headers.get('Site'));
    imports.push({sites,initial:options.body.get('initial')});
    const count=imports.length===1?2:sites.length;
    return Response.json({chapters:Array.from({length:count},(_,index)=>({id:String(index)})),error:imports.length===1?'Import interrupted':null});
  };
  try{
    const gameIds=Array.from({length:65},(_,index)=>String(index*2).padStart(8,'0'));
    const job=new StudyImportJob({tournament,name:'Player games',visibility:'private',expectedCount:140,gameIds});
    gameIds.push('00000139'); // The running job keeps its original selection.
    await assert.rejects(job.run('token',new AbortController().signal,progress=>totals.push(progress.total)),/interrupted/);
    assert.equal(job.games.length,65);assert.equal(job.imported,2);
    assert.deepEqual(job.studies.map(study=>study.total),[64,1]);
    await job.run('token',new AbortController().signal,progress=>totals.push(progress.total));
    assert.equal(creates,2);assert.equal(job.imported,65);assert.ok(totals.every(total=>total===65));
    assert.equal(imports[1].initial,'false');assert.deepEqual(imports[1].sites,imports[0].sites.slice(2));
    assert.deepEqual([...imports[0].sites,...imports[2].sites],gameIds.slice(0,65).map(id=>`https://lichess.org/${id}`));
  }finally{globalThis.fetch=originalFetch;}
});

test('empty filters and exports missing selected games fail before creating studies',async()=>{
  const originalFetch=globalThis.fetch;
  for(const gameIds of [[],['00000002']]){
    const requests=[];
    globalThis.fetch=async url=>{requests.push(url);return new Response(pgn(2));};
    try{
      const job=new StudyImportJob({tournament,name:'Player games',visibility:'private',expectedCount:2,gameIds});
      await assert.rejects(job.run('token',new AbortController().signal),gameIds.length?/incomplete/:/No games match/);
      assert.equal(requests.length,1);assert.equal(job.studies.length,0);
    }finally{globalThis.fetch=originalFetch;}
  }
  const selected=splitTournamentPgn(pgn(2).replace('https://lichess.org/00000001','https://lichess.org/00000001abcd'),2,['00000001']);
  assert.equal(selected.length,1);assert.equal(parsePgn(selected[0])[0].headers.get('White'),'José 1');
});

test('retrying a partial import reuses its study and sends only the remaining games',async()=>{
  const originalFetch=globalThis.fetch,imports=[];
  let creates=0;
  globalThis.fetch=async(url,options)=>{
    if(url.startsWith('/lichess/'))return new Response(pgn(4));
    if(url.endsWith('/api/study')){creates++;return Response.json({id:'study001'});}
    imports.push({sites:parsePgn(options.body.get('pgn')).map(game=>game.headers.get('Site')),initial:options.body.get('initial')});
    return Response.json(imports.length===1?{chapters:[{id:'chapter1'},{id:'chapter2'}],error:'Import interrupted'}:{chapters:[{id:'chapter3'},{id:'chapter4'}],error:null});
  };
  try{
    const job=new StudyImportJob({tournament,name:'Test study',visibility:'unlisted'});
    await assert.rejects(job.run('token',new AbortController().signal),/interrupted/);
    assert.equal(job.imported,2);assert.equal(job.studies[0].id,'study001');
    await job.run('token',new AbortController().signal);
    assert.equal(creates,1);assert.equal(job.imported,4);
    assert.deepEqual(imports[1],{sites:['https://lichess.org/00000002','https://lichess.org/00000003'],initial:'false'});
  }finally{globalThis.fetch=originalFetch;}
});

test('rate limits retain created studies for a safe retry and lost write responses forbid blind retries',async()=>{
  for(const kind of ['rate-limit','lost-response','server-error','unreadable']){
    const originalFetch=globalThis.fetch;
    let requestCount=0;
    globalThis.fetch=async(url)=>{
      requestCount++;
      if(url.startsWith('/lichess/'))return new Response(pgn(1));
      if(url.endsWith('/api/study'))return Response.json({id:'study001'});
      if(kind==='rate-limit')return new Response('',{status:429,headers:{'Retry-After':'120'}});
      if(kind==='server-error')return new Response('',{status:502});
      if(kind==='unreadable')return new Response('not JSON');
      throw new TypeError('Network lost');
    };
    try{
      const job=new StudyImportJob({tournament,name:'Test study',visibility:'unlisted'});
      await assert.rejects(job.run('token',new AbortController().signal),error=>{
        assert.equal(error.uncertain,kind!=='rate-limit');
        if(kind==='rate-limit'){assert.equal(error.status,429);assert.equal(error.retryAfter,120);}
        return true;
      });
      assert.equal(job.studies[0].id,'study001');assert.equal(job.imported,0);
      if(kind!=='rate-limit'){
        const priorRequests=requestCount;
        await assert.rejects(job.run('token',new AbortController().signal),error=>error.uncertain);
        assert.equal(requestCount,priorRequests);
      }
    }finally{globalThis.fetch=originalFetch;}
  }
});
