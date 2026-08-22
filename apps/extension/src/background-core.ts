import type {BrowserContext, BrowserContextMember, BrowserContextScope, BrowserTabSnapshot, Checkpoint, LocalTranscriptionEngine, PendingCapture} from '@selfrelay/shared';
import {contextKey,matches,normalizeUrl} from './url.js';
import {createStorage, type DurableBrowserTabSnapshot} from './storage.js';
import {browserAudioAssetStore, type AudioAssetStore} from './audio-store.js';

type ChromeApi=typeof chrome;
type Clock=()=>string;
type IdFactory=()=>string;
type TranscriptResult={text:string;engine:LocalTranscriptionEngine};
type BackgroundDeps={now?:Clock;uuid?:IdFactory;audioStore?:AudioAssetStore|null;transcribeAudio?:(audioRef:string,language:string)=>Promise<TranscriptResult|null>};

export interface SaveCheckpointInput {
  text?: string;
  audioRef?: string|null;
  audioMimeType?: string|null;
  audioDurationMs?: number|null;
  transcript?: string|null;
  transcriptionEngine?: LocalTranscriptionEngine|null;
  targetMemberIds?: string[]|null;
}

function isWorkset(context:BrowserContext){return Array.isArray(context.members)&&context.members.length>0;}
function worksetMember(context:BrowserContext,url:string){if(!isWorkset(context))return null;let normalized='';try{normalized=normalizeUrl(url);}catch{return null;}return context.members!.find(member=>{try{return normalizeUrl(member.url)===normalized;}catch{return false;}})||null;}
function contextMatches(context:BrowserContext,url:string,tabId?:number){return isWorkset(context)?Boolean(worksetMember(context,url)):matches(context,url,tabId);}

export function findBestContext(contexts:BrowserContext[],url:string,tabId?:number){
  function rank(context:BrowserContext){if(!isWorkset(context)&&context.scope==='tab'&&context.trackedTabId===tabId)return 0;if(isWorkset(context))return 1;if(context.scope==='url')return 2;return 3;}
  return contexts.filter(context=>contextMatches(context,url,tabId)).sort((a,b)=>rank(a)-rank(b)||b.updatedAt.localeCompare(a.updatedAt))[0]||null;
}

function orderedPending(items:PendingCapture[]){return [...items].sort((a,b)=>a.closedAt.localeCompare(b.closedAt)||a.id.localeCompare(b.id));}
function newestSnapshot<T extends BrowserTabSnapshot>(items:T[]){return [...items].sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)||a.tabId-b.tabId)[0]!;}
function durableKey(sessionId:string,tabId:number){return `${sessionId}:${tabId}`;}
function windowSourceKey(sessionId:string,contextId:string,windowId:number){return `session:${sessionId}:context:${contextId}:window:${windowId}`;}
function shutdownSourcePrefix(sessionId:string,contextId:string){return `session:${sessionId}:context:${contextId}:`;}
function cleanText(value:unknown,max=12000){return String(value??'').replace(/\u0000/g,'').trim().slice(0,max);}
function cleanOptional(value:unknown,max=12000){const cleaned=cleanText(value,max);return cleaned||null;}
function cleanAudioRef(value:unknown){const cleaned=cleanText(value,180);return cleaned||null;}
function cleanDuration(value:unknown){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?Math.min(Math.round(parsed),10*60*1000):null;}
function cleanEngine(value:unknown):LocalTranscriptionEngine|null{return value==='browser-local'||value==='whisper-local'?value:null;}
function safeLanguage(value:unknown){const raw=String(value||'es').toLowerCase();const match=raw.match(/^[a-z]{2,3}/);return match?.[0]||'es';}
function checkpointSpecificity(checkpoint:Checkpoint){const targets=checkpoint.targetMemberIds;return !targets?.length?2:targets.length===1?0:1;}

