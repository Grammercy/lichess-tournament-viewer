const turnDuration=300,holdDuration=240,duration=turnDuration*2+holdDuration;

// Animate the actual card inside its slot. Keep the incoming card off the
// page until the logo covers the old one, then reveal its latest position.
export function flipGameSlot(node,{delay=0,getCard,onComplete,clearing=false}) {
  if(document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return null;
  const card=node.querySelector('.game-card'),rect=node.getBoundingClientRect();
  if(!card||!rect.width||!rect.height||rect.bottom<=0||rect.top>=window.innerHeight||rect.right<=0||rect.left>=window.innerWidth)return null;

  const scene=document.createElement('div');
  scene.className='game-slot-scene';
  scene.setAttribute('aria-hidden','true');
  scene.inert=true;
  const turner=document.createElement('div');
  turner.className='game-slot-turner';
  let front=card,revealed=false,finished=false,frame;
  front.classList.add('game-slot-front');
  const back=document.createElement('div');
  back.className='game-slot-back';
  const logo=document.createElement('img');
  logo.src='/lichess.svg';
  logo.alt='';
  logo.width=100;
  logo.height=100;
  back.append(logo);
  turner.append(front,back);
  scene.append(turner);
  node.append(scene);

  const wasInert=node.inert;
  node.inert=true;
  node.style.height=`${rect.height}px`;
  node.classList.add('game-slot-changing');
  const easing='cubic-bezier(.4,0,.2,1)';
  const animation=turner.animate([
    {transform:'rotateY(0deg)',offset:0,easing},
    {transform:'rotateY(180deg)',offset:turnDuration/duration},
    {transform:'rotateY(180deg)',offset:(turnDuration+holdDuration)/duration,easing},
    {transform:`rotateY(${clearing?180:360}deg)`,offset:1}
  ],{duration,delay,fill:'both'});
  // Fade the scene, never the preserve-3d turner, which would flatten its faces.
  const fade=clearing?scene.animate([{opacity:1,offset:0},{opacity:1,offset:.7},{opacity:0,offset:1}],{duration,delay,fill:'both'}):null;
  const updateCard=()=>{
    const next=getCard();
    if(!revealed||!next||front===next)return;
    next.classList.add('game-slot-front');
    front.replaceWith(next);
    front.classList.remove('game-slot-front');
    front=next;
  };
  const reveal=()=>{
    if(finished)return;
    if(animation.currentTime>=delay+turnDuration+holdDuration){revealed=true;updateCard();}
    else frame=requestAnimationFrame(reveal);
  };
  frame=requestAnimationFrame(reveal);
  const cleanup=()=>{
    if(finished)return;
    finished=true;
    cancelAnimationFrame(frame);
    animation.cancel();
    fade?.cancel();
    const next=getCard();
    front.classList.remove('game-slot-front');
    next?.classList.remove('game-slot-front');
    node.replaceChildren(...(next?[next]:[]));
    node.classList.remove('game-slot-changing');
    node.style.height='';
    node.inert=wasInert;
  };
  animation.finished.then(()=>{cleanup();onComplete();},()=>{});
  return {cancel:cleanup,updateCard};
}
