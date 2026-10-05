import { tournamentDetails, tournamentRankings, tournamentGames } from './api.js';

// Each attempt owns its streams so cancellation and Swiss fallback cannot mix games.
export async function loadTournamentData(tournament,signal,callbacks){
  try {
    return await loadAttempt(tournament,signal,callbacks);
  } catch(error) {
    if(signal.aborted||error.status!==404||tournament.type==='swiss'||!error.detailsNotFound)throw error;
    return loadAttempt({...tournament,type:'swiss'},signal,callbacks);
  }
}

async function loadAttempt(tournament,signal,{onInfo,onRankings,onGame,onGamesComplete}){
  signal.throwIfAborted();
  const controller=new AbortController();
  const abort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  const active=()=>!controller.signal.aborted;
  const bufferedGames=[];
  let confirmed=false,rankings,gamesComplete=false;
  const detailsRequest=tournamentDetails(tournament,controller.signal);
  const rankingsRequest=tournamentRankings(tournament,controller.signal).then(players=>{
    rankings=players;
    if(confirmed&&active())onRankings(players);
  });
  const gamesRequest=tournamentGames(tournament,controller.signal,game=>{
    if(!active())return false;
    if(confirmed)onGame(game);else bufferedGames.push(game);
  }).then(()=>{
    gamesComplete=true;
    if(confirmed&&active())onGamesComplete();
  });
  // Observe every rejection immediately, including failures before details arrive.
  const settled=Promise.allSettled([detailsRequest,rankingsRequest,gamesRequest]);
  try {
    let info;
    try {info=await detailsRequest;}catch(error){if(error.status===404)error.detailsNotFound=true;throw error;}
    controller.signal.throwIfAborted();
    onInfo(info,tournament);
    confirmed=true;
    if(rankings)onRankings(rankings);
    for(const game of bufferedGames){if(!active())break;onGame(game);}
    bufferedGames.length=0;
    if(gamesComplete&&active())onGamesComplete();
    await Promise.all([rankingsRequest,gamesRequest]);
    controller.signal.throwIfAborted();
    return {tournament,info:{...info,rankingPlayers:rankings}};
  } finally {
    controller.abort();
    await settled;
    signal.removeEventListener('abort',abort);
  }
}
