import { isTournamentFinished } from './model.js';
import { startStudyAuthorization, completeStudyAuthorization, StudyImportJob, studyChapterLimit } from './study.js';

export function initStudyImport(){
  const $=id=>document.getElementById(id);
  let current=null,token=null,job=null,busy=false,error=null,phase='',retryAt=0,retryTimer;
  const controller=new AbortController();
  window.addEventListener('pagehide',()=>{controller.abort();clearTimeout(retryTimer);});

  function render(){
    const total=job?.games?.length??current?.gameCount??0;
    const studyCount=Math.ceil(total/studyChapterLimit);
    $('study-import-summary').textContent=`Import all ${total.toLocaleString()} games from ${current?.info?.fullName??current?.info?.name??'this tournament'}. Each game becomes a chapter.`;
    $('study-limit-note').textContent=studyCount>1?`Lichess allows 64 chapters per study. This import will create ${studyCount.toLocaleString()} studies.`:'This import will create one Lichess study.';
    const done=phase==='complete';
    $('study-import-status').textContent=error?.message??(phase==='download'?'Downloading all tournament games…':phase==='create'?'Creating a Lichess study…':phase==='import'?`Imported ${job.imported.toLocaleString()} of ${total.toLocaleString()} games…`:done?`Imported all ${total.toLocaleString()} games.`:token?'Lichess connected. Choose Import all games to continue.':'Sign in to Lichess to create studies in your account.');
    $('study-import-status').classList.toggle('error',Boolean(error));
    $('study-import-form').setAttribute('aria-busy',String(busy));
    for(const id of ['study-name','study-visibility'])$(id).disabled=busy||Boolean(job?.studies.some(study=>study.id));
    $('close-study-import').disabled=busy;
    $('study-import-submit').hidden=done||Boolean(error?.uncertain);
    $('study-import-submit').disabled=busy||Date.now()<retryAt;
    $('study-import-submit').textContent=busy?'Importing…':!token?'Sign in with Lichess':job?'Retry remaining games':'Import all games';
    $('study-import-progress').hidden=!busy||!job?.games;
    $('study-import-progress').max=total||1;
    $('study-import-progress').value=job?.imported??0;
    $('study-import-results').replaceChildren();
    for(const study of job?.studies??[]){
      if(!study.id)continue;
      const item=document.createElement('li'),link=document.createElement('a'),count=document.createElement('span');
      link.href=`https://lichess.org/study/${study.id}`;link.target='_blank';link.rel='noopener';link.textContent=study.name;
      count.textContent=`${study.imported.toLocaleString()} / ${study.total.toLocaleString()} games`;
      item.append(link,count);$('study-import-results').append(item);
    }
    $('study-check-account').hidden=!error?.uncertain;
  }

  function open(intent,authorizationError){
    if(!current||!isTournamentFinished(current.info))return;
    if(!job){
      $('study-name').value=intent?.name??(current.info.fullName??current.info.name??'Tournament games').slice(0,100);
      $('study-visibility').value=intent?.visibility??'unlisted';
    }
    if(authorizationError)error=authorizationError;
    render();$('study-import-dialog').showModal();
  }

  $('import-study').addEventListener('click',()=>open());
  $('close-study-import').addEventListener('click',()=>$('study-import-dialog').close());
  $('study-import-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('study-import-dialog').addEventListener('click',event=>{if(!busy&&event.target===$('study-import-dialog'))$('study-import-dialog').close();});
  $('study-import-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!current||error?.uncertain||Date.now()<retryAt)return;
    const intent={tournament:current.tournament,name:$('study-name').value.trim(),visibility:$('study-visibility').value};
    if(intent.name.length<2){$('study-name').setCustomValidity('Enter at least two characters.');$('study-name').reportValidity();return;}
    busy=true;error=null;render();
    try {
      if(!token){
        location.assign(await startStudyAuthorization(intent));
        return;
      }
      job??=new StudyImportJob({...intent,expectedCount:current.gameCount});
      await job.run(token,controller.signal,progress=>{phase=progress.phase;render();});
    } catch(failure){
      if(controller.signal.aborted)return;
      error=failure;
      if(failure.status===401||failure.status===403){
        token=null;
        if(job?.studies.some(study=>study.id))error={...failure,message:'Lichess authorization expired. Check the studies below before starting another import.',uncertain:true};
      }
      if(failure.retryAfter){retryAt=Date.now()+failure.retryAfter*1000;retryTimer=setTimeout(render,failure.retryAfter*1000+50);}
    } finally {busy=false;render();}
  });
  $('study-name').addEventListener('input',()=>{$('study-name').setCustomValidity('');if(!job?.studies.some(study=>study.id))job=null;});
  $('study-visibility').addEventListener('change',()=>{if(!job?.studies.some(study=>study.id))job=null;});

  return {
    open,
    update(next){
      if(current?.tournament?.id!==next.tournament?.id||current?.tournament?.type!==next.tournament?.type){
        if(!busy){job=null;error=null;phase='';retryAt=0;clearTimeout(retryTimer);$('study-import-dialog').close();}
      }
      current=next;
      $('import-study').hidden=!next.tournament||next.pendingLoad||!isTournamentFinished(next.info);
      $('import-study').disabled=next.loading||!next.completeExport||!next.gameCount||next.playing>0;
      $('import-study').title=next.loading||!next.completeExport?'Waiting for all tournament games':!next.gameCount?'No games to import':next.playing?'Waiting for the last games to finish':'Import every tournament game into Lichess studies';
    },
    async restoreAuthorization(){
      const url=location.href,parameters=new URL(url).searchParams;
      if(!parameters.has('code')&&!parameters.has('error'))return null;
      for(const key of ['code','state','error','error_description'])parameters.delete(key);
      history.replaceState(null,'',`${location.pathname}${parameters.size?`?${parameters}`:''}`);
      let intent;
      try {
        const authorization=await completeStudyAuthorization(url,{onIntent:restored=>{intent=restored;}});
        token=authorization.token;
        return {intent};
      } catch(error){return {intent,error};}
    },
  };
}
