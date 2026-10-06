import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as model from '../src/model.js';

// Run the real update loop and visibility handler without rendering boards.
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'');
const game=(id,status='started')=>({id,status,variant:'standard',moves:'e4 e5',clock:{initial:60},clocks:[5900,5900],players:{white:{user:{name:'White'}},black:{user:{name:'Black'}}}});

function harness({finished=true}={}){
  const events=new Map(),elements=new Map(),timers=new Map(),exports=[],pauses=[];
  let now=100000,timerId=0,infoCalls=0;
  let info={name:'Test tournament',isFinished:finished,nbPlayers:2};
  let reply=async ids=>ids.map(id=>game(id,'outoftime'));
  const element=()=>({hidden:false,disabled:false,open:false,dataset:{},classList:{toggle(){}},style:{setProperty(){}},addEventListener(){},setAttribute(){},close(){this.open=false;}});
  const document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelector:()=>element(),querySelectorAll:()=>[],addEventListener(name,callback){events.set(name,callback);}};
  const context=vm.createContext({
    ...model,document,URL,URLSearchParams,AbortController,
    performance:{now:()=>now},Date:class extends Date{static now(){return now;}},
    location:{href:'http://localhost/',search:''},history:{replaceState(){}},
    window:{addEventListener(){}},IntersectionObserver:class{observe(){}unobserve(){}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    setInterval(){return 1;},clearInterval(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){},
    LiveGames:class{constructor(options){Object.assign(this,options);this.status='connected';}pause(value){pauses.push(value);}watch(){}close(){}},
    initThemeMenu:()=>({set(){}}),initStudyImport:()=>({update(){},restoreAuthorization:async()=>null}),
    tournamentInfo:async()=>{infoCalls++;return info;},
    discoverTournamentGames:async()=>{},
    refreshGames:async(ids,signal,onGame)=>{exports.push([...ids]);const games=await reply([...ids],signal);signal.throwIfAborted();games.forEach(onGame);},
  });
  vm.runInContext(source,context);
  const app=vm.runInContext('render=()=>{}; ({state,live,updateTournament,updateLiveStatus})',context);
  Object.assign(app.state,{tournament:{type:'tournament',id:'testtour'},info,controller:new AbortController(),completeExport:true,lastDiscovery:now,lastInfoUpdate:now});
  return {
    ...app,exports,timers,pauses,
    get infoCalls(){return infoCalls;},
    setInfo(value){info=value;},setReply(value){reply=value;},advance(ms){now+=ms;},
    visibility(hidden){document.hidden=hidden;events.get('visibilitychange')();},
    nextDelay(){return timers.get(app.state.timer)?.delay;},
  };
}

test('returning to an ended tournament confirms every game that finished while hidden',async()=>{
  const h=harness();
  for(let i=0;i<40;i++){const id=String(i).padStart(8,'0');h.state.games.set(id,game(id));}
  h.visibility(true);h.advance(300000);h.visibility(false);
  assert.deepEqual(h.pauses,[false,true,false]);
  assert.equal(h.nextDelay(),0);
  await h.updateTournament();
  assert.equal(h.infoCalls,1);
  assert.equal(h.exports[0].length,40); // Active catch-up is not capped by the history batch size.
  assert.ok([...h.state.games.values()].every(g=>!model.isPlaying(g)));
  assert.equal(h.state.refreshActiveGames,false);
});

test('a quick tab return refreshes status even before the normal polling interval',async()=>{
  const h=harness({finished:false});h.state.games.set('active01',game('active01'));
  h.setInfo({name:'Test tournament',isFinished:true,nbPlayers:2});
  h.visibility(true);h.advance(1000);h.visibility(false);
  await h.updateTournament();
  assert.equal(h.infoCalls,1);
  assert.equal(h.state.info.isFinished,true);
  assert.deepEqual(h.exports,[['active01']]);
  assert.equal(h.state.games.get('active01').status,'outoftime');
});

test('a tab return during an in-flight update schedules a second catch-up after it completes',async()=>{
  const h=harness();h.state.games.set('active01',game('active01'));
  let release;
  h.setReply(ids=>new Promise(resolve=>{release=()=>resolve(ids.map(id=>game(id)));}));
  const updating=h.updateTournament();
  assert.equal(h.state.busy,true);
  h.visibility(true);h.visibility(false);
  await h.updateTournament(); // Busy updates must retain the catch-up request.
  release();await updating;
  assert.equal(h.state.refreshActiveGames,true);
  assert.equal(h.nextDelay(),0);
  h.setReply(async ids=>ids.map(id=>game(id,'mate')));
  await h.updateTournament();
  assert.equal(h.exports.length,2);
  assert.equal(h.state.games.get('active01').status,'mate');
});

test('socket reconnection confirms missed results without waiting for another move',async()=>{
  const h=harness({finished:false});h.state.games.set('active01',game('active01'));
  h.state.liveStatus='reconnecting';h.updateLiveStatus('connected');
  assert.equal(h.nextDelay(),0);
  await h.updateTournament();
  assert.deepEqual(h.exports,[['active01']]);
  assert.equal(h.state.games.get('active01').status,'outoftime');
});

test('ended tournaments keep reconciling unconfirmed games without rapid polling',async()=>{
  const h=harness();h.state.games.set('active01',game('active01'));
  h.setReply(async ids=>ids.map(id=>game(id)));
  await h.updateTournament();
  assert.equal(h.exports.length,1);
  assert.equal(h.state.finishedToRefresh.size,0);
  assert.equal(h.nextDelay(),30000);
  h.advance(1000);await h.updateTournament();
  assert.equal(h.exports.length,1);
  h.advance(29000);await h.updateTournament();
  assert.equal(h.exports.length,2);
});

test('rate-limited catch-up retains its work and waits before retrying',async()=>{
  const h=harness();h.state.games.set('active01',game('active01'));
  h.visibility(true);h.visibility(false);
  h.setReply(async()=>{throw Object.assign(new Error('Rate limited'),{status:429,retryAfter:60});});
  await h.updateTournament();
  assert.equal(h.state.refreshActiveGames,true);
  assert.equal(h.nextDelay(),61000);
  await h.updateTournament();
  assert.equal(h.exports.length,1);
  assert.equal(h.nextDelay(),61000);
  h.advance(61000);h.setReply(async ids=>ids.map(id=>game(id,'mate')));
  await h.updateTournament();
  assert.equal(h.state.refreshActiveGames,false);
  assert.equal(h.state.games.get('active01').status,'mate');
});

test('a catch-up for a fully confirmed tournament does not export completed games again',async()=>{
  const h=harness();h.state.games.set('ended001',game('ended001','mate'));
  h.visibility(true);h.visibility(false);
  await h.updateTournament();
  assert.equal(h.infoCalls,1);
  assert.deepEqual(h.exports,[]);
});
