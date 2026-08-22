import type {BrowserContext, BrowserContextScope, Checkpoint, PendingCapture} from '@selfrelay/shared';
import {contextKey,matches,normalizeUrl} from './url.js';
import {createStorage} from './storage.js';

type ChromeApi=typeof chrome;
type Clock=()=>string;
type IdFactory=()=>string;

export function findBestContext(contexts:BrowserContext[],url:string,tabId?:number){
  const rank:Record<BrowserContextScope,number>={tab:0,url:1,site:2};
  return contexts.filter(context=>matches(context,url,tabId)).sort((a,b)=>rank[a.scope]-rank[b.scope]||b.updatedAt.localeCompare(a.updatedAt))[0]||null;
}

export function createBackgroundController(api:ChromeApi,deps:{now?:Clock;uuid?:IdFactory}={}){
  const storage=createStorage(api);
  const now=deps.now??(()=>new Date().toISOString());
  const uuid=deps.uuid??(()=>crypto.randomUUID());

  async function getActiveTab(){const tabs=await api.tabs.query({active:true,lastFocusedWindow:true});return tabs[0]||null;}
  async function refreshAllTabs(){for(const tab of await api.tabs.query({}))await refreshTab(tab);}
  async function refreshTab(tab:chrome.tabs.Tab){
    if(!tab?.id||!tab.url)return;
    let url='';try{url=normalizeUrl(tab.url);}catch{return;}
    const contexts=await storage.getContexts();
    let context=contexts.find(item=>item.scope==='tab'&&item.trackedTabId===tab.id)||findBestContext(contexts.filter(item=>item.scope!=='tab'),url,tab.id);
    if(context?.scope==='tab'&&context.trackedTabId===tab.id&&context.url!==url){
      context={...context,url,origin:new URL(url).origin,contextKey:contextKey(url,'tab'),title:tab.title||url,faviconUrl:tab.favIconUrl||null,updatedAt:now()};
      contexts[contexts.findIndex(item=>item.id===context!.id)]=context;
      await storage.setContexts(contexts);
    }
    const snapshots=await storage.getSnapshots();
    if(context)snapshots[String(tab.id)]={tabId:tab.id,contextId:context.id,url,title:tab.title||context.title||url,faviconUrl:tab.favIconUrl||context.faviconUrl,capturedAt:now()};
    else delete snapshots[String(tab.id)];
    await storage.setSnapshots(snapshots);
  }
  async function getActiveState(){
    const tab=await getActiveTab();
    if(!tab?.id||!tab.url)return{ok:true,supported:false};
    let normalized='';try{normalized=normalizeUrl(tab.url);}catch{return{ok:true,supported:false,url:tab.url,title:tab.title||''};}
    const contexts=await storage.getContexts();
    return{ok:true,supported:true,tab:{id:tab.id,url:normalized,title:tab.title||normalized,faviconUrl:tab.favIconUrl||null},context:findBestContext(contexts,normalized,tab.id)};
  }
  async function trackContext(scope:BrowserContextScope){
    if(!['tab','url','site'].includes(scope))throw new Error('invalid_scope');
    const tab=await getActiveTab();if(!tab?.id||!tab.url)throw new Error('no_active_tab');
    const url=normalizeUrl(tab.url),timestamp=now(),origin=new URL(url).origin,key=contextKey(url,scope);
    const contexts=await storage.getContexts();
    let context=contexts.find(item=>item.contextKey===key&&item.scope===scope);
    if(context){context={...context,url,origin,title:tab.title||url,faviconUrl:tab.favIconUrl||null,trackedTabId:scope==='tab'?tab.id:null,updatedAt:timestamp};contexts[contexts.findIndex(item=>item.id===context!.id)]=context;}
    else{context={id:uuid(),type:'browser',contextKey:key,scope,url,origin,title:tab.title||url,faviconUrl:tab.favIconUrl||null,trackedTabId:scope==='tab'?tab.id:null,createdAt:timestamp,updatedAt:timestamp};contexts.push(context);}
    await storage.setContexts(contexts);await refreshTab(tab);return{ok:true,context};
  }
  async function untrackContext(contextId:string){const contexts=(await storage.getContexts()).filter(item=>item.id!==contextId);await storage.setContexts(contexts);const snapshots=await storage.getSnapshots();for(const [key,value] of Object.entries(snapshots))if(value.contextId===contextId)delete snapshots[key];await storage.setSnapshots(snapshots);return{ok:true};}
  async function handleRemoved(tabId:number,isWindowClosing:boolean){
    const snapshots=await storage.getSnapshots();const snapshot=snapshots[String(tabId)];if(!snapshot)return;
    delete snapshots[String(tabId)];await storage.setSnapshots(snapshots);
    const contexts=await storage.getContexts();const context=contexts.find(item=>item.id===snapshot.contextId);if(!context)return;
    if(context.scope==='tab'&&context.trackedTabId===tabId){const index=contexts.findIndex(item=>item.id===context.id);contexts[index]={...context,trackedTabId:null,updatedAt:now()};await storage.setContexts(contexts);}
    const pending:PendingCapture={id:uuid(),contextId:context.id,url:snapshot.url,title:snapshot.title,closedAt:now()};const all=await storage.getPending();all.push(pending);await storage.setPending(all);
    if(isWindowClosing)return;
    try{await api.windows.create({url:api.runtime.getURL(`checkpoint.html?pending=${encodeURIComponent(pending.id)}`),type:'popup',width:460,height:560,focused:true});}catch{}
  }
  async function handleStartup(){await refreshAllTabs();const pending=(await storage.getPending()).sort((a,b)=>a.closedAt.localeCompare(b.closedAt));if(!pending[0])return;try{await api.windows.create({url:api.runtime.getURL(`checkpoint.html?pending=${encodeURIComponent(pending[0].id)}`),type:'popup',width:460,height:560,focused:true});}catch{}}
  async function getPendingCapture(id:string){const pending=(await storage.getPending()).find(item=>item.id===id);if(!pending)return{ok:false,error:'pending_not_found'};const context=(await storage.getContexts()).find(item=>item.id===pending.contextId)||null;return{ok:true,pending,context};}
  async function discardPending(id:string){await storage.setPending((await storage.getPending()).filter(item=>item.id!==id));return{ok:true};}
  async function saveCheckpoint(pendingId:string,text:string){const clean=text.replace(/\u0000/g,'').trim().slice(0,12000);if(!clean)return{ok:false,error:'empty_checkpoint'};const pending=(await storage.getPending()).find(item=>item.id===pendingId);if(!pending)return{ok:false,error:'pending_not_found'};const checkpoint:Checkpoint={id:uuid(),contextId:pending.contextId,originalText:clean,createdAt:now(),resolvedAt:null};const all=await storage.getCheckpoints();all.push(checkpoint);await storage.setCheckpoints(all);await discardPending(pendingId);return{ok:true,checkpoint};}
  async function lookupCheckpoint(rawUrl:string,tabId?:number){let url='';try{url=normalizeUrl(rawUrl);}catch{return{ok:true,checkpoint:null,context:null};}const context=findBestContext(await storage.getContexts(),url,tabId);if(!context)return{ok:true,checkpoint:null,context:null};return{ok:true,checkpoint:(await storage.unresolvedFor(context.id))[0]||null,context};}
  async function resolveCheckpoint(id:string){const all=await storage.getCheckpoints();const index=all.findIndex(item=>item.id===id);if(index<0)return{ok:false,error:'checkpoint_not_found'};all[index]={...all[index]!,resolvedAt:now()};await storage.setCheckpoints(all);return{ok:true};}
  async function getContextHistory(contextId:string){const context=(await storage.getContexts()).find(item=>item.id===contextId)||null;const checkpoints=(await storage.getCheckpoints()).filter(item=>item.contextId===contextId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return{ok:true,context,checkpoints};}
  async function handleMessage(message:any,sender?:chrome.runtime.MessageSender){switch(message?.type){case'GET_ACTIVE_STATE':return getActiveState();case'TRACK_CONTEXT':return trackContext(message.scope);case'UNTRACK_CONTEXT':return untrackContext(String(message.contextId||''));case'GET_PENDING_CAPTURE':return getPendingCapture(String(message.pendingId||''));case'SAVE_CHECKPOINT':return saveCheckpoint(String(message.pendingId||''),String(message.text||''));case'DISCARD_PENDING_CAPTURE':return discardPending(String(message.pendingId||''));case'LOOKUP_CHECKPOINT':return lookupCheckpoint(String(message.url||sender?.tab?.url||''),sender?.tab?.id);case'RESOLVE_CHECKPOINT':return resolveCheckpoint(String(message.checkpointId||''));case'GET_CONTEXT_HISTORY':return getContextHistory(String(message.contextId||''));default:return{ok:false,error:'unknown_message'};}}
  return{storage,refreshAllTabs,refreshTab,getActiveState,trackContext,untrackContext,handleRemoved,handleStartup,getPendingCapture,discardPending,saveCheckpoint,lookupCheckpoint,resolveCheckpoint,getContextHistory,handleMessage};
}

export function registerBackground(api:ChromeApi,deps:{now?:Clock;uuid?:IdFactory}={}){
  const controller=createBackgroundController(api,deps);
  api.runtime.onInstalled.addListener(()=>{void (async()=>{try{await api.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});}catch{}try{await api.storage.session.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});}catch{}await controller.refreshAllTabs();})();});
  api.runtime.onStartup.addListener(()=>{void controller.handleStartup();});
  api.tabs.onCreated.addListener(tab=>{void controller.refreshTab(tab);});
  api.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{if(changeInfo.url||changeInfo.status==='complete'||changeInfo.title)void controller.refreshTab({...tab,id:tabId});});
  api.tabs.onRemoved.addListener((tabId,info)=>{void controller.handleRemoved(tabId,info.isWindowClosing);});
  api.runtime.onMessage.addListener((message,sender,sendResponse)=>{void controller.handleMessage(message,sender).then(sendResponse).catch(error=>sendResponse({ok:false,error:error instanceof Error?error.message:'unknown_error'}));return true;});
  return controller;
}
