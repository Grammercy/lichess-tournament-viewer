import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real grid and card updates with controllable animation completion.
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const gridSource=source.slice(source.indexOf('function clearSlotTransitions()'),source.indexOf('function render(){'));
const games=['playing1','finished1','playing2','finished2'].map(id=>({id,moves:'e4 e5'}));

function harness(){
  const animations=[];
  const node=()=>({
    children:[],dataset:{},style:{},
    append(child){child.parent=this;this.children.push(child);},
    replaceChildren(...children){this.children=[];children.forEach(child=>this.append(child));},
    remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);},
    querySelector(){return null;}
  });
  const grid=node(),document={hidden:false,createElement(tag){
    if(tag!=='template')return node();
    return {content:{},set innerHTML(id){const card=node();card.id=id;card.querySelector=selector=>selector==='.board-button'?{innerHTML:''}:null;this.content.firstElementChild=card;}};
  }};
  let reducedMotion=false;
  const state={tournament:{type:'tournament',id:'testtour'},filter:'all',search:'',games:new Map(games.map(game=>[game.id,game])),flipped:new Set(),playingIds:new Set(),loading:false,pendingLoad:false};
  const context=vm.createContext({
    state,document,window:{matchMedia:()=>({matches:reducedMotion})},
    $:()=>grid,cardHtml:game=>game.id,boardHtml:()=>'',positionFor:()=>null,
    boardObserver:{observe(){},unobserve(){}},queueRender(){},
    flipGameSlot(node,options){
      const animation={node,options,front:node.children[0],cancelled:false,completed:false,
        updateCard(){this.incoming=options.getCard();},
        cancel(){this.cancelled=true;node.replaceChildren(...(options.getCard()?[options.getCard()]:[]));},
        complete(){if(this.cancelled||this.completed)return;this.completed=true;node.replaceChildren(...(options.getCard()?[options.getCard()]:[]));options.onComplete();}
      };
      animations.push(animation);
      return animation;
    }
  });
  vm.runInContext(`const cardSlots=[];let gridContext=null;${gridSource}`,context);
  const app=vm.runInContext('({renderGameGrid,cardSlots})',context);
  return {state,document,grid,animations,...app,
    reduceMotion(value){reducedMotion=value;},
    select(filter,visible){state.filter=filter;return app.renderGameGrid(visible);},
    complete(){animations.forEach(animation=>animation.complete());},
    ids(){return Array.from(app.cardSlots,slot=>slot.gameId);}
  };
}

test('All games to Playing flips retained and replaced cards and clears removed slots',()=>{
  const h=harness();
  assert.equal(h.renderGameGrid(games),false);
  assert.equal(h.animations.length,0);
  assert.equal(h.select('playing',[games[0],games[2]]),true);
  assert.deepEqual(h.animations.map(a=>Boolean(a.options.clearing)),[false,false,true,true]);
  assert.deepEqual(h.animations.map(a=>a.options.delay),[0,80,160,240]);
  assert.notEqual(h.animations[0].front,h.cardSlots[0].card);
  assert.equal(h.animations[0].incoming,h.cardSlots[0].card);
  assert.deepEqual(h.ids(),['playing1','playing2',null,null]);
  assert.equal(h.grid.children.length,4);
  h.complete();h.renderGameGrid([games[0],games[2]]);
  assert.equal(h.grid.children.length,2);
});

test('Playing to All games uses the standard entrance for new slots',()=>{
  const h=harness();h.select('playing',[games[0],games[2]]);
  h.select('all',games);
  assert.deepEqual(h.animations.map(a=>Boolean(a.options.entering)),[false,false,true,true]);
  assert.deepEqual(h.ids(),games.map(game=>game.id));
  h.complete();h.renderGameGrid(games);
  assert.equal(h.grid.children.length,4);
  assert.equal(h.animations.length,4);
});

test('rapid filter changes interrupt the old wave and finish on the latest filter',()=>{
  const h=harness();h.renderGameGrid(games);
  h.select('playing',[games[0],games[2]]);
  const firstWave=[...h.animations];
  h.select('finished',[games[1],games[3]]);
  assert.ok(firstWave.every(animation=>animation.cancelled));
  h.select('all',games);
  h.complete();h.renderGameGrid(games);
  assert.deepEqual(h.ids(),games.map(game=>game.id));
  assert.ok(h.cardSlots.every(slot=>!slot.transition&&slot.node.children[0]===slot.card));
});

test('an empty filter keeps clearing slots until the logo animations finish',()=>{
  const h=harness();h.renderGameGrid(games);
  assert.equal(h.select('playing',[]),true);
  assert.ok(h.animations.every(animation=>animation.options.clearing));
  assert.equal(h.renderGameGrid([]),true);
  assert.equal(h.grid.children.length,4);
  h.complete();
  assert.equal(h.renderGameGrid([]),false);
  assert.equal(h.grid.children.length,0);
  assert.equal(h.select('all',games),true);
  assert.ok(h.animations.slice(4).every(animation=>animation.options.entering));
});

test('live updates refresh the incoming card during a filter wave',()=>{
  const h=harness();h.renderGameGrid(games);
  h.select('playing',[games[0],games[2]]);
  const previous=h.cardSlots[0].card;
  h.state.games.set(games[0].id,{...games[0],moves:'e4 e5 Nf3'});
  h.renderGameGrid([h.state.games.get(games[0].id),games[2]]);
  assert.notEqual(h.cardSlots[0].card,previous);
  assert.equal(h.animations[0].incoming,h.cardSlots[0].card);
  assert.equal(h.animations.length,4);
});

test('search and tournament changes reset immediately',()=>{
  for(const change of [h=>{h.state.search='white';},h=>{h.state.tournament.id='nexttour';}]){
    const h=harness();h.renderGameGrid(games);
    h.select('playing',[games[0],games[2]]);change(h);
    assert.equal(h.renderGameGrid([games[0]]),false);
    assert.ok(h.animations.every(animation=>animation.cancelled));
    assert.deepEqual(h.ids(),[games[0].id]);
    assert.equal(h.animations.length,4);
  }
});

test('hidden pages, reduced motion, and loading suppress filter animations',()=>{
  for(const suppress of [h=>{h.document.hidden=true;},h=>h.reduceMotion(true),h=>{h.state.loading=true;},h=>{h.state.pendingLoad=true;}]){
    const h=harness();h.select('playing',[games[0],games[2]]);suppress(h);
    assert.equal(h.select('all',games),false);
    assert.equal(h.animations.length,0);
    assert.deepEqual(h.ids(),games.map(game=>game.id));
  }
});
