import { gamePosition, clockValues, formatClock, isPlaying, isPlayingAt, isTournamentFinished, resultOf, parseTournament, mergeGameData, withLivePosition, orderTournamentGames, currentSwissRoundGames } from './model.js';
import { tournamentInfo, discoverTournamentGames, refreshGames } from './api.js';
import { LiveGames } from './live.js';
import { PairingStream } from './pairings.js';
import { loadTournamentData } from './load.js';
import { initThemeMenu } from './theme.js';
import { boardHtml } from './board.js';
import { initStudyImport } from './study-import.js';
import { flipGameSlot } from './card-transition.js';
const displaySettings=initThemeMenu();
const studyImport=initStudyImport();
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={games:new Map(),positions:new Map(),playingIds:new Set(),filter:'playing',search:'',player:null,flipped:new Set(),selected:null,tournament:null,info:null,controller:null,loading:false,pendingLoad:false,busy:false,retryAt:0,timer:null,renderTimer:null,lastDiscovery:0,lastInfoUpdate:0,newestCreatedAt:0,finishedToRefresh:new Set(),liveStatus:'idle',clockPausedAt:performance.now()};
state.completeExport=true;
state.refreshActiveGames=false;
state.lastActiveRefresh=0;
state.discoveryRequested=false;
const live=new LiveGames({onPosition:applyLivePosition,onFinish:finishLiveGame,onStatus:updateLiveStatus});
const pairings=new PairingStream({onGame:applyPairingEvent,onRateLimit:retryAt=>{state.retryAt=Math.max(state.retryAt,retryAt);scheduleUpdates(state.retryAt-Date.now()+1000);}});
live.pause(document.hidden);
pairings.pause(document.hidden);
const cardSlots=[];
let gridContext=null,resultHoldTimer=null;
let gameTabIndicator=null;
const gameTabMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
const boardObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const game=state.games.get(entry.target.dataset.gameId);if(game){const button=entry.target.querySelector('.board-button');if(button)button.innerHTML=boardHtml(positionFor(game),state.flipped.has(game.id));}boardObserver.unobserve(entry.target);}},{rootMargin:'500px'});
const flipIcon='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m4 7 3-3 3 3M7 4v13m13 0-3 3-3-3m3 3V7"/></svg>';
function positionFor(game){if(!game.live&&typeof game.moves!=='string')return {pending:true};const old=state.positions.get(game.id);try{if(old&&old.sourceMoves===game.moves && old.sourceLive===game.live && old.initialFen===game.initialFen && old.variant===game.variant)return old;const pos=gamePosition(game,old);pos.sourceMoves=game.moves;pos.sourceLive=game.live;state.positions.set(game.id,pos);return pos;}catch{return null;}}
function clockNow(){return live.status==='connected'?performance.now():state.clockPausedAt;}
function clockPercent(game,time){const initial=game.clock?.initial??state.info?.clock?.limit;return Number.isFinite(time)&&Number.isFinite(initial)&&initial>0?Math.max(0,Math.min(100,time/initial*100)):0;}
function clockBarHtml(game,color,pos){const time=clockValues(game,pos,clockNow())[color];return `<div class="clock-bar" data-clock-color="${color}" style="--clock-percent:${clockPercent(game,time)}%" aria-hidden="true"></div>`;}
function playerHtml(game,color,pos){const player=game.players?.[color]??{};const name=player.user?.name??player.name??'Anonymous';const now=clockNow(),time=clockValues(game,pos,now)[color],playing=isPlayingAt(game,now),won=!playing&&game.winner===color;return `<div class="player-row${won?' winner':''}"><span class="player-symbol ${color}"></span>${player.user?.title?`<span class="player-title">${esc(player.user.title)}</span>`:''}<span class="player-name" title="${esc(name)}">${esc(name)}</span>${won?'<span class="winner-badge">Won</span>':''}<span class="rating">${esc(player.rating??'')}</span><span class="player-clock${playing&&pos?.turn===color?' to-move':''}${playing&&time<20?' low':''}" data-clock-game="${esc(game.id)}" data-clock-color="${color}" title="${game.live?'Live clock':'Clock at last available move'}">${formatClock(time)}</span></div>`;}
function gameResultHtml(game){
  const label=game.winner==='white'?'White won':game.winner==='black'?'Black won':game.status==='aborted'?'Aborted':game.status==='noStart'?'Not played':'Draw';
  const score=!game.winner&&['aborted','noStart'].includes(game.status)?'':`<span class="result-label">${resultOf(game)}</span>`;
  return `<span class="game-state"><span class="result-summary">${label}</span>${score}</span>`;
}
function lastMoveLabel(game,pos){if(game.live)return esc((game.live.uci??'').replace(/^([a-h][1-8])([a-h][1-8])(.*)$/,'$1–$2$3'))||'—';return pos?.moves?.length?`${Math.ceil(pos.moves.length/2)}. ${esc(pos.moves.at(-1))}`:'—';}
function cardHtml(game,index,detail=false){
  const moves=(game.moves??'').trim().split(/\s+/).filter(Boolean);
  const firstTurn=game.initialFen?.split(' ')[1]==='b'?1:0;
  const pos=detail?positionFor(game):(game.live||typeof game.moves==='string'?{moves,turn:game.live?.turn??((moves.length+firstTurn)%2?'black':'white')}:null);
  const flipped=state.flipped.has(game.id),playing=isPlayingAt(game,clockNow());
  const topColor=flipped?'white':'black',bottomColor=flipped?'black':'white';
  return `<article class="game-card${playing?'':' completed'}" data-game-id="${esc(game.id)}"><div class="game-topline"><span class="game-number">${detail?'':`#${index+1}`}</span>${playing?'':gameResultHtml(game)}</div>${playerHtml(game,topColor,pos)}${clockBarHtml(game,topColor,pos)}${detail?boardHtml(pos,flipped):`<button class="board-button" data-open="${esc(game.id)}" aria-label="View ${esc(game.players?.white?.user?.name??'White')} versus ${esc(game.players?.black?.user?.name??'Black')}"><div class="board-placeholder"></div></button>`}${clockBarHtml(game,bottomColor,pos)}${playerHtml(game,bottomColor,pos)}<div class="game-bottomline"><span class="opening-name" title="${esc(game.opening?.name??'')}">${esc(game.opening?.name??prettyVariant(game.variant))}</span><div class="game-bottom-actions"><span>${lastMoveLabel(game,pos)}</span><button class="flip-button" data-flip="${esc(game.id)}" aria-label="Flip board" title="Flip board">${flipIcon}</button></div></div></article>`;
}
function paintGameTabUnderline(){
  const {tabs,center,width,scale}=gameTabIndicator;
  tabs.style.setProperty('--tab-left',`${center-width/2}px`);
  tabs.style.setProperty('--tab-width',`${width}px`);
  tabs.style.setProperty('--tab-scale',String(scale));
}
function settleGameTabUnderline(){
  if(!gameTabIndicator)return;
  cancelAnimationFrame(gameTabIndicator.frame);
  for(const key of ['center','width','scale']){
    gameTabIndicator[key]=gameTabIndicator.target[key];
    gameTabIndicator.velocity[key]=0;
  }
  gameTabIndicator.frame=null;
  paintGameTabUnderline();
}
function animateGameTabUnderline(now){
  const indicator=gameTabIndicator;
  if(gameTabMotion?.matches||document.hidden){settleGameTabUnderline();return;}
  const elapsed=Math.max(0,Math.min((now-indicator.time)/1000,.064));
  indicator.time=now;
  // Small physics steps keep the spring stable at different refresh rates.
  const steps=Math.max(1,Math.ceil(elapsed*120)),dt=elapsed/steps;
  for(let step=0;step<steps;step++)for(const key of ['center','width','scale']){
    const stiffness=key==='scale'?500:440,damping=key==='scale'?18:26;
    indicator.velocity[key]+=((indicator.target[key]-indicator[key])*stiffness-indicator.velocity[key]*damping)*dt;
    indicator[key]+=indicator.velocity[key]*dt;
  }
  const settled=['center','width','scale'].every(key=>{
    const tolerance=key==='scale' ? .0005 : .05;
    return Math.abs(indicator.target[key]-indicator[key])<tolerance&&Math.abs(indicator.velocity[key])<tolerance*10;
  });
  if(settled){settleGameTabUnderline();return;}
  paintGameTabUnderline();
  indicator.frame=requestAnimationFrame(animateGameTabUnderline);
}
function updateGameTabUnderline(animate=true){
  const tab=document.querySelector('.game-tab.active');
  if(!tab?.offsetWidth)return;
  const tabs=tab.parentElement,rect=tab.getBoundingClientRect();
  const target={center:rect.left-tabs.getBoundingClientRect().left+rect.width/2,width:rect.width,scale:1};
  if(!gameTabIndicator){
    gameTabIndicator={tabs,tab,...target,target,velocity:{center:0,width:0,scale:0},frame:null,time:0};
    paintGameTabUnderline();return;
  }
  const indicator=gameTabIndicator,changed=indicator.tab!==tab;
  indicator.tab=tab;indicator.target=target;
  if(!animate||gameTabMotion?.matches||document.hidden){settleGameTabUnderline();return;}
  if(changed){
    const direction=Math.sign(target.center-indicator.center);
    const push=3.8*Math.max(0,Math.min(1,(indicator.scale-.85)/.15));
    const previousVelocity=indicator.velocity.scale;
    indicator.velocity.scale=Math.min(previousVelocity,-push);
    // A push at the trailing end compresses the bar before it springs forward.
    indicator.velocity.center+=direction*indicator.width*(previousVelocity-indicator.velocity.scale)/2;
  }
  if(!changed&&indicator.center===target.center&&indicator.width===target.width)return;
  // Retarget the running spring without resetting its position or momentum.
  if(indicator.frame===null){indicator.time=performance.now();indicator.frame=requestAnimationFrame(animateGameTabUnderline);}
}
function clearSlotTransitions(){clearTimeout(resultHoldTimer);resultHoldTimer=null;for(const slot of cardSlots){slot.transition?.cancel();slot.transition=null;slot.resultUntil=0;slot.node.style.height='';}}
function updateSlotCard(slot,game,index,force=false){
  const signature=game?JSON.stringify([game,index,state.flipped.has(game.id),state.playingIds.has(game.id)]):null;
  if(!force&&slot.signature===signature)return;
  const drawn=Boolean(slot.transition||slot.card?.querySelector('.board,.position-error'));
  if(slot.card)boardObserver.unobserve(slot.card);
  if(game){
    const template=document.createElement('template');template.innerHTML=cardHtml(game,index);
    const card=template.content.firstElementChild;
    if(drawn)card.querySelector('.board-button').innerHTML=boardHtml(positionFor(game),state.flipped.has(game.id));
    slot.card=card;
    if(slot.transition)slot.transition.updateCard();
    else slot.node.replaceChildren(card);
    if(!drawn)boardObserver.observe(card);
  }else{slot.card=null;if(!slot.transition)slot.node.replaceChildren();}
  if(slot.gameId!==(game?.id??null))slot.resultUntil=0;
  slot.gameId=game?.id??null;slot.playing=Boolean(game&&isPlaying(game));slot.signature=signature;
}
function renderGameGrid(games){
  const context=JSON.stringify([state.tournament?.type,state.tournament?.id]);
  const playerChanged=gridContext?.player!==state.player;
  const reset=gridContext?.context!==context||(gridContext?.search!==state.search&&!playerChanged)||state.pendingLoad||document.hidden;
  const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const selectionChanged=gridContext?.filter!==state.filter||playerChanged;
  if(reset||selectionChanged)clearSlotTransitions();
  if(reducedMotion)for(const slot of cardSlots){slot.transition?.cancel();slot.transition=null;slot.node.style.height='';}
  const animate=!reset&&!state.loading&&!state.pendingLoad&&!reducedMotion;
  gridContext={context,filter:state.filter,search:state.search,player:state.player};
  clearTimeout(resultHoldTimer);resultHoldTimer=null;
  const now=performance.now();let holdUntil=0;
  if(!reset&&!selectionChanged&&!state.loading){
    for(let i=0;i<cardSlots.length;i++){
      const slot=cardSlots[i],game=state.games.get(slot.gameId);
      if(slot.playing&&game&&!isPlaying(game))slot.resultUntil=now+500;
      if(slot.gameId!==(games[i]?.id??null))holdUntil=Math.max(holdUntil,slot.resultUntil??0);
    }
  }
  // Show the result in its current slot before any clearing or replacement.
  if(holdUntil>now&&!cardSlots.some(slot=>slot.transition)){
    for(let i=0;i<cardSlots.length;i++){const slot=cardSlots[i];updateSlotCard(slot,state.games.get(slot.gameId),i);}
    resultHoldTimer=setTimeout(()=>{resultHoldTimer=null;queueRender();},holdUntil-now);
    return true;
  }
  // Finish a wave before applying the latest ordering. Live moves still update
  // the incoming cards while they turn.
  if(cardSlots.some(slot=>slot.transition)){
    for(let i=0;i<cardSlots.length;i++){const slot=cardSlots[i];updateSlotCard(slot,state.games.get(slot.gameId),i);}
    return true;
  }
  let waveIndex=0;
  const count=Math.max(games.length,cardSlots.length);
  for(let i=0;i<count;i++){
    let slot=cardSlots[i];const game=games[i];
    if(!slot){
      const node=document.createElement('div');node.className='game-slot';node.dataset.slot=String(i);
      slot={node,card:null,gameId:null,signature:null,transition:null};cardSlots.push(slot);$('game-grid').append(node);
    }
    const changed=slot.gameId!==(game?.id??null);
    const entering=animate&&changed&&!slot.card&&Boolean(game);
    if(animate&&(changed||selectionChanged)&&slot.card){
      slot.transition=flipGameSlot(slot.node,{
        delay:waveIndex*80,clearing:!game,getCard:()=>slot.card,
        onComplete(){slot.transition=null;queueRender();}
      });
      if(slot.transition)waveIndex++;
    }
    if(!slot.transition)slot.node.style.height='';
    // Retained cards need a fresh reverse face when the tab or player changes.
    updateSlotCard(slot,game,i,animate&&selectionChanged);
    if(entering){
      slot.transition=flipGameSlot(slot.node,{
        delay:waveIndex*80,entering:true,getCard:()=>slot.card,
        onComplete(){slot.transition=null;queueRender();}
      });
      if(slot.transition)waveIndex++;
    }
  }
  const transitioning=cardSlots.some(slot=>slot.transition);
  if(!transitioning)while(cardSlots.length>games.length){const slot=cardSlots.pop();if(slot.card)boardObserver.unobserve(slot.card);slot.node.remove();}
  return transitioning;
}
function render(){
  const active=[...state.games.values()].filter(isPlaying);
  live.watch(active.map(game=>game.id));
  const players=state.info?.rankingPlayers??[];
  pairings.watch(state.pendingLoad||tourFinished(state.info)?[]:players.map(player=>player.username??player.id??player.name??player.user?.id??player.user?.name));
  const loaded=Boolean(state.tournament)||state.pendingLoad;
  document.querySelector('.app-shell').classList.toggle('awaiting-tournament',!loaded);
  $('no-tournament').hidden=loaded;
  for(const id of ['tournament-panel','standings-panel','page-heading','summary-strip','toolbar','main-footer'])$(id).hidden=!loaded||state.pendingLoad;
  document.querySelectorAll('[data-filter]').forEach(tab=>{const active=tab.dataset.filter===state.filter;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
  document.querySelectorAll('#standings [data-player]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.player===state.player)));
  const swiss=state.tournament?.type==='swiss';
  $('playing-tab-label').textContent=swiss?'Current round':'Playing';
  const all=orderTournamentGames(state.games.values(),state.info,{playingFirst:swiss});
  const roundIds=swiss?new Set(currentSwissRoundGames(all,state.info).map(game=>game.id)):null;
  const now=clockNow();
  state.playingIds=new Set(active.filter(game=>isPlayingAt(game,now)).map(game=>game.id));
  const playing=state.playingIds.size;
  const playerGames=all.filter(g=>state.player?Object.values(g.players??{}).some(p=>String(p.user?.id??p.user?.name??p.name??'').toLowerCase()===state.player):JSON.stringify(g.players).toLowerCase().includes(state.search));
  const playerFilter=state.player||state.search?{player:state.player,search:state.search,label:$('player-search').value.trim()}:null;
  studyImport.update({tournament:state.tournament,info:state.info,pendingLoad:state.pendingLoad,loading:state.loading,completeExport:state.completeExport,gameCount:all.length,playing:active.length,playerFilter,gameIds:playerFilter?playerGames.map(game=>game.id):null});
  for(const [id,val] of [['total-count',all.length],['playing-count',playing],['finished-count',all.length-playing],['tab-all',all.length],['tab-playing',swiss?roundIds.size:playing],['tab-finished',all.length-playing]])$(id).textContent=val.toLocaleString();
  updateGameTabUnderline();
  const visible=playerGames.filter(g=>state.filter==='all'||(state.filter==='playing'?(swiss?roundIds.has(g.id):state.playingIds.has(g.id)):!state.playingIds.has(g.id)));
  const transitioning=renderGameGrid(visible);
  const showLoading=state.loading&&(state.pendingLoad||visible.length===0);
  const showTournamentOver=Boolean(state.tournament)&&!state.pendingLoad&&!state.loading&&state.completeExport&&state.filter==='playing'&&tourFinished(state.info)&&active.length===0&&!transitioning&&!swiss;
  document.querySelector('.app-shell').classList.toggle('loading-tournament',showLoading);
  document.querySelector('.app-shell').classList.toggle('finished-tournament',showTournamentOver);
  $('tournament-over').hidden=!showTournamentOver;
  $('loading-state').hidden=!showLoading;
  $('loading-title').textContent=state.pendingLoad?'Loading tournament…':'Loading games…';
  $('loading-message').textContent=state.pendingLoad?'Getting tournament details from Lichess.':'Waiting for the first game from Lichess.';
  $('game-grid').hidden=state.pendingLoad;
  $('game-grid').setAttribute('aria-busy',String(showLoading));
  $('empty-state').hidden=!loaded||visible.length>0||transitioning||showLoading||showTournamentOver;
  $('empty-title').textContent=state.loading?'Loading games…':state.games.size?'No matching games':'No games yet';
  $('visible-caption').textContent=visible.length===all.length?`${all.length.toLocaleString()} games`:`${visible.length.toLocaleString()} of ${all.length.toLocaleString()} games`;
  if(state.selected&&$('game-dialog').open)renderDialog();
}
function queueRender(){if(state.renderTimer===null)state.renderTimer=requestAnimationFrame(()=>{state.renderTimer=null;render();});}
function applyLivePosition(data){const game=state.games.get(data.id);if(!game||!isPlaying(game))return;try{const updated=withLivePosition(game,data);if(updated!==game){state.games.set(game.id,updated);queueRender();}}catch{}}
function finishLiveGame(data){const game=state.games.get(data.id);if(!game||!isPlaying(game))return;const now=clockNow();const snapshot=game.live?{...game.live,clocks:clockValues(game,null,now),receivedAt:now}:undefined;state.games.set(game.id,{...game,live:snapshot,status:'finished',winner:data.win==='w'?'white':data.win==='b'?'black':undefined});state.finishedToRefresh.add(game.id);queueRender();if(!tourFinished(state.info))requestPairingDiscovery();}
function requestPairingDiscovery(){
  if(!state.tournament||state.pendingLoad)return;
  state.discoveryRequested=true;
  scheduleUpdates(Math.max(0,5000-(Date.now()-state.lastDiscovery),state.retryAt-Date.now()+1000));
}
function applyPairingEvent(data){
  if(!/^[a-zA-Z0-9]{8}$/.test(data?.id??'')||!state.tournament||state.pendingLoad)return;
  const game=state.games.get(data.id);
  if(game){
    if(isPlaying(game)&&data.statusName&&!['created','started'].includes(data.statusName)){
      const now=clockNow();
      const snapshot=game.live?{...game.live,clocks:clockValues(game,null,now),receivedAt:now}:undefined;
      mergeGame({...game,live:snapshot,status:data.statusName,winner:data.winner,moves:undefined,clocks:undefined});
      if(!tourFinished(state.info))requestPairingDiscovery();
    }
    return;
  }
  // Player streams also include games outside this tournament. Confirm each
  // new pairing through the tournament export before adding it to the grid.
  requestPairingDiscovery();
}
function updateLiveStatus(status){const reconnected=state.liveStatus==='reconnecting'&&status==='connected';if(state.liveStatus==='connected'||state.liveStatus==='idle')state.clockPausedAt=performance.now();state.liveStatus=status;if(state.tournament){markUpdated();if(reconnected){state.refreshActiveGames=true;scheduleUpdates(0);}}}
function renderClocks(){if(document.hidden)return;const now=clockNow();if([...state.games.values()].some(game=>isPlayingAt(game,now)!==state.playingIds.has(game.id)))queueRender();document.querySelectorAll('[data-clock-game]').forEach(element=>{const game=state.games.get(element.dataset.clockGame);const card=element.closest('.game-card');if(!game?.live||card?.hidden)return;const color=element.dataset.clockColor;const value=clockValues(game,null,now)[color];element.textContent=formatClock(value);element.classList.toggle('low',isPlayingAt(game,now)&&value<20);const bar=card?.querySelector(`.clock-bar[data-clock-color="${color}"]`);if(bar)bar.style.setProperty('--clock-percent',`${clockPercent(game,value)}%`);});}
function showNotice(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function setStatus(text,connected=false){$('update-status').innerHTML=`<span class="${connected?'live-dot':'connection-dot'}"></span>${esc(text)}`;}
const tourFinished=isTournamentFinished;
function updateInfo(info){
  state.info=info;const name=info.fullName??info.name??'Tournament';$('tournament-name').textContent=name;$('page-tournament-name').textContent=name;document.title=`Viewing ${name}`;
  state.lastInfoUpdate=Date.now();
  $('tournament-kind').textContent=state.tournament.type==='swiss'?'SWISS':`${info.perf?.name??'ARENA'} ARENA`;
  const finished=tourFinished(info);const pending=info.status==='created'||info.isStarted===false;
  $('tournament-status').textContent=finished?'FINISHED':pending?'UPCOMING':'PLAYING';$('tournament-status').classList.toggle('playing',!finished&&!pending);
  $('rated-label').textContent=`${info.rated?'Rated':'Casual'} · ${prettyVariant(info.variant)}`;
  $('time-control').textContent=info.clock?`${info.clock.limit/60} + ${info.clock.increment}`:'—';$('player-count').textContent=(info.nbPlayers??0).toLocaleString();
  $('duration').textContent=state.tournament.type==='swiss'?`${info.round??0} / ${info.nbRounds??0} rounds`:`${info.minutes??'—'} minutes`;
  $('tournament-external').href=`https://lichess.org/${state.tournament.type}/${state.tournament.id}`;
  const standings=info.standing?.players??info.podium??[];$('standings').innerHTML=standings.slice(0,5).map(p=>{
    const name=p.name??p.user?.name??p.id,player=String(p.id??p.user?.id??name??'').toLowerCase();
    return `<li><button class="standing-player" type="button" data-player="${esc(player)}" data-player-name="${esc(name)}" aria-label="Show games by ${esc(name)}" aria-controls="game-grid" aria-pressed="${player===state.player}">${p.title?`<span class="player-title">${esc(p.title)}</span>`:''}<span class="standing-name">${esc(name)}</span><span class="standing-points">${esc(p.score??'')}</span></button></li>`;
  }).join('');
  $('standings-note').textContent=standings.length?'':state.tournament.type==='swiss'?'Standings on Lichess':'No standings yet';
}
function prettyVariant(variant){return ({standard:'Standard',chess960:'Chess960',kingOfTheHill:'King of the Hill',threeCheck:'Three-check',racingKings:'Racing Kings',crazyhouse:'Crazyhouse',atomic:'Atomic',horde:'Horde',antichess:'Antichess',fromPosition:'From position'})[variant]??variant??'Standard';}
function mergeGame(game){
  if(!game?.id||!game.players)return;
  const previous=state.games.get(game.id);const merged=mergeGameData(previous,game);
  state.games.set(game.id,merged);
  if(!isPlaying(game)&&typeof game.moves==='string')state.finishedToRefresh.delete(game.id);
  else if(!isPlaying(merged)&&(typeof merged.moves!=='string'||merged.live||previous&&isPlaying(previous)))state.finishedToRefresh.add(game.id);
  state.newestCreatedAt=Math.max(state.newestCreatedAt,game.createdAt??0);queueRender();
}
function markUpdated(){const playing=[...state.games.values()].some(isPlaying);const finished=tourFinished(state.info)&&!playing;const connected=playing&&live.status==='connected';setStatus(connected?'Live':state.loading?'Loading games…':finished?'Finished':playing?({connecting:'Connecting…',reconnecting:'Reconnecting…',paused:'Paused'}[live.status]??'Connecting…'):'Connected',connected);}
function scheduleUpdates(delay=30000){clearTimeout(state.timer);if(state.tournament)state.timer=setTimeout(()=>{if(document.hidden){scheduleUpdates();return;}void updateTournament();},delay);}
function handleError(error){if(error.name==='AbortError')return;showNotice(error.message||'Could not connect to Lichess. Try again.',true);markUpdated();if(error.status===429){state.retryAt=Math.max(state.retryAt,Date.now()+Math.max(60,error.retryAfter||60)*1000);pairings.deferUntil(state.retryAt);scheduleUpdates(state.retryAt-Date.now()+1000);}else scheduleUpdates(30000);}
async function loadTournament(value){
  let tournament;try{tournament=parseTournament(value);}catch(error){showNotice(error.message,true);return {ok:false,error:error.message};}
  state.controller?.abort();pairings.close();clearTimeout(state.timer);const controller=new AbortController();state.controller=controller;state.busy=true;state.loading=true;state.pendingLoad=true;$('watch-button').disabled=true;showNotice('');setStatus('Connecting…');render();
  try {
    await loadTournamentData(tournament,controller.signal,{
      onInfo(info,confirmedTournament){
        tournament=confirmedTournament;
        live.close();state.tournament=tournament;state.filter='playing';state.games.clear();state.positions.clear();state.flipped.clear();state.finishedToRefresh.clear();state.newestCreatedAt=0;state.retryAt=0;state.refreshActiveGames=false;state.lastActiveRefresh=0;state.discoveryRequested=false;state.loading=true;state.pendingLoad=false;state.completeExport=false;state.selected=null;$('game-dialog').close();$('tournament-input').value=`https://lichess.org/${tournament.type}/${tournament.id}`;$('watch-button').disabled=false;updateInfo(info);render();
        history.replaceState(null,'',`?${new URLSearchParams({[tournament.type]:tournament.id})}`);
        setStatus('Loading games…');
      },
      onRankings(rankingPlayers){state.info={...state.info,rankingPlayers};queueRender();},
      onGame:mergeGame,
      onGamesComplete(){state.loading=false;state.completeExport=true;state.lastDiscovery=Date.now();state.lastActiveRefresh=Date.now();render();markUpdated();}
    });
    if(controller.signal.aborted)return {ok:false};
    render();markUpdated();scheduleUpdates(state.finishedToRefresh.size?1000:30000);
    return {ok:true,tournament:tournament.id,games:state.games.size};
  }catch(error){if(controller.signal.aborted)return {ok:false};state.loading=false;state.pendingLoad=false;render();handleError(error);return {ok:false,error:error.message};}
  finally{if(state.controller===controller){state.busy=false;$('watch-button').disabled=false;if(state.refreshActiveGames)scheduleUpdates(0);else if(state.discoveryRequested)requestPairingDiscovery();}}
}
function discoverPairings(signal,{full=false}={}){
  const tournament=state.tournament,boundary=full?0:state.newestCreatedAt;
  return discoverTournamentGames(tournament,signal,game=>{
    if(signal.aborted||state.tournament!==tournament)return false;
    if(tournament.type==='tournament'&&boundary&&game.createdAt<boundary&&state.games.has(game.id))return false;
    mergeGame(game);
  },{shouldHydrate:game=>{const current=state.games.get(game.id);return !current?.live&&typeof current?.moves!=='string';}});
}
async function updateTournament(){
  if(state.busy||!state.tournament)return;if(Date.now()<state.retryAt){scheduleUpdates(state.retryAt-Date.now()+1000);return;}
  const refreshActive=state.refreshActiveGames;state.refreshActiveGames=false;
  const requested=state.discoveryRequested&&(refreshActive||Date.now()-state.lastDiscovery>=5000);
  if(requested)state.discoveryRequested=false;
  state.busy=true;$('refresh-button').disabled=true;const controller=state.controller;let failed=false;
  try{
    const previousInfo=state.info;let info=previousInfo;
    // Announced Arena pairings display before slower full ranking exports.
    let arenaDiscovered=false;
    if(state.completeExport&&state.tournament.type==='tournament'&&(requested||Date.now()-state.lastDiscovery>=30000||state.games.size===0)&&(!tourFinished(previousInfo)||requested||state.games.size===0)){
      await discoverPairings(controller.signal);state.lastDiscovery=Date.now();arenaDiscovered=true;
    }
    if(refreshActive||Date.now()-state.lastInfoUpdate>=30000||state.lastDiscovery===0||!state.completeExport){info=await tournamentInfo(state.tournament,controller.signal);if(controller.signal.aborted)return;updateInfo(info);}
    if(!state.completeExport){state.loading=true;setStatus('Loading games…');await discoverPairings(controller.signal,{full:true});state.completeExport=true;state.loading=false;state.lastDiscovery=Date.now();}
    const discover=!arenaDiscovered&&(requested||Date.now()-state.lastDiscovery>=30000||state.games.size===0);
    if(discover && (!tourFinished(previousInfo)||requested||state.games.size===0)){
      const swissChanged=info.round!==previousInfo.round||info.nbOngoing!==previousInfo.nbOngoing||Date.now()-state.lastDiscovery>=120000;
      if(state.tournament.type==='tournament'||requested||swissChanged||state.games.size===0){await discoverPairings(controller.signal);state.lastDiscovery=Date.now();}
    }
    // Re-subscribing cannot replay missed results. Catch up every ongoing game
    // on reconnect, and periodically confirm games without recent live moves.
    const recheckActive=refreshActive||Date.now()-state.lastActiveRefresh>=30000;
    const activeIds=recheckActive?[...state.games.values()].filter(game=>isPlaying(game)&&(refreshActive||tourFinished(info)||!game.live||clockNow()-game.live.receivedAt>=30000)).map(game=>game.id):[];
    const activeSet=new Set(activeIds);
    // Bound background history work so the next pairing check takes priority.
    const pending=[...state.finishedToRefresh];
    const historyIds=(state.finishedToRefresh.has(state.selected)?[state.selected,...pending.filter(id=>id!==state.selected)]:pending).filter(id=>!activeSet.has(id)).slice(0,32);
    const historySet=new Set(historyIds);
    const ids=[...activeIds,...historyIds];
    if(ids.length)await refreshGames(ids,controller.signal,game=>{mergeGame(game);if(historySet.has(game.id)){state.finishedToRefresh.delete(game.id);if(isPlaying(game))state.finishedToRefresh.add(game.id);}});
    if(recheckActive)state.lastActiveRefresh=Date.now();
    if(controller.signal.aborted)return;
    render();showNotice('');markUpdated();
    if(state.finishedToRefresh.size)scheduleUpdates(1000);
    else if(!tourFinished(info)||[...state.games.values()].some(isPlaying))scheduleUpdates(Math.max(0,30000-(Date.now()-state.lastInfoUpdate)));
  }catch(error){failed=true;state.loading=false;if(state.controller===controller){if(refreshActive)state.refreshActiveGames=true;if(requested)state.discoveryRequested=true;}if(!controller.signal.aborted)handleError(error);}
  finally{if(state.controller===controller){state.busy=false;$('refresh-button').disabled=false;if(!failed){if(state.refreshActiveGames)scheduleUpdates(0);else if(state.discoveryRequested)requestPairingDiscovery();}}}
}
function renderDialog(){const g=state.games.get(state.selected);if(!g)return;const white=g.players.white.user?.name??'White',black=g.players.black.user?.name??'Black';$('dialog-title').textContent=`${white} – ${black}`;$('dialog-content').innerHTML=cardHtml(g,0,true)+`<p class="dialog-note">${isPlaying(g)?'Moves and clocks update live.':'Game finished.'}</p><a class="dialog-link" href="https://lichess.org/${esc(g.id)}" target="_blank" rel="noopener">View on Lichess</a>`;}
document.addEventListener('click',event=>{const flip=event.target.closest('[data-flip]');if(flip){const id=flip.dataset.flip;state.flipped.has(id)?state.flipped.delete(id):state.flipped.add(id);render();return;}const open=event.target.closest('[data-open]');if(open){state.selected=open.dataset.open;renderDialog();$('game-dialog').showModal();}});
$('close-dialog').addEventListener('click',()=>$('game-dialog').close());
$('game-dialog').addEventListener('click',e=>{if(e.target===$('game-dialog')){$('game-dialog').close();}});
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;render();}));
$('standings').addEventListener('click',event=>{
  const player=event.target.closest('[data-player]');if(!player)return;
  const selected=state.player===player.dataset.player;
  state.player=selected?null:player.dataset.player;state.search=selected?'':player.dataset.playerName.toLowerCase();state.filter=selected?'playing':'all';
  $('player-search').value=selected?'':player.dataset.playerName;render();
});
window.addEventListener('resize',()=>{clearSlotTransitions();queueRender();updateGameTabUnderline(false);});
document.fonts?.ready.then(()=>updateGameTabUnderline(false));
gameTabMotion?.addEventListener('change',()=>updateGameTabUnderline(false));
document.querySelectorAll('[data-filter]').forEach((button,index)=>{button.setAttribute('aria-controls','game-grid');button.addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-filter]')];const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;if(next!==null){event.preventDefault();tabs[next].focus();tabs[next].click();}});});
$('player-search').addEventListener('input',e=>{clearSlotTransitions();gridContext=null;state.player=null;state.search=e.target.value.trim().toLowerCase();render();});
document.querySelectorAll('[data-density]').forEach(b=>b.addEventListener('click',()=>{clearSlotTransitions();displaySettings.set('density',b.dataset.density);queueRender();}));
render();
$('tournament-form').addEventListener('submit',event=>{event.preventDefault();void loadTournament($('tournament-input').value);});
$('paste-link-prompt').addEventListener('click',()=>{$('tournament-input').focus();});
$('refresh-button').addEventListener('click',()=>{state.lastDiscovery=0;state.discoveryRequested=true;state.refreshActiveGames=true;void updateTournament();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearSlotTransitions();live.pause(document.hidden);pairings.pause(document.hidden);if(!document.hidden&&state.tournament){queueRender();state.discoveryRequested=true;state.refreshActiveGames=true;scheduleUpdates(0);}});
const clockTimer=setInterval(renderClocks,1000);
window.addEventListener('pagehide',()=>{settleGameTabUnderline();clearSlotTransitions();state.controller?.abort();clearTimeout(state.timer);cancelAnimationFrame(state.renderTimer);clearInterval(clockTimer);live.close();pairings.close();});
async function initializeTournament(){
  const authorization=await studyImport.restoreAuthorization();
  const parameters=new URLSearchParams(location.search),initial=parameters.get('swiss')??parameters.get('tournament');
  const tournament=authorization?.intent?.tournament;
  const value=tournament?`https://lichess.org/${tournament.type}/${tournament.id}`:initial?`https://lichess.org/${parameters.has('swiss')?'swiss':'tournament'}/${initial}`:null;
  if(value){
    const loaded=await loadTournament(value);
    if(loaded.ok&&authorization?.intent){
      const filter=authorization.intent.playerFilter;
      state.player=filter?.player??null;state.search=filter?.search??'';
      $('player-search').value=filter?.label??'';
      if(filter)state.filter='all';
      render();studyImport.open(authorization.intent,authorization.error);
    }
  }
  if(authorization?.error&&!authorization.intent)showNotice(authorization.error.message,true);
}
void initializeTournament();
// Browsers without WebMCP keep the normal interface.
if(document.modelContext){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{Promise.resolve(document.modelContext.registerTool({name:'load_tournament',title:'Load tournament',description:'Load a Lichess Arena or Swiss tournament and display its games.',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(typeof input?.url!=='string')throw new Error('A tournament URL or ID is required.');return loadTournament(input.url);}},{signal:lifecycle.signal})).catch(()=>{});}catch{}}
