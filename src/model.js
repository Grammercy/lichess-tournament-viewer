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
export const demoGames=Array.from({length:12},(_,i)=>{
  const openings=[['Ruy Lopez','e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7'],['Sicilian Defense','e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5'],['Queen’s Gambit Declined','d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 exd5 Bd3 Bb7 O-O Nbd7'],['Italian Game','e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 Nbd2 h6 Nf1 Re8'],['Caro-Kann Defense','e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6'],['King’s Indian Defense','d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 f3 f5']];
  const names=['KnightShift','e4enthusiast','quiet_move','endgamewizard','BlitzTheory','rookandroll','pawnstorm','open_file','tempo_tempo','fianchetto','chesscoffee','doublecheck','castleshort','NimzoFan','passed_pawn','boardwalk','zugzwang','file_seven','SicilianSun','midnightrook','centerstage','bishop_pair','slowthinker','last_rank'];
  const [opening,moves]=openings[i%6];
  return {id:`demo${i}`,variant:'standard',status:i<9?'started':i===9?'mate':i===10?'resign':'draw',winner:i===9?'white':i===10?'black':undefined,moves,clock:{initial:180,increment:0},clocks:moves.split(' ').map((_,j)=>18000-j*365-i*80),createdAt:Date.now()-i*60000,players:{white:{user:{name:names[i*2],title:i%4===0?'FM':undefined},rating:2254-i*32},black:{user:{name:names[i*2+1],title:i%3===0?'CM':undefined},rating:2198-i*27}},opening:{name:opening}};
});
