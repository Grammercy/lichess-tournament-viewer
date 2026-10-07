import { PgnParser, makePgn } from 'chessops/pgn';
import { tournamentPgn, ApiError } from './api.js';

const authorizationKey='tv_study_authorization';
export const studyChapterLimit=64;

export class StudyError extends ApiError {
  constructor(message,status=0,retryAfter=0,uncertain=false){
    super(message,status,retryAfter);
    this.uncertain=uncertain;
  }
}

async function studyRequest(path,token,body,signal){
  let response;
  try {
    response=await fetch(`https://lichess.org${path}`,{
      method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded',...(token?{Authorization:`Bearer ${token}`}:{})},
      body:new URLSearchParams(body),credentials:'omit',referrerPolicy:'no-referrer',signal,
    });
  } catch(error) {
    if(signal?.aborted)throw error;
    // A lost response can follow a successful write. Do not blindly repeat it.
    throw new StudyError('The connection was lost. Lichess may have received the last request. Check your studies before starting another import.',0,0,path!=='/api/token');
  }
  if(response.status===429){
    const retryAfter=Math.max(60,Number(response.headers.get('Retry-After'))||60);
    throw new StudyError(`Lichess rate limit. Wait ${retryAfter} seconds, then retry.`,429,retryAfter);
  }
  if(response.status===401||response.status===403)throw new StudyError('Lichess authorization expired or does not allow study imports. Sign in again.',response.status);
  if(!response.ok){
    const data=await response.json().catch(()=>null);
    throw new StudyError(data?.error&&typeof data.error==='string'?data.error:`Lichess could not complete the request (${response.status}).`,response.status,0,response.status>=500);
  }
  try {
    const data=await response.json();
    if(!data||typeof data!=='object')throw new Error('Invalid JSON response');
    return data;
  }
  catch {throw new StudyError('Lichess returned an unreadable response. Check your studies before starting another import.',0,0,path!=='/api/token');}
}

function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}

export async function startStudyAuthorization(intent,{storage=sessionStorage,origin=location.origin,pathname=location.pathname}={}){
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  const redirectUri=`${origin}${pathname}`;
  const clientId=new URL(origin).host;
  try {storage.setItem(authorizationKey,JSON.stringify({verifier,state,redirectUri,clientId,intent,createdAt:Date.now()}));}
  catch {throw new StudyError('Your browser must allow session storage to sign in to Lichess.');}
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectUri,code_challenge_method:'S256',code_challenge:challenge,scope:'study:write',state});
  return `https://lichess.org/oauth?${query}`;
}

export async function completeStudyAuthorization(url,{storage=sessionStorage,onIntent=()=>{}}={}){
  const parameters=new URL(url).searchParams;
  if(!parameters.has('code')&&!parameters.has('error'))return null;
  let authorization;
  try {authorization=JSON.parse(storage.getItem(authorizationKey));storage.removeItem(authorizationKey);}
  catch {throw new StudyError('Could not restore Lichess sign-in. Start the import again.');}
  if(!authorization||parameters.get('state')!==authorization.state||Date.now()-authorization.createdAt>600000){
    throw new StudyError('Could not verify Lichess sign-in. Start the import again.');
  }
  onIntent(authorization.intent);
  if(parameters.has('error'))throw new StudyError(parameters.get('error')==='access_denied'?'Lichess sign-in was canceled. You can try again.':'Lichess sign-in failed. You can try again.');
  const data=await studyRequest('/api/token',null,{grant_type:'authorization_code',code:parameters.get('code'),code_verifier:authorization.verifier,redirect_uri:authorization.redirectUri,client_id:authorization.clientId});
  if(typeof data.access_token!=='string'||!data.access_token)throw new StudyError('Lichess did not return an access token. Sign in again.');
  return {token:data.access_token,intent:authorization.intent};
}

