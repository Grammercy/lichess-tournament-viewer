import { streamPlayerGames } from './api.js';

// One public player stream announces starts/finishes, not moves. Larger
// tournaments still use periodic discovery for players beyond its 300-user cap.
export class PairingStream {
  constructor({onGame,onRateLimit,stream=streamPlayerGames,timers=globalThis,now=Date.now}){
    Object.assign(this,{onGame,onRateLimit,stream,timers,now});
    this.users=[];
    this.paused=false;
    this.controller=null;
    this.timer=null;
    this.retryAt=0;
    this.rosterAt=0;
    this.failures=0;
  }
  watch(users){
    const next=[...new Set(users.map(user=>String(user??'').toLowerCase()).filter(user=>/^[a-z0-9_-]{2,30}$/.test(user)))].slice(0,300).sort();
    if(next.length===this.users.length&&next.every((user,i)=>user===this.users[i]))return;
    this.users=next;
    if(next.length<2){this.stop();return;}
    // Rankings can change on every refresh. Apply roster changes together,
    // at most once a minute, while keeping the current stream open.
    this.schedule(Math.max(this.retryAt,this.controller?this.rosterAt:0)-this.now());
  }
  pause(paused){
    if(this.paused===paused)return;
    this.paused=paused;
    if(paused)this.stop();
    else this.schedule(this.retryAt-this.now());
  }
  close(){this.users=[];this.stop();}
  deferUntil(at){
    this.retryAt=Math.max(this.retryAt,at);
    if(this.timer!==null)this.schedule(Math.max(this.retryAt,this.controller?this.rosterAt:0)-this.now());
  }
  stop(){
    this.timers.clearTimeout(this.timer);this.timer=null;
    this.controller?.abort();this.controller=null;
  }
  schedule(delay=0){
    this.timers.clearTimeout(this.timer);this.timer=null;
    if(this.paused||this.users.length<2)return;
    this.timer=this.timers.setTimeout(()=>{this.timer=null;void this.connect();},Math.max(0,delay));
  }
  async connect(){
    if(this.paused||this.users.length<2)return;
    if(this.now()<this.retryAt){this.schedule(this.retryAt-this.now());return;}
    this.controller?.abort();
    const controller=this.controller=new AbortController();
    this.rosterAt=this.now()+60000;
    try{
      await this.stream([...this.users],controller.signal,game=>{
        if(this.controller===controller&&!controller.signal.aborted)this.onGame(game);
      },()=>{if(this.controller===controller)this.failures=0;});
    }catch(error){
      if(this.controller!==controller||controller.signal.aborted)return;
      if(error.status===429){
        this.retryAt=this.now()+Math.max(60,error.retryAfter||60)*1000;
        this.onRateLimit?.(this.retryAt);
      }
    }
    if(this.controller!==controller||controller.signal.aborted)return;
    this.controller=null;
    this.failures++;
    this.retryAt=Math.max(this.retryAt,this.now()+Math.min(5000*2**(this.failures-1),60000));
    this.schedule(this.retryAt-this.now());
  }
}
