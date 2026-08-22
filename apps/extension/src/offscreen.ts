import {browserAudioAssetStore} from './audio-store.js';
import {transcribeLocally} from './transcription.js';

const store=browserAudioAssetStore();

chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message?.target!=='offscreen'||message?.type!=='OFFSCREEN_TRANSCRIBE')return false;
  void (async()=>{
    try{
      if(!store)throw new Error('audio_storage_unavailable');
      const asset=await store.get(String(message.audioRef||''));
      if(!asset)throw new Error('audio_not_found');
      const result=await transcribeLocally(asset.blob,String(message.language||navigator.language||'es'));
      if(!result){sendResponse({ok:false,error:'transcription_failed'});return;}
      sendResponse({ok:true,text:result.text,engine:result.engine});
    }catch(error){sendResponse({ok:false,error:error instanceof Error?error.message:'transcription_failed'});}
  })();
  return true;
});
