const turnDuration=300,backgroundFadeDuration=160,logoHoldDuration=3000,logoFadeDuration=160;

// Replacements occupy the reverse face throughout a single half-turn.
// Empty slots keep the logo after their card background fades away.
export function flipGameSlot(node,{delay=0,getCard,onComplete,clearing=false,entering=false}) {
  if(document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return null;
  const card=node.querySelector('.game-card'),bounds=node.getBoundingClientRect();
  if(!card||!bounds.width||!bounds.height||bounds.bottom<=0||bounds.top>=window.innerHeight||bounds.right<=0||bounds.left>=window.innerWidth)return null;
  // Newly inserted cards can still report their intrinsic placeholder height.
  const visibility=card.style.contentVisibility;
  card.style.contentVisibility='visible';
  const rect=node.getBoundingClientRect();
  card.style.contentVisibility=visibility;

  const scene=document.createElement('div');
  scene.className='game-slot-scene';
  scene.setAttribute('aria-hidden','true');
  scene.inert=true;
  const turner=document.createElement('div');
  turner.className='game-slot-turner';
  let front=card,incoming=null,finished=false;
  front.classList.add('game-slot-front');
  turner.append(front);
  scene.append(turner);
  node.append(scene);

  const wasInert=node.inert;
  node.inert=true;
  node.style.height=`${rect.height}px`;
  node.classList.add('game-slot-changing');
  const turn=turner.animate([
    {transform:`rotateY(${entering?180:0}deg)`},
    {transform:`rotateY(${entering?360:180}deg)`}
  ],{duration:turnDuration,delay:delay+(entering?logoFadeDuration+backgroundFadeDuration:0),easing:'cubic-bezier(.4,0,.2,1)',fill:'both'});
  const animations=[turn];
  let completion=turn;
  if(clearing||entering){
    const back=document.createElement('div');
    back.className='game-slot-back';
    const background=document.createElement('div');
    background.className='game-slot-backdrop';
    const logo=document.createElement('img');
    logo.src='./lichess.svg';
    logo.alt='';
    logo.width=100;
    logo.height=100;
    back.append(background,logo);
    turner.append(back);
    // Fade each element separately so the turner's 3D faces stay intact.
    const backgroundFade=background.animate([{opacity:entering?0:1},{opacity:entering?1:0}],{
      duration:backgroundFadeDuration,delay:delay+(entering?logoFadeDuration:turnDuration),fill:'both'
    });
    const logoFade=logo.animate([{opacity:entering?0:1},{opacity:entering?1:0}],{
      duration:logoFadeDuration,delay:delay+(entering?0:turnDuration+backgroundFadeDuration+logoHoldDuration),fill:'both'
    });
    animations.push(backgroundFade,logoFade);
    if(clearing)completion=logoFade;
  }
  const updateCard=()=>{
    const next=getCard();
    if(finished||clearing||!next||front===next||incoming===next)return;
    if(entering){
      next.classList.add('game-slot-front');
      front.replaceWith(next);
      front.classList.remove('game-slot-front');
      front=next;
      return;
    }
    next.classList.add('game-slot-replacement');
    if(incoming){incoming.replaceWith(next);incoming.classList.remove('game-slot-replacement');}
    else turner.append(next);
    incoming=next;
  };
  updateCard();
  const cleanup=()=>{
    if(finished)return;
    finished=true;
    for(const animation of animations)animation.cancel();
    const next=getCard();
    front.classList.remove('game-slot-front');
    incoming?.classList.remove('game-slot-replacement');
    node.replaceChildren(...(next?[next]:[]));
    node.classList.remove('game-slot-changing');
    node.style.height='';
    node.inert=wasInert;
  };
  completion.finished.then(()=>{cleanup();onComplete();},()=>{});
  return {cancel:cleanup,updateCard};
}
