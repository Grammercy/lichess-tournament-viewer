import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveGames } from '../src/live.js';

function harness() {
  const sockets=[],positions=[],finishes=[],statuses=[];
  const scheduled=new Map();
  let timerId=0;
  const timers={setTimeout(fn,delay){const id=++timerId;scheduled.set(id,{fn,delay});return id;},clearTimeout(id){scheduled.delete(id);}};
  class Socket {
    constructor(url){this.url=url;this.sent=[];this.closed=false;sockets.push(this);}
    send(data){assert.equal(this.closed,false);this.sent.push(data);}
    open(){this.onopen?.();}
    receive(data){this.onmessage?.({data:typeof data==='string'?data:JSON.stringify(data)});}
    close(){this.closed=true;this.onclose?.();}
  }
  const live=new LiveGames({WebSocket:Socket,timers,onPosition:data=>positions.push(data),onFinish:data=>finishes.push(data),onStatus:status=>statuses.push(status)});
  function advance(delay){const ready=[...scheduled].filter(([,timer])=>timer.delay===delay);for(const [id,timer] of ready){scheduled.delete(id);timer.fn();}}
  return {live,sockets,positions,finishes,statuses,scheduled,advance};
}
const gameId=index=>String(index).padStart(8,'0');
const watched=socket=>socket.sent.filter(item=>item!=='p').map(JSON.parse).filter(item=>item.t==='startWatching').at(-1).d.split(' ');

test('streams all games without the per-socket 16-game limit dropping any boards',()=>{
  const h=harness();
  const ids=Array.from({length:35},(_,i)=>gameId(i));
  h.live.watch([...ids,ids[0],'invalid']);
  assert.equal(h.sockets.length,3);
  h.sockets.forEach(socket=>socket.open());
  assert.deepEqual(h.sockets.flatMap(watched),ids);
  assert.ok(h.sockets.every(socket=>watched(socket).length<=16&&socket.url.endsWith('/api/socket')));
  assert.equal(h.live.status,'connected');
  h.live.watch(ids);
  assert.equal(h.sockets.length,3);
  assert.ok(h.sockets.every(socket=>socket.sent.length===2));
  h.live.close();
  assert.equal(h.scheduled.size,0);
});

test('delivers position and result events immediately, including batched events',()=>{
  const h=harness();h.live.watch([gameId(1)]);const socket=h.sockets[0];socket.open();
  const fen={id:gameId(1),fen:'8/8/8/8/8/8/8/8 w',lm:'e2e4',wc:60,bc:59};
  socket.receive({t:'batch',d:[{t:'fen',d:fen},{t:'finish',d:{id:gameId(1),win:'w'}},{t:'fen',d:{...fen,id:gameId(2)}}]});
  assert.deepEqual(h.positions,[fen]);
  assert.deepEqual(h.finishes,[{id:gameId(1),win:'w'}]);
  socket.receive('not JSON');socket.receive(null);
  assert.equal(h.positions.length,1);
  h.live.close();
});

test('keeps ongoing games on the same socket when other games finish or join',()=>{
  const h=harness();const ids=Array.from({length:33},(_,i)=>gameId(i));
  h.live.watch(ids);h.sockets.forEach(socket=>socket.open());
  const second=h.sockets[1],third=h.sockets[2];
  const secondMessages=second.sent.length,thirdMessages=third.sent.length;
  h.live.watch(ids.slice(1));
  assert.equal(second.sent.length,secondMessages);assert.equal(third.sent.length,thirdMessages);
  h.live.watch([...ids.slice(1),gameId(33)]);
  assert.equal(h.sockets.length,3);assert.ok(watched(h.sockets[0]).includes(gameId(33)));
  assert.equal(second.sent.length,secondMessages);assert.equal(third.sent.length,thirdMessages);
  h.live.close();
});

test('reconnects on loss and restores subscriptions, while stale sockets cannot update boards',()=>{
  const h=harness();h.live.watch([gameId(1)]);const first=h.sockets[0];first.open();
  const staleMessage=first.onmessage;
  first.close();assert.equal(h.live.status,'reconnecting');
  h.advance(3500);assert.equal(h.sockets.length,2);
  const second=h.sockets[1];second.open();
  assert.deepEqual(watched(second),[gameId(1)]);
  assert.notEqual(first.url,second.url);
  staleMessage({data:JSON.stringify({t:'fen',d:{id:gameId(1)}})});
  assert.equal(h.positions.length,0);
  second.receive({t:'fen',d:{id:gameId(1)}});
  assert.equal(h.positions.length,1);
  h.live.close();assert.equal(h.scheduled.size,0);
});

test('pings after each pong and reconnects when a connection stops responding',()=>{
  const h=harness();h.live.watch([gameId(1)]);const socket=h.sockets[0];socket.open();
  socket.receive('0');h.advance(2500);
  assert.equal(socket.sent.filter(item=>item==='p').length,2);
  h.advance(9000);assert.equal(socket.closed,true);assert.equal(h.live.status,'reconnecting');
  h.live.close();
});

test('pauses, resumes, and switches subscriptions without delivering obsolete game events',()=>{
  const h=harness();h.live.watch([gameId(1)]);const first=h.sockets[0];first.open();
  h.live.pause(true);assert.equal(first.closed,true);assert.equal(h.scheduled.size,0);assert.equal(h.live.status,'paused');
  h.live.watch([gameId(2)]);assert.equal(h.sockets.length,1);
  h.live.pause(false);const second=h.sockets[1];second.open();assert.deepEqual(watched(second),[gameId(2)]);
  h.live.watch([gameId(3)]);assert.deepEqual(watched(second),[gameId(3)]);
  second.receive({t:'fen',d:{id:gameId(2)}});assert.equal(h.positions.length,0);
  second.receive({t:'fen',d:{id:gameId(3)}});assert.equal(h.positions.length,1);
  h.live.close();assert.equal(second.closed,true);assert.equal(h.live.status,'idle');
});
