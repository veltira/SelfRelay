import type {BrowserContext, BrowserContextScope, BrowserTabSnapshot, Checkpoint, PendingCapture} from '@selfrelay/shared';
import {contextKey,matches,normalizeUrl} from './url.js';
import {createStorage, type DurableBrowserTabSnapshot} from './storage.js';

type ChromeApi=typeof chrome;
type Clock=()=>string;
type IdFactory=()=>string;

export function findBestContext(contexts:BrowserContext[],url:string,tabId?:number){
  const rank:Record<BrowserContextScope,number>={tab:0,url:1,site:2};
  return contexts.filter(context=>matches(context,url,tabId)).sort((a,b)=>rank[a.scope]-rank[b.scope]||b.updatedAt.localeCompare(a.updatedAt))[0]||null;
}

function orderedPending(items:PendingCapture[]){return [...items].sort((a,b)=>a.closedAt.localeCompare(b.closedAt)||a.id.localeCompare(b.id));}
function newestSnapshot<T extends BrowserTabSnapshot>(items:T[]){return [...items].sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)||a.tabId-b.tabId)[0]!;}
function durableKey(sessionId:string,tabId:number){return `${sessionId}:${tabId}`;}
function windowSourceKey(sessionId:string,contextId:string,windowId:number){return `session:${sessionId}:context:${contextId}:window:${windowId}`;}
function shutdownSourcePrefix(sessionId:string,contextId:string){return `session:${sessionId}:context:${contextId}:`;}

