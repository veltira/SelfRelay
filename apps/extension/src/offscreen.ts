import {browserAudioAssetStore} from './audio-store.js';
import {TranscriptionRuntimeError,transcribeLocally} from './transcription.js';

const store=browserAudioAssetStore();

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.target!=='offscreen')return false;
  if(message?.type==='OFFSCREEN_DIAGNOSTICS'){
    sendResponse({ok:true,crossOriginIsolated:globalThis.crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer!=='undefined',audioContext:typeof AudioContext!=='undefined',indexedDb:typeof indexedDB!=='undefined'});
    return false;
  }
  if(message?.type!=='OFFSCREEN_TRANSCRIBE')return false;
  void (async()=>{
    try{
      if(!store)throw new TranscriptionRuntimeError('audio_storage_unavailable');
      const asset=await store.get(String(message.audioRef||''));
      if(!asset)throw new TranscriptionRuntimeError('audio_not_found');
      const result=await transcribeLocally(asset.blob,String(message.language||navigator.language||'es'));
      sendResponse({ok:true,text:result.text,engine:result.engine});
    }catch(error){
      if(error instanceof TranscriptionRuntimeError){console.error('[SelfRelay offscreen transcription]',error.code,error.detail||'');sendResponse({ok:false,error:error.code,detail:error.detail||''});return;}
      const detail=error instanceof Error?error.message:String(error||'');console.error('[SelfRelay offscreen transcription] offscreen_failed',detail);sendResponse({ok:false,error:'offscreen_failed',detail});
    }
  })();
  return true;
});
