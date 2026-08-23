#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

const extensionDir=resolve(process.argv[2]||'');
const fixturePath=resolve(process.argv[3]||'');
if(!extensionDir||!fixturePath)throw new Error('usage: transcription-lifecycle-e2e.mjs <packaged-extension-dir> <wav-fixture>');
const fixtureBase64=(await readFile(fixturePath)).toString('base64');

const server=createServer((request,response)=>{const key=String(request.url||'/').split('?')[0].slice(1)||'a';response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(`<!doctype html><meta charset="utf-8"><title>SelfRelay lifecycle ${key}</title><main>SelfRelay lifecycle work page ${key}</main>`);});
await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen);});
const address=server.address();if(!address||typeof address==='string')throw new Error('fixture_server_failed');
const workUrl=key=>`http://127.0.0.1:${address.port}/${key}`;

const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--autoplay-policy=no-user-gesture-required']});
const unexpected=[];
function describeConsole(message){return{kind:'console.error',page:message.page()?.url()||'',text:message.text()};}
context.on('console',message=>{if(message.type()==='error')unexpected.push(describeConsole(message));});
context.on('weberror',error=>unexpected.push({kind:'weberror',page:error.page()?.url()||'',text:error.error()?.stack||error.error()?.message||String(error.error())}));
for(const page of context.pages())page.on('pageerror',error=>unexpected.push({kind:'pageerror',page:page.url(),text:error?.stack||error?.message||String(error)}));
context.on('page',page=>page.on('pageerror',error=>unexpected.push({kind:'pageerror',page:page.url(),text:error?.stack||error?.message||String(error)})));

async function waitForServiceWorker(extensionId=''){
  const existing=context.serviceWorkers().find(worker=>worker.url().endsWith('/background.js')&&(!extensionId||new URL(worker.url()).host===extensionId));
  if(existing)return existing;
  return context.waitForEvent('serviceworker',{predicate:worker=>worker.url().endsWith('/background.js')&&(!extensionId||new URL(worker.url()).host===extensionId),timeout:30000});
}

