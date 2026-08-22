#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const extensionDir=resolve(process.argv[2]||'apps/extension/dist');
const fixturePath=resolve(process.argv[3]||'');
const chromeBin=process.env.CHROME_BIN||'google-chrome';
if(!fixturePath)throw new Error('usage: transcription-e2e.mjs <extension-dir> <wav-fixture>');
const fixture=await readFile(fixturePath);const fixtureBase64=fixture.toString('base64');
const profile=await mkdtemp(join(tmpdir(),'selfrelay-chrome-e2e-'));const port=9339;
const chrome=spawn(chromeBin,[
  '--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,
  `--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'about:blank'
],{stdio:['ignore','pipe','pipe']});
let stderr='';chrome.stderr.on('data',chunk=>{stderr+=String(chunk);if(stderr.length>12000)stderr=stderr.slice(-12000);});

async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function json(url){const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);return response.json();}
async function waitDebug(){for(let i=0;i<120;i++){try{return await json(`http://127.0.0.1:${port}/json/version`);}catch{if(chrome.exitCode!==null)throw new Error(`Chrome exited ${chrome.exitCode}: ${stderr}`);await sleep(250);}}throw new Error(`Chrome debugging port did not open: ${stderr}`);}

class Cdp{
  ws;next=1;pending=new Map();
  constructor(url){this.ws=new WebSocket(url);this.ws.onmessage=event=>{const message=JSON.parse(String(event.data));if(!message.id)return;const item=this.pending.get(message.id);if(!item)return;this.pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);};}
  async ready(){if(this.ws.readyState===WebSocket.OPEN)return;await new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=reject;});}
  call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=this.next++;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  close(){this.ws.close();}
}

let cdp;
try{
  const version=await waitDebug();cdp=new Cdp(version.webSocketDebuggerUrl);await cdp.ready();
  let extensionId='';let discovered=[];
  for(let i=0;i<100&&!extensionId;i++){
    const {targetInfos}=await cdp.call('Target.getTargets');
    discovered=targetInfos.filter(item=>String(item.url||'').startsWith('chrome-extension://')).map(item=>({type:item.type,url:item.url}));
    const target=targetInfos.find(item=>item.type==='service_worker'&&/^chrome-extension:\/\/[^/]+\/background\.js(?:$|\?)/.test(String(item.url||'')));
    if(target)extensionId=new URL(target.url).host;
    else await sleep(250);
  }
  if(!extensionId)throw new Error(`selfrelay_service_worker_not_found: ${JSON.stringify(discovered)} ${stderr}`);
  const {targetId}=await cdp.call('Target.createTarget',{url:`chrome-extension://${extensionId}/popup.html`});
  const {sessionId}=await cdp.call('Target.attachToTarget',{targetId,flatten:true});
  await cdp.call('Runtime.enable',{},sessionId);
  await sleep(500);
  const expression=`(async()=>{
    if(!globalThis.chrome?.runtime?.getURL)throw new Error('selfrelay_extension_context_missing');
    const isolation={crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer};
    const logo=document.querySelector('.logo');
    await new Promise(resolve=>{if(logo?.complete)return resolve();logo?.addEventListener('load',resolve,{once:true});setTimeout(resolve,1000);});
    const logoState={src:logo?.getAttribute('src')||'',naturalWidth:logo?.naturalWidth||0,naturalHeight:logo?.naturalHeight||0};
    const wavBytes=Uint8Array.from(atob(${JSON.stringify(fixtureBase64)}),c=>c.charCodeAt(0));
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
    return {isolation,logoState,mediaRecorder:{mimeType,size:webmBlob.size,durationMs:checkpoint.audioDurationMs},response,storedTranscript:stored?.transcript||'',storedEngine:stored?.transcriptionEngine||null};
  })()`;
  const evaluated=await cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
  if(evaluated.exceptionDetails)throw new Error(`runtime_exception: ${evaluated.exceptionDetails.text} ${evaluated.exceptionDetails.exception?.description||''}`);
  const result=evaluated.result?.value;
  if(!result?.isolation?.crossOriginIsolated||result.isolation.sharedArrayBuffer!=='function')throw new Error(`cross_origin_isolation_failed: ${JSON.stringify(result?.isolation)}`);
  if(result.logoState?.src!=='icons/icon32.png'||result.logoState?.naturalWidth!==32||result.logoState?.naturalHeight!==32)throw new Error(`logo_render_failed: ${JSON.stringify(result.logoState)}`);
  if(!String(result.mediaRecorder?.mimeType||'').startsWith('audio/webm')||result.mediaRecorder?.size<1000)throw new Error(`mediarecorder_fixture_failed: ${JSON.stringify(result.mediaRecorder)}`);
  if(!result.response?.ok)throw new Error(`transcription_failed: ${JSON.stringify(result.response)}`);
  const transcript=String(result.storedTranscript||'').trim();if(transcript.length<8)throw new Error(`empty_transcript: ${JSON.stringify(result)}`);
  const normalized=transcript.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const hits=['hola','prueba','sistema','reconocimiento'].filter(word=>normalized.includes(word));if(hits.length<2)throw new Error(`spanish_recall_failed (${hits.length}/4): ${transcript}`);
  const {targetInfos}=await cdp.call('Target.getTargets');const offscreen=targetInfos.some(item=>String(item.url||'').includes(`chrome-extension://${extensionId}/offscreen.html`));
  if(!offscreen)throw new Error('offscreen_document_not_observed');
  console.log(`SelfRelay extension id: ${extensionId}`);
  console.log(`SelfRelay Chromium MediaRecorder: ${result.mediaRecorder.mimeType}, ${result.mediaRecorder.size} bytes, ${result.mediaRecorder.durationMs} ms`);
  console.log(`SelfRelay Chromium E2E transcript: ${transcript}`);
  console.log(`Runtime: crossOriginIsolated=${result.isolation.crossOriginIsolated}, SharedArrayBuffer=${result.isolation.sharedArrayBuffer}, offscreen=${offscreen}, engine=${result.storedEngine}`);
  console.log(`Logo: ${result.logoState.naturalWidth}x${result.logoState.naturalHeight} rendered from ${result.logoState.src}`);
}finally{
  try{cdp?.close();}catch{}try{chrome.kill('SIGTERM');}catch{}await sleep(300);try{if(chrome.exitCode===null)chrome.kill('SIGKILL');}catch{}await rm(profile,{recursive:true,force:true});
}
