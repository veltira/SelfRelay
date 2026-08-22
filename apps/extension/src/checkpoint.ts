import type {LocalTranscriptionEngine} from '@selfrelay/shared';
import {browserAudioAssetStore} from './audio-store.js';
import {transcribeLocally} from './transcription.js';

const params=new URLSearchParams(location.search);
const pendingId=params.get('pending')||'';
const title=document.querySelector<HTMLElement>('#title')!;
const meta=document.querySelector<HTMLElement>('#meta')!;
const text=document.querySelector<HTMLTextAreaElement>('#text')!;
const statusEl=document.querySelector<HTMLElement>('#status')!;
const save=document.querySelector<HTMLButtonElement>('#save')!;
const skip=document.querySelector<HTMLButtonElement>('#skip')!;
const record=document.querySelector<HTMLButtonElement>('#record')!;
const recordingPanel=document.querySelector<HTMLElement>('#recording')!;
const timer=document.querySelector<HTMLElement>('#timer')!;
const meterBars=[...document.querySelectorAll<HTMLElement>('#levelMeter span')];
const stopRecording=document.querySelector<HTMLButtonElement>('#stopRecording')!;
const cancelRecording=document.querySelector<HTMLButtonElement>('#cancelRecording')!;
const audioReview=document.querySelector<HTMLElement>('#audioReview')!;
const preview=document.querySelector<HTMLAudioElement>('#preview')!;
const audioDuration=document.querySelector<HTMLElement>('#audioDuration')!;
const redoRecording=document.querySelector<HTMLButtonElement>('#redoRecording')!;
const transcriptionState=document.querySelector<HTMLElement>('#transcriptionState')!;
const transcriptWrap=document.querySelector<HTMLElement>('#transcriptWrap')!;
const transcript=document.querySelector<HTMLTextAreaElement>('#transcript')!;
const assetStore=browserAudioAssetStore();

type DraftAudio={blob:Blob;mimeType:string;durationMs:number;transcriptionEngine:LocalTranscriptionEngine|null};
let draft:DraftAudio|null=null;
let recorder:MediaRecorder|null=null;
let stream:MediaStream|null=null;
let chunks:BlobPart[]=[];
let startedAt=0;
let tick:number|undefined;
let meterFrame:number|undefined;
let meterContext:AudioContext|null=null;
let previewUrl:string|null=null;
let cancelRequested=false;
let transcribing=false;

void init();

async function init(){
  const result=await chrome.runtime.sendMessage({type:'GET_PENDING_CAPTURE',pendingId});
  if(!result?.ok){renderExpired();return;}
  title.textContent='¿Dónde quedaste?';
  meta.textContent=result.pending.title||result.pending.url;
  record.onclick=()=>void startRecording();
  stopRecording.onclick=()=>stopActiveRecording(false);
  cancelRecording.onclick=()=>stopActiveRecording(true);
  redoRecording.onclick=()=>void redo();
  save.onclick=()=>void saveCheckpoint();
  skip.onclick=()=>void discardPending();
  text.focus();
}

function renderExpired(){
  title.textContent='Este checkpoint ya no está pendiente.';
  meta.textContent='Podés cerrar esta ventana.';
  document.querySelector<HTMLElement>('#composer')!.hidden=true;
  audioReview.hidden=true;recordingPanel.hidden=true;save.hidden=true;
  skip.textContent='Cerrar';skip.onclick=()=>window.close();
}

function preferredMimeType(){
  for(const type of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'])if(MediaRecorder.isTypeSupported(type))return type;
  return '';
}

async function startRecording(){
  if(recorder||transcribing)return;
  clearStatus();
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){showError('La grabación no está disponible en este navegador.');return;}
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    const mimeType=preferredMimeType();
    recorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
    chunks=[];cancelRequested=false;startedAt=Date.now();
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>void finishRecording();
    recorder.onerror=()=>{showError('La grabación se interrumpió. Podés intentar de nuevo.');cleanupRecorder();};
    recorder.start(250);
    recordingPanel.hidden=false;audioReview.hidden=true;record.disabled=true;
    startTimer();startMeter(stream);
  }catch(error:any){
    cleanupRecorder();
    showError(error?.name==='NotAllowedError'?'SelfRelay necesita permiso de micrófono solo para grabar este checkpoint.':'No se pudo iniciar el micrófono.');
  }
}

function stopActiveRecording(cancel:boolean){
  if(!recorder)return;
  cancelRequested=cancel;
  try{if(recorder.state!=='inactive')recorder.stop();}catch{cleanupRecorder();}
}

async function finishRecording(){
  const elapsed=Math.max(0,Date.now()-startedAt);
  const mimeType=recorder?.mimeType||preferredMimeType()||'audio/webm';
  const blob=new Blob(chunks,{type:mimeType});
  const cancelled=cancelRequested;
  cleanupRecorder();
  if(cancelled||blob.size===0){if(blob.size===0&&!cancelled)showError('No se registró audio. Intentá de nuevo.');return;}
  draft={blob,mimeType,durationMs:elapsed,transcriptionEngine:null};
  setPreview(blob,elapsed);
  await transcribeDraft(blob);
}

