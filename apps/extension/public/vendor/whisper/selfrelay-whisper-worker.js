import createSelfRelayWhisperModule from './selfrelay-whisper.js';

let modulePromise;

async function loadModule(){
  if(modulePromise)return modulePromise;
  modulePromise=(async()=>{
    const base=new URL('.',import.meta.url);
    const module=await createSelfRelayWhisperModule({locateFile:path=>new URL(path,base).href});
    const response=await fetch(new URL('ggml-tiny-q5_1.bin',base));
    if(!response.ok)throw new Error(`model_load_failed_${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    module.FS_createDataFile('/','selfrelay-model.bin',bytes,true,false,false);
    if(!module.initModel('/selfrelay-model.bin'))throw new Error('model_init_failed');
    return module;
  })();
  return modulePromise;
}

self.onmessage=async event=>{
  const {id,samples,language,threads}=event.data||{};
  if(!id||!(samples instanceof ArrayBuffer))return;
  try{
    const module=await loadModule();
    const text=module.transcribe(new Float32Array(samples),String(language||'es'),Math.max(1,Math.min(4,Number(threads)||1)));
    self.postMessage({id,ok:true,text:String(text||'').trim()});
  }catch(error){
    self.postMessage({id,ok:false,error:error instanceof Error?error.message:'whisper_failed'});
  }
};
