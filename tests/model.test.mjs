import test from 'node:test';
import assert from 'node:assert/strict';
import { gamePosition, parseTournament, clockValues, formatClock, isPlaying, isPlayingAt, mergeGameData, withLivePosition } from '../src/model.js';

test('accepts Arena, Swiss and bare IDs, and rejects other hosts and routes',()=>{
  assert.deepEqual(parseTournament(' lichess.org/swiss/abcdefgh '),{type:'swiss',id:'abcdefgh'});
  assert.deepEqual(parseTournament('https://lichess.org/tournament/abcdefgh?x=1'),{type:'tournament',id:'abcdefgh'});
  assert.deepEqual(parseTournament('abcdefgh'),{type:'tournament',id:'abcdefgh'});
  for(const input of ['https://evil.example/tournament/abcdefgh','https://lichess.org.evil.example/tournament/abcdefgh','https://lichess.org/abcdefgh','bad','javascript:alert(1)'])assert.throws(()=>parseTournament(input));
});
test('updates the board incrementally and handles en passant',()=>{
  const prefix={variant:'standard',moves:'e4 a6 e5 d5'};
  const old=gamePosition(prefix);
  const game={...prefix,moves:`${prefix.moves} exd6`};
  const updated=gamePosition(game,old);
  assert.equal(updated.fen,gamePosition(game).fen);
  assert.equal(updated.squares[35],null); // d5 was captured en passant
  assert.equal(updated.squares[43],'wP'); // white pawn now on d6
  assert.notEqual(old.fen,updated.fen);
});
test('custom positions support promotion and clock colors when Black starts',()=>{
  const game={variant:'fromPosition',initialFen:'7k/P7/8/8/8/8/8/7K w - - 0 1',moves:'a8=Q+'};
  assert.equal(gamePosition(game).squares[56],'wQ');
  const clocks=clockValues({initialFen:'7k/8/8/8/8/8/8/7K b - - 0 1',clock:{initial:180},clocks:[14000]});
  assert.deepEqual(clocks,{white:180,black:140});
});
test('all Lichess variants can initialize, and illegal moves are reported',()=>{
  for(const variant of ['standard','chess960','antichess','kingOfTheHill','threeCheck','atomic','horde','racingKings','crazyhouse'])assert.equal(gamePosition({variant,moves:''}).squares.length,64);
  assert.throws(()=>gamePosition({variant:'standard',moves:'e5'}));
});

test('a streamed board and clocks take precedence over a delayed move export',()=>{
  const game={id:'abcdefgh',status:'started',variant:'standard',moves:'e4',clock:{initial:180},clocks:[18000]};
  const latest=gamePosition({...game,moves:'e4 e5 Nf3'}).fen.split(' ').slice(0,2).join(' ');
  const live=withLivePosition(game,{fen:latest,lm:'g1f3',wc:175,bc:177},1000);
  const merged=mergeGameData(live,{...game,moves:'e4 e5',clocks:[18000,17900]});
  assert.equal(gamePosition(merged).fen,latest);
  assert.equal(gamePosition(merged).squares[6],null);
  assert.equal(gamePosition(merged).squares[21],'wN');
  assert.deepEqual(clockValues(merged,null,3500),{white:175,black:174.5});
});

test('metadata waits for an exported or streamed position instead of showing a starting board and clock',()=>{
  const metadata={status:'started',variant:'standard',clock:{initial:180}};
  assert.equal(gamePosition(metadata),null);
  assert.deepEqual(clockValues(metadata),{white:undefined,black:undefined});
  const exported={...metadata,moves:'e4',clocks:[17500]};
  assert.equal(gamePosition(exported).squares[28],'wP');
  assert.deepEqual(clockValues(exported),{white:175,black:180});
  const live=withLivePosition(metadata,{fen:gamePosition(exported).fen,lm:'e2e4',wc:175,bc:180},1000);
  assert.equal(gamePosition(live).squares[28],'wP');
  assert.deepEqual(clockValues(live,null,1000),{white:175,black:180});
});

test('duplicate cached position messages do not reset the running clock',()=>{
  const game={status:'started',variant:'standard',moves:'e4 e5'};
  const update={fen:gamePosition(game).fen.split(' ').slice(0,2).join(' '),lm:'e7e5',wc:59,bc:58};
  const live=withLivePosition(game,update,1000);
  assert.equal(withLivePosition(live,update,9000),live);
  assert.deepEqual(clockValues(live,null,9000),{white:51,black:58});
});

test('live clocks pause before the first moves and after the game finishes',()=>{
  const game={status:'started',variant:'standard',moves:'e4'};
  const update={fen:gamePosition(game).fen.split(' ').slice(0,2).join(' '),lm:'e2e4',wc:60,bc:60};
  const live=withLivePosition(game,update,1000);
  assert.deepEqual(clockValues(live,null,9000),{white:60,black:60});
  assert.deepEqual(clockValues({...live,status:'finished'},null,9000),{white:60,black:60});
});