function cleanupRecorder(){
  if(tick!==undefined){clearInterval(tick);tick=undefined;}
  if(meterFrame!==undefined){cancelAnimationFrame(meterFrame);meterFrame=undefined;}
  if(meterContext){void meterContext.close();meterContext=null;}
  if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
  recorder=null;chunks=[];recordingPanel.hidden=true;record.disabled=false;timer.textContent='00:00';renderMeter(0);
}

function startTimer(){
  const update=()=>{const seconds=Math.floor((Date.now()-startedAt)/1000);timer.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};
  update();tick=window.setInterval(update,250);
}

function startMeter(activeStream:MediaStream){
  try{
    meterContext=new AudioContext();
    const analyser=meterContext.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.72;
    meterContext.createMediaStreamSource(activeStream).connect(analyser);
    const data=new Uint8Array(analyser.frequencyBinCount);
    const draw=()=>{analyser.getByteFrequencyData(data);let total=0;for(const value of data)total+=value;renderMeter(total/(data.length*255));meterFrame=requestAnimationFrame(draw);};
    draw();
  }catch{renderMeter(.2);}
}

function renderMeter(level:number){
  const active=Math.round(Math.max(0,Math.min(1,level*2.4))*meterBars.length);
  meterBars.forEach((bar,index)=>{const strength=index<active?Math.max(.2,level):.08;bar.style.height=`${4+Math.round(strength*13)}px`;bar.style.background=index<active?'#0891b2':'#9fb0c4';});
}

function setPreview(blob:Blob,durationMs:number){
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl=URL.createObjectURL(blob);preview.src=previewUrl;
  audioDuration.textContent=formatDuration(durationMs);audioReview.hidden=false;
  transcript.value='';transcriptWrap.hidden=true;
}

async function transcribeDraft(blob:Blob){
  transcribing=true;save.disabled=true;redoRecording.disabled=true;transcriptionState.hidden=false;transcriptionState.textContent='Transcribiendo…';clearStatus();
  try{
    const result=await transcribeLocally(blob);
    if(result&&draft){draft.transcriptionEngine=result.engine;transcript.value=result.text;transcriptWrap.hidden=false;}
    else{transcriptWrap.hidden=false;showStatus('No se pudo transcribir localmente. El audio se puede guardar igual.');}
  }catch{transcriptWrap.hidden=false;showStatus('No se pudo transcribir localmente. El audio se puede guardar igual.');}
  finally{transcribing=false;transcriptionState.hidden=true;save.disabled=false;redoRecording.disabled=false;}
}

async function redo(){
  if(transcribing)return;
  clearDraft();
  await startRecording();
}

function clearDraft(){
  draft=null;transcript.value='';transcriptWrap.hidden=true;audioReview.hidden=true;
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}preview.removeAttribute('src');preview.load();
}

async function saveCheckpoint(){
  if(transcribing||recorder)return;
  const typed=text.value.trim();
  if(!typed&&!draft){showError('Escribí algo o grabá un audio antes de guardar.');return;}
  setBusy(true);clearStatus();
  let storedRef:string|null=null;
  try{
    if(draft){
      if(!assetStore)throw new Error('audio_storage_unavailable');
      storedRef=`audio-${crypto.randomUUID()}`;
      await assetStore.put({id:storedRef,blob:draft.blob,mimeType:draft.mimeType,durationMs:draft.durationMs,createdAt:new Date().toISOString()});
    }
    const response=await chrome.runtime.sendMessage({type:'SAVE_CHECKPOINT',pendingId,payload:{text:typed,audioRef:storedRef,audioMimeType:draft?.mimeType??null,audioDurationMs:draft?.durationMs??null,transcript:draft?transcript.value.trim()||null:null,transcriptionEngine:draft?.transcriptionEngine??null}});
    if(!response?.ok)throw new Error(response?.error||'save_failed');
    if(response.nextPendingId){openPending(response.nextPendingId);return;}
    clearDraft();window.close();
  }catch{
    if(storedRef&&assetStore)try{await assetStore.delete(storedRef);}catch{}
    showError('No se pudo guardar el checkpoint. Probá de nuevo.');setBusy(false);
  }
}

async function discardPending(){
  if(recorder)stopActiveRecording(true);
  setBusy(true);clearStatus();
  try{
    const response=await chrome.runtime.sendMessage({type:'DISCARD_PENDING_CAPTURE',pendingId});
    if(!response?.ok)throw new Error('discard_failed');
    clearDraft();
    if(response.nextPendingId){openPending(response.nextPendingId);return;}
    window.close();
  }catch{showError('No se pudo descartar. Probá de nuevo.');setBusy(false);}
}

function openPending(id:string){clearDraft();location.replace(chrome.runtime.getURL(`checkpoint.html?pending=${encodeURIComponent(id)}`));}
function setBusy(value:boolean){save.disabled=value;skip.disabled=value;record.disabled=value;redoRecording.disabled=value;text.disabled=value;transcript.disabled=value;}
function showError(message:string){statusEl.textContent=message;statusEl.classList.add('error');}
function showStatus(message:string){statusEl.textContent=message;statusEl.classList.remove('error');}
function clearStatus(){statusEl.textContent='';statusEl.classList.remove('error');}
function formatDuration(ms:number){const seconds=Math.max(0,Math.round(ms/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · audio local`;}

window.addEventListener('beforeunload',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);if(stream)for(const track of stream.getTracks())track.stop();});
