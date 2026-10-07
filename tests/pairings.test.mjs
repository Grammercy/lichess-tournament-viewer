import test from 'node:test';
import assert from 'node:assert/strict';
import { PairingStream } from '../src/pairings.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  let now=100000,timerId=0;
  const timers=new Map(),requests=[],games=[],limits=[];
  const stream=(users,signal,onGame,onOpen)=>new Promise((resolve,reject)=>{
    const request={users,signal,onGame,onOpen,resolve,reject};requests.push(request);
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
  const pairings=new PairingStream({stream,now:()=>now,onGame:game=>games.push(game),onRateLimit:at=>limits.push(at),timers:{
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}
  }});
  function advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.delay<=ms){timers.delete(id);timer.fn();}}
  return {pairings,requests,games,limits,timers,advance};
}

test('uses one capped, deduplicated player stream and delivers starts and results immediately',()=>{
  const h=harness();
  h.pairings.watch(['ALICE','alice','bob','bad user',...Array.from({length:400},(_,i)=>`user${i}`)]);
  h.advance(0);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].users.length,300);
  assert.ok(h.requests[0].users.includes('alice'));assert.ok(!h.requests[0].users.includes('bad user'));
  h.requests[0].onOpen();
  h.requests[0].onGame({id:'newgame1',statusName:'started'});
  h.requests[0].onGame({id:'newgame1',statusName:'mate',winner:'white'});
  assert.equal(h.games.length,2);
  h.pairings.close();assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.timers.size,0);
});

test('batches changing rosters at most once a minute and ignores events from superseded streams',async()=>{
  const h=harness();h.pairings.watch(['alice','bob']);h.advance(0);
  h.pairings.watch(['bob','alice']);assert.equal(h.timers.size,0);
  h.pairings.watch(['alice','bob','charlie']);h.pairings.watch(['alice','bob','charlie','dave']);
  assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,60000);
  assert.equal(h.requests[0].signal.aborted,false);
  h.advance(60000);await tick();
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].signal.aborted,true);
  assert.deepEqual(h.requests[1].users,['alice','bob','charlie','dave']);
  h.requests[0].onGame({id:'stale001'});assert.equal(h.games.length,0);
  h.pairings.close();
});

test('a hidden tab stops its stream and resumes with the current roster',async()=>{
  const h=harness();h.pairings.watch(['alice','bob']);h.advance(0);
  h.pairings.pause(true);await tick();assert.equal(h.requests[0].signal.aborted,true);
  h.pairings.watch(['alice','charlie']);h.advance(60000);assert.equal(h.requests.length,1);
  h.pairings.pause(false);h.advance(0);assert.equal(h.requests.length,2);
  assert.deepEqual(h.requests[1].users,['alice','charlie']);h.pairings.close();
});

test('rate limits wait at least a full minute, even across tab return and roster changes',async()=>{
  const h=harness();h.pairings.watch(['alice','bob']);h.advance(0);
  h.requests[0].reject(Object.assign(new Error('Rate limited'),{status:429,retryAfter:90}));await tick();
  assert.deepEqual(h.limits,[190000]);assert.equal([...h.timers.values()][0].delay,90000);
  h.pairings.pause(true);h.pairings.pause(false);h.pairings.watch(['alice','charlie']);
  assert.equal([...h.timers.values()][0].delay,90000);
  h.advance(0);assert.equal(h.requests.length,1);
  h.advance(90000);assert.equal(h.requests.length,2);h.pairings.close();
});

test('closed streams reconnect with backoff and closing the viewer cancels retries',async()=>{
  const h=harness();h.pairings.watch(['alice','bob']);h.advance(0);
  h.requests[0].resolve();await tick();assert.equal([...h.timers.values()][0].delay,5000);
  h.advance(5000);h.requests[1].reject(new Error('Offline'));await tick();
  assert.equal([...h.timers.values()][0].delay,10000);
  h.pairings.watch(['alice','charlie']);assert.equal([...h.timers.values()][0].delay,10000);
  h.pairings.close();assert.equal(h.timers.size,0);
});

test('an export rate limit also delays a pending roster change without closing a healthy stream',()=>{
  const h=harness();h.pairings.watch(['alice','bob']);h.advance(0);
  h.pairings.watch(['alice','bob','charlie']);h.pairings.deferUntil(190000);
  assert.equal(h.requests[0].signal.aborted,false);assert.equal([...h.timers.values()][0].delay,90000);
  h.advance(0);assert.equal(h.requests.length,1);
  h.advance(90000);assert.equal(h.requests.length,2);h.pairings.close();
});
