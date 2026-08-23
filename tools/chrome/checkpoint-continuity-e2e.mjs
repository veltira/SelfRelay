#!/usr/bin/env node
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

const extensionDir=resolve(process.argv[2]||'apps/extension/dist');
const screenshotsDir=resolve(process.env.SELFRELAY_SCREENSHOTS_DIR||'artifacts/chrome-e2e-screenshots');
await mkdir(screenshotsDir,{recursive:true});

const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end('<!doctype html><meta charset="utf-8"><title>Continuidad SelfRelay</title><main><h1>Documento de continuidad</h1><p>Fixture real para checkpoints acumulados.</p></main>');});
await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen);});
const address=server.address();if(!address||typeof address==='string')throw new Error('fixture_server_failed');
const workUrl=`http://127.0.0.1:${address.port}/work`;

const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:760,height:860},args:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const consoleErrors=[];const pageErrors=[];
function watch(page){page.on('console',message=>{if(message.type()==='error')consoleErrors.push(`${page.url()} :: ${message.text()}`);});page.on('pageerror',error=>pageErrors.push(`${page.url()} :: ${error?.stack||error?.message||String(error)}`));}
context.on('page',watch);for(const page of context.pages())watch(page);

async function openExtensionPage(serviceWorker,extensionId,path){const url=`chrome-extension://${extensionId}/${path}`;await serviceWorker.evaluate(url=>chrome.tabs.create({url,active:false}),url);let page=context.pages().find(item=>item.url()===url);if(!page)page=await context.waitForEvent('page',{predicate:item=>item.url()===url,timeout:10000});await page.waitForLoadState('domcontentloaded');return page;}
async function waitForCheckpointCount(serviceWorker,count){for(let attempt=0;attempt<80;attempt++){const value=await serviceWorker.evaluate(()=>chrome.storage.local.get(['checkpoint:checkpoints','checkpoint:pendingCaptures']));const checkpoints=value['checkpoint:checkpoints']||[],pending=value['checkpoint:pendingCaptures']||[];if(checkpoints.length===count&&pending.length===0)return checkpoints;await new Promise(resolveWait=>setTimeout(resolveWait,100));}throw new Error(`checkpoint_count_timeout:${count}`);}
async function seedPending(serviceWorker,pendingId){const now=new Date().toISOString();await serviceWorker.evaluate(({workUrl,now,pendingId})=>chrome.storage.local.set({'checkpoint:pendingCaptures':[{id:pendingId,contextId:'qa-continuity-context',url:workUrl,title:'Documento de continuidad',closedAt:now,memberId:'qa-continuity-member',closedMembers:[{memberId:'qa-continuity-member',url:workUrl,title:'Documento de continuidad',faviconUrl:null}],defaultTargetMemberIds:['qa-continuity-member'],exitSessionId:'qa-continuity',exitKind:'tab',sourceKey:`qa:${pendingId}`}]}),{workUrl,now,pendingId});}
async function audioAssetMeta(serviceWorker,ref){return serviceWorker.evaluate(async ref=>{const module=await import(chrome.runtime.getURL('audio-store.js'));const store=module.browserAudioAssetStore();const asset=store?await store.get(ref):null;return asset?{size:asset.blob.size,type:asset.blob.type,mimeType:asset.mimeType,durationMs:asset.durationMs}:null;},ref);}
async function validatePlayback(serviceWorker,extensionId,ref){const player=await openExtensionPage(serviceWorker,extensionId,`audio.html?ref=${encodeURIComponent(ref)}`);await player.waitForFunction(()=>{const audio=document.querySelector('#audio'),status=document.querySelector('#playerStatus');return audio instanceof HTMLAudioElement&&audio.src.startsWith('blob:')&&status?.textContent?.includes('guardado en este dispositivo');},null,{timeout:10000});const playback=await player.locator('#audio').evaluate(async audio=>{try{await audio.play();await new Promise(resolveWait=>setTimeout(resolveWait,160));audio.pause();return{ok:true,currentTime:audio.currentTime,readyState:audio.readyState};}catch(error){return{ok:false,error:String(error)};}});await player.close();if(!playback.ok||playback.readyState<2)throw new Error(`saved_audio_not_playable:${JSON.stringify(playback)}`);}
function qaCheckpoint(id,createdAt,text,resolvedAt=null){return{id,contextId:'qa-continuity-context',originalText:text,audioRef:null,audioMimeType:null,audioDurationMs:null,transcript:null,transcriptionEngine:null,targetMemberIds:null,createdAt,resolvedAt};}
async function setRecoveryCheckpoints(serviceWorker,items){await serviceWorker.evaluate(items=>chrome.storage.local.set({'checkpoint:checkpoints':items,'checkpoint:pendingCaptures':[]}),items);}
async function openRecovery(expectedCount,fileName){const page=await context.newPage();await page.goto(workUrl);await page.waitForFunction(expected=>document.getElementById('checkpoint-recovery-root')?.shadowRoot?.querySelectorAll('.checkpoint-item').length===expected,expectedCount,{timeout:10000});const host=page.locator('#checkpoint-recovery-root');await host.screenshot({path:resolve(screenshotsDir,fileName)});return page;}
async function recoveryTexts(page){return page.locator('#checkpoint-recovery-root').locator('.checkpoint-item .text').allTextContents();}

