import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as model from '../src/model.js';

// Run the real update loop and visibility handler without rendering boards.
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('void initializeTournament();','const initialization=initializeTournament();');
const game=(id,status='started')=>({id,status,variant:'standard',moves:'e4 e5',clock:{initial:60},clocks:[5900,5900],players:{white:{user:{name:'White'}},black:{user:{name:'Black'}}}});

function harness({finished=true,authorization=null,initialGames=[]}={}){
  const events=new Map(),elements=new Map(),timers=new Map(),exports=[],pauses=[],discoveries=[],studyUpdates=[],studyOpens=[];
  let now=100000,timerId=0,infoCalls=0;
  let info={name:'Test tournament',isFinished:finished,nbPlayers:2};
  let reply=async ids=>ids.map(id=>game(id,'outoftime'));
  let discoverReply=async()=>{};
  const element=()=>({value:'',hidden:false,disabled:false,open:false,dataset:{},listeners:new Map(),classList:{toggle(){}},style:{setProperty(){}},addEventListener(name,callback){this.listeners.set(name,callback);},setAttribute(){},close(){this.open=false;}});
  const document={hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelector:()=>element(),querySelectorAll:()=>[],addEventListener(name,callback){events.set(name,callback);}};
  const context=vm.createContext({
    ...model,document,URL,URLSearchParams,AbortController,
    performance:{now:()=>now},Date:class extends Date{static now(){return now;}},
    location:{href:'http://localhost/',search:''},history:{replaceState(){}},
    window:{addEventListener(){}},IntersectionObserver:class{observe(){}unobserve(){}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    setInterval(){return 1;},clearInterval(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){},
    LiveGames:class{constructor(options){Object.assign(this,options);this.status='connected';}pause(value){pauses.push(value);}watch(){}close(){}},
    PairingStream:class{constructor(options){Object.assign(this,options);}pause(){}watch(){}close(){}deferUntil(){}},
    initThemeMenu:()=>({set(){}}),initStudyImport:()=>({update(value){studyUpdates.push(value);},open(...args){studyOpens.push(args);},restoreAuthorization:async()=>authorization}),
    loadTournamentData:async(tournament,signal,callbacks)=>{callbacks.onInfo(info,tournament);initialGames.forEach(callbacks.onGame);callbacks.onGamesComplete();},
    tournamentInfo:async()=>{infoCalls++;return info;},
    discoverTournamentGames:async(tournament,signal,onGame,options)=>{discoveries.push({tournament,options});await discoverReply(onGame,options);},
    refreshGames:async(ids,signal,onGame)=>{exports.push([...ids]);const games=await reply([...ids],signal);signal.throwIfAborted();games.forEach(onGame);},
  });
  vm.runInContext(source,context);
  const app=vm.runInContext('const renderView=render; render=()=>{}; let visibleGames=[]; renderGameGrid=games=>{visibleGames=games;return false;}; ({state,live,updateTournament,updateLiveStatus,applyPairingEvent,requestPairingDiscovery,finishLiveGame,cardHtml,renderView,initialization,get visibleGames(){return visibleGames;}})',context);
  Object.assign(app.state,{tournament:{type:'tournament',id:'testtour'},info,controller:new AbortController(),completeExport:true,lastDiscovery:now,lastInfoUpdate:now});
  return {
    ...app,exports,timers,pauses,discoveries,elements,studyUpdates,studyOpens,
    get visibleGames(){return app.visibleGames;},
    get infoCalls(){return infoCalls;},
    setInfo(value){info=value;},setReply(value){reply=value;},setDiscovery(value){discoverReply=value;},advance(ms){now+=ms;},
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

test('study imports use the player selection across both colors and all game tabs',()=>{
  const h=harness();
  const pairing=(id,white,black)=>({...game(id,'mate'),players:{white:{user:{id:white.toLowerCase(),name:white}},black:{user:{id:black.toLowerCase(),name:black}}}});
  for(const g of [pairing('alicew01','Alice','Bob'),pairing('aliceb01','Carol','Alice'),pairing('similar1','Alice2','Bob'),pairing('other001','Carol','Dave')])h.state.games.set(g.id,g);
  h.state.player='alice';h.state.search='alice';h.elements.get('player-search').value='Alice';
  for(const filter of ['all','finished','playing']){
    h.state.filter=filter;h.renderView();
    const update=h.studyUpdates.at(-1);
    assert.deepEqual(Array.from(update.gameIds).sort(),['aliceb01','alicew01']);
    assert.equal(update.gameCount,4);assert.equal(update.playerFilter.label,'Alice');
  }
  h.state.player=null;h.state.search='ali';h.elements.get('player-search').value='ali';h.renderView();
  assert.deepEqual(Array.from(h.studyUpdates.at(-1).gameIds).sort(),['aliceb01','alicew01','similar1']);
  h.state.search='';h.elements.get('player-search').value='';h.renderView();
  assert.equal(h.studyUpdates.at(-1).gameIds,null);assert.equal(h.studyUpdates.at(-1).playerFilter,null);
});

test('clicking a standings player selects all their games and clicking again returns to Playing',()=>{
  const h=harness();
  const clickPlayer=name=>h.elements.get('standings').listeners.get('click')({target:{closest:()=>({dataset:{player:name.toLowerCase(),playerName:name}})}});
  clickPlayer('Alice');
  assert.equal(h.state.player,'alice');assert.equal(h.state.search,'alice');assert.equal(h.state.filter,'all');
  assert.equal(h.elements.get('player-search').value,'Alice');
  clickPlayer('Bob');
  assert.equal(h.state.player,'bob');assert.equal(h.state.filter,'all');
  h.state.filter='finished';clickPlayer('Bob');
  assert.equal(h.state.player,null);assert.equal(h.state.search,'');assert.equal(h.state.filter,'playing');
  assert.equal(h.elements.get('player-search').value,'');
});

test('returning from study sign-in restores the player filter before reopening the import',async()=>{
  const intent={tournament:{type:'swiss',id:'testtour'},name:'White games',visibility:'private',gameIds:['white001'],expectedCount:2,playerFilter:{player:'white',search:'white',label:'White'}};
  const h=harness({authorization:{intent},initialGames:[game('white001','mate'),{...game('other001','mate'),players:{white:{user:{name:'Alice'}},black:{user:{name:'Bob'}}}}]});
  await h.initialization;
  assert.equal(h.state.player,'white');assert.equal(h.state.search,'white');assert.equal(h.state.filter,'all');
  assert.equal(h.elements.get('player-search').value,'White');
  assert.equal(h.studyOpens.length,1);assert.deepEqual(h.studyOpens[0],[intent,undefined]);
  h.renderView();assert.deepEqual(Array.from(h.studyUpdates.at(-1).gameIds),['white001']);
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

test('bursts of stream starts batch one tournament check without adding unrelated games',async()=>{
  const h=harness({finished:false});h.state.lastActiveRefresh=100000;
  h.state.games.set('active01',game('active01'));
  for(const id of ['newgame1','newgame2','other001'])h.applyPairingEvent({id,statusName:'started'});
  assert.equal(h.state.games.size,1);assert.equal(h.state.discoveryRequested,true);
  assert.equal(h.nextDelay(),5000);assert.equal(h.timers.size,1);
  h.setDiscovery(async onGame=>{onGame(game('newgame1'));onGame(game('newgame2'));});
  h.advance(5000);await h.updateTournament();
  assert.equal(h.discoveries.length,1);assert.equal(h.infoCalls,0);
  assert.equal(h.state.games.size,3);assert.equal(h.state.games.has('other001'),false);
  assert.equal(h.state.discoveryRequested,false);assert.deepEqual(h.exports,[]);
});

test('a streamed result ends play immediately without losing players or move history',()=>{
  const h=harness({finished:false});const original=game('active01');h.state.games.set(original.id,original);
  h.applyPairingEvent({id:original.id,statusName:'mate',winner:'white'});
  const finished=h.state.games.get(original.id);
  assert.equal(model.isPlaying(finished),false);assert.equal(finished.winner,'white');
  assert.equal(finished.moves,original.moves);assert.deepEqual(finished.players,original.players);
  assert.equal(h.state.finishedToRefresh.has(original.id),true);
  assert.equal(h.state.discoveryRequested,true);
});

test('Swiss Current round keeps streamed results visible, puts playing games first and replaces old rounds',()=>{
  const h=harness({finished:false});h.state.tournament.type='swiss';h.state.info.round=2;
  const pairing=(id,white,black,createdAt,status='started',winner)=>({...game(id,status),createdAt,lastMoveAt:createdAt+1000,winner,players:{white:{user:{name:white}},black:{user:{name:black}}}});
  const old=pairing('oldgame1','Alice','Bob',10000,'mate','white');
  const first=pairing('active01','Alice','Carol',20000);
  const second=pairing('active02','Bob','Dave',20001);
  h.state.info.rankingPlayers=[{username:'Alice',rank:1},{username:'Bob',rank:2}];
  [old,first,second].forEach(game=>h.state.games.set(game.id,game));
  h.renderView();
  assert.deepEqual(Array.from(h.visibleGames,g=>g.id),['active01','active02']);
  h.finishLiveGame({id:'active01',win:'w'});h.renderView();
  assert.deepEqual(Array.from(h.visibleGames,g=>g.id),['active02','active01']);
  assert.equal(h.elements.get('playing-tab-label').textContent,'Current round');
  assert.equal(h.elements.get('tab-playing').textContent,'2');
  assert.equal(h.elements.get('playing-count').textContent,'1');
  h.applyPairingEvent({id:'active02',statusName:'draw'});h.renderView();
  assert.equal(h.visibleGames.length,2);
  h.state.info.isFinished=true;h.renderView();
  assert.equal(h.elements.get('tournament-over').hidden,true);
  h.state.info.isFinished=false;h.state.info.round=3;
  h.state.games.set('nextrnd1',pairing('nextrnd1','Alice','Dave',30000));h.renderView();
  assert.deepEqual(Array.from(h.visibleGames,g=>g.id),['nextrnd1']);
  h.state.filter='all';h.renderView();assert.equal(h.visibleGames.length,4);
  h.state.filter='finished';h.renderView();assert.equal(h.visibleGames.length,3);
  h.state.filter='playing';h.state.tournament.type='tournament';h.renderView();
  assert.deepEqual(Array.from(h.visibleGames,g=>g.id),['nextrnd1']);
  assert.equal(h.elements.get('playing-tab-label').textContent,'Playing');
});

test('finished cards identify either winner after a board flip, and distinguish draws and unplayed games',()=>{
  const h=harness();const finished={...game('ended001','mate'),winner:'white'};
  const white=h.cardHtml(finished,0);
  assert.match(white,/game-card completed/);assert.match(white,/White won/);assert.match(white,/1–0/);
  assert.match(white,/player-row winner.*player-symbol white.*winner-badge/s);
  h.state.flipped.add(finished.id);
  assert.match(h.cardHtml(finished,0),/player-row winner.*player-symbol white.*winner-badge/s);
  finished.winner='black';
  assert.match(h.cardHtml(finished,0),/Black won/);
  assert.match(h.cardHtml(finished,0),/player-row winner.*player-symbol black.*winner-badge/s);
  delete finished.winner;finished.status='draw';
  const draw=h.cardHtml(finished,0);assert.match(draw,/Draw/);assert.match(draw,/½–½/);assert.doesNotMatch(draw,/winner-badge/);
  for(const status of ['aborted','noStart']){
    finished.status=status;const html=h.cardHtml(finished,0);
    assert.match(html,status==='aborted'?/Aborted/:/Not played/);assert.doesNotMatch(html,/½–½|winner-badge/);
  }
});

test('stream events during discovery retain another check with a five-second minimum gap',async()=>{
  const h=harness({finished:false});h.state.lastActiveRefresh=100000;
  h.state.games.set('active01',game('active01'));h.advance(5000);
  h.applyPairingEvent({id:'newgame1',statusName:'started'});
  let release;
  h.setDiscovery(()=>new Promise(resolve=>{release=resolve;}));
  const updating=h.updateTournament();assert.equal(h.state.busy,true);
  h.applyPairingEvent({id:'newgame2',statusName:'started'});
  await h.updateTournament();assert.equal(h.discoveries.length,1);
  release();await updating;
  assert.equal(h.state.discoveryRequested,true);assert.equal(h.nextDelay(),5000);
  h.setDiscovery(async()=>{});h.advance(5000);await h.updateTournament();
  assert.equal(h.discoveries.length,2);assert.equal(h.state.discoveryRequested,false);
});

test('a rate-limited pairing check retains the event and later events cannot bypass the backoff',async()=>{
  const h=harness({finished:false});h.state.lastActiveRefresh=100000;
  h.state.games.set('active01',game('active01'));h.advance(5000);
  h.applyPairingEvent({id:'newgame1',statusName:'started'});
  h.setDiscovery(async()=>{throw Object.assign(new Error('Rate limited'),{status:429,retryAfter:60});});
  await h.updateTournament();assert.equal(h.state.discoveryRequested,true);assert.equal(h.nextDelay(),61000);
  h.applyPairingEvent({id:'newgame2',statusName:'started'});assert.equal(h.nextDelay(),61000);
  await h.updateTournament();assert.equal(h.discoveries.length,1);
  h.advance(61000);h.setDiscovery(async()=>{});await h.updateTournament();
  assert.equal(h.discoveries.length,2);assert.equal(h.state.discoveryRequested,false);
});

test('normal discovery skips already live or hydrated ongoing histories',async()=>{
  const h=harness({finished:false});h.state.lastActiveRefresh=100000;
  h.state.games.set('active01',{...game('active01'),live:{fen:'position'}});
  h.state.games.set('export01',game('export01'));
  const pending={...game('pending1'),moves:undefined};h.state.games.set('pending1',pending);
  h.advance(5000);h.requestPairingDiscovery();await h.updateTournament();
  const hydrate=h.discoveries[0].options.shouldHydrate;
  assert.equal(hydrate(game('active01')),false);assert.equal(hydrate(game('export01')),false);
  assert.equal(hydrate(pending),true);
});

test('periodic result reconciliation exports stale boards and skips games with fresh live moves',async()=>{
  const h=harness({finished:false});
  h.state.games.set('fresh001',{...game('fresh001'),live:{receivedAt:99000}});
  h.state.games.set('stale001',{...game('stale001'),live:{receivedAt:69000}});
  h.state.games.set('export01',game('export01'));
  await h.updateTournament();
  assert.deepEqual(h.exports,[['stale001','export01']]);
  assert.equal(model.isPlaying(h.state.games.get('fresh001')),true);
});
