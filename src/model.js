import { defaultPosition, setupPosition } from 'chessops/variant';
import { lichessRules } from 'chessops/compat';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeSquare, parseUci } from 'chessops/util';

export function parseTournament(value) {
  const input=String(value??'').trim();
  if(/^[a-zA-Z0-9]{8}$/.test(input)) return {id:input,type:'tournament'};
  let url; try {url=new URL(/^https?:\/\//i.test(input)?input:`https://${input}`);} catch {throw new Error('Enter a Lichess tournament link or 8-character ID.');}
  if(!['lichess.org','www.lichess.org'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)) throw new Error('Enter a link from lichess.org.');
  const match=url.pathname.match(/^\/(tournament|swiss)\/([a-zA-Z0-9]{8})\/?$/);
  if(!match) throw new Error('Enter an Arena or Swiss tournament link.');
  return {type:match[1],id:match[2]};
}
export function isPlaying(game) { return ['created','started'].includes(game.status); }
export function orderTournamentGames(games, info) {
  const ranks=new Map();
  for(const player of info?.rankingPlayers??info?.standing?.players??info?.podium??[]){
    const name=player.username??player.id??player.name??player.user?.id??player.user?.name;
    if(name&&Number.isInteger(player.rank)&&player.rank>0)ranks.set(name.toLowerCase(),player.rank);
  }
  const playerRank=player=>ranks.get((player?.user?.id??player?.user?.name??player?.name??'').toLowerCase())??Number.MAX_SAFE_INTEGER;
  const bestRank=game=>Math.min(playerRank(game.players?.white),playerRank(game.players?.black));
  return [...games].sort((a,b)=>bestRank(a)-bestRank(b)
    ||Number(isPlaying(b))-Number(isPlaying(a))
    ||(b.createdAt??0)-(a.createdAt??0)||a.id.localeCompare(b.id));
}
export function resultOf(game) {return isPlaying(game)?'*':game.winner==='white'?'1–0':game.winner==='black'?'0–1':game.status==='aborted'?'Aborted':'½–½';}
export function mergeGameData(previous, game) {
  const merged={...previous,...game,moves:game.moves??previous?.moves,clocks:game.clocks??previous?.clocks,opening:game.opening??previous?.opening};
  // A delayed export must not undo an already streamed result or position.
  if(previous&&!isPlaying(previous)&&isPlaying(game)){merged.status=previous.status;merged.winner=previous.winner;}
  if(!isPlaying(game)&&typeof game.moves==='string')delete merged.live;
  return merged;
}
export function withLivePosition(game, data, now=performance.now()) {
  const setup=parseFen(data.fen).unwrap();
  const last=parseUci(data.lm??'');
  const clocks={white:Number.isFinite(data.wc)?data.wc:undefined,black:Number.isFinite(data.bc)?data.bc:undefined};
  const live={fen:data.fen,last,clocks,receivedAt:now,turn:setup.turn};
  if(game.live?.fen===live.fen&&game.live?.uci===data.lm&&game.live.clocks.white===clocks.white&&game.live.clocks.black===clocks.black)return game;
  live.uci=data.lm;
  return {...game,live};
}
export function gamePosition(game, previous) {
  const moves=(game.moves??'').trim().split(/\s+/).filter(Boolean);
  if(game.live) {
    const setup=parseFen(game.live.fen).unwrap();
    return {...boardPosition(setup.board),turn:setup.turn,moves,last:game.live.last,fen:game.live.fen,initialFen:game.initialFen,variant:game.variant};
  }
  if(typeof game.moves!=='string')return null;
  const rules=lichessRules(game.variant??'standard');
  let pos,last;
  let start=0;
  if(previous?.position && previous.moves.length<=moves.length && previous.moves.every((m,i)=>moves[i]===m) && previous.initialFen===game.initialFen && previous.variant===game.variant){pos=previous.position.clone();last=previous.last;start=previous.moves.length;}
  else pos=game.initialFen&&game.initialFen!=='startpos'?setupPosition(rules,parseFen(game.initialFen).unwrap()).unwrap():defaultPosition(rules);
  for(let i=start;i<moves.length;i++) {const move=parseSan(pos,moves[i]);if(!move)throw new Error(`Could not read move ${i+1}.`);last=move;pos.play(move);}
  return {...boardPosition(pos.board),turn:pos.turn,moves,last,position:pos,fen:makeFen(pos.toSetup()),initialFen:game.initialFen,variant:game.variant};
}
function boardPosition(board) {
  const squares=[];for(let i=0;i<64;i++){const piece=board.get(i);squares.push(piece?`${piece.color==='white'?'w':'b'}${({pawn:'P',knight:'N',bishop:'B',rook:'R',queen:'Q',king:'K'})[piece.role]}`:null);}
  return {squares};
}
export function clockValues(game, position, now=performance.now()) {
  if(game.live) {
    const values={...game.live.clocks};
    const color=game.live.turn;
    // Match Lichess's mini-game clocks, including the opening clock pause.
    const running=color==='white'?!game.live.fen.includes('PPPPPPPP/RNBQKBNR'):!game.live.fen.startsWith('rnbqkbnr/pppppppp');
    if(isPlaying(game)&&running&&Number.isFinite(values[color]))values[color]-=Math.max(0,now-game.live.receivedAt)/1000;
    return values;
  }
  if(typeof game.moves!=='string'&&!game.clocks?.length)return {white:undefined,black:undefined};
  const initial=game.clock?.initial;
  const clocks=game.clocks??[];
  const offset=game.initialFen&&game.initialFen!=='startpos'?(parseFen(game.initialFen).unwrap().turn==='black'?1:0):0;
  const values={white:initial,black:initial};
  for(let i=Math.max(0,clocks.length-2);i<clocks.length;i++) values[(i+offset)%2?'black':'white']=clocks[i]/100;
  return values;
}
export function formatClock(value){if(!Number.isFinite(value))return '—';const sec=Math.max(0,Math.floor(value));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;}
export function squareName(index){return makeSquare(index);}
