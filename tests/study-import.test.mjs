import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parsePgn } from 'chessops/pgn';
import { isTournamentFinished } from '../src/model.js';
import { StudyImportJob, studyChapterLimit } from '../src/study.js';

const source=readFileSync(new URL('../src/study-import.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export function','function');
const tournament={type:'tournament',id:'testtour'};
const playerFilter={player:'alice',search:'alice',label:'Alice'};
const pgn='[Site "https://lichess.org/alice001"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n\n[Site "https://lichess.org/other001"]\n[White "Carol"]\n[Black "Dave"]\n[Result "1-0"]\n\n1. d4 d5 1-0';

function harness(){
  const elements=new Map(),authorizations=[],redirects=[];
  const element=()=>({value:'',hidden:false,disabled:false,open:false,textContent:'',children:[],listeners:new Map(),
    classList:{toggle(){}},setAttribute(){},setCustomValidity(){},reportValidity(){},
    addEventListener(type,callback){this.listeners.set(type,callback);},
    async dispatch(type){await this.listeners.get(type)?.({preventDefault(){},target:this});},
    replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    showModal(){this.open=true;},close(){this.open=false;}
  });
  const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const context=vm.createContext({
    document:{getElementById:$,createElement:element},window:{addEventListener(){}},
    location:{href:'https://viewer.example/?code=test',pathname:'/',assign:url=>redirects.push(url)},history:{replaceState(){}},
    URL,AbortController,setTimeout,clearTimeout,isTournamentFinished,StudyImportJob,studyChapterLimit,
    startStudyAuthorization:async intent=>{authorizations.push(intent);return 'https://lichess.org/oauth';},
    completeStudyAuthorization:async(url,{onIntent})=>{onIntent({tournament});return {token:'test-token'};},
  });
  vm.runInContext(source,context);
  const controller=vm.runInContext('initStudyImport()',context);
  const current={tournament,info:{name:'Test tournament',isFinished:true},pendingLoad:false,loading:false,completeExport:true,gameCount:2,playing:0,playerFilter,gameIds:['alice001']};
  controller.update(current);
  return {controller,current,$,authorizations,redirects};
}

test('the import dialog counts filtered games and sends that selection through sign-in',async()=>{
  const h=harness();h.controller.open();
  assert.match(h.$('study-import-summary').textContent,/Import 1 games by Alice/);
  await h.$('study-import-form').dispatch('submit');
  const intent=h.authorizations[0];
  assert.deepEqual(Array.from(intent.gameIds),['alice001']);assert.deepEqual(intent.playerFilter,playerFilter);assert.equal(intent.expectedCount,2);
  assert.deepEqual(h.redirects,['https://lichess.org/oauth']);
  const empty={...h.current,playerFilter:{player:null,search:'missing',label:'missing'},gameIds:[]};
  h.controller.update(empty);assert.equal(h.$('import-study').disabled,true);
  h.controller.open();assert.equal(h.$('study-import-submit').disabled,true);
  await h.$('study-import-form').dispatch('submit');assert.equal(h.authorizations.length,1);
});

test('changing or clearing the player filter starts a new import with the new game set',async()=>{
  const originalFetch=globalThis.fetch,imports=[];
  let creates=0;
  globalThis.fetch=async(url,options)=>{
    if(url.startsWith('/lichess/'))return new Response(pgn);
    if(url.endsWith('/api/study'))return Response.json({id:`study00${++creates}`});
    const games=parsePgn(options.body.get('pgn'));imports.push(games.map(game=>game.headers.get('Site')));
    return Response.json({chapters:games.map((_,index)=>({id:String(index)}))});
  };
  try{
    const h=harness();await h.controller.restoreAuthorization();h.controller.open();
    assert.equal(h.$('study-import-submit').textContent,'Import filtered games');
    await h.$('study-import-form').dispatch('submit');
    assert.equal(h.$('study-import-status').textContent,'Imported 1 games.');
    h.controller.update({...h.current,playerFilter:{player:'carol',search:'carol',label:'Carol'},gameIds:['other001']});
    assert.equal(h.$('study-import-dialog').open,false);h.controller.open();
    assert.match(h.$('study-import-summary').textContent,/by Carol/);assert.equal(h.$('study-name').disabled,false);
    await h.$('study-import-form').dispatch('submit');
    h.controller.update({...h.current,playerFilter:null,gameIds:null});h.controller.open();
    assert.match(h.$('study-import-summary').textContent,/Import all 2 games/);
    assert.equal(h.$('study-import-submit').textContent,'Import all games');
    await h.$('study-import-form').dispatch('submit');
    assert.deepEqual(imports,[['https://lichess.org/alice001'],['https://lichess.org/other001'],['https://lichess.org/alice001','https://lichess.org/other001']]);
  }finally{globalThis.fetch=originalFetch;}
});

test('restored imports use the games saved before the authorization redirect',async()=>{
  const h=harness();await h.controller.restoreAuthorization();
  const saved={tournament,name:'Saved player study',visibility:'private',playerFilter,gameIds:['alice001'],expectedCount:2};
  h.controller.update({...h.current,gameIds:['alice001','other001']});h.controller.open(saved);
  assert.match(h.$('study-import-summary').textContent,/Import 1 games by Alice/);
  assert.equal(h.$('study-name').value,'Saved player study');assert.equal(h.$('study-visibility').value,'private');
});