export function createBackgroundController(api:ChromeApi,deps:BackgroundDeps={}){
  const storage=createStorage(api);
  const audioStore=deps.audioStore===undefined?browserAudioAssetStore():deps.audioStore;
  const now=deps.now??(()=>new Date().toISOString());
  const uuid=deps.uuid??(()=>crypto.randomUUID());
  let removalQueue:Promise<void>=Promise.resolve();
  let captureQueue:Promise<void>=Promise.resolve();
  let sessionIdPromise:Promise<string>|null=null;
  let captureWindowId:number|null=null;
  let offscreenPromise:Promise<void>|null=null;
  const windowsAwaitingSurface=new Set<number>();

  function enqueueRemoval<T>(work:()=>Promise<T>){const task=removalQueue.then(work,work);removalQueue=task.then(()=>undefined,()=>undefined);return task;}
  function enqueueCapture<T>(work:()=>Promise<T>){const task=captureQueue.then(work,work);captureQueue=task.then(()=>undefined,()=>undefined);return task;}
  async function ensureBrowserSessionId(){if(!sessionIdPromise){sessionIdPromise=(async()=>{const existing=await storage.getBrowserSessionId();if(existing)return existing;const created=uuid();await storage.setBrowserSessionId(created);return created;})();}return sessionIdPromise;}
  async function getActiveTab(){const tabs=await api.tabs.query({active:true,lastFocusedWindow:true});return tabs[0]||null;}

  async function refreshAllTabs(){for(const tab of await api.tabs.query({}))await refreshTab(tab);}
  async function refreshTab(tab:chrome.tabs.Tab){
    if(!tab?.id||!tab.url)return;
    let url='';try{url=normalizeUrl(tab.url);}catch{return;}
    const contexts=await storage.getContexts();
    let context=contexts.find(item=>!isWorkset(item)&&item.scope==='tab'&&item.trackedTabId===tab.id)||findBestContext(contexts.filter(item=>isWorkset(item)||item.scope!=='tab'),url,tab.id);
    if(context&&!isWorkset(context)&&context.scope==='tab'&&context.trackedTabId===tab.id&&context.url!==url){context={...context,url,origin:new URL(url).origin,contextKey:contextKey(url,'tab'),title:tab.title||url,faviconUrl:tab.favIconUrl||null,updatedAt:now()};contexts[contexts.findIndex(item=>item.id===context!.id)]=context;await storage.setContexts(contexts);}
    const snapshots=await storage.getSnapshots();
    const durable=await storage.getDurableSnapshots();
    const sessionId=await ensureBrowserSessionId();
    const key=durableKey(sessionId,tab.id);
    if(context){const member=worksetMember(context,url);const snapshot:BrowserTabSnapshot={tabId:tab.id,windowId:tab.windowId,contextId:context.id,memberId:member?.id??null,url,title:tab.title||context.title||url,faviconUrl:tab.favIconUrl||context.faviconUrl,capturedAt:now()};snapshots[String(tab.id)]=snapshot;durable[key]={...snapshot,browserSessionId:sessionId};}
    else{delete snapshots[String(tab.id)];delete durable[key];}
    await storage.setSnapshots(snapshots);await storage.setDurableSnapshots(durable);
  }

  async function getActiveState(){
    const tab=await getActiveTab();if(!tab?.id||!tab.url)return{ok:true,supported:false};
    let normalized='';try{normalized=normalizeUrl(tab.url);}catch{return{ok:true,supported:false,url:tab.url,title:tab.title||''};}
    const contexts=await storage.getContexts();const context=findBestContext(contexts,normalized,tab.id);const member=context?worksetMember(context,normalized):null;
    return{ok:true,supported:true,tab:{id:tab.id,windowId:tab.windowId,url:normalized,title:tab.title||normalized,faviconUrl:tab.favIconUrl||null},context,memberId:member?.id??null};
  }

  async function trackContext(scope:BrowserContextScope){
    if(!['tab','url','site'].includes(scope))throw new Error('invalid_scope');const tab=await getActiveTab();if(!tab?.id||!tab.url)throw new Error('no_active_tab');
    const url=normalizeUrl(tab.url),timestamp=now(),origin=new URL(url).origin,key=contextKey(url,scope);const contexts=await storage.getContexts();let context=contexts.find(item=>!isWorkset(item)&&item.contextKey===key&&item.scope===scope);
    if(context){context={...context,url,origin,title:tab.title||url,faviconUrl:tab.favIconUrl||null,trackedTabId:scope==='tab'?tab.id:null,updatedAt:timestamp};contexts[contexts.findIndex(item=>item.id===context!.id)]=context;}
    else{context={id:uuid(),type:'browser',contextKey:key,scope,url,origin,title:tab.title||url,faviconUrl:tab.favIconUrl||null,trackedTabId:scope==='tab'?tab.id:null,createdAt:timestamp,updatedAt:timestamp};contexts.push(context);}
    await storage.setContexts(contexts);await refreshTab(tab);return{ok:true,context};
  }

  async function listEligibleTabs(contextId?:string){
    const context=contextId?(await storage.getContexts()).find(item=>item.id===contextId)||null:null;
    const tabs=await api.tabs.query({});const items:any[]=[];
    for(const tab of tabs){if(!tab.id||!tab.url)continue;let url='';try{url=normalizeUrl(tab.url);}catch{continue;}const member=context?worksetMember(context,url):null;items.push({id:tab.id,windowId:tab.windowId,url,title:tab.title||url,faviconUrl:tab.favIconUrl||null,selected:Boolean(member),memberId:member?.id??null});}
    return{ok:true,tabs:items};
  }

  async function upsertWorkset(tabIds:number[],contextId?:string){
    const unique=[...new Set(tabIds.map(Number).filter(Number.isInteger))];if(!unique.length)return{ok:false,error:'no_tabs_selected'};
    const openTabs=await api.tabs.query({});const byId=new Map(openTabs.filter(tab=>tab.id).map(tab=>[tab.id!,tab]));const selected:chrome.tabs.Tab[]=[];
    for(const id of unique){const tab=byId.get(id);if(!tab?.url)continue;try{normalizeUrl(tab.url);selected.push(tab);}catch{}}
    if(!selected.length)return{ok:false,error:'no_supported_tabs'};
    const contexts=await storage.getContexts();const existing=contextId?contexts.find(item=>item.id===contextId):undefined;
    if(existing&&!isWorkset(existing))return{ok:false,error:'context_not_workset'};
    const timestamp=now();const id=existing?.id||uuid();const oldMembers=existing?.members||[];const members:BrowserContextMember[]=selected.map((tab,index)=>{const url=normalizeUrl(tab.url!);const old=oldMembers.find(member=>{try{return normalizeUrl(member.url)===url;}catch{return false;}});return{id:old?.id||uuid(),url,title:tab.title||url,faviconUrl:tab.favIconUrl||null,order:index,addedAt:old?.addedAt||timestamp};});
    const first=members[0]!;const context:BrowserContext={id,type:'browser',contextKey:`browser:workset:${id}`,scope:'url',url:first.url,origin:new URL(first.url).origin,title:existing?.title||selected[0]?.title||'Contexto de trabajo',faviconUrl:first.faviconUrl,trackedTabId:null,members,createdAt:existing?.createdAt||timestamp,updatedAt:timestamp,metadata:existing?.metadata};
    const index=contexts.findIndex(item=>item.id===id);if(index>=0)contexts[index]=context;else contexts.push(context);await storage.setContexts(contexts);await refreshAllTabs();return{ok:true,context};
  }

  async function removeWorksetMember(contextId:string,memberId:string){
    const contexts=await storage.getContexts();const index=contexts.findIndex(item=>item.id===contextId);if(index<0)return{ok:false,error:'context_not_found'};const context=contexts[index]!;if(!isWorkset(context))return{ok:false,error:'context_not_workset'};
    const members=context.members!.filter(member=>member.id!==memberId).map((member,order)=>({...member,order}));if(members.length===context.members!.length)return{ok:false,error:'member_not_found'};
    if(!members.length)return untrackContext(contextId);
    const first=members[0]!;contexts[index]={...context,members,url:first.url,origin:new URL(first.url).origin,faviconUrl:first.faviconUrl,updatedAt:now()};await storage.setContexts(contexts);
    const snapshots=await storage.getSnapshots();for(const [key,value] of Object.entries(snapshots))if(value.contextId===contextId&&value.memberId===memberId)delete snapshots[key];await storage.setSnapshots(snapshots);
    const durable=await storage.getDurableSnapshots();for(const [key,value] of Object.entries(durable))if(value.contextId===contextId&&value.memberId===memberId)delete durable[key];await storage.setDurableSnapshots(durable);await refreshAllTabs();return{ok:true,context:contexts[index]};
  }

  async function untrackContext(contextId:string){const contexts=(await storage.getContexts()).filter(item=>item.id!==contextId);await storage.setContexts(contexts);const snapshots=await storage.getSnapshots();for(const [key,value] of Object.entries(snapshots))if(value.contextId===contextId)delete snapshots[key];await storage.setSnapshots(snapshots);const durable=await storage.getDurableSnapshots();for(const [key,value] of Object.entries(durable))if(value.contextId===contextId)delete durable[key];await storage.setDurableSnapshots(durable);return{ok:true};}

  async function hasCaptureSurface(){try{const prefix=api.runtime.getURL('checkpoint.html');return (await api.tabs.query({})).some(tab=>typeof tab.url==='string'&&tab.url.startsWith(prefix));}catch{return false;}}
  async function openCapture(pendingId:string){return enqueueCapture(async()=>{if(captureWindowId!==null||await hasCaptureSurface())return false;try{const created=await api.windows.create({url:api.runtime.getURL(`checkpoint.html?pending=${encodeURIComponent(pendingId)}`),type:'popup',width:540,height:650,focused:true});captureWindowId=created?.id??null;return true;}catch{return false;}});}
  async function openOldestPendingCapture(){const first=orderedPending(await storage.getPending())[0];return first?openCapture(first.id):false;}
  async function clearTrackedTabBindings(contexts:BrowserContext[],snapshots:BrowserTabSnapshot[]){const removedTabIds=new Set(snapshots.map(item=>item.tabId));let changed=false;for(let i=0;i<contexts.length;i++){const context=contexts[i]!;if(!isWorkset(context)&&context.scope==='tab'&&context.trackedTabId!==null&&removedTabIds.has(context.trackedTabId)){contexts[i]={...context,trackedTabId:null,updatedAt:now()};changed=true;}}if(changed)await storage.setContexts(contexts);}

  async function processWindowClose(tabId:number,windowId:number){
    const sessionId=await ensureBrowserSessionId();const durable=await storage.getDurableSnapshots();const currentSessionWindow=Object.entries(durable).filter(([,item])=>item.browserSessionId===sessionId&&item.windowId===windowId);let closing=currentSessionWindow.map(([,item])=>item);const snapshots=await storage.getSnapshots();const trigger=snapshots[String(tabId)];if(!closing.length&&trigger)closing=[{...trigger,browserSessionId:sessionId}];if(!closing.length)return{ok:true,created:0,pending:[] as PendingCapture[]};for(const item of closing)delete snapshots[String(item.tabId)];await storage.setSnapshots(snapshots);
    const contexts=await storage.getContexts();await clearTrackedTabBindings(contexts,closing);const contextMap=new Map(contexts.map(item=>[item.id,item]));const byContext=new Map<string,DurableBrowserTabSnapshot[]>();for(const item of closing){if(!contextMap.has(item.contextId))continue;const group=byContext.get(item.contextId)||[];group.push(item);byContext.set(item.contextId,group);}
    const pending=await storage.getPending();const created:PendingCapture[]=[];
    for(const [contextId,items] of byContext){const context=contextMap.get(contextId)!;if(isWorkset(context)&&Object.values(snapshots).some(item=>item.contextId===contextId))continue;const sourceKey=windowSourceKey(sessionId,contextId,windowId);if(pending.some(item=>item.sourceKey===sourceKey))continue;const snapshot=newestSnapshot(items);const capture:PendingCapture={id:uuid(),contextId,url:snapshot.url,title:snapshot.title,memberId:snapshot.memberId??null,closedAt:now(),sourceKey};pending.push(capture);created.push(capture);}
    for(const [key,item] of currentSessionWindow)if(item.windowId===windowId)delete durable[key];await storage.setPendingAndDurable(pending,durable);if(created.length)windowsAwaitingSurface.add(windowId);return{ok:true,created:created.length,pending:created};
  }

  async function processNormalTabClose(tabId:number){
    const sessionId=await ensureBrowserSessionId();const snapshots=await storage.getSnapshots();const snapshot=snapshots[String(tabId)];if(!snapshot)return{ok:true,created:false,pending:null};delete snapshots[String(tabId)];await storage.setSnapshots(snapshots);const contexts=await storage.getContexts();const context=contexts.find(item=>item.id===snapshot.contextId);if(!context)return{ok:true,created:false,pending:null};await clearTrackedTabBindings(contexts,[snapshot]);const durable=await storage.getDurableSnapshots();delete durable[durableKey(sessionId,tabId)];
    if(isWorkset(context)&&Object.values(snapshots).some(item=>item.contextId===context.id)){await storage.setDurableSnapshots(durable);return{ok:true,created:false,pending:null};}
    const pending:PendingCapture={id:uuid(),contextId:context.id,url:snapshot.url,title:snapshot.title,memberId:snapshot.memberId??null,closedAt:now()};const all=await storage.getPending();all.push(pending);await storage.setPendingAndDurable(all,durable);await openCapture(pending.id);return{ok:true,created:true,pending};
  }
  function handleRemoved(tabId:number,isWindowClosing:boolean,windowId?:number){return enqueueRemoval(async()=>{if(isWindowClosing&&typeof windowId==='number')return processWindowClose(tabId,windowId);return processNormalTabClose(tabId);});}

  async function recoverDurableShutdowns(){
    const currentSessionId=await ensureBrowserSessionId();const durable=await storage.getDurableSnapshots();const staleEntries=Object.entries(durable).filter(([,item])=>item.browserSessionId!==currentSessionId);if(!staleEntries.length)return{created:0};const contexts=await storage.getContexts();const knownContexts=new Set(contexts.map(item=>item.id));const groups=new Map<string,DurableBrowserTabSnapshot[]>();for(const [,item] of staleEntries){if(!knownContexts.has(item.contextId))continue;const key=`${item.browserSessionId}:${item.contextId}`;const group=groups.get(key)||[];group.push(item);groups.set(key,group);}await clearTrackedTabBindings(contexts,staleEntries.map(([,item])=>item));const pending=await storage.getPending();let created=0;for(const items of groups.values()){const snapshot=newestSnapshot(items);const oldSessionId=items[0]!.browserSessionId;const prefix=shutdownSourcePrefix(oldSessionId,snapshot.contextId);if(pending.some(item=>item.sourceKey?.startsWith(prefix)))continue;pending.push({id:uuid(),contextId:snapshot.contextId,url:snapshot.url,title:snapshot.title,memberId:snapshot.memberId??null,closedAt:now(),sourceKey:`${prefix}shutdown`});created++;}for(const [key] of staleEntries)delete durable[key];await storage.setPendingAndDurable(pending,durable);return{created};
  }
  async function handleStartup(){await recoverDurableShutdowns();await refreshAllTabs();return openOldestPendingCapture();}
  async function handleWindowRemoved(windowId:number){if(captureWindowId===windowId){captureWindowId=null;return false;}await removalQueue;if(!windowsAwaitingSurface.delete(windowId))return false;try{const remaining=await api.windows.getAll({windowTypes:['normal']});if(!remaining.length)return false;}catch{return false;}return openOldestPendingCapture();}

  async function getPendingCapture(id:string){const pending=(await storage.getPending()).find(item=>item.id===id);if(!pending)return{ok:false,error:'pending_not_found'};const context=(await storage.getContexts()).find(item=>item.id===pending.contextId)||null;return{ok:true,pending,context};}
  async function removePending(id:string){const remaining=(await storage.getPending()).filter(item=>item.id!==id);await storage.setPending(remaining);return orderedPending(remaining)[0]?.id??null;}
  async function discardPending(id:string){const exists=(await storage.getPending()).some(item=>item.id===id);if(!exists)return{ok:false,error:'pending_not_found'};return{ok:true,nextPendingId:await removePending(id)};}

  async function saveCheckpoint(pendingId:string,input:string|SaveCheckpointInput){
    const payload:SaveCheckpointInput=typeof input==='string'?{text:input}:input;const text=cleanText(payload.text);const audioRef=cleanAudioRef(payload.audioRef);if(!text&&!audioRef)return{ok:false,error:'empty_checkpoint'};const pending=(await storage.getPending()).find(item=>item.id===pendingId);if(!pending)return{ok:false,error:'pending_not_found'};const context=(await storage.getContexts()).find(item=>item.id===pending.contextId)||null;
    let targetMemberIds:string[]|null=null;if(isWorkset(context as BrowserContext)&&Array.isArray(payload.targetMemberIds)){const valid=new Set(context!.members!.map(member=>member.id));const requested=[...new Set(payload.targetMemberIds.map(String).filter(id=>valid.has(id)))];if(requested.length&&requested.length<context!.members!.length)targetMemberIds=requested;}
    const checkpoint:Checkpoint={id:uuid(),contextId:pending.contextId,originalText:text,audioRef,audioMimeType:audioRef?cleanOptional(payload.audioMimeType,120):null,audioDurationMs:audioRef?cleanDuration(payload.audioDurationMs):null,transcript:cleanOptional(payload.transcript),transcriptionEngine:cleanEngine(payload.transcriptionEngine),targetMemberIds,createdAt:now(),resolvedAt:null};
    const all=await storage.getCheckpoints();all.push(checkpoint);await storage.setCheckpoints(all);const nextPendingId=await removePending(pendingId);return{ok:true,checkpoint,nextPendingId};
  }

  async function lookupCheckpoint(rawUrl:string,tabId?:number){
    let url='';try{url=normalizeUrl(rawUrl);}catch{return{ok:true,checkpoint:null,context:null,memberId:null};}const context=findBestContext(await storage.getContexts(),url,tabId);if(!context)return{ok:true,checkpoint:null,context:null,memberId:null};const member=worksetMember(context,url);let candidates=await storage.unresolvedFor(context.id);if(isWorkset(context)){candidates=candidates.filter(checkpoint=>!checkpoint.targetMemberIds?.length||Boolean(member&&checkpoint.targetMemberIds.includes(member.id))).sort((a,b)=>checkpointSpecificity(a)-checkpointSpecificity(b)||b.createdAt.localeCompare(a.createdAt));}
    return{ok:true,checkpoint:candidates[0]||null,context,memberId:member?.id??null};
  }

  async function getContextTabState(contextId:string){
    const context=(await storage.getContexts()).find(item=>item.id===contextId)||null;if(!context||!isWorkset(context))return{ok:true,context,missing:[],open:[]};const openTabs=await api.tabs.query({});const openUrls=new Set<string>();for(const tab of openTabs){if(!tab.url)continue;try{openUrls.add(normalizeUrl(tab.url));}catch{}}
    const missing=context.members!.filter(member=>{try{return !openUrls.has(normalizeUrl(member.url));}catch{return false;}});const open=context.members!.filter(member=>!missing.some(item=>item.id===member.id));return{ok:true,context,missing,open};
  }

  async function openMissingContextTabs(contextId:string,windowId?:number){
    const state:any=await getContextTabState(contextId);if(!state.context||!isWorkset(state.context))return{ok:false,error:'context_not_workset',opened:0};let opened=0;for(const member of state.missing as BrowserContextMember[]){let url='';try{url=normalizeUrl(member.url);}catch{continue;}try{await api.tabs.create({url,active:false,...(typeof windowId==='number'?{windowId}:{})});opened++;}catch{}}
    return{ok:true,opened};
  }

  async function cleanupAudio(checkpoint:Checkpoint){if(!checkpoint.audioRef)return true;if(!audioStore)return false;try{await audioStore.delete(checkpoint.audioRef);return true;}catch{return false;}}
  async function resolveCheckpoint(id:string){const all=await storage.getCheckpoints();const index=all.findIndex(item=>item.id===id);if(index<0)return{ok:false,error:'checkpoint_not_found'};const checkpoint=all[index]!;if(!await cleanupAudio(checkpoint))return{ok:false,error:'audio_cleanup_failed'};all[index]={...checkpoint,audioRef:null,audioMimeType:null,audioDurationMs:null,resolvedAt:now()};await storage.setCheckpoints(all);return{ok:true};}
  async function deleteCheckpoint(id:string){const all=await storage.getCheckpoints();const checkpoint=all.find(item=>item.id===id);if(!checkpoint)return{ok:false,error:'checkpoint_not_found'};if(!await cleanupAudio(checkpoint))return{ok:false,error:'audio_cleanup_failed'};await storage.setCheckpoints(all.filter(item=>item.id!==id));return{ok:true};}
  async function openAudioPlayer(audioRef:string){const ref=cleanAudioRef(audioRef);if(!ref)return{ok:false,error:'audio_not_found'};try{await api.windows.create({url:api.runtime.getURL(`audio.html?ref=${encodeURIComponent(ref)}`),type:'popup',width:420,height:240,focused:true});return{ok:true};}catch{return{ok:false,error:'audio_player_failed'};}}

  async function ensureOffscreen(){
    const offscreen=(api as any).offscreen;if(!offscreen?.createDocument)throw new Error('offscreen_unavailable');if(offscreenPromise)return offscreenPromise;offscreenPromise=(async()=>{if(typeof offscreen.hasDocument==='function'&&await offscreen.hasDocument())return;await offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],justification:'Run the packaged local transcription worker after an explicit user request.'});})();try{await offscreenPromise;}finally{offscreenPromise=null;}
  }
  async function runTranscription(audioRef:string,language:string){if(deps.transcribeAudio)return deps.transcribeAudio(audioRef,language);await ensureOffscreen();const response=await api.runtime.sendMessage({target:'offscreen',type:'OFFSCREEN_TRANSCRIBE',audioRef,language});return response?.ok?{text:String(response.text||''),engine:cleanEngine(response.engine)||'whisper-local'}:null;}
  async function transcribeCheckpoint(id:string,language:string){const all=await storage.getCheckpoints();const index=all.findIndex(item=>item.id===id);if(index<0)return{ok:false,error:'checkpoint_not_found'};const checkpoint=all[index]!;if(checkpoint.transcript)return{ok:true,checkpoint,cached:true};if(!checkpoint.audioRef)return{ok:false,error:'audio_not_found'};const result=await runTranscription(checkpoint.audioRef,safeLanguage(language));if(!result?.text)return{ok:false,error:'transcription_failed'};const updated:Checkpoint={...checkpoint,transcript:cleanText(result.text),transcriptionEngine:result.engine};all[index]=updated;await storage.setCheckpoints(all);return{ok:true,checkpoint:updated,cached:false};}
  async function updateTranscript(id:string,textValue:string){const all=await storage.getCheckpoints();const index=all.findIndex(item=>item.id===id);if(index<0)return{ok:false,error:'checkpoint_not_found'};const transcript=cleanOptional(textValue);all[index]={...all[index]!,transcript};await storage.setCheckpoints(all);return{ok:true,checkpoint:all[index]};}

  async function getContextHistory(contextId:string){const context=(await storage.getContexts()).find(item=>item.id===contextId)||null;const checkpoints=(await storage.getCheckpoints()).filter(item=>item.contextId===contextId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return{ok:true,context,checkpoints};}

  async function handleMessage(message:any,sender?:chrome.runtime.MessageSender){
    switch(message?.type){
      case'GET_ACTIVE_STATE':return getActiveState();
      case'TRACK_CONTEXT':return trackContext(message.scope);
      case'LIST_ELIGIBLE_TABS':return listEligibleTabs(String(message.contextId||'')||undefined);
      case'UPSERT_WORKSET':return upsertWorkset(Array.isArray(message.tabIds)?message.tabIds:[],String(message.contextId||'')||undefined);
      case'REMOVE_WORKSET_MEMBER':return removeWorksetMember(String(message.contextId||''),String(message.memberId||''));
      case'UNTRACK_CONTEXT':return untrackContext(String(message.contextId||''));
      case'GET_PENDING_CAPTURE':return getPendingCapture(String(message.pendingId||''));
      case'SAVE_CHECKPOINT':return saveCheckpoint(String(message.pendingId||''),message.payload??{text:message.text});
      case'DISCARD_PENDING_CAPTURE':return discardPending(String(message.pendingId||''));
      case'LOOKUP_CHECKPOINT':return lookupCheckpoint(String(message.url||sender?.tab?.url||''),sender?.tab?.id);
      case'GET_CONTEXT_TAB_STATE':return getContextTabState(String(message.contextId||''));
      case'OPEN_MISSING_CONTEXT_TABS':return openMissingContextTabs(String(message.contextId||''),sender?.tab?.windowId);
      case'TRANSCRIBE_CHECKPOINT':return transcribeCheckpoint(String(message.checkpointId||''),String(message.language||'es'));
      case'UPDATE_CHECKPOINT_TRANSCRIPT':return updateTranscript(String(message.checkpointId||''),String(message.text||''));
      case'RESOLVE_CHECKPOINT':return resolveCheckpoint(String(message.checkpointId||''));
      case'DELETE_CHECKPOINT':return deleteCheckpoint(String(message.checkpointId||''));
      case'OPEN_AUDIO_PLAYER':return openAudioPlayer(String(message.audioRef||''));
      case'GET_CONTEXT_HISTORY':return getContextHistory(String(message.contextId||''));
      default:return{ok:false,error:'unknown_message'};
    }
  }

  return{storage,refreshAllTabs,refreshTab,getActiveState,trackContext,listEligibleTabs,upsertWorkset,removeWorksetMember,untrackContext,handleRemoved,handleStartup,handleWindowRemoved,getPendingCapture,discardPending,saveCheckpoint,lookupCheckpoint,getContextTabState,openMissingContextTabs,transcribeCheckpoint,updateTranscript,resolveCheckpoint,deleteCheckpoint,getContextHistory,handleMessage,openOldestPendingCapture,recoverDurableShutdowns};
}

export function registerBackground(api:ChromeApi,deps:BackgroundDeps={}){
  const controller=createBackgroundController(api,deps);
  api.runtime.onInstalled.addListener(()=>{void (async()=>{try{await api.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});}catch{}try{await api.storage.session.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});}catch{}await controller.refreshAllTabs();})();});
  api.runtime.onStartup.addListener(()=>{void controller.handleStartup();});
  api.tabs.onCreated.addListener(tab=>{void controller.refreshTab(tab);});
  api.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{if(changeInfo.url||changeInfo.status==='complete'||changeInfo.title)void controller.refreshTab({...tab,id:tabId});});
  api.tabs.onRemoved.addListener((tabId,info)=>{void controller.handleRemoved(tabId,info.isWindowClosing,info.windowId);});
  api.windows.onRemoved.addListener(windowId=>{void controller.handleWindowRemoved(windowId);});
  api.runtime.onMessage.addListener((message,sender,sendResponse)=>{if(message?.target==='offscreen')return false;void controller.handleMessage(message,sender).then(sendResponse).catch(error=>sendResponse({ok:false,error:error instanceof Error?error.message:'unknown_error'}));return true;});
  return controller;
}
