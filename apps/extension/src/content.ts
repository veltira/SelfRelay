const ROOT_ID='checkpoint-recovery-root';
void lookup();

type ClaimedCheckpoint={checkpoint:any;claim:chrome.runtime.Port;released:boolean;article?:HTMLElement};

function unresolvedRecoveryStack(checkpoints:any[],memberId:string|null|undefined){
  return checkpoints
    .filter(checkpoint=>!checkpoint.resolvedAt&&(!checkpoint.targetMemberIds?.length||Boolean(memberId&&checkpoint.targetMemberIds.includes(memberId))))
    .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
}

async function claimSurface(checkpointId:string){
  return new Promise<chrome.runtime.Port|null>(resolve=>{
    let settled=false;const port=chrome.runtime.connect({name:`selfrelay-recovery:${encodeURIComponent(checkpointId)}`});
    const finish=(value:chrome.runtime.Port|null)=>{if(settled)return;settled=true;resolve(value);};
    const timeout=window.setTimeout(()=>{try{port.disconnect();}catch{}finish(null);},1500);
    port.onMessage.addListener(message=>{if(typeof message?.claimed!=='boolean')return;clearTimeout(timeout);if(message.claimed)finish(port);else finish(null);});
    port.onDisconnect.addListener(()=>{clearTimeout(timeout);finish(null);});
  });
}

async function lookup(){
  if(document.getElementById(ROOT_ID))return;
  let result:any;try{result=await chrome.runtime.sendMessage({type:'LOOKUP_CHECKPOINT',url:location.href});}catch{return;}
  if(!result?.context)return;
  let history:any;try{history=await chrome.runtime.sendMessage({type:'GET_CONTEXT_HISTORY',contextId:result.context.id});}catch{return;}
  const relevant=unresolvedRecoveryStack(Array.isArray(history?.checkpoints)?history.checkpoints:[],result.memberId??null);
  if(!relevant.length)return;
  const claimed:ClaimedCheckpoint[]=[];
  for(const checkpoint of relevant){const claim=await claimSurface(checkpoint.id);if(claim)claimed.push({checkpoint,claim,released:false});}
  if(!claimed.length)return;
  render(result.context,claimed);
}

function render(context:any,entries:ClaimedCheckpoint[]){
  const host=document.createElement('div');host.id=ROOT_ID;
  host.style.cssText='all:initial;position:fixed;z-index:2147483647;right:16px;top:16px;width:min(392px,calc(100vw - 24px));font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182230;';
  const shadow=host.attachShadow({mode:'open'}),fontRegular=chrome.runtime.getURL('fonts/IBMPlexSans-Regular.woff2'),fontMedium=chrome.runtime.getURL('fonts/IBMPlexSans-Medium.woff2'),logoUrl=chrome.runtime.getURL('icons/icon32.png');
  shadow.innerHTML=`<style>
    @font-face{font-family:"IBM Plex Sans";src:url("${fontRegular}") format("woff2");font-weight:400;font-style:normal;font-display:swap}@font-face{font-family:"IBM Plex Sans";src:url("${fontMedium}") format("woff2");font-weight:500 700;font-style:normal;font-display:swap}
    :host{all:initial}.panel{box-sizing:border-box;background:#fff;border:1px solid #ccd4df;border-radius:10px;box-shadow:0 10px 28px rgba(15,27,42,.16);color:#182230;overflow:hidden}.head{display:flex;align-items:center;justify-content:space-between;height:48px;padding:0 13px;background:#0d1b2a;color:#fff;border-bottom:1px solid rgba(24,166,184,.45)}.brand{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:650;letter-spacing:-.012em}.brand-logo{width:22px;height:22px;object-fit:contain;display:block}.context{max-width:215px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:#b9c5d4}.body{padding:12px 13px 13px}.summary{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:1px 0 9px}.summary strong{font-size:13px;font-weight:600;color:#27364a}.summary span{font-size:10px;color:#7d8998}.checkpoint-list{border-top:1px solid #e7ebf0}.checkpoint-item{padding:11px 0 12px;border-bottom:1px solid #e7ebf0}.checkpoint-topline{display:flex;align-items:center;gap:7px;margin-bottom:6px}.when{font-size:10px;font-variant-numeric:tabular-nums;color:#7d8998}.latest{display:inline-flex;align-items:center;min-height:18px;padding:2px 6px;border:1px solid #cfe0fb;border-radius:6px;background:#f2f7ff;color:#2058aa;font-size:9px;font-weight:600}.main-content{min-width:0}.text{white-space:pre-wrap;margin:0;font-size:13px;line-height:1.48;color:#202b3a}.typed{white-space:pre-wrap;margin:8px 0 0;padding-top:8px;border-top:1px solid #edf0f4;font-size:11.5px;line-height:1.45;color:#687589}.media,.context-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.action{appearance:none;display:inline-flex;align-items:center;min-height:34px;border:1px solid #c7cfda;background:#fff;color:#36465a;border-radius:8px;padding:6px 9px;font:500 11.5px "IBM Plex Sans",sans-serif;cursor:pointer;box-shadow:0 1px 1px rgba(15,27,42,.04);transition:background-color .14s,border-color .14s,color .14s,transform .14s,box-shadow .14s}.action:hover{background:#f5f8fb;border-color:#aeb9c7;color:#174fae;box-shadow:0 1px 2px rgba(15,27,42,.08)}.action:active{transform:translateY(1px);box-shadow:none}.action svg{width:13px;height:13px;margin-right:5px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.transcript-editor{display:block;width:100%;min-height:68px;box-sizing:border-box;border:1px solid #cbd3dd;border-radius:7px;padding:8px 9px;background:#fff;color:#202b3a;font:400 13px/1.48 "IBM Plex Sans",sans-serif;resize:vertical}.transcript-editor:focus{border-color:#6f97eb;outline:0;box-shadow:0 0 0 3px rgba(33,104,243,.08)}.save-edit{margin-top:6px}.item-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:9px;margin-top:9px}.status{min-height:15px;font-size:10.5px;color:#687589}.status.error{color:#b42318}.resolve{appearance:none;flex:none;min-height:36px;border:1px solid #aebfd8;background:#f7faff;color:#2459a8;border-radius:8px;padding:7px 10px;font:600 11px "IBM Plex Sans",sans-serif;cursor:pointer;box-shadow:inset 0 1px rgba(255,255,255,.8),0 1px 1px rgba(15,27,42,.04);transition:background-color .14s,border-color .14s,transform .14s,box-shadow .14s}.resolve:hover{background:#edf4ff;border-color:#8da8d2}.resolve:active{transform:translateY(1px);box-shadow:none}.resolve:disabled,.action:disabled,.later:disabled{cursor:default;opacity:.48}.context-actions{padding-top:1px}.foot{display:flex;justify-content:flex-end;padding:10px 13px;border-top:1px solid #e2e7ed;background:#f7f9fb}.later{appearance:none;min-height:36px;border:1px solid #c8d0da;background:#fff;color:#46566b;border-radius:8px;padding:7px 11px;font:500 11.5px "IBM Plex Sans",sans-serif;cursor:pointer;box-shadow:0 1px 1px rgba(15,27,42,.04);transition:background-color .14s,border-color .14s,transform .14s}.later:hover{background:#f2f5f8;border-color:#aeb8c6}.later:active{transform:translateY(1px)}.action:focus-visible,.resolve:focus-visible,.later:focus-visible,.transcript-editor:focus-visible{outline:2px solid #5f8ff1;outline-offset:2px}.spinner{display:inline-block;width:10px;height:10px;margin-right:5px;border:1.5px solid #c6ced9;border-top-color:#2168f3;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-1px}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}@media(max-width:520px){:host{right:12px!important;top:12px!important;width:calc(100vw - 24px)!important}}
  </style><div class="panel" role="dialog" aria-label="Checkpoints pendientes de SelfRelay"><div class="head"><span class="brand"><img class="brand-logo" src="${logoUrl}" alt="">SelfRelay</span><span class="context"></span></div><div class="body"><div class="summary"><strong></strong><span>antiguo → reciente</span></div><div class="checkpoint-list"></div><div class="context-actions"></div></div><div class="foot"><button class="later" data-action="dismiss">Lo veo después</button></div></div>`;
  shadow.querySelector<HTMLElement>('.context')!.textContent=context.members?.length?`${context.members.length} pestañas`:new URL(location.href).hostname;
  const list=shadow.querySelector<HTMLElement>('.checkpoint-list')!,contextActions=shadow.querySelector<HTMLElement>('.context-actions')!,summary=shadow.querySelector<HTMLElement>('.summary strong')!;

  function activeEntries(){return entries.filter(entry=>!entry.released&&entry.article?.isConnected!==false);}
  function releaseEntry(entry:ClaimedCheckpoint){if(entry.released)return;entry.released=true;try{entry.claim.disconnect();}catch{}}
  function releaseAll(){for(const entry of entries)releaseEntry(entry);}
  function updateSummary(){
    const active=activeEntries(),count=active.length;
    summary.textContent=count===1?'Tenés 1 checkpoint pendiente':`Tenés ${count} checkpoints pendientes`;
    for(const badge of shadow.querySelectorAll<HTMLElement>('.latest'))badge.remove();
    const latest=active.at(-1)?.article?.querySelector<HTMLElement>('.checkpoint-topline');if(latest){const badge=document.createElement('span');badge.className='latest';badge.textContent='Más reciente';latest.append(badge);}
    if(!count){releaseAll();host.remove();}
  }

  for(const entry of entries){
    const checkpoint=entry.checkpoint,article=document.createElement('article');entry.article=article;article.className='checkpoint-item';article.dataset.checkpointId=checkpoint.id;
    article.innerHTML='<div class="checkpoint-topline"><time class="when"></time></div><div class="main-content"></div><div class="media"></div><div class="item-bottom"><div class="status" role="status"></div><button class="resolve" type="button">Ya retomé</button></div>';
    article.querySelector<HTMLElement>('.when')!.textContent=formatDate(checkpoint.createdAt);
    const main=article.querySelector<HTMLElement>('.main-content')!,media=article.querySelector<HTMLElement>('.media')!,status=article.querySelector<HTMLElement>('.status')!,resolveButton=article.querySelector<HTMLButtonElement>('.resolve')!;
    const typed=String(checkpoint.originalText||'').trim();let currentTranscript=String(checkpoint.transcript||'').trim();

    function setError(message:string){status.textContent=message;status.classList.add('error');}
    function renderContent(){
      main.innerHTML='';status.classList.remove('error');
      if(currentTranscript){const editor=document.createElement('textarea');editor.className='transcript-editor';editor.value=currentTranscript;editor.setAttribute('aria-label','Transcripción del checkpoint');main.append(editor);const saveEdit=button('Guardar cambios','');saveEdit.classList.add('save-edit');saveEdit.hidden=true;main.append(saveEdit);editor.oninput=()=>{saveEdit.hidden=editor.value.trim()===currentTranscript.trim();};saveEdit.onclick=async()=>{saveEdit.disabled=true;const response=await chrome.runtime.sendMessage({type:'UPDATE_CHECKPOINT_TRANSCRIPT',checkpointId:checkpoint.id,text:editor.value});if(response?.ok){currentTranscript=editor.value.trim();checkpoint.transcript=currentTranscript;saveEdit.hidden=true;status.textContent='Transcripción actualizada.';}else setError('No se pudo guardar el cambio.');saveEdit.disabled=false;};if(typed&&typed!==currentTranscript){const note=document.createElement('p');note.className='typed';note.textContent=typed;main.append(note);}}
      else if(typed){const body=document.createElement('p');body.className='text';body.textContent=typed;main.append(body);}
      else{const body=document.createElement('p');body.className='text';body.textContent='Dejaste un checkpoint de audio.';main.append(body);}
    }
    renderContent();

    if(checkpoint.audioRef){const listen=button('Escuchar','<path d="M9 6.5v11l9-5.5-9-5.5Z"/>');listen.onclick=async()=>{const response=await chrome.runtime.sendMessage({type:'OPEN_AUDIO_PLAYER',audioRef:checkpoint.audioRef});if(!response?.ok)setError('El audio no se pudo abrir.');};media.append(listen);if(!currentTranscript){const transcribe=button('Transcribir audio','<path d="M4 7h16M4 12h12M4 17h9"/>');media.append(transcribe);transcribe.onclick=async()=>{transcribe.disabled=true;status.classList.remove('error');let seconds=0;status.innerHTML='<span class="spinner"></span>Transcribiendo…';const timer=window.setInterval(()=>{seconds++;status.innerHTML=`<span class="spinner"></span>Transcribiendo… ${seconds}s`;},1000);try{const response=await chrome.runtime.sendMessage({type:'TRANSCRIBE_CHECKPOINT',checkpointId:checkpoint.id,language:navigator.language||'es'});if(!response?.ok)throw new Error('failed');checkpoint.transcript=response.checkpoint.transcript;checkpoint.transcriptionEngine=response.checkpoint.transcriptionEngine;currentTranscript=String(checkpoint.transcript||'').trim();renderContent();transcribe.remove();status.textContent='';}catch{setError('No se pudo transcribir.');transcribe.textContent='Intentar otra vez';transcribe.disabled=false;}finally{clearInterval(timer);}};}}

    resolveButton.onclick=async()=>{resolveButton.disabled=true;const response=await chrome.runtime.sendMessage({type:'RESOLVE_CHECKPOINT',checkpointId:checkpoint.id});if(response?.ok){releaseEntry(entry);article.remove();updateSummary();return;}resolveButton.disabled=false;setError('No se pudo cerrar el checkpoint.');};
    entry.claim.onDisconnect.addListener(()=>{if(entry.released)return;entry.released=true;if(article.isConnected)article.remove();updateSummary();});
    list.append(article);
  }

  if(Array.isArray(context.members)&&context.members.length){void(async()=>{const state=await chrome.runtime.sendMessage({type:'GET_CONTEXT_TAB_STATE',contextId:context.id}),missing=Array.isArray(state?.missing)?state.missing:[];if(!missing.length)return;const restore=button(`Abrir ${missing.length} ${missing.length===1?'pestaña restante':'pestañas restantes'}`,'<path d="M12 5v14M5 12h14"/>');contextActions.append(restore);restore.onclick=async()=>{restore.disabled=true;const response=await chrome.runtime.sendMessage({type:'OPEN_MISSING_CONTEXT_TABS',contextId:context.id});if(response?.ok)restore.remove();else{restore.disabled=false;const firstStatus=shadow.querySelector<HTMLElement>('.status');if(firstStatus){firstStatus.textContent='No se pudieron abrir las pestañas.';firstStatus.classList.add('error');}}};})();}
  shadow.querySelector<HTMLButtonElement>('[data-action="dismiss"]')!.onclick=()=>{releaseAll();host.remove();};
  document.documentElement.append(host);updateSummary();

  function button(label:string,svg:string){const element=document.createElement('button');element.className='action';element.innerHTML=svg?`<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>${escapeHtml(label)}`:escapeHtml(label);return element;}
}
function formatDate(raw:string){try{return new Intl.DateTimeFormat('es-UY',{hour:'2-digit',minute:'2-digit'}).format(new Date(raw));}catch{return'';}}function escapeHtml(value:string){return String(value).replace(/[&<>'\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));}
