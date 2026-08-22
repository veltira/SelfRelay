#!/usr/bin/env node
import {readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const extensionDir=resolve(process.argv[2]||'apps/extension/dist');
const fixturePath=resolve(process.argv[3]||'');
if(!fixturePath)throw new Error('usage: transcription-e2e.mjs <extension-dir> <wav-fixture>');
const fixtureBase64=(await readFile(fixturePath)).toString('base64');
const screenshotsDir=resolve(process.env.SELFRELAY_SCREENSHOTS_DIR||'artifacts/chrome-e2e-screenshots');
await rm(screenshotsDir,{recursive:true,force:true});

const context=await chromium.launchPersistentContext('',{
  channel:'chromium',
  headless:true,
  args:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--autoplay-policy=no-user-gesture-required']
});

try{
  let [serviceWorker]=context.serviceWorkers();
  if(!serviceWorker)serviceWorker=await context.waitForEvent('serviceworker',{timeout:30000});
  const extensionId=new URL(serviceWorker.url()).host;
  if(!serviceWorker.url().endsWith('/background.js'))throw new Error(`unexpected_service_worker:${serviceWorker.url()}`);

  const page=await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  const result=await page.evaluate(async fixtureBase64=>{
    if(!globalThis.chrome?.runtime?.getURL)throw new Error('selfrelay_extension_context_missing');
    const isolation={crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer};
    const logo=document.querySelector('.logo');
    if(logo instanceof HTMLImageElement&&!logo.complete)await new Promise(resolve=>{logo.addEventListener('load',resolve,{once:true});setTimeout(resolve,1500);});
    const logoState={src:logo?.getAttribute('src')||'',naturalWidth:logo instanceof HTMLImageElement?logo.naturalWidth:0,naturalHeight:logo instanceof HTMLImageElement?logo.naturalHeight:0};
    const toggle=document.querySelector('#simpleToggle');const panel=document.querySelector('#simplePanel');
    const disclosure={initial:{expanded:toggle?.getAttribute('aria-expanded'),hidden:panel instanceof HTMLElement?panel.hidden:null}};
    if(toggle instanceof HTMLButtonElement)toggle.click();await new Promise(r=>setTimeout(r,20));
    disclosure.open={expanded:toggle?.getAttribute('aria-expanded'),hidden:panel instanceof HTMLElement?panel.hidden:null};
    if(toggle instanceof HTMLButtonElement)toggle.click();await new Promise(r=>setTimeout(r,20));
    disclosure.closed={expanded:toggle?.getAttribute('aria-expanded'),hidden:panel instanceof HTMLElement?panel.hidden:null};

    const wavBytes=Uint8Array.from(atob(fixtureBase64),c=>c.charCodeAt(0));
    const audioContext=new AudioContext();
    let audioBuffer;
    try{audioBuffer=await audioContext.decodeAudioData(wavBytes.buffer.slice(0));}catch(error){await audioContext.close();throw new Error('fixture_wav_decode_failed:'+error.message);}
    const destination=audioContext.createMediaStreamDestination();
    const source=audioContext.createBufferSource();source.buffer=audioBuffer;source.connect(destination);
    const mimeType=['audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mimeType){await audioContext.close();throw new Error('mediarecorder_webm_opus_unavailable');}
    const chunks=[];const recorder=new MediaRecorder(destination.stream,{mimeType,audioBitsPerSecond:64000});
    const stopped=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=resolve;recorder.onerror=event=>reject(new Error(event.error?.message||'mediarecorder_failed'));});
    recorder.start(100);source.start();source.onended=()=>{if(recorder.state!=='inactive')recorder.stop();};await stopped;await audioContext.close();
    const webmBlob=new Blob(chunks,{type:mimeType});if(webmBlob.size<1000)throw new Error('mediarecorder_webm_empty');
    const {browserAudioAssetStore}=await import(chrome.runtime.getURL('audio-store.js'));
    const store=browserAudioAssetStore();if(!store)throw new Error('audio_store_unavailable');
    const audioRef='e2e-webm';await store.put({id:audioRef,blob:webmBlob,mimeType,durationMs:Math.round(audioBuffer.duration*1000),createdAt:new Date().toISOString()});
    const checkpoint={id:'e2e-checkpoint',contextId:'e2e-context',originalText:'',audioRef,audioMimeType:mimeType,audioDurationMs:Math.round(audioBuffer.duration*1000),transcript:null,transcriptionEngine:null,targetMemberIds:null,createdAt:new Date().toISOString(),resolvedAt:null};
    await chrome.storage.local.set({'checkpoint:checkpoints':[checkpoint]});
    const response=await chrome.runtime.sendMessage({type:'TRANSCRIBE_CHECKPOINT',checkpointId:checkpoint.id,language:'es'});
    const stored=(await chrome.storage.local.get('checkpoint:checkpoints'))['checkpoint:checkpoints']?.[0];
    return {isolation,logoState,disclosure,mediaRecorder:{mimeType,size:webmBlob.size,durationMs:checkpoint.audioDurationMs},response,storedTranscript:stored?.transcript||'',storedEngine:stored?.transcriptionEngine||null};
  },fixtureBase64);

  if(!result?.isolation?.crossOriginIsolated||result.isolation.sharedArrayBuffer!=='function')throw new Error(`cross_origin_isolation_failed:${JSON.stringify(result?.isolation)}`);
  if(result.logoState?.src!=='icons/icon32.png'||result.logoState?.naturalWidth!==32||result.logoState?.naturalHeight!==32)throw new Error(`logo_render_failed:${JSON.stringify(result.logoState)}`);
  if(result.disclosure.initial.expanded!=='false'||result.disclosure.initial.hidden!==true||result.disclosure.open.expanded!=='true'||result.disclosure.open.hidden!==false||result.disclosure.closed.expanded!=='false'||result.disclosure.closed.hidden!==true)throw new Error(`disclosure_failed:${JSON.stringify(result.disclosure)}`);
  if(!String(result.mediaRecorder?.mimeType||'').startsWith('audio/webm')||result.mediaRecorder?.size<1000)throw new Error(`mediarecorder_fixture_failed:${JSON.stringify(result.mediaRecorder)}`);
  if(!result.response?.ok)throw new Error(`transcription_failed:${JSON.stringify(result.response)}`);
  const transcript=String(result.storedTranscript||'').trim();if(transcript.length<8)throw new Error(`empty_transcript:${JSON.stringify(result)}`);
  const normalized=transcript.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const hits=['hola','prueba','sistema','reconocimiento'].filter(word=>normalized.includes(word));if(hits.length<2)throw new Error(`spanish_recall_failed(${hits.length}/4):${transcript}`);
  const offscreenWorkers=context.serviceWorkers().filter(worker=>worker.url().includes('offscreen')); // offscreen itself is a page, not a worker; kept for diagnostics only.
  const offscreenPages=context.pages().filter(item=>item.url().includes(`chrome-extension://${extensionId}/offscreen.html`));
  const offscreenObserved=offscreenPages.length>0||offscreenWorkers.length>0;
  console.log(`SelfRelay extension id: ${extensionId}`);
  console.log(`SelfRelay Chromium MediaRecorder: ${result.mediaRecorder.mimeType}, ${result.mediaRecorder.size} bytes, ${result.mediaRecorder.durationMs} ms`);
  console.log(`SelfRelay Chromium E2E transcript: ${transcript}`);
  console.log(`Runtime: crossOriginIsolated=${result.isolation.crossOriginIsolated}, SharedArrayBuffer=${result.isolation.sharedArrayBuffer}, offscreenObserved=${offscreenObserved}, engine=${result.storedEngine}`);
  console.log(`Logo: ${result.logoState.naturalWidth}x${result.logoState.naturalHeight} rendered from ${result.logoState.src}`);
  console.log(`Disclosure: ${JSON.stringify(result.disclosure)}`);
}finally{await context.close();}
