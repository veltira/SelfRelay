import type {BrowserContextScope} from '@selfrelay/shared';

const stateEl=document.querySelector<HTMLElement>('#state')!;
const worksetSection=document.querySelector<HTMLElement>('#worksetSection')!;
const memberList=document.querySelector<HTMLElement>('#memberList')!;
const emptyActions=document.querySelector<HTMLElement>('#emptyActions')!;
const createContext=document.querySelector<HTMLButtonElement>('#createContext')!;
const addTabs=document.querySelector<HTMLButtonElement>('#addTabs')!;
const addTabsEmpty=document.querySelector<HTMLButtonElement>('#addTabsEmpty')!;
const stopTracking=document.querySelector<HTMLButtonElement>('#stopTracking')!;
const tabPicker=document.querySelector<HTMLElement>('#tabPicker')!;
const tabList=document.querySelector<HTMLElement>('#tabList')!;
const closePicker=document.querySelector<HTMLButtonElement>('#closePicker')!;
const saveTabs=document.querySelector<HTMLButtonElement>('#saveTabs')!;
const selectionCount=document.querySelector<HTMLElement>('#selectionCount')!;
const statusEl=document.querySelector<HTMLElement>('#popupStatus')!;
const simpleToggle=document.querySelector<HTMLButtonElement>('#simpleToggle')!;
const simplePanel=document.querySelector<HTMLElement>('#simplePanel')!;
const simpleFollow=document.querySelector<HTMLButtonElement>('#simpleFollow')!;
const scopeButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-scope]')];
let selectedScope:BrowserContextScope='url';
let activeContext:any=null;
let activeTabId:number|null=null;
let pickerTabs:any[]=[];
const selectedTabIds=new Set<number>();

void load();

async function load(){
  clearStatus();tabPicker.hidden=true;
  let state:any;try{state=await chrome.runtime.sendMessage({type:'GET_ACTIVE_STATE'});}catch{renderUnsupported('SelfRelay no pudo leer esta pestaña.');return;}
  if(!state?.supported){renderUnsupported('Esta página no se puede asociar a un contexto.');return;}
  activeContext=state.context||null;activeTabId=state.tab.id;
  stateEl.innerHTML=`<div class="current-label">Contexto actual</div><div class="current-title">${escapeHtml(state.tab.title)}</div><div class="current-domain">${escapeHtml(new URL(state.tab.url).hostname)}</div>`;
  stopTracking.hidden=!activeContext;stopTracking.onclick=()=>void stop();
  if(activeContext){emptyActions.hidden=true;worksetSection.hidden=false;renderMembers();addTabs.onclick=()=>void openPicker();}
  else{worksetSection.hidden=true;emptyActions.hidden=false;createContext.onclick=()=>void createSingleWorkset();addTabsEmpty.onclick=()=>void openPicker();}
  simpleToggle.onclick=()=>{simplePanel.hidden=!simplePanel.hidden;};simpleFollow.onclick=()=>void startSimple();
  for(const button of scopeButtons){button.onclick=()=>{selectedScope=button.dataset.scope as BrowserContextScope;renderScope();};}renderScope();
}

function renderUnsupported(message:string){stateEl.innerHTML=`<div class="current-label">SelfRelay</div><div class="current-title">Contexto no disponible</div><div class="current-domain">${escapeHtml(message)}</div>`;worksetSection.hidden=true;emptyActions.hidden=true;stopTracking.hidden=true;}

function renderMembers(){
  const members=Array.isArray(activeContext?.members)?activeContext.members:[];
  if(!members.length){memberList.innerHTML=`<div class="legacy-row"><span>${scopeLabel(activeContext?.scope)}</span><small>Seguimiento existente</small></div>`;return;}
  memberList.innerHTML=members.map((member:any)=>`<div class="member-row"><div class="tab-favicon">${member.faviconUrl?`<img src="${escapeHtml(member.faviconUrl)}" alt="">`:''}</div><div class="member-copy"><strong>${escapeHtml(member.title||member.url)}</strong><small>${escapeHtml(host(member.url))}</small></div><button class="remove-member" data-member="${escapeHtml(member.id)}" type="button" aria-label="Quitar pestaña">×</button></div>`).join('');
  for(const button of memberList.querySelectorAll<HTMLButtonElement>('.remove-member'))button.onclick=()=>void removeMember(button.dataset.member||'');
}

