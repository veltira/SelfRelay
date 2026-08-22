#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const extensionDir=resolve(process.argv[2]||'apps/extension/dist');
const fixturePath=resolve(process.argv[3]||'');
const chromeBin=process.env.CHROME_BIN||'google-chrome';
if(!fixturePath)throw new Error('usage: transcription-e2e.mjs <extension-dir> <webm-fixture>');
const fixture=await readFile(fixturePath);const fixtureBase64=fixture.toString('base64');
const profile=await mkdtemp(join(tmpdir(),'selfrelay-chrome-e2e-'));const port=9339;
const chrome=spawn(chromeBin,[
  '--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
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
  let extensionId='';
  for(let i=0;i<80&&!extensionId;i++){
    const {targetInfos}=await cdp.call('Target.getTargets');
    const target=targetInfos.find(item=>String(item.url||'').startsWith('chrome-extension://'));
    if(target)extensionId=new URL(target.url).host;
    else await sleep(250);
  }
  if(!extensionId)throw new Error(`extension_not_loaded: ${stderr}`);
  const {targetId}=await cdp.call('Target.createTarget',{url:`chrome-extension://${extensionId}/popup.html`});
  const {sessionId}=await cdp.call('Target.attachToTarget',{targetId,flatten:true});
  await cdp.call('Runtime.enable',{},sessionId);
  await sleep(400);
  const expression=`(async()=>{
    const isolation={crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer};
    const logo=document.querySelector('.logo');
    await new Promise(resolve=>{if(logo?.complete)return resolve();logo?.addEventListener('load',resolve,{once:true});setTimeout(resolve,1000);});
    const logoState={src:logo?.getAttribute('src')||'',naturalWidth:logo?.naturalWidth||0,naturalHeight:logo?.naturalHeight||0};
    const bytes=Uint8Array.from(atob(${JSON.stringify(fixtureBase64)}),c=>c.charCodeAt(0));
    const {browserAudioAssetStore}=await import(chrome.runtime.getURL('audio-store.js'));
    const store=browserAudioAssetStore();if(!store)throw new Error('audio_store_unavailable');
    const audioRef='e2e-webm';await store.put({id:audioRef,blob:new Blob([bytes],{type:'audio/webm;codecs=opus'}),mimeType:'audio/webm;codecs=opus',durationMs:4000,createdAt:new Date().toISOString()});
    const checkpoint={id:'e2e-checkpoint',contextId:'e2e-context',originalText:'',audioRef,audioMimeType:'audio/webm;codecs=opus',audioDurationMs:4000,transcript:null,transcriptionEngine:null,targetMemberIds:null,createdAt:new Date().toISOString(),resolvedAt:null};
    await chrome.storage.local.set({'checkpoint:checkpoints':[checkpoint]});
    const response=await chrome.runtime.sendMessage({type:'TRANSCRIBE_CHECKPOINT',checkpointId:checkpoint.id,language:'es'});
    const stored=(await chrome.storage.local.get('checkpoint:checkpoints'))['checkpoint:checkpoints']?.[0];
    return {isolation,logoState,response,storedTranscript:stored?.transcript||'',storedEngine:stored?.transcriptionEngine||null};
  })()`;
  const evaluated=await cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
  if(evaluated.exceptionDetails)throw new Error(`runtime_exception: ${evaluated.exceptionDetails.text}`);
  const result=evaluated.result?.value;
  if(!result?.isolation?.crossOriginIsolated||result.isolation.sharedArrayBuffer!=='function')throw new Error(`cross_origin_isolation_failed: ${JSON.stringify(result?.isolation)}`);
  if(result.logoState?.src!=='icons/icon32.png'||result.logoState?.naturalWidth!==32||result.logoState?.naturalHeight!==32)throw new Error(`logo_render_failed: ${JSON.stringify(result.logoState)}`);
  if(!result.response?.ok)throw new Error(`transcription_failed: ${JSON.stringify(result.response)}`);
  const transcript=String(result.storedTranscript||'').trim();if(transcript.length<8)throw new Error(`empty_transcript: ${JSON.stringify(result)}`);
  const normalized=transcript.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const hits=['hola','prueba','sistema','reconocimiento'].filter(word=>normalized.includes(word));if(hits.length<2)throw new Error(`spanish_recall_failed (${hits.length}/4): ${transcript}`);
  const {targetInfos}=await cdp.call('Target.getTargets');const offscreen=targetInfos.some(item=>String(item.url||'').includes(`chrome-extension://${extensionId}/offscreen.html`));
  if(!offscreen)throw new Error('offscreen_document_not_observed');
  console.log(`SelfRelay Chromium E2E transcript: ${transcript}`);
  console.log(`Runtime: crossOriginIsolated=${result.isolation.crossOriginIsolated}, SharedArrayBuffer=${result.isolation.sharedArrayBuffer}, offscreen=${offscreen}, engine=${result.storedEngine}`);
  console.log(`Logo: ${result.logoState.naturalWidth}x${result.logoState.naturalHeight} rendered from ${result.logoState.src}`);
}finally{
  try{cdp?.close();}catch{}try{chrome.kill('SIGTERM');}catch{}await sleep(300);try{if(chrome.exitCode===null)chrome.kill('SIGKILL');}catch{}await rm(profile,{recursive:true,force:true});
}
