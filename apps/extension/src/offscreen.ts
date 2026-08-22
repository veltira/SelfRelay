import {browserAudioAssetStore} from './audio-store.js';
import {LocalTranscriptionError,transcribeLocally} from './transcription.js';

const store=browserAudioAssetStore();

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.target!=='offscreen'||message?.type!=='OFFSCREEN_TRANSCRIBE')return false;
  void (async()=>{
    try{
      if(!store)throw new LocalTranscriptionError('audio_storage_unavailable');
      const asset=await store.get(String(message.audioRef||''));
      if(!asset)throw new LocalTranscriptionError('audio_not_found');
      const result=await transcribeLocally(asset.blob,String(message.language||navigator.language||'es'));
      if(!result){sendResponse({ok:false,error:'transcription_empty'});return;}
      sendResponse({ok:true,text:result.text,engine:result.engine});
    }catch(error){
      const code=error instanceof LocalTranscriptionError?error.code:error instanceof Error?error.message:'transcription_failed';
      const detail=error instanceof LocalTranscriptionError?error.detail:error instanceof Error?error.message:'';
      console.error('[SelfRelay transcription]',code,detail||'');
      sendResponse({ok:false,error:code,detail:detail||null});
    }
  })();
  return true;
});
