import { defaultPosition, setupPosition } from 'chessops/variant';
import { lichessRules } from 'chessops/compat';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeSquare } from 'chessops/util';

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
export function resultOf(game) {return isPlaying(game)?'*':game.winner==='white'?'1–0':game.winner==='black'?'0–1':game.status==='aborted'?'Aborted':'½–½';}
export function gamePosition(game, previous) {
  const moves=(game.moves??'').trim().split(/\s+/).filter(Boolean);
  const rules=lichessRules(game.variant??'standard');
  let pos,last;
  let start=0;
  if(previous && previous.moves.length<=moves.length && previous.moves.every((m,i)=>moves[i]===m) && previous.initialFen===game.initialFen && previous.variant===game.variant){pos=previous.position.clone();last=previous.last;start=previous.moves.length;}
  else pos=game.initialFen&&game.initialFen!=='startpos'?setupPosition(rules,parseFen(game.initialFen).unwrap()).unwrap():defaultPosition(rules);
  for(let i=start;i<moves.length;i++) {const move=parseSan(pos,moves[i]);if(!move)throw new Error(`Could not read move ${i+1}.`);last=move;pos.play(move);}
  const squares=[];for(let i=0;i<64;i++){const piece=pos.board.get(i);squares.push(piece?`${piece.color==='white'?'w':'b'}${({pawn:'P',knight:'N',bishop:'B',rook:'R',queen:'Q',king:'K'})[piece.role]}`:null);}
  return {squares,turn:pos.turn,moves,last,position:pos,fen:makeFen(pos.toSetup()),initialFen:game.initialFen,variant:game.variant};
}
export function clockValues(game, position) {
  const initial=game.clock?.initial;
  const clocks=game.clocks??[];
  const offset=game.initialFen&&game.initialFen!=='startpos'?(parseFen(game.initialFen).unwrap().turn==='black'?1:0):0;
  const values={white:initial,black:initial};
  for(let i=Math.max(0,clocks.length-2);i<clocks.length;i++) values[(i+offset)%2?'black':'white']=clocks[i]/100;
  return values;
}
export function formatClock(value){if(!Number.isFinite(value))return '—';const sec=Math.max(0,Math.floor(value));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;}
export function squareName(index){return makeSquare(index);}
