import createSelfRelayWhisperModule from './selfrelay-whisper.js';

let modulePromise;

function failure(code,error){
  const detail=error instanceof Error?error.message:String(error||'');
  const wrapped=new Error(code);wrapped.code=code;wrapped.detail=detail.slice(0,240);return wrapped;
}

async function loadModule(id){
  if(modulePromise)return modulePromise;
  modulePromise=(async()=>{
    self.postMessage({id,status:'checking-runtime'});
    if(!self.crossOriginIsolated||typeof SharedArrayBuffer==='undefined')throw failure('cross_origin_isolation_missing',`crossOriginIsolated=${String(self.crossOriginIsolated)} SharedArrayBuffer=${typeof SharedArrayBuffer}`);
    self.postMessage({id,status:'loading-wasm'});
    const base=new URL('.',import.meta.url);
    let module;
    try{module=await createSelfRelayWhisperModule({locateFile:path=>new URL(path,base).href});}
    catch(error){throw failure('wasm_load_failed',error);}
    self.postMessage({id,status:'loading-model'});
    let response;
    try{response=await fetch(new URL('ggml-base-q5_1.bin',base));}
    catch(error){throw failure('model_fetch_failed',error);}
    if(!response.ok)throw failure('model_fetch_failed',`HTTP ${response.status}`);
    let bytes;
    try{bytes=new Uint8Array(await response.arrayBuffer());}
    catch(error){throw failure('model_fetch_failed',error);}
    try{module.FS_createDataFile('/','selfrelay-model.bin',bytes,true,false,false);}
    catch(error){throw failure('model_init_failed',error);}
    try{if(!module.initModel('/selfrelay-model.bin'))throw new Error('initModel returned false');}
    catch(error){throw failure('model_init_failed',error);}
    return module;
  })().catch(error=>{modulePromise=undefined;throw error;});
  return modulePromise;
}

self.onmessage=async event=>{
  const {id,samples,language,threads}=event.data||{};
  if(!id||!(samples instanceof ArrayBuffer))return;
  try{
    const module=await loadModule(id);
    self.postMessage({id,status:'transcribing'});
    let text='';
    try{text=module.transcribe(new Float32Array(samples),String(language||'es'),Math.max(1,Math.min(4,Number(threads)||1)));}
    catch(error){throw failure('whisper_runtime_failed',error);}
    self.postMessage({id,ok:true,text:String(text||'').trim()});
  }catch(error){
    self.postMessage({id,ok:false,error:error?.code||'whisper_runtime_failed',detail:error?.detail||error?.message||''});
  }
};
