// The same position/clock messages used by Lichess's mini-game boards.
// /api/socket permits third-party clients; /socket/v5 is restricted to Lichess.
const domains = Array.from({length:6},(_,i)=>`socket${i}.lichess.org`);
const gamesPerSocket = 16;

export class LiveGames {
  constructor({onPosition,onFinish,onStatus,WebSocket=globalThis.WebSocket,timers=globalThis}) {
    Object.assign(this,{onPosition,onFinish,onStatus,WebSocket,timers});
    this.ids=[];
    this.peers=[];
    this.paused=false;
    this.status='idle';
  }
  watch(ids) {
    const next=[...new Set(ids)].filter(id=>/^[a-zA-Z0-9]{8}$/.test(id)).sort();
    if(next.length===this.ids.length&&next.every((id,i)=>id===this.ids[i]))return;
    this.ids=next;
    this.sync();
  }
  pause(paused) {
    if(this.paused===paused)return;
    this.paused=paused;
    this.sync();
  }
  close() {
    this.ids=[];
    this.sync();
  }
  sync() {
    if(this.paused||!this.ids.length) {
      while(this.peers.length)this.peers.pop().close();
      this.updateStatus();
      return;
    }
    // Keep each ongoing game on its current socket as other games finish.
    const remaining=new Set(this.ids);
    const groups=this.peers.map(peer=>peer.ids.filter(id=>remaining.delete(id)));
    for(let i=0;i<groups.length;i++) {
      for(const id of remaining) {
        if(groups[i].length===gamesPerSocket)break;
        groups[i].push(id);
        remaining.delete(id);
      }
      if(groups[i].length)this.peers[i].watch(groups[i]);
    }
    this.peers=this.peers.filter((peer,i)=>{if(groups[i].length)return true;peer.close();return false;});
    const pending=[...remaining];
    for(let i=0;i<pending.length;i+=gamesPerSocket) {
      const peer=new LivePeer(this,pending.slice(i,i+gamesPerSocket),this.peers.length);
      this.peers.push(peer);
      peer.connect();
    }
    this.updateStatus();
  }
  updateStatus() {
    const next=!this.ids.length?'idle':this.paused?'paused':this.peers.every(peer=>peer.connected)?'connected':this.peers.some(peer=>peer.failures)?'reconnecting':'connecting';
    if(next!==this.status){this.status=next;this.onStatus?.(next);}
  }
}

class LivePeer {
  constructor(owner,ids,index) {
    this.owner=owner;
    this.ids=ids;
    this.domain=index%domains.length;
    this.failures=0;
    this.connected=false;
    this.stopped=false;
  }
  watch(ids) {
    if(ids.length===this.ids.length&&ids.every((id,i)=>id===this.ids[i]))return;
    this.ids=ids;
    if(this.connected){
      // startWatching adds IDs to a 16-game queue. Removed games still occupy
      // it, so reuse can silently evict games we still need to watch.
      if(new Set([...this.subscribedIds,...ids]).size>gamesPerSocket){
        this.disconnect();
        this.connect();
        this.owner.updateStatus();
      }else this.subscribe();
    }
  }
  subscribe() {
    this.socket.send(JSON.stringify({t:'startWatching',d:this.ids.join(' ')}));
    this.ids.forEach(id=>this.subscribedIds.add(id));
  }
  connect() {
    if(this.stopped)return;
    try {
      const socket=this.socket=new this.owner.WebSocket(`wss://${domains[this.domain]}/api/socket`);
      socket.onopen=()=>{
        if(this.socket!==socket)return;
        this.clearTimers();
        this.connected=true;
        this.failures=0;
        this.subscribedIds=new Set();
        this.subscribe();
        this.ping();
        this.owner.updateStatus();
      };
      socket.onmessage=event=>{
        if(this.socket!==socket)return;
        if(event.data==='0'){this.pong();return;}
        let message;try{message=JSON.parse(event.data);}catch{return;}
        this.receive(message);
      };
      socket.onerror=socket.onclose=()=>{if(this.socket===socket)this.reconnect();};
      this.timeout=this.owner.timers.setTimeout(()=>this.reconnect(),9000);
    } catch {this.reconnect();}
  }
  receive(message) {
    if(this.stopped||!this.connected||!message||typeof message!=='object')return;
    if(message.t==='n')this.pong();
    else if(message.t==='batch'&&Array.isArray(message.d))message.d.forEach(item=>this.receive(item));
    else if(message.t==='resync'||message.t==='serverRestart')this.reconnect();
    else if(this.ids.includes(message.d?.id)) {
      if(message.t==='fen')this.owner.onPosition?.(message.d);
      else if(message.t==='finish')this.owner.onFinish?.(message.d);
    }
  }
  ping() {
    if(!this.connected)return;
    try{this.socket.send('p');}catch{this.reconnect();return;}
    this.timeout=this.owner.timers.setTimeout(()=>this.reconnect(),9000);
  }
  pong() {
    this.owner.timers.clearTimeout(this.timeout);
    this.owner.timers.clearTimeout(this.pingTimer);
    this.pingTimer=this.owner.timers.setTimeout(()=>this.ping(),2500);
  }
  clearTimers() {
    for(const timer of [this.timeout,this.pingTimer,this.retry])this.owner.timers.clearTimeout(timer);
  }
  disconnect() {
    this.clearTimers();
    this.connected=false;
    const socket=this.socket;
    this.socket=null;
    if(socket){socket.onopen=socket.onmessage=socket.onerror=socket.onclose=null;socket.close();}
  }
  reconnect() {
    this.disconnect();
    if(this.stopped)return;
    this.failures++;
    this.domain=(this.domain+1)%domains.length;
    this.retry=this.owner.timers.setTimeout(()=>this.connect(),Math.min(3500*2**(this.failures-1),30000));
    this.owner.updateStatus();
  }
  close() {
    this.stopped=true;
    this.disconnect();
  }
}