try{
  let [serviceWorker]=context.serviceWorkers();if(!serviceWorker)serviceWorker=await context.waitForEvent('serviceworker',{timeout:30000});
  if(!serviceWorker.url().endsWith('/background.js'))throw new Error(`unexpected_service_worker:${serviceWorker.url()}`);
  const extensionId=new URL(serviceWorker.url()).host,baseTime='2026-08-22T09:00:00.000Z';
  await serviceWorker.evaluate(({workUrl,baseTime})=>chrome.storage.local.set({
    'checkpoint:contexts':[{id:'qa-continuity-context',type:'browser',contextKey:'browser:workset:qa-continuity-context',scope:'url',url:workUrl,origin:new URL(workUrl).origin,title:'Documento de continuidad',faviconUrl:null,trackedTabId:null,members:[{id:'qa-continuity-member',url:workUrl,title:'Documento de continuidad',faviconUrl:null,order:0,addedAt:baseTime}],createdAt:baseTime,updatedAt:baseTime}],
    'checkpoint:checkpoints':[],
    'checkpoint:pendingCaptures':[]
  }),{workUrl,baseTime});

  // Audio-only: Guardar is clicked while MediaRecorder is still active.
  await seedPending(serviceWorker,'qa-audio-only');
  const captureA=await openExtensionPage(serviceWorker,extensionId,'checkpoint.html?pending=qa-audio-only');
  await captureA.locator('#record').waitFor({state:'visible'});await captureA.locator('.capture-shell').screenshot({path:resolve(screenshotsDir,'09-capture-empty.png')});
  await captureA.locator('#record').click();await captureA.locator('#recording').waitFor({state:'visible'});await new Promise(resolveWait=>setTimeout(resolveWait,900));
  await captureA.locator('.capture-shell').screenshot({path:resolve(screenshotsDir,'10-capture-recording.png')});
  if(!await captureA.locator('#save').isEnabled())throw new Error('save_disabled_while_recording');
  await captureA.locator('.capture-shell').screenshot({path:resolve(screenshotsDir,'11-capture-recording-save-ready.png')});
  await captureA.locator('#save').click();await captureA.waitForEvent('close',{timeout:15000}).catch(()=>{});
  const firstSet=await waitForCheckpointCount(serviceWorker,1),audioOnly=firstSet[0];if(!audioOnly?.audioRef||audioOnly.originalText||!(audioOnly.audioDurationMs>0))throw new Error(`audio_only_checkpoint_invalid:${JSON.stringify(audioOnly)}`);
  const firstAsset=await audioAssetMeta(serviceWorker,audioOnly.audioRef);if(!firstAsset||firstAsset.size<500||firstAsset.durationMs<=0||!String(firstAsset.mimeType||firstAsset.type).startsWith('audio/'))throw new Error(`audio_only_asset_invalid:${JSON.stringify(firstAsset)}`);await validatePlayback(serviceWorker,extensionId,audioOnly.audioRef);
  console.log(`Save-during-recording audio-only: PASS (${firstAsset.size} bytes, ${firstAsset.durationMs} ms)`);

  // Text + audio uses the same direct-save path without requiring Detener.
  await seedPending(serviceWorker,'qa-text-audio');
  const captureB=await openExtensionPage(serviceWorker,extensionId,'checkpoint.html?pending=qa-text-audio');await captureB.locator('#text').fill('Texto y audio se conservan juntos.');await captureB.locator('#record').click();await captureB.locator('#recording').waitFor({state:'visible'});await new Promise(resolveWait=>setTimeout(resolveWait,900));if(!await captureB.locator('#save').isEnabled())throw new Error('text_audio_save_disabled_while_recording');await captureB.locator('#save').click();await captureB.waitForEvent('close',{timeout:15000}).catch(()=>{});
  const secondSet=await waitForCheckpointCount(serviceWorker,2),textAudio=secondSet.find(item=>item.originalText==='Texto y audio se conservan juntos.');if(!textAudio?.audioRef||!(textAudio.audioDurationMs>0))throw new Error(`text_audio_checkpoint_invalid:${JSON.stringify(textAudio)}`);const secondAsset=await audioAssetMeta(serviceWorker,textAudio.audioRef);if(!secondAsset||secondAsset.size<500||secondAsset.durationMs<=0)throw new Error(`text_audio_asset_invalid:${JSON.stringify(secondAsset)}`);await validatePlayback(serviceWorker,extensionId,textAudio.audioRef);
  console.log(`Save-during-recording text + audio: PASS (${secondAsset.size} bytes, ${secondAsset.durationMs} ms)`);

  const A=qaCheckpoint('A','2026-08-22T09:20:00.000Z','Estaba revisando el formulario.');
  const B=qaCheckpoint('B','2026-08-22T11:45:00.000Z','Ya corregí validación; falta submit.');
  const C=qaCheckpoint('C','2026-08-22T14:10:00.000Z','El submit funciona; revisar error móvil.');

  await setRecoveryCheckpoints(serviceWorker,[A]);
  const one=await openRecovery(1,'12-recovery-one-pending.png');if(JSON.stringify(await recoveryTexts(one))!==JSON.stringify([A.originalText]))throw new Error('recovery_one_order_failed');await one.locator('#checkpoint-recovery-root').locator('[data-action="dismiss"]').click();await one.waitForFunction(()=>!document.getElementById('checkpoint-recovery-root'));const afterLater=await serviceWorker.evaluate(()=>chrome.storage.local.get('checkpoint:checkpoints').then(value=>value['checkpoint:checkpoints']));if(afterLater[0]?.resolvedAt!==null)throw new Error('later_resolved_checkpoint');await one.close();

  await setRecoveryCheckpoints(serviceWorker,[B,A]);
  const two=await openRecovery(2,'13-recovery-two-pending.png');if(JSON.stringify(await recoveryTexts(two))!==JSON.stringify([A.originalText,B.originalText]))throw new Error(`recovery_two_order_failed:${JSON.stringify(await recoveryTexts(two))}`);await two.locator('#checkpoint-recovery-root').locator('[data-action="dismiss"]').click();await two.close();

  await setRecoveryCheckpoints(serviceWorker,[C,A,B]);
  const three=await openRecovery(3,'14-recovery-three-pending.png');if(JSON.stringify(await recoveryTexts(three))!==JSON.stringify([A.originalText,B.originalText,C.originalText]))throw new Error(`recovery_three_order_failed:${JSON.stringify(await recoveryTexts(three))}`);const latestText=await three.locator('#checkpoint-recovery-root').locator('.checkpoint-item').last().textContent();if(!latestText?.includes('Más reciente')||!latestText.includes(C.originalText))throw new Error(`latest_marker_failed:${latestText}`);
  await three.locator('#checkpoint-recovery-root').locator('[data-checkpoint-id="B"] .resolve').click();await three.waitForFunction(()=>document.getElementById('checkpoint-recovery-root')?.shadowRoot?.querySelectorAll('.checkpoint-item').length===2);if(JSON.stringify(await recoveryTexts(three))!==JSON.stringify([A.originalText,C.originalText]))throw new Error(`individual_resolution_failed:${JSON.stringify(await recoveryTexts(three))}`);await three.locator('#checkpoint-recovery-root').screenshot({path:resolve(screenshotsDir,'15-recovery-one-resolved-two-pending.png')});
  let stored=await serviceWorker.evaluate(()=>chrome.storage.local.get('checkpoint:checkpoints').then(value=>value['checkpoint:checkpoints']));if(stored.find(item=>item.id==='A')?.resolvedAt!==null||!stored.find(item=>item.id==='B')?.resolvedAt||stored.find(item=>item.id==='C')?.resolvedAt!==null)throw new Error(`individual_storage_state_failed:${JSON.stringify(stored)}`);
  await three.locator('#checkpoint-recovery-root').locator('[data-checkpoint-id="A"] .resolve').click();await three.waitForFunction(()=>document.getElementById('checkpoint-recovery-root')?.shadowRoot?.querySelectorAll('.checkpoint-item').length===1);if(JSON.stringify(await recoveryTexts(three))!==JSON.stringify([C.originalText]))throw new Error('resolve_a_left_wrong_stack');await three.locator('#checkpoint-recovery-root').locator('[data-checkpoint-id="C"] .resolve').click();await three.waitForFunction(()=>!document.getElementById('checkpoint-recovery-root'));stored=await serviceWorker.evaluate(()=>chrome.storage.local.get('checkpoint:checkpoints').then(value=>value['checkpoint:checkpoints']));if(stored.some(item=>!item.resolvedAt))throw new Error(`final_resolution_failed:${JSON.stringify(stored)}`);await three.close();
  console.log('Checkpoint accumulation A/B/C + individual resolution: PASS');

  const work=await context.newPage();await work.goto(workUrl);await work.bringToFront();const popup=await openExtensionPage(serviceWorker,extensionId,'popup.html');await popup.waitForFunction(()=>Boolean(document.querySelector('#state')?.textContent?.trim()),null,{timeout:10000});await popup.locator('.popup-shell').screenshot({path:resolve(screenshotsDir,'16-popup-main.png')});await popup.close();await work.close();

  if(pageErrors.length)throw new Error(`checkpoint_continuity_page_errors:${JSON.stringify(pageErrors)}`);if(consoleErrors.length)throw new Error(`checkpoint_continuity_console_errors:${JSON.stringify(consoleErrors)}`);
  console.log(`Checkpoint continuity screenshots: ${screenshotsDir}`);console.log('SelfRelay checkpoint continuity E2E: PASS');
}finally{await context.close();await new Promise(resolveClose=>server.close(resolveClose));}