export function splitTournamentPgn(pgn,expectedCount=0,gameIds=null){
  const games=[],remaining=gameIds===null?null:new Set(gameIds);let failure,count=0;
  const parser=new PgnParser((game,error)=>{
    if(error){failure??=new StudyError('A tournament game is too large to import.');return;}
    if(!game.headers.get('White')||!game.headers.get('Black')||!['1-0','0-1','1/2-1/2','*'].includes(game.headers.get('Result'))){failure??=new StudyError('Lichess returned an invalid game export. Try again.');return;}
    if(game.headers.get('Result')==='*'){failure??=new StudyError('Some games are still finishing on Lichess. Wait a moment, then retry.');return;}
    count++;
    const id=game.headers.get('Site')?.match(/^https?:\/\/lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#]|$)/)?.[1];
    if(!remaining||remaining.delete(id))games.push(makePgn(game));
  },()=>new Map());
  parser.parse(pgn);
  if(failure)throw failure;
  if(!count)throw new StudyError('This tournament has no games to import.');
  if(count<expectedCount||remaining?.size)throw new StudyError('Lichess returned an incomplete tournament export. Try again before creating studies.');
  if(!games.length)throw new StudyError('No games match the current player filter.');
  return games;
}

export class StudyImportJob {
  constructor({tournament,name,visibility,expectedCount=0,gameIds=null}){
    this.tournament={...tournament};this.name=name.trim();this.visibility=visibility;this.expectedCount=expectedCount;
    this.gameIds=gameIds===null?null:[...gameIds];
    this.games=null;this.studies=[];
  }
  get imported(){return this.studies.reduce((total,study)=>total+study.imported,0);}
  async run(token,signal,onProgress=()=>{}){
    if(this.failure?.uncertain)throw this.failure;
    try {return await this.importGames(token,signal,onProgress);}
    catch(error){this.failure=error;throw error;}
  }
  async importGames(token,signal,onProgress){
    if(this.name.length<2||this.name.length>100||!['public','unlisted','private'].includes(this.visibility))throw new StudyError('Enter a study name between 2 and 100 characters and choose its visibility.');
    const progress=phase=>onProgress({phase,total:this.games?.length??this.gameIds?.length??this.expectedCount,imported:this.imported,studies:this.studies});
    if(!this.games){
      progress('download');
      this.games=splitTournamentPgn(await tournamentPgn(this.tournament,signal),this.expectedCount,this.gameIds);
      const count=Math.ceil(this.games.length/studyChapterLimit);
      for(let index=0;index<count;index++){
        const suffix=count>1?` (${index+1}/${count})`:'';
        this.studies.push({id:null,name:this.name.slice(0,100-suffix.length)+suffix,imported:0,total:Math.min(studyChapterLimit,this.games.length-index*studyChapterLimit)});
      }
    }
    for(const [index,study] of this.studies.entries()){
      signal.throwIfAborted();
      if(study.imported===study.total)continue;
      if(!study.id){
        progress('create');
        const data=await studyRequest('/api/study',token,{name:study.name,visibility:this.visibility,computer:'everyone',explorer:'everyone',cloneable:'everyone',shareable:'everyone',chat:'everyone',sticky:'false'},signal);
        if(!/^[A-Za-z0-9]{8}$/.test(data.id??''))throw new StudyError('Lichess did not return a study link. Check your studies before starting another import.',0,0,true);
        study.id=data.id;
      }
      progress('import');
      const remaining=this.games.slice(index*studyChapterLimit+study.imported,index*studyChapterLimit+study.total);
      // Lichess's initial flag replaces the empty chapter created with a new study.
      const data=await studyRequest(`/api/study/${study.id}/import-pgn`,token,{pgn:remaining.join('\n\n'),initial:String(study.imported===0)},signal);
      if(!Array.isArray(data.chapters)||data.chapters.length>remaining.length)throw new StudyError('Could not confirm how many games Lichess imported. Check the study before starting another import.',0,0,true);
      study.imported+=data.chapters.length;
      progress('import');
      if(data.error||data.chapters.length!==remaining.length)throw new StudyError(typeof data.error==='string'?data.error:'Lichess did not import every game. Retry to import the remaining games.');
    }
    progress('complete');
    return this.studies;
  }
}