async function openPopup(extensionId){
  const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/popup.html`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(globalThis.chrome?.runtime?.id),null,{timeout:10000});return page;
}

async function resetState(page){await page.evaluate(async()=>{await chrome.storage.local.clear();await chrome.storage.session.clear();const indexedDBApi=globalThis.indexedDB;if(indexedDBApi?.databases){for(const db of await indexedDBApi.databases())if(db.name)await new Promise(resolveDelete=>{const request=indexedDBApi.deleteDatabase(db.name);request.onsuccess=request.onerror=request.onblocked=()=>resolveDelete();});}});}

async function seedAudioCheckpoint(page,{key,url}){
  return page.evaluate(async({fixtureBase64,key,url})=>{
    const wavBytes=Uint8Array.from(atob(fixtureBase64),char=>char.charCodeAt(0));
    const audioContext=new AudioContext();const audioBuffer=await audioContext.decodeAudioData(wavBytes.buffer.slice(0));const destination=audioContext.createMediaStreamDestination(),source=audioContext.createBufferSource();source.buffer=audioBuffer;source.connect(destination);
    const mimeType=['audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));if(!mimeType)throw new Error('mediarecorder_webm_unavailable');const chunks=[];const recorder=new MediaRecorder(destination.stream,{mimeType,audioBitsPerSecond:64000});const stopped=new Promise((resolveStop,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=resolveStop;recorder.onerror=event=>reject(new Error(event.error?.message||'mediarecorder_failed'));});recorder.start(100);source.start();source.onended=()=>{if(recorder.state!=='inactive')recorder.stop();};await stopped;await audioContext.close();
    const blob=new Blob(chunks,{type:mimeType});if(blob.size<1000)throw new Error('mediarecorder_webm_empty');const {browserAudioAssetStore}=await import(chrome.runtime.getURL('audio-store.js')),store=browserAudioAssetStore();if(!store)throw new Error('audio_store_unavailable');
    const audioRef=`lifecycle-audio-${key}`,contextId=`lifecycle-context-${key}`,memberId=`lifecycle-member-${key}`,checkpointId=`lifecycle-checkpoint-${key}`,timestamp=new Date().toISOString();await store.put({id:audioRef,blob,mimeType,durationMs:Math.round(audioBuffer.duration*1000),createdAt:timestamp});
    const current=(await chrome.storage.local.get(['checkpoint:contexts','checkpoint:checkpoints'])),contexts=Array.isArray(current['checkpoint:contexts'])?current['checkpoint:contexts']:[],checkpoints=Array.isArray(current['checkpoint:checkpoints'])?current['checkpoint:checkpoints']:[];
    contexts.push({id:contextId,type:'browser',contextKey:`browser:workset:${contextId}`,scope:'url',url,origin:new URL(url).origin,title:`Lifecycle ${key}`,faviconUrl:null,trackedTabId:null,members:[{id:memberId,url,title:`Lifecycle ${key}`,faviconUrl:null,order:0,addedAt:timestamp}],createdAt:timestamp,updatedAt:timestamp});
    checkpoints.push({id:checkpointId,contextId,originalText:'',audioRef,audioMimeType:mimeType,audioDurationMs:Math.round(audioBuffer.duration*1000),transcript:null,transcriptionEngine:null,targetMemberIds:null,createdAt:timestamp,resolvedAt:null});
    await chrome.storage.local.set({'checkpoint:contexts':contexts,'checkpoint:checkpoints':checkpoints});return{checkpointId,audioRef,blobSize:blob.size};
  },{fixtureBase64,key,url});
}

async function transcribeThroughRecovery(popup,{key,url}){
  const seeded=await seedAudioCheckpoint(popup,{key,url});const work=await context.newPage();await work.goto(url);await work.waitForFunction(()=>Boolean(document.getElementById('checkpoint-recovery-root')),{timeout:15000});
  const button=work.getByText('Transcribir audio',{exact:true});await button.waitFor({state:'visible',timeout:10000});await button.click();await work.locator('#checkpoint-recovery-root').locator('textarea.transcript-editor').waitFor({state:'visible',timeout:120000});
  const stored=await popup.evaluate(async checkpointId=>{const list=(await chrome.storage.local.get('checkpoint:checkpoints'))['checkpoint:checkpoints']||[];return list.find(item=>item.id===checkpointId)||null;},seeded.checkpointId);if(!stored?.transcript||stored.transcriptionEngine!=='whisper-local')throw new Error(`transcript_not_persisted:${key}:${JSON.stringify(stored)}`);
  return{checkpointId:seeded.checkpointId,transcript:String(stored.transcript).trim(),engine:stored.transcriptionEngine,blobSize:seeded.blobSize};
}

function extensionsStateScript(extensionId){
  const manager=document.querySelector('extensions-manager');const queue=[manager?.shadowRoot].filter(Boolean);let item=null;while(queue.length&&!item){const root=queue.shift();for(const child of root.querySelectorAll('*')){if(child.tagName==='EXTENSIONS-ITEM'&&child.data?.id===extensionId){item=child;break;}if(child.shadowRoot)queue.push(child.shadowRoot);}}
  const data=item?.data||null;const normalize=items=>Array.isArray(items)?items.map(error=>({message:String(error?.message||error?.error||error?.stackTrace||error?.source||error),source:String(error?.source||''),severity:String(error?.severity||''),type:String(error?.type||'')})):[];
  return{manager,item,data,publicState:{found:Boolean(item),name:data?.name||null,state:data?.state||null,runtimeErrors:normalize(data?.runtimeErrors),manifestErrors:normalize(data?.manifestErrors),itemText:item?.shadowRoot?.textContent?.replace(/\s+/g,' ').trim().slice(0,1200)||''}};
}

async function inspectExtensionsPage(extensionId){
  const page=await context.newPage();await page.goto('chrome://extensions/');await page.waitForFunction(id=>Boolean(document.querySelector('extensions-manager')?.shadowRoot),extensionId,{timeout:10000});await page.waitForTimeout(500);
  const result=await page.evaluate(extensionId=>extensionsStateScript(extensionId).publicState,extensionId).catch(async()=>page.evaluate(extensionId=>{
    const manager=document.querySelector('extensions-manager');const queue=[manager?.shadowRoot].filter(Boolean);let item=null;while(queue.length&&!item){const root=queue.shift();for(const child of root.querySelectorAll('*')){if(child.tagName==='EXTENSIONS-ITEM'&&child.data?.id===extensionId){item=child;break;}if(child.shadowRoot)queue.push(child.shadowRoot);}}const data=item?.data||null;const normalize=items=>Array.isArray(items)?items.map(error=>({message:String(error?.message||error?.error||error?.stackTrace||error?.source||error),source:String(error?.source||''),severity:String(error?.severity||''),type:String(error?.type||'')})):[];return{found:Boolean(item),name:data?.name||null,state:data?.state||null,runtimeErrors:normalize(data?.runtimeErrors),manifestErrors:normalize(data?.manifestErrors),itemText:item?.shadowRoot?.textContent?.replace(/\s+/g,' ').trim().slice(0,1200)||''};},extensionId));
  await page.close();if(!result.found)throw new Error(`chrome_extensions_item_not_found:${JSON.stringify(result)}`);if(result.runtimeErrors.length||result.manifestErrors.length)throw new Error(`chrome_extensions_selfrelay_errors:${JSON.stringify(result)}`);return result;
}

async function reloadThroughExtensionsPage(extensionId){
  const page=await context.newPage();await page.goto('chrome://extensions/');await page.waitForFunction(()=>Boolean(document.querySelector('extensions-manager')?.shadowRoot),null,{timeout:10000});
  await page.evaluate(()=>{const manager=document.querySelector('extensions-manager'),toolbar=manager?.shadowRoot?.querySelector('extensions-toolbar'),toggle=toolbar?.shadowRoot?.querySelector('#devMode');if(!toggle)throw new Error('chrome_extensions_dev_mode_toggle_missing');if(!toggle.checked)toggle.click();});
  await page.waitForFunction(extensionId=>{const manager=document.querySelector('extensions-manager');const queue=[manager?.shadowRoot].filter(Boolean);while(queue.length){const root=queue.shift();for(const child of root.querySelectorAll('*')){if(child.tagName==='EXTENSIONS-ITEM'&&child.data?.id===extensionId)return Boolean(child.shadowRoot?.querySelector('#dev-reload-button'));if(child.shadowRoot)queue.push(child.shadowRoot);}}return false;},extensionId,{timeout:10000});
  const clicked=await page.evaluate(extensionId=>{const manager=document.querySelector('extensions-manager');const queue=[manager?.shadowRoot].filter(Boolean);while(queue.length){const root=queue.shift();for(const child of root.querySelectorAll('*')){if(child.tagName==='EXTENSIONS-ITEM'&&child.data?.id===extensionId){const button=child.shadowRoot?.querySelector('#dev-reload-button');if(!button)return false;button.click();return true;}if(child.shadowRoot)queue.push(child.shadowRoot);}}return false;},extensionId);if(!clicked)throw new Error('chrome_extensions_reload_button_missing');
  await page.waitForFunction(extensionId=>{const manager=document.querySelector('extensions-manager');const queue=[manager?.shadowRoot].filter(Boolean);while(queue.length){const root=queue.shift();for(const child of root.querySelectorAll('*')){if(child.tagName==='EXTENSIONS-ITEM'&&child.data?.id===extensionId)return child.data?.state==='ENABLED'&&!child.data?.disableReasons?.reloading;if(child.shadowRoot)queue.push(child.shadowRoot);}}return false;},extensionId,{timeout:30000});await page.waitForTimeout(750);
  const result=await page.evaluate(extensionId=>{const manager=document.querySelector('extensions-manager');const queue=[manager?.shadowRoot].filter(Boolean);let item=null;while(queue.length&&!item){const root=queue.shift();for(const child of root.querySelectorAll('*')){if(child.tagName==='EXTENSIONS-ITEM'&&child.data?.id===extensionId){item=child;break;}if(child.shadowRoot)queue.push(child.shadowRoot);}}const data=item?.data||null;const normalize=items=>Array.isArray(items)?items.map(error=>({message:String(error?.message||error?.error||error?.stackTrace||error?.source||error),source:String(error?.source||''),severity:String(error?.severity||''),type:String(error?.type||'')})):[];return{found:Boolean(item),name:data?.name||null,state:data?.state||null,runtimeErrors:normalize(data?.runtimeErrors),manifestErrors:normalize(data?.manifestErrors)};},extensionId);await page.close();if(!result.found||result.state!=='ENABLED'||result.runtimeErrors.length||result.manifestErrors.length)throw new Error(`chrome_extensions_reload_failed:${JSON.stringify(result)}`);return result;
}

try{
  let serviceWorker=await waitForServiceWorker();const extensionId=new URL(serviceWorker.url()).host;let popup=await openPopup(extensionId);await resetState(popup);
  const first=await transcribeThroughRecovery(popup,{key:'a',url:workUrl('a')});const second=await transcribeThroughRecovery(popup,{key:'b',url:workUrl('b')});const beforeReload=await inspectExtensionsPage(extensionId);
  if(first.transcript.length<8||second.transcript.length<8)throw new Error(`same_session_transcript_too_short:${JSON.stringify({first,second})}`);
  console.log(`Same-session transcript A: ${first.transcript}`);console.log(`Same-session transcript B: ${second.transcript}`);console.log(`chrome://extensions before reload: ${JSON.stringify(beforeReload)}`);

  const oldWorker=serviceWorker;await popup.close().catch(()=>{});const reloadState=await reloadThroughExtensionsPage(extensionId);await oldWorker.waitForEvent('close',{timeout:15000}).catch(()=>{});serviceWorker=await waitForServiceWorker(extensionId);popup=await openPopup(extensionId);console.log(`chrome://extensions reload action: ${JSON.stringify(reloadState)}`);
  const afterReload=await transcribeThroughRecovery(popup,{key:'reload',url:workUrl('reload')});const afterReloadExtensions=await inspectExtensionsPage(extensionId);if(afterReload.transcript.length<8)throw new Error(`reload_transcript_too_short:${JSON.stringify(afterReload)}`);
  console.log(`Post-reload transcript: ${afterReload.transcript}`);console.log(`chrome://extensions after reload: ${JSON.stringify(afterReloadExtensions)}`);

  const extensionOwned=unexpected.filter(item=>String(item.page||'').startsWith(`chrome-extension://${extensionId}/`)||String(item.text||'').includes(extensionId)||/selfrelay-whisper|pthread|sharedarraybuffer|wasm/i.test(String(item.text||'')));
  if(extensionOwned.length)throw new Error(`selfrelay_unexpected_runtime_errors:${JSON.stringify(extensionOwned)}`);
  console.log(`Observed non-SelfRelay Chromium errors excluded: ${unexpected.length-extensionOwned.length}`);console.log('SelfRelay packaged Whisper lifecycle E2E: PASS');
}finally{await context.close();await new Promise(resolveClose=>server.close(resolveClose));}