test('either running clock clears Playing at zero while retaining the official status',()=>{
  for(const [moves,color] of [['e4 e5','white'],['e4 e5 Nf3','black']]){
    const game={status:'started',variant:'standard',moves};
    const live=withLivePosition(game,{fen:gamePosition(game).fen,wc:color==='white'?1:60,bc:color==='black'?1:60},1000);
    assert.equal(isPlayingAt(live,1999),true);
    assert.equal(isPlayingAt(live,2000),false);
    assert.equal(isPlayingAt(live,3000),false);
    assert.equal(isPlaying(live),true);
    assert.equal(live.status,'started');
    assert.equal(live.winner,undefined);
  }
});

test('zero exported or streamed clocks clear Playing, and unknown clocks keep games visible',()=>{
  for(const clocks of [[0,5900],[5900,0]]){
    assert.equal(isPlayingAt({status:'started',moves:'e4 e5',clock:{initial:60},clocks},1000),false);
  }
  const game={status:'started',moves:'e4 e5'};
  for(const color of ['white','black']){
    const live=withLivePosition(game,{fen:gamePosition(game).fen,[color==='white'?'wc':'bc']:0},1000);
    assert.equal(isPlayingAt(live,1000),false);
  }
  assert.equal(isPlayingAt({status:'created'},1000),true);
  assert.equal(isPlayingAt({status:'started',clock:{initial:60}},1000),true);
  const unknown=withLivePosition(game,{fen:gamePosition(game).fen},1000);
  assert.equal(isPlayingAt(unknown,9000),true);
  assert.equal(isPlayingAt({...game,status:'mate',clock:{initial:60}},1000),false);
});

test('a clock correction restores Playing, and the official result still takes precedence',()=>{
  const game={status:'started',variant:'standard',moves:'e4 e5'};
  const update={fen:gamePosition(game).fen,wc:1,bc:60};
  const live=withLivePosition(game,update,1000);
  assert.equal(isPlayingAt(live,2000),false);
  const delayed=mergeGameData(live,{...game,clock:{initial:60},clocks:[5900,5900]});
  assert.equal(isPlayingAt(delayed,2000),false);
  const corrected=withLivePosition(delayed,{...update,wc:3},2000);
  assert.equal(isPlayingAt(corrected,2000),true);
  assert.equal(isPlayingAt({...corrected,status:'outoftime',winner:'black'},2000),false);
});

test('positive fractions never display zero, and paused opening clocks stay in Playing',()=>{
  assert.equal(formatClock(0.001),'0:01');
  assert.equal(formatClock(59.1),'1:00');
  assert.equal(formatClock(0),'0:00');
  assert.equal(formatClock(-1),'0:00');
  assert.equal(formatClock(undefined),'—');
  const game={status:'started',variant:'standard',moves:'e4'};
  const live=withLivePosition(game,{fen:gamePosition(game).fen,wc:60,bc:1},1000);
  assert.equal(isPlayingAt(live,9000),true);
});

test('a delayed export cannot resurrect a streamed result, and a completed export restores full history',()=>{
  const game={id:'abcdefgh',status:'started',variant:'standard',moves:'f3 e5'};
  const finalMoves='f3 e5 g4 Qh4#';
  const finalFen=gamePosition({...game,moves:finalMoves}).fen.split(' ').slice(0,2).join(' ');
  const finished={...withLivePosition(game,{fen:finalFen,lm:'d8h4',wc:58,bc:59},1000),status:'finished',winner:'black'};
  const delayed=mergeGameData(finished,game);
  assert.equal(delayed.status,'finished');assert.equal(delayed.winner,'black');assert.equal(gamePosition(delayed).fen,finalFen);
  const complete=mergeGameData(delayed,{...game,status:'mate',winner:'black',moves:finalMoves});
  assert.equal(complete.live,undefined);
  assert.equal(gamePosition(complete,gamePosition(delayed)).fen,gamePosition({...game,moves:finalMoves}).fen);
});

test('streamed FENs support promotions, crazyhouse drops, and variant terminal positions',()=>{
  const promotion=withLivePosition({variant:'standard'},{fen:'Q6k/8/8/8/8/8/8/7K b',lm:'a7a8q'},1000);
  assert.equal(gamePosition(promotion).squares[56],'wQ');assert.deepEqual(gamePosition(promotion).last,{from:48,to:56,promotion:'queen'});
  const drop=withLivePosition({variant:'crazyhouse'},{fen:'7k/8/8/8/8/5N2/8/7K[P] b',lm:'N@f3'},1000);
  assert.equal(gamePosition(drop).squares[21],'wN');assert.deepEqual(gamePosition(drop).last,{role:'knight',to:21});
  const atomic=withLivePosition({variant:'atomic'},{fen:'8/8/8/8/8/8/8/7K b',lm:'h7h8'},1000);
  assert.equal(gamePosition(atomic).squares[7],'wK');
});