async function createSingleWorkset(){if(activeTabId===null)return;setBusy(true);try{const response=await chrome.runtime.sendMessage({type:'UPSERT_WORKSET',tabIds:[activeTabId]});if(!response?.ok)throw new Error('create_failed');await load();}catch{showError('No se pudo crear el contexto.');setBusy(false);}}

async function openPicker(){
  clearStatus();const response=await chrome.runtime.sendMessage({type:'LIST_ELIGIBLE_TABS',contextId:Array.isArray(activeContext?.members)?activeContext.id:null});if(!response?.ok){showError('No se pudieron cargar las pestañas.');return;}
  pickerTabs=response.tabs||[];selectedTabIds.clear();for(const item of pickerTabs)if(item.selected||(activeContext&&!Array.isArray(activeContext.members)&&item.id===activeTabId)||(!activeContext&&item.id===activeTabId))selectedTabIds.add(item.id);
  renderPicker();tabPicker.hidden=false;closePicker.onclick=()=>{tabPicker.hidden=true;};saveTabs.onclick=()=>void saveSelection();
}

function renderPicker(){
  tabList.innerHTML=pickerTabs.map(tab=>`<label class="picker-row"><input type="checkbox" value="${tab.id}" ${selectedTabIds.has(tab.id)?'checked':''}><span class="tab-favicon">${tab.faviconUrl?`<img src="${escapeHtml(tab.faviconUrl)}" alt="">`:''}</span><span class="picker-copy"><strong>${escapeHtml(tab.title||tab.url)}</strong><small>${escapeHtml(host(tab.url))}</small></span></label>`).join('');
  for(const input of tabList.querySelectorAll<HTMLInputElement>('input'))input.onchange=()=>{input.checked?selectedTabIds.add(Number(input.value)):selectedTabIds.delete(Number(input.value));updateCount();};updateCount();
}
function updateCount(){const count=selectedTabIds.size;selectionCount.textContent=`${count} ${count===1?'pestaña':'pestañas'}`;saveTabs.disabled=count===0;}

async function saveSelection(){
  const oldLegacy=activeContext&&!Array.isArray(activeContext.members)?activeContext.id:null;setBusy(true);
  const orderedIds=pickerTabs.filter(tab=>selectedTabIds.has(tab.id)).map(tab=>tab.id);
  try{const response=await chrome.runtime.sendMessage({type:'UPSERT_WORKSET',tabIds:orderedIds,contextId:Array.isArray(activeContext?.members)?activeContext.id:null});if(!response?.ok)throw new Error('save_failed');if(oldLegacy)await chrome.runtime.sendMessage({type:'UNTRACK_CONTEXT',contextId:oldLegacy});tabPicker.hidden=true;await load();}catch{showError('No se pudo guardar la selección.');setBusy(false);}
}

async function removeMember(memberId:string){setBusy(true);try{const response=await chrome.runtime.sendMessage({type:'REMOVE_WORKSET_MEMBER',contextId:activeContext.id,memberId});if(!response?.ok)throw new Error('remove_failed');await load();}catch{showError('No se pudo quitar la pestaña.');setBusy(false);}}
async function stop(){if(!activeContext)return;setBusy(true);try{const result=await chrome.runtime.sendMessage({type:'UNTRACK_CONTEXT',contextId:activeContext.id});if(!result?.ok)throw new Error('stop_failed');activeContext=null;await load();}catch{showError('No se pudo dejar de seguir.');setBusy(false);}}
async function startSimple(){setBusy(true);try{const result=await chrome.runtime.sendMessage({type:'TRACK_CONTEXT',scope:selectedScope});if(!result?.ok)throw new Error('track_failed');simplePanel.hidden=true;await load();}catch{showError('No se pudo iniciar el seguimiento.');setBusy(false);}}

function renderScope(){for(const button of scopeButtons)button.setAttribute('aria-checked',String(button.dataset.scope===selectedScope));}
function setBusy(value:boolean){for(const button of [createContext,addTabs,addTabsEmpty,stopTracking,saveTabs,simpleFollow,...scopeButtons])button.disabled=value;for(const input of tabList.querySelectorAll<HTMLInputElement>('input'))input.disabled=value;}
function showError(message:string){statusEl.textContent=message;statusEl.classList.add('error');}
function clearStatus(){statusEl.textContent='';statusEl.classList.remove('error');}
function scopeLabel(scope:string){return scope==='site'?'Sitio completo':scope==='tab'?'Pestaña':'Página exacta';}
function host(url:string){try{return new URL(url).hostname;}catch{return url;}}
function escapeHtml(value:string){return String(value).replace(/[&<>'\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));}
