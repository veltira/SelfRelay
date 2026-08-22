import createSelfRelayWhisperModule from './selfrelay-whisper.js';

let modulePromise;

function failure(code,error){const detail=error instanceof Error?error.message:String(error||'');const wrapped=new Error(code);wrapped.code=code;wrapped.detail=detail;return wrapped;}

async function requireAsset(url,code){
  try{const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw failure(response.status===404?'asset_not_found':code,`${response.status} ${response.statusText}`);return response;}
  catch(error){if(error?.code)throw error;throw failure(code,error);}
}

async function loadModule(id){
  if(modulePromise)return modulePromise;
  modulePromise=(async()=>{
    self.postMessage({id,status:'loading-runtime'});
    if(!globalThis.crossOriginIsolated||typeof SharedArrayBuffer==='undefined')throw failure('cross_origin_isolation_missing','SharedArrayBuffer is unavailable');
    const base=new URL('.',import.meta.url);
    await requireAsset(new URL('selfrelay-whisper.wasm',base),'wasm_load_failed');
    let module;
    try{module=await createSelfRelayWhisperModule({locateFile:path=>new URL(path,base).href});}
    catch(error){const detail=error instanceof Error?error.message:String(error||'');throw failure(/wasm|sharedarraybuffer|memory/i.test(detail)?'wasm_load_failed':'whisper_runtime_failed',error);}
    self.postMessage({id,status:'loading-model'});
    const response=await requireAsset(new URL('ggml-base-q5_1.bin',base),'model_fetch_failed');
    let bytes;try{bytes=new Uint8Array(await response.arrayBuffer());}catch(error){throw failure('model_fetch_failed',error);}
    try{module.FS_createDataFile('/','selfrelay-model.bin',bytes,true,false,false);}catch(error){throw failure('model_init_failed',error);}
    try{if(!module.initModel('/selfrelay-model.bin'))throw new Error('initModel returned false');}catch(error){throw failure('model_init_failed',error);}
    return module;
  })();
  try{return await modulePromise;}catch(error){modulePromise=undefined;throw error;}
}

self.onmessage=async event=>{
  const {id,samples,language,threads}=event.data||{};
  if(!id||!(samples instanceof ArrayBuffer))return;
  try{
    const module=await loadModule(id);
    self.postMessage({id,status:'transcribing'});
    let text;try{text=module.transcribe(new Float32Array(samples),String(language||'es'),Math.max(1,Math.min(4,Number(threads)||1)));}catch(error){throw failure('whisper_runtime_failed',error);}
    self.postMessage({id,ok:true,text:String(text||'').trim()});
  }catch(error){self.postMessage({id,ok:false,error:error?.code||error?.message||'whisper_runtime_failed',detail:error?.detail||''});}
};
