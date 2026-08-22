import {browserAudioAssetStore} from './audio-store.js';
import {LocalTranscriptionError,transcribeLocally} from './transcription.js';

const store=browserAudioAssetStore();
const DIAGNOSTIC_KEY='selfrelay:last-transcription-diagnostic';

async function writeDiagnostic(code:string,detail:string){
  try{await chrome.storage.session.set({[DIAGNOSTIC_KEY]:{code,detail:detail.slice(0,240),at:new Date().toISOString()}});}catch{}
}
async function clearDiagnostic(){try{await chrome.storage.session.remove(DIAGNOSTIC_KEY);}catch{}}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.target!=='offscreen'||message?.type!=='OFFSCREEN_TRANSCRIBE')return false;
  void (async()=>{
    try{
      await clearDiagnostic();
      if(!store)throw new LocalTranscriptionError('offscreen_failed','audio_storage_unavailable');
      const asset=await store.get(String(message.audioRef||''));
      if(!asset)throw new LocalTranscriptionError('offscreen_failed','audio_not_found');
      const result=await transcribeLocally(asset.blob,String(message.language||navigator.language||'es'));
      if(!result){await writeDiagnostic('whisper_runtime_failed','transcription_empty');sendResponse({ok:false,error:'whisper_runtime_failed',detail:'transcription_empty'});return;}
      await clearDiagnostic();
      sendResponse({ok:true,text:result.text,engine:result.engine});
    }catch(error){
      const code=error instanceof LocalTranscriptionError?error.code:error instanceof Error?error.message:'whisper_runtime_failed';
      const detail=error instanceof LocalTranscriptionError?error.detail||'':error instanceof Error?error.message:'';
      await writeDiagnostic(code,detail);
      console.error('[SelfRelay transcription]',code,detail||'');
      sendResponse({ok:false,error:code,detail:detail||null});
    }
  })();
  return true;
});
