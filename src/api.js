import { isPlaying } from './model.js';

export class ApiError extends Error { constructor(message,status=0,retryAfter=0){super(message);this.status=status;this.retryAfter=retryAfter;} }
async function checked(path,options={}) {
  const response=await fetch(`/lichess${path}`,options);
  if(response.ok)return response;
  if(response.status===429)throw new ApiError('Lichess rate limit. Updates will retry shortly.',429,Math.max(60,Number(response.headers.get('Retry-After'))||60));
  if(response.status===404)throw new ApiError('Tournament not found. Check the link or ID.',404);
  throw new ApiError(`Could not load Lichess data (${response.status}). Try again.`,response.status);
}
export async function tournamentDetails(tournament,signal){
  return (await checked(`/api/${tournament.type}/${tournament.id}`,{signal})).json();
}
export async function tournamentRankings(tournament,signal){
  // The info response contains only the first standings page. Fetch every rank.
  const rankingPlayers=[];
  const response=await checked(`/api/${tournament.type}/${tournament.id}/results`,{headers:{Accept:'application/x-ndjson'},signal});
  await readNdjson(response,player=>{rankingPlayers.push(player);});
  return rankingPlayers;
}
export async function tournamentInfo(tournament,signal){
  const [info,rankingPlayers]=await Promise.all([tournamentDetails(tournament,signal),tournamentRankings(tournament,signal)]);
  return {...info,rankingPlayers};
}
export async function readNdjson(response,onItem){
  if(!response.body)throw new ApiError('Lichess returned an empty response.');
  const reader=response.body.getReader();const decoder=new TextDecoder();let pending='';
  try{
    for(;;){const {value,done}=await reader.read();pending+=done?decoder.decode():decoder.decode(value,{stream:true});const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines){if(line.trim()&&onItem(JSON.parse(line))===false)return;}if(done){if(pending.trim())onItem(JSON.parse(pending));break;}}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function tournamentGames(tournament,signal,onGame,{metadataOnly=false}={}) {
  const query=new URLSearchParams({moves:String(!metadataOnly),clocks:String(!metadataOnly),opening:String(!metadataOnly)});
  const response=await checked(`/api/${tournament.type}/${tournament.id}/games?${query}`,{headers:{Accept:'application/x-ndjson'},signal});
  await readNdjson(response,onGame);
}
export async function tournamentPgn(tournament,signal) {
  const response=await checked(`/api/${tournament.type}/${tournament.id}/games?moves=true&clocks=true&opening=true`,{headers:{Accept:'application/x-chess-pgn'},signal});
  return response.text();
}
export async function discoverTournamentGames(tournament,signal,onGame){
  const ongoing=new Set();
  // Subscribe to active boards as soon as their metadata arrives. Old move
  // histories wait until discovery and the active-game export have finished.
  await tournamentGames(tournament,signal,game=>{
    if(isPlaying(game)&&typeof game.moves!=='string')ongoing.add(game.id);
    else ongoing.delete(game.id);
    return onGame(game);
  },{metadataOnly:true});
  await refreshGames([...ongoing],signal,onGame);
}
export async function refreshGames(ids,signal,onGame){
  for(let i=0;i<ids.length;i+=300){const response=await checked('/api/games/export/_ids?moves=true&clocks=true&opening=true',{method:'POST',headers:{Accept:'application/x-ndjson','Content-Type':'text/plain'},body:ids.slice(i,i+300).join(','),signal});await readNdjson(response,onGame);}
}