export function createBackgroundController(api:ChromeApi,deps:{now?:Clock;uuid?:IdFactory}={}){
  const storage=createStorage(api);
  const now=deps.now??(()=>new Date().toISOString());
  const uuid=deps.uuid??(()=>crypto.randomUUID());
  let removalQueue:Promise<void>=Promise.resolve();
  let captureQueue:Promise<void>=Promise.resolve();
  let sessionIdPromise:Promise<string>|null=null;
  let captureWindowId:number|null=null;
  const windowsAwaitingSurface=new Set<number>();

  function enqueueRemoval<T>(work:()=>Promise<T>){const task=removalQueue.then(work,work);removalQueue=task.then(()=>undefined,()=>undefined);return task;}
  function enqueueCapture<T>(work:()=>Promise<T>){const task=captureQueue.then(work,work);captureQueue=task.then(()=>undefined,()=>undefined);return task;}
  async function ensureBrowserSessionId(){
    if(!sessionIdPromise){sessionIdPromise=(async()=>{const existing=await storage.getBrowserSessionId();if(existing)return existing;const created=uuid();await storage.setBrowserSessionId(created);return created;})();}
    return sessionIdPromise;
  }
  async function getActiveTab(){const tabs=await api.tabs.query({active:true,lastFocusedWindow:true});return tabs[0]||null;}
  async function refreshAllTabs(){for(const tab of await api.tabs.query({}))await refreshTab(tab);}
  async function refreshTab(tab:chrome.tabs.Tab){
    if(!tab?.id||!tab.url)return;
    let url='';try{url=normalizeUrl(tab.url);}catch{return;}
    const contexts=await storage.getContexts();
    let context=contexts.find(item=>item.scope==='tab'&&item.trackedTabId===tab.id)||findBestContext(contexts.filter(item=>item.scope!=='tab'),url,tab.id);
    if(context?.scope==='tab'&&context.trackedTabId===tab.id&&context.url!==url){context={...context,url,origin:new URL(url).origin,contextKey:contextKey(url,'tab'),title:tab.title||url,faviconUrl:tab.favIconUrl||null,updatedAt:now()};contexts[contexts.findIndex(item=>item.id===context!.id)]=context;await storage.setContexts(contexts);}
    const snapshots=await storage.getSnapshots();
    const durable=await storage.getDurableSnapshots();
    const sessionId=await ensureBrowserSessionId();
    const key=durableKey(sessionId,tab.id);
    if(context){const snapshot:BrowserTabSnapshot={tabId:tab.id,windowId:tab.windowId,contextId:context.id,url,title:tab.title||context.title||url,faviconUrl:tab.favIconUrl||context.faviconUrl,capturedAt:now()};snapshots[String(tab.id)]=snapshot;durable[key]={...snapshot,browserSessionId:sessionId};}
    else{delete snapshots[String(tab.id)];delete durable[key];}
    await storage.setSnapshots(snapshots);await storage.setDurableSnapshots(durable);
  }
  async function getActiveState(){const tab=await getActiveTab();if(!tab?.id||!tab.url)return{ok:true,supported:false};let normalized='';try{normalized=normalizeUrl(tab.url);}catch{return{ok:true,supported:false,url:tab.url,title:tab.title||''};}const contexts=await storage.getContexts();return{ok:true,supported:true,tab:{id:tab.id,url:normalized,title:tab.title||normalized,faviconUrl:tab.favIconUrl||null},context:findBestContext(contexts,normalized,tab.id)};}
  async function trackContext(scope:BrowserContextScope){
    if(!['tab','url','site'].includes(scope))throw new Error('invalid_scope');const tab=await getActiveTab();if(!tab?.id||!tab.url)throw new Error('no_active_tab');const url=normalizeUrl(tab.url),timestamp=now(),origin=new URL(url).origin,key=contextKey(url,scope);const contexts=await storage.getContexts();let context=contexts.find(item=>item.contextKey===key&&item.scope===scope);
    if(context){context={...context,url,origin,title:tab.title||url,faviconUrl:tab.favIconUrl||null,trackedTabId:scope==='tab'?tab.id:null,updatedAt:timestamp};contexts[contexts.findIndex(item=>item.id===context!.id)]=context;}else{context={id:uuid(),type:'browser',contextKey:key,scope,url,origin,title:tab.title||url,faviconUrl:tab.favIconUrl||null,trackedTabId:scope==='tab'?tab.id:null,createdAt:timestamp,updatedAt:timestamp};contexts.push(context);}await storage.setContexts(contexts);await refreshTab(tab);return{ok:true,context};
  }
  async function untrackContext(contextId:string){const contexts=(await storage.getContexts()).filter(item=>item.id!==contextId);await storage.setContexts(contexts);const snapshots=await storage.getSnapshots();for(const [key,value] of Object.entries(snapshots))if(value.contextId===contextId)delete snapshots[key];await storage.setSnapshots(snapshots);const durable=await storage.getDurableSnapshots();for(const [key,value] of Object.entries(durable))if(value.contextId===contextId)delete durable[key];await storage.setDurableSnapshots(durable);return{ok:true};}
  async function hasCaptureSurface(){try{const prefix=api.runtime.getURL('checkpoint.html');return (await api.tabs.query({})).some(tab=>typeof tab.url==='string'&&tab.url.startsWith(prefix));}catch{return false;}}
  async function openCapture(pendingId:string){return enqueueCapture(async()=>{if(captureWindowId!==null||await hasCaptureSurface())return false;try{const created=await api.windows.create({url:api.runtime.getURL(`checkpoint.html?pending=${encodeURIComponent(pendingId)}`),type:'popup',width:460,height:560,focused:true});captureWindowId=created?.id??null;return true;}catch{return false;}});}
  async function openOldestPendingCapture(){const first=orderedPending(await storage.getPending())[0];return first?openCapture(first.id):false;}
  async function clearTrackedTabBindings(contexts:BrowserContext[],snapshots:BrowserTabSnapshot[]){const removedTabIds=new Set(snapshots.map(item=>item.tabId));let changed=false;for(let i=0;i<contexts.length;i++){const context=contexts[i]!;if(context.scope==='tab'&&context.trackedTabId!==null&&removedTabIds.has(context.trackedTabId)){contexts[i]={...context,trackedTabId:null,updatedAt:now()};changed=true;}}if(changed)await storage.setContexts(contexts);}
  async function processWindowClose(tabId:number,windowId:number){
    const sessionId=await ensureBrowserSessionId();const durable=await storage.getDurableSnapshots();const currentSessionWindow=Object.entries(durable).filter(([,item])=>item.browserSessionId===sessionId&&item.windowId===windowId);let closing=currentSessionWindow.map(([,item])=>item);const snapshots=await storage.getSnapshots();const trigger=snapshots[String(tabId)];if(!closing.length&&trigger)closing=[{...trigger,browserSessionId:sessionId}];if(!closing.length)return{ok:true,created:0,pending:[] as PendingCapture[]};for(const item of closing)delete snapshots[String(item.tabId)];await storage.setSnapshots(snapshots);
    const contexts=await storage.getContexts();await clearTrackedTabBindings(contexts,closing);const knownContexts=new Set(contexts.map(item=>item.id));const byContext=new Map<string,DurableBrowserTabSnapshot[]>();for(const item of closing){if(!knownContexts.has(item.contextId))continue;const group=byContext.get(item.contextId)||[];group.push(item);byContext.set(item.contextId,group);}
    const pending=await storage.getPending();const created:PendingCapture[]=[];for(const [contextId,items] of byContext){const sourceKey=windowSourceKey(sessionId,contextId,windowId);if(pending.some(item=>item.sourceKey===sourceKey))continue;const snapshot=newestSnapshot(items);const capture:PendingCapture={id:uuid(),contextId,url:snapshot.url,title:snapshot.title,closedAt:now(),sourceKey};pending.push(capture);created.push(capture);}for(const [key,item] of currentSessionWindow)if(item.windowId===windowId)delete durable[key];await storage.setPendingAndDurable(pending,durable);if(created.length)windowsAwaitingSurface.add(windowId);return{ok:true,created:created.length,pending:created};
  }
  async function processNormalTabClose(tabId:number){const sessionId=await ensureBrowserSessionId();const snapshots=await storage.getSnapshots();const snapshot=snapshots[String(tabId)];if(!snapshot)return{ok:true,created:false,pending:null};delete snapshots[String(tabId)];await storage.setSnapshots(snapshots);const contexts=await storage.getContexts();const context=contexts.find(item=>item.id===snapshot.contextId);if(!context)return{ok:true,created:false,pending:null};await clearTrackedTabBindings(contexts,[snapshot]);const pending:PendingCapture={id:uuid(),contextId:context.id,url:snapshot.url,title:snapshot.title,closedAt:now()};const all=await storage.getPending();all.push(pending);const durable=await storage.getDurableSnapshots();delete durable[durableKey(sessionId,tabId)];await storage.setPendingAndDurable(all,durable);await openCapture(pending.id);return{ok:true,created:true,pending};}
  function handleRemoved(tabId:number,isWindowClosing:boolean,windowId?:number){return enqueueRemoval(async()=>{if(isWindowClosing&&typeof windowId==='number')return processWindowClose(tabId,windowId);return processNormalTabClose(tabId);});}
  async function recoverDurableShutdowns(){
    const currentSessionId=await ensureBrowserSessionId();const durable=await storage.getDurableSnapshots();const staleEntries=Object.entries(durable).filter(([,item])=>item.browserSessionId!==currentSessionId);if(!staleEntries.length)return{created:0};const contexts=await storage.getContexts();const knownContexts=new Set(contexts.map(item=>item.id));const groups=new Map<string,DurableBrowserTabSnapshot[]>();for(const [,item] of staleEntries){if(!knownContexts.has(item.contextId))continue;const key=`${item.browserSessionId}:${item.contextId}`;const group=groups.get(key)||[];group.push(item);groups.set(key,group);}await clearTrackedTabBindings(contexts,staleEntries.map(([,item])=>item));const pending=await storage.getPending();let created=0;for(const items of groups.values()){const snapshot=newestSnapshot(items);const oldSessionId=items[0]!.browserSessionId;const prefix=shutdownSourcePrefix(oldSessionId,snapshot.contextId);if(pending.some(item=>item.sourceKey?.startsWith(prefix)))continue;pending.push({id:uuid(),contextId:snapshot.contextId,url:snapshot.url,title:snapshot.title,closedAt:now(),sourceKey:`${prefix}shutdown`});created++;}for(const [key] of staleEntries)delete durable[key];await storage.setPendingAndDurable(pending,durable);return{created};
  }
  async function handleStartup(){captureWindowId=null;await recoverDurableShutdowns();await refreshAllTabs();return openOldestPendingCapture();}
  async function handleWindowRemoved(windowId:number){if(captureWindowId===windowId){captureWindowId=null;return false;}await removalQueue;if(!windowsAwaitingSurface.delete(windowId))return false;try{const remaining=await api.windows.getAll({windowTypes:['normal']});if(!remaining.length)return false;}catch{return false;}return openOldestPendingCapture();}
  async function getPendingCapture(id:string){const pending=(await storage.getPending()).find(item=>item.id===id);if(!pending)return{ok:false,error:'pending_not_found'};const context=(await storage.getContexts()).find(item=>item.id===pending.contextId)||null;return{ok:true,pending,context};}
  async function removePending(id:string){const remaining=(await storage.getPending()).filter(item=>item.id!==id);await storage.setPending(remaining);return orderedPending(remaining)[0]?.id??null;}
  async function discardPending(id:string){const exists=(await storage.getPending()).some(item=>item.id===id);if(!exists)return{ok:false,error:'pending_not_found'};return{ok:true,nextPendingId:await removePending(id)};}
  async function saveCheckpoint(pendingId:string,text:string){const clean=text.replace(/\u0000/g,'').trim().slice(0,12000);if(!clean)return{ok:false,error:'empty_checkpoint'};const pending=(await storage.getPending()).find(item=>item.id===pendingId);if(!pending)return{ok:false,error:'pending_not_found'};const checkpoint:Checkpoint={id:uuid(),contextId:pending.contextId,originalText:clean,createdAt:now(),resolvedAt:null};const all=await storage.getCheckpoints();all.push(checkpoint);await storage.setCheckpoints(all);const nextPendingId=await removePending(pendingId);return{ok:true,checkpoint,nextPendingId};}
  async function lookupCheckpoint(rawUrl:string,tabId?:number){let url='';try{url=normalizeUrl(rawUrl);}catch{return{ok:true,checkpoint:null,context:null};}const context=findBestContext(await storage.getContexts(),url,tabId);if(!context)return{ok:true,checkpoint:null,context:null};return{ok:true,checkpoint:(await storage.unresolvedFor(context.id))[0]||null,context};}
  async function resolveCheckpoint(id:string){const all=await storage.getCheckpoints();const index=all.findIndex(item=>item.id===id);if(index<0)return{ok:false,error:'checkpoint_not_found'};all[index]={...all[index]!,resolvedAt:now()};await storage.setCheckpoints(all);return{ok:true};}
  async function getContextHistory(contextId:string){const context=(await storage.getContexts()).find(item=>item.id===contextId)||null;const checkpoints=(await storage.getCheckpoints()).filter(item=>item.contextId===contextId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return{ok:true,context,checkpoints};}
  async function handleMessage(message:any,sender?:chrome.runtime.MessageSender){switch(message?.type){case'GET_ACTIVE_STATE':return getActiveState();case'TRACK_CONTEXT':return trackContext(message.scope);case'UNTRACK_CONTEXT':return untrackContext(String(message.contextId||''));case'GET_PENDING_CAPTURE':return getPendingCapture(String(message.pendingId||''));case'SAVE_CHECKPOINT':return saveCheckpoint(String(message.pendingId||''),String(message.text||''));case'DISCARD_PENDING_CAPTURE':return discardPending(String(message.pendingId||''));case'LOOKUP_CHECKPOINT':return lookupCheckpoint(String(message.url||sender?.tab?.url||''),sender?.tab?.id);case'RESOLVE_CHECKPOINT':return resolveCheckpoint(String(message.checkpointId||''));case'GET_CONTEXT_HISTORY':return getContextHistory(String(message.contextId||''));default:return{ok:false,error:'unknown_message'};}}
  return{storage,refreshAllTabs,refreshTab,getActiveState,trackContext,untrackContext,handleRemoved,handleStartup,handleWindowRemoved,getPendingCapture,discardPending,saveCheckpoint,lookupCheckpoint,resolveCheckpoint,getContextHistory,handleMessage,openOldestPendingCapture,recoverDurableShutdowns};
}

export function registerBackground(api:ChromeApi,deps:{now?:Clock;uuid?:IdFactory}={}){
  const controller=createBackgroundController(api,deps);
  api.runtime.onInstalled.addListener(()=>{void (async()=>{try{await api.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});}catch{}try{await api.storage.session.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});}catch{}await controller.refreshAllTabs();})();});
  api.runtime.onStartup.addListener(()=>{void controller.handleStartup();});
  api.tabs.onCreated.addListener(tab=>{void controller.refreshTab(tab);});
  api.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{if(changeInfo.url||changeInfo.status==='complete'||changeInfo.title)void controller.refreshTab({...tab,id:tabId});});
  api.tabs.onRemoved.addListener((tabId,info)=>{void controller.handleRemoved(tabId,info.isWindowClosing,info.windowId);});
  api.windows.onRemoved.addListener(windowId=>{void controller.handleWindowRemoved(windowId);});
  api.runtime.onMessage.addListener((message,sender,sendResponse)=>{void controller.handleMessage(message,sender).then(sendResponse).catch(error=>sendResponse({ok:false,error:error instanceof Error?error.message:'unknown_error'}));return true;});
  return controller;
}