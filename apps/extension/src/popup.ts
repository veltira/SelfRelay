import type {BrowserContextScope} from '@selfrelay/shared';

const stateEl=document.querySelector<HTMLElement>('#state')!;
const actions=document.querySelector<HTMLElement>('#actions')!;
const toggle=document.querySelector<HTMLButtonElement>('#followToggle')!;
const badge=document.querySelector<HTMLElement>('#trackingBadge')!;
const statusEl=document.querySelector<HTMLElement>('#popupStatus')!;
const help=document.querySelector<HTMLElement>('#scopeHelp')!;
const scopeButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-scope]')];
let selected:BrowserContextScope='url';
let activeContext:any=null;

const HELP:Record<BrowserContextScope,string>={
  tab:'Solo esta pestaña, aunque cambie de página.',
  url:'Esta página exacta cuando vuelvas a abrirla.',
  site:'Cualquier página dentro de este sitio.'
};

void load();

async function load(){
  statusEl.textContent='';statusEl.classList.remove('error');
  let state:any;
  try{state=await chrome.runtime.sendMessage({type:'GET_ACTIVE_STATE'});}catch{renderUnsupported('SelfRelay no pudo leer esta pestaña.');return;}
  if(!state?.supported){renderUnsupported('Esta página no se puede seguir. SelfRelay funciona en páginas web normales.');return;}
  actions.hidden=false;
  activeContext=state.context||null;
  const tab=state.tab;
  stateEl.innerHTML=`<div class="context-title">${escapeHtml(tab.title)}</div><div class="context-url">${escapeHtml(tab.url)}</div><div class="context-state ${activeContext?'active':''}"><span class="dot"></span>${activeContext?`Siguiendo como ${scopeLabel(activeContext.scope)}`:'Aún no se sigue este contexto'}</div>`;
  badge.hidden=!activeContext;
  selected=activeContext?.scope||selected;
  renderSelection();
  toggle.textContent=activeContext?'Dejar de seguir':'Seguir contexto';
  toggle.classList.toggle('secondary',Boolean(activeContext));
  toggle.classList.toggle('primary',!activeContext);
  toggle.onclick=activeContext?stopTracking:startTracking;
}

function renderUnsupported(message:string){
  stateEl.innerHTML=`<div class="context-title">Contexto no disponible</div><div class="context-url">${escapeHtml(message)}</div>`;
  actions.hidden=true;badge.hidden=true;
}

function renderSelection(){
  for(const button of scopeButtons){
    const scope=button.dataset.scope as BrowserContextScope;
    button.setAttribute('aria-checked',String(scope===selected));
    button.disabled=Boolean(activeContext);
    button.onclick=()=>{if(activeContext)return;selected=scope;renderSelection();};
  }
  help.textContent=activeContext?`SelfRelay reconocerá ${scopeLabel(activeContext.scope)} cuando vuelvas.`:HELP[selected];
}

async function startTracking(){
  setBusy(true);
  try{
    const result=await chrome.runtime.sendMessage({type:'TRACK_CONTEXT',scope:selected});
    if(!result?.ok)throw new Error('track_failed');
    await load();
  }catch{showError('No se pudo seguir este contexto.');setBusy(false);}
}

async function stopTracking(){
  if(!activeContext)return;
  setBusy(true);
  try{
    const result=await chrome.runtime.sendMessage({type:'UNTRACK_CONTEXT',contextId:activeContext.id});
    if(!result?.ok)throw new Error('untrack_failed');
    activeContext=null;
    await load();
  }catch{showError('No se pudo dejar de seguir.');setBusy(false);}
}

function setBusy(value:boolean){toggle.disabled=value;for(const button of scopeButtons)button.disabled=value||Boolean(activeContext);}
function showError(message:string){statusEl.textContent=message;statusEl.classList.add('error');}
function scopeLabel(scope:string){return scope==='site'?'sitio':scope==='url'?'página':'pestaña';}
function escapeHtml(value:string){return String(value).replace(/[&<>'\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));}
