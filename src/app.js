import { gamePosition, clockValues, formatClock, isPlaying, resultOf, parseTournament, mergeGameData, withLivePosition, orderTournamentGames } from './model.js';
import { tournamentInfo, tournamentGames, refreshGames } from './api.js';
import { LiveGames } from './live.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={games:new Map(),positions:new Map(),filter:'playing',search:'',flipped:new Set(),selected:null,tournament:null,info:null,controller:null,loading:false,busy:false,retryAt:0,timer:null,renderTimer:null,lastDiscovery:0,newestCreatedAt:0,finishedToRefresh:new Set(),liveStatus:'idle',clockPausedAt:performance.now()};
state.completeExport=true;
const live=new LiveGames({onPosition:applyLivePosition,onFinish:finishLiveGame,onStatus:updateLiveStatus});
live.pause(document.hidden);
const cardCache=new Map();
const boardObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const game=state.games.get(entry.target.dataset.gameId);if(game){const button=entry.target.querySelector('.board-button');if(button)button.innerHTML=boardHtml(positionFor(game),state.flipped.has(game.id));}boardObserver.unobserve(entry.target);}},{rootMargin:'500px'});
const flipIcon='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m4 7 3-3 3 3M7 4v13m13 0-3 3-3-3m3 3V7"/></svg>';
function positionFor(game){const old=state.positions.get(game.id);try{if(old?.sourceMoves===game.moves && old.sourceLive===game.live && old.initialFen===game.initialFen && old.variant===game.variant)return old;const pos=gamePosition(game,old);pos.sourceMoves=game.moves;pos.sourceLive=game.live;state.positions.set(game.id,pos);return pos;}catch{return null;}}
function boardHtml(pos,flipped){if(!pos)return '<div class="position-error">Position unavailable</div>';let html='<div class="board" aria-hidden="true">';for(let row=0;row<8;row++)for(let col=0;col<8;col++){const rank=flipped?row:7-row,file=flipped?7-col:col,index=rank*8+file;const dark=(rank+file)%2===0;const last=pos.last&&(pos.last.from===index||pos.last.to===index);html+=`<span class="square${dark?' dark':''}${last?' last':''}">${pos.squares[index]?`<img src="/pieces/${pos.squares[index]}.svg" alt="" draggable="false">`:''}${col===0?`<span class="coordinate rank">${rank+1}</span>`:''}${row===7?`<span class="coordinate file">${'abcdefgh'[file]}</span>`:''}</span>`;}return html+'</div>';}
function clockNow(){return live.status==='connected'?performance.now():state.clockPausedAt;}
function playerHtml(game,color,pos){const player=game.players?.[color]??{};const name=player.user?.name??player.name??'Anonymous';const time=clockValues(game,pos,clockNow())[color];return `<div class="player-row"><span class="player-symbol ${color}"></span>${player.user?.title?`<span class="player-title">${esc(player.user.title)}</span>`:''}<span class="player-name" title="${esc(name)}">${esc(name)}</span><span class="rating">${esc(player.rating??'')}</span><span class="player-clock${isPlaying(game)&&pos?.turn===color?' to-move':''}${isPlaying(game)&&time<20?' low':''}" data-clock-game="${esc(game.id)}" data-clock-color="${color}" title="${game.live?'Live clock':'Clock at last available move'}">${formatClock(time)}</span></div>`;}
function lastMoveLabel(game,pos){if(game.live)return esc((game.live.uci??'').replace(/^([a-h][1-8])([a-h][1-8])(.*)$/,'$1–$2$3'))||'—';return pos&&pos.moves.length?`${Math.ceil(pos.moves.length/2)}. ${esc(pos.moves.at(-1))}`:'—';}
function cardHtml(game,index,detail=false){
  const moves=(game.moves??'').trim().split(/\s+/).filter(Boolean);
  const firstTurn=game.initialFen?.split(' ')[1]==='b'?1:0;
  const pos=detail?positionFor(game):{moves,turn:game.live?.turn??((moves.length+firstTurn)%2?'black':'white')};
  const flipped=state.flipped.has(game.id),playing=isPlaying(game);
  return `<article class="game-card" data-game-id="${esc(game.id)}"><div class="game-topline"><span class="game-number">${detail?'':`#${index+1}`}</span><span class="game-state${playing?' live':''}">${playing?'<span class="live-dot"></span>Playing':`<span class="result-label">${resultOf(game)}</span>`}</span></div>${playerHtml(game,flipped?'white':'black',pos)}${detail?boardHtml(pos,flipped):`<button class="board-button" data-open="${esc(game.id)}" aria-label="View ${esc(game.players?.white?.user?.name??'White')} versus ${esc(game.players?.black?.user?.name??'Black')}"><div class="board-placeholder"></div></button>`}${playerHtml(game,flipped?'black':'white',pos)}<div class="game-bottomline"><span class="opening-name" title="${esc(game.opening?.name??'')}">${esc(game.opening?.name??prettyVariant(game.variant))}</span><div class="game-bottom-actions"><span>${lastMoveLabel(game,pos)}</span><button class="flip-button" data-flip="${esc(game.id)}" aria-label="Flip board" title="Flip board">${flipIcon}</button></div></div></article>`;
}
function render(){
  live.watch([...state.games.values()].filter(isPlaying).map(game=>game.id));
  const loaded=Boolean(state.tournament);
  document.querySelector('.app-shell').classList.toggle('awaiting-tournament',!loaded);
  $('no-tournament').hidden=loaded;
  for(const id of ['tournament-panel','standings-panel','page-heading','summary-strip','toolbar','main-footer'])$(id).hidden=!loaded;
  document.querySelectorAll('[data-filter]').forEach(tab=>{const active=tab.dataset.filter===state.filter;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
  const all=orderTournamentGames(state.games.values(),state.info,state.tournament?.type);
  const playing=all.filter(isPlaying).length;
  for(const [id,val] of [['total-count',all.length],['playing-count',playing],['finished-count',all.length-playing],['tab-all',all.length],['tab-playing',playing],['tab-finished',all.length-playing]])$(id).textContent=val.toLocaleString();
  const visible=all.filter(g=>(state.filter==='all'||(state.filter==='playing')===isPlaying(g))&&JSON.stringify(g.players).toLowerCase().includes(state.search));
  const visibleIds=new Set(visible.map(g=>g.id));
  for(const [id,cached] of cardCache) {if(!state.games.has(id)){boardObserver.unobserve(cached.node);cached.node.remove();cardCache.delete(id);}else cached.node.hidden=!visibleIds.has(id);}
  for(let i=0;i<visible.length;i++) {
    const game=visible[i];const signature=JSON.stringify([game,i,state.flipped.has(game.id)]);let cached=cardCache.get(game.id);
    if(cached?.signature!==signature){const template=document.createElement('template');template.innerHTML=cardHtml(game,i);const node=template.content.firstElementChild;const drawn=Boolean(cached?.node.querySelector('.board'));if(drawn)node.querySelector('.board-button').innerHTML=boardHtml(positionFor(game),state.flipped.has(game.id));if(cached){boardObserver.unobserve(cached.node);cached.node.replaceWith(node);}cached={node,signature};cardCache.set(game.id,cached);if(!drawn)boardObserver.observe(node);}
    cached.node.hidden=false;cached.node.style.order=i;if(cached.node.parentNode!==$('game-grid'))$('game-grid').append(cached.node);
  }
  $('empty-state').hidden=!loaded||visible.length>0;
  $('empty-title').textContent=state.loading?'Loading games…':state.games.size?'No matching games':'No games yet';
  $('empty-message').textContent=state.loading?'':state.games.size?'Try another player or game filter.':'Games will appear when play starts.';
  $('visible-caption').textContent=visible.length===all.length?`${all.length.toLocaleString()} games`:`${visible.length.toLocaleString()} of ${all.length.toLocaleString()} games`;
  if(state.selected&&$('game-dialog').open)renderDialog();
}
function queueRender(){if(state.renderTimer===null)state.renderTimer=requestAnimationFrame(()=>{state.renderTimer=null;render();});}
function applyLivePosition(data){const game=state.games.get(data.id);if(!game||!isPlaying(game))return;try{const updated=withLivePosition(game,data);if(updated!==game){state.games.set(game.id,updated);queueRender();}}catch{}}
function finishLiveGame(data){const game=state.games.get(data.id);if(!game||!isPlaying(game))return;const now=clockNow();const snapshot=game.live?{...game.live,clocks:clockValues(game,null,now),receivedAt:now}:undefined;state.games.set(game.id,{...game,live:snapshot,status:'finished',winner:data.win==='w'?'white':data.win==='b'?'black':undefined});state.finishedToRefresh.add(game.id);queueRender();}
function updateLiveStatus(status){if(state.liveStatus==='connected'||state.liveStatus==='idle')state.clockPausedAt=performance.now();state.liveStatus=status;if(state.tournament)markUpdated();}
function renderClocks(){if(document.hidden)return;const now=clockNow();document.querySelectorAll('[data-clock-game]').forEach(element=>{const game=state.games.get(element.dataset.clockGame);if(!game?.live||element.closest('.game-card')?.hidden)return;const color=element.dataset.clockColor;const value=clockValues(game,null,now)[color];element.textContent=formatClock(value);element.classList.toggle('low',isPlaying(game)&&value<20);});}
function showNotice(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function setStatus(text,connected=false){$('update-status').innerHTML=`<span class="${connected?'live-dot':'connection-dot'}"></span>${esc(text)}`;}
function tourFinished(info){return info?.isFinished===true||info?.status==='finished';}
function updateInfo(info){
  state.info=info;const name=info.fullName??info.name??'Tournament';$('tournament-name').textContent=name;$('page-tournament-name').textContent=name;document.title=`Viewing ${name}`;
  $('tournament-kind').textContent=state.tournament.type==='swiss'?'SWISS':`${info.perf?.name??'ARENA'} ARENA`;
  const finished=tourFinished(info);const pending=info.status==='created'||info.isStarted===false;
  $('tournament-status').textContent=finished?'FINISHED':pending?'UPCOMING':'PLAYING';$('tournament-status').classList.toggle('playing',!finished&&!pending);
  $('rated-label').textContent=`${info.rated?'Rated':'Casual'} · ${prettyVariant(info.variant)}`;
  $('time-control').textContent=info.clock?`${info.clock.limit/60} + ${info.clock.increment}`:'—';$('player-count').textContent=(info.nbPlayers??0).toLocaleString();
  $('duration').textContent=state.tournament.type==='swiss'?`${info.round??0} / ${info.nbRounds??0} rounds`:`${info.minutes??'—'} minutes`;
  $('tournament-external').href=`https://lichess.org/${state.tournament.type}/${state.tournament.id}`;
  const standings=info.standing?.players??info.podium??[];$('standings').innerHTML=standings.slice(0,5).map(p=>`<li>${p.title?`<span class="player-title">${esc(p.title)}</span>`:''}<span class="standing-name">${esc(p.name??p.user?.name??p.id)}</span><span class="standing-points">${esc(p.score??'')}</span></li>`).join('');
  $('standings-note').textContent=standings.length?'':state.tournament.type==='swiss'?'Standings on Lichess':'No standings yet';
}
function prettyVariant(variant){return ({standard:'Standard',chess960:'Chess960',kingOfTheHill:'King of the Hill',threeCheck:'Three-check',racingKings:'Racing Kings',crazyhouse:'Crazyhouse',atomic:'Atomic',horde:'Horde',antichess:'Antichess',fromPosition:'From position'})[variant]??variant??'Standard';}
function mergeGame(game){if(!game?.id||!game.players)return;const previous=state.games.get(game.id);state.games.set(game.id,mergeGameData(previous,game));state.newestCreatedAt=Math.max(state.newestCreatedAt,game.createdAt??0);queueRender();}
function markUpdated(){const playing=[...state.games.values()].some(isPlaying);const finished=tourFinished(state.info)&&!playing;const connected=playing&&live.status==='connected';setStatus(state.loading?'Loading games…':finished?'Finished':playing?({connected:'Live',connecting:'Connecting…',reconnecting:'Reconnecting…',paused:'Paused'}[live.status]??'Connecting…'):'Connected',connected);}
function scheduleUpdates(delay=30000){clearTimeout(state.timer);if(state.tournament)state.timer=setTimeout(()=>{if(document.hidden){scheduleUpdates();return;}void updateTournament();},delay);}
function handleError(error){if(error.name==='AbortError')return;showNotice(error.message||'Could not connect to Lichess. Try again.',true);markUpdated();if(error.status===429){state.retryAt=Date.now()+error.retryAfter*1000;scheduleUpdates(error.retryAfter*1000+1000);}else scheduleUpdates(30000);}
async function loadTournament(value){
  let tournament;try{tournament=parseTournament(value);}catch(error){showNotice(error.message,true);return {ok:false,error:error.message};}
  state.controller?.abort();clearTimeout(state.timer);const controller=new AbortController();state.controller=controller;state.busy=true;$('watch-button').disabled=true;showNotice('');setStatus('Connecting…');
  try {
    let info;try{info=await tournamentInfo(tournament,controller.signal);}catch(error){if(error.status!==404||tournament.type==='swiss')throw error;tournament={...tournament,type:'swiss'};info=await tournamentInfo(tournament,controller.signal);}
    if(controller.signal.aborted)return {ok:false};
    live.close();state.tournament=tournament;state.filter='playing';state.games.clear();state.positions.clear();state.flipped.clear();state.finishedToRefresh.clear();state.newestCreatedAt=0;state.retryAt=0;state.loading=true;state.completeExport=false;state.selected=null;$('game-dialog').close();$('tournament-input').value=`https://lichess.org/${tournament.type}/${tournament.id}`;$('watch-button').disabled=false;updateInfo(info);render();
    history.replaceState(null,'',`?${new URLSearchParams({[tournament.type]:tournament.id})}`);
    setStatus('Loading games…');
    await tournamentGames(tournament,controller.signal,mergeGame);
    state.loading=false;state.completeExport=true;state.lastDiscovery=Date.now();render();markUpdated();scheduleUpdates();
    return {ok:true,tournament:tournament.id,games:state.games.size};
  }catch(error){if(controller.signal.aborted)return {ok:false};state.loading=false;render();handleError(error);return {ok:false,error:error.message};}
  finally{if(state.controller===controller){state.busy=false;$('watch-button').disabled=false;}}
}
async function updateTournament(){
  if(state.busy||!state.tournament)return;if(Date.now()<state.retryAt){scheduleUpdates(state.retryAt-Date.now()+1000);return;}
  state.busy=true;$('refresh-button').disabled=true;const controller=state.controller;
  try{
    const previousInfo=state.info;const info=await tournamentInfo(state.tournament,controller.signal);if(controller.signal.aborted)return;updateInfo(info);
    if(!state.completeExport){state.loading=true;setStatus('Loading games…');await tournamentGames(state.tournament,controller.signal,mergeGame);state.completeExport=true;state.loading=false;state.lastDiscovery=Date.now();}
    const discover=Date.now()-state.lastDiscovery>=30000||state.games.size===0;
    if(discover && (!tourFinished(previousInfo)||state.games.size===0)){
      const boundary=state.newestCreatedAt;
      const swissChanged=info.round!==previousInfo.round||info.nbOngoing!==previousInfo.nbOngoing||Date.now()-state.lastDiscovery>=120000;
      if(state.tournament.type==='tournament'||swissChanged||state.games.size===0)await tournamentGames(state.tournament,controller.signal,game=>{if(state.tournament.type==='tournament'&&boundary&&game.createdAt<boundary&&state.games.has(game.id))return false;mergeGame(game);});
      state.lastDiscovery=Date.now();
    }
    const ids=[...state.finishedToRefresh];
    if(ids.length)await refreshGames(ids,controller.signal,game=>{mergeGame(game);if(!isPlaying(game))state.finishedToRefresh.delete(game.id);});
    if(controller.signal.aborted)return;
    render();showNotice('');markUpdated();
    // Finished tournaments no longer need repeated polling once all games have results.
    if(!tourFinished(info)||[...state.games.values()].some(isPlaying))scheduleUpdates();
  }catch(error){state.loading=false;if(!controller.signal.aborted)handleError(error);}
  finally{if(state.controller===controller){state.busy=false;$('refresh-button').disabled=false;}}
}
function renderDialog(){const g=state.games.get(state.selected);if(!g)return;const white=g.players.white.user?.name??'White',black=g.players.black.user?.name??'Black';$('dialog-title').textContent=`${white} – ${black}`;$('dialog-content').innerHTML=cardHtml(g,0,true)+`<p class="dialog-note">${isPlaying(g)?'Moves and clocks update live.':'Game finished.'}</p><a class="dialog-link" href="https://lichess.org/${esc(g.id)}" target="_blank" rel="noopener">View on Lichess</a>`;}
document.addEventListener('click',event=>{const flip=event.target.closest('[data-flip]');if(flip){const id=flip.dataset.flip;state.flipped.has(id)?state.flipped.delete(id):state.flipped.add(id);render();return;}const open=event.target.closest('[data-open]');if(open){state.selected=open.dataset.open;renderDialog();$('game-dialog').showModal();}});
$('close-dialog').addEventListener('click',()=>$('game-dialog').close());
$('game-dialog').addEventListener('click',e=>{if(e.target===$('game-dialog')){$('game-dialog').close();}});
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;render();}));
document.querySelectorAll('[data-filter]').forEach((button,index)=>{button.setAttribute('aria-controls','game-grid');button.addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-filter]')];const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;if(next!==null){event.preventDefault();tabs[next].focus();tabs[next].click();}});});
$('player-search').addEventListener('input',e=>{state.search=e.target.value.trim().toLowerCase();render();});
document.querySelectorAll('[data-density]').forEach(b=>b.addEventListener('click',()=>{$('game-grid').className=`game-grid ${b.dataset.density}`;document.querySelectorAll('[data-density]').forEach(x=>x.classList.toggle('selected',x===b));}));
$('theme-button').addEventListener('click',()=>{const light=document.body.classList.toggle('light');$('theme-button').setAttribute('aria-label',light?'Switch to dark theme':'Switch to light theme');$('theme-button').title=light?'Switch to dark theme':'Switch to light theme';});
render();
$('tournament-form').addEventListener('submit',event=>{event.preventDefault();void loadTournament($('tournament-input').value);});
$('paste-link-prompt').addEventListener('click',()=>{$('tournament-input').focus();});
$('refresh-button').addEventListener('click',()=>{state.lastDiscovery=0;void updateTournament();});
document.addEventListener('visibilitychange',()=>{live.pause(document.hidden);if(!document.hidden&&state.tournament)scheduleUpdates(0);});
const clockTimer=setInterval(renderClocks,1000);
window.addEventListener('pagehide',()=>{state.controller?.abort();clearTimeout(state.timer);cancelAnimationFrame(state.renderTimer);clearInterval(clockTimer);live.close();});
const parameters=new URLSearchParams(location.search);const initial=parameters.get('swiss')??parameters.get('tournament');if(initial)void loadTournament(`https://lichess.org/${parameters.has('swiss')?'swiss':'tournament'}/${initial}`);
// Browsers without WebMCP keep the normal interface.
if(document.modelContext){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{Promise.resolve(document.modelContext.registerTool({name:'load_tournament',title:'Load tournament',description:'Load a Lichess Arena or Swiss tournament and display its games.',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(typeof input?.url!=='string')throw new Error('A tournament URL or ID is required.');return loadTournament(input.url);}},{signal:lifecycle.signal})).catch(()=>{});}catch{}}
