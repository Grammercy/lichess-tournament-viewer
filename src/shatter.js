const duration=900;

// Clip copies of the rendered card so shards retain its position and theme.
export function shatterGameCard(node,onComplete) {
  if(document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return null;
  const rect=node.getBoundingClientRect();
  if(!rect.width||!rect.height||rect.bottom<=0||rect.top>=window.innerHeight||rect.right<=0||rect.left>=window.innerWidth)return null;

  const layer=document.createElement('div');
  layer.className='game-shatter-layer';
  layer.setAttribute('aria-hidden','true');
  layer.inert=true;
  const burst=document.createElement('div');
  burst.className='game-shatter-burst';
  Object.assign(burst.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  layer.append(burst);

  const columns=3,rows=4;
  const points=Array.from({length:rows+1},(_,row)=>Array.from({length:columns+1},(_,col)=>[
    (col+(col>0&&col<columns?(Math.random()-.5)*.5:0))/columns*100,
    (row+(row>0&&row<rows?(Math.random()-.5)*.5:0))/rows*100
  ]));
  const polygons=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
    const a=points[row][col],b=points[row][col+1],c=points[row+1][col+1],d=points[row+1][col];
    polygons.push(...((row+col)%2?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]]));
  }
  for(const polygon of polygons) {
    const fragment=document.createElement('div');
    fragment.className='game-shatter-fragment';
    const x=polygon.reduce((sum,p)=>sum+p[0],0)/3,y=polygon.reduce((sum,p)=>sum+p[1],0)/3;
    const distance=Math.hypot((x-50)/50,(y-50)/50);
    const spread=.55+Math.random()*.5;
    const delay=Math.round(distance*45+Math.random()*30);
    fragment.style.clipPath=`polygon(${polygon.map(p=>`${p[0]}% ${p[1]}%`).join(',')})`;
    fragment.style.transformOrigin=`${x}% ${y}%`;
    fragment.style.setProperty('--shard-x',`${(x-50)*rect.width/100*spread}px`);
    fragment.style.setProperty('--shard-y',`${(y-50)*rect.height/100*spread+rect.height*.2}px`);
    fragment.style.setProperty('--shard-spin',`${(Math.random()-.5)*100}deg`);
    fragment.style.setProperty('--shard-tilt',`${(Math.random()-.5)*70}deg`);
    fragment.style.setProperty('--shard-delay',`${delay}ms`);
    fragment.style.setProperty('--shard-duration',`${duration-delay}ms`);
    const copy=node.cloneNode(true);
    copy.removeAttribute('data-game-id');
    copy.querySelectorAll('[data-clock-game]').forEach(clock=>clock.removeAttribute('data-clock-game'));
    fragment.append(copy);
    burst.append(fragment);
  }

  const cracks=document.createElementNS('http://www.w3.org/2000/svg','svg');
  cracks.classList.add('game-shatter-cracks');
  cracks.setAttribute('viewBox','0 0 100 100');
  cracks.setAttribute('preserveAspectRatio','none');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',polygons.map(p=>`M${p.map(point=>point.join(' ')).join('L')}Z`).join(''));
  cracks.append(path);
  burst.append(cracks);
  document.body.append(layer);

  const wasInert=node.inert;
  node.inert=true;
  node.classList.add('game-card-shattering');
  const followScroll=()=>{
    const current=node.getBoundingClientRect();
    burst.style.left=`${current.left}px`;
    burst.style.top=`${current.top}px`;
  };
  window.addEventListener('scroll',followScroll,{passive:true});
  const cleanup=()=>{
    clearTimeout(timer);
    window.removeEventListener('scroll',followScroll);
    layer.remove();
    node.classList.remove('game-card-shattering');
    node.inert=wasInert;
  };
  const timer=setTimeout(()=>{cleanup();onComplete();},duration);
  return cleanup;
}
