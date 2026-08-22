import type {LocalTranscriptionEngine} from '@selfrelay/shared';

export interface LocalTranscript {
  text: string;
  engine: LocalTranscriptionEngine;
}

type SpeechRecognitionCtor = {
  new(): any;
  available?: (options:{langs:string[];processLocally:boolean})=>Promise<string>;
  install?: (options:{langs:string[];processLocally:boolean})=>Promise<boolean>;
};

function speechRecognitionCtor():SpeechRecognitionCtor|null{
  const ctor=(globalThis as any).SpeechRecognition as SpeechRecognitionCtor|undefined;
  return typeof ctor==='function'?ctor:null;
}

function languageCandidates(){
  const raw=(navigator.language||'es-UY').trim();
  const items=[raw.startsWith('es')?raw:'es-UY','es-UY','es-ES','es'];
  return [...new Set(items)];
}

async function ensureNativeLanguage(ctor:SpeechRecognitionCtor){
  if(typeof ctor.available!=='function'||typeof ctor.install!=='function')return null;
  for(const lang of languageCandidates()){
    try{
      let status=await ctor.available({langs:[lang],processLocally:true});
      if(status==='downloadable'){
        const installed=await ctor.install({langs:[lang],processLocally:true});
        if(!installed)continue;
        status=await ctor.available({langs:[lang],processLocally:true});
      }
      if(status==='available')return lang;
    }catch{}
  }
  return null;
}

async function decodeAudio(blob:Blob,targetRate?:number){
  const context=new AudioContext({sampleRate:targetRate});
  try{return await context.decodeAudioData(await blob.arrayBuffer());}
  finally{await context.close();}
}

async function nativeTranscript(blob:Blob):Promise<LocalTranscript|null>{
  const Ctor=speechRecognitionCtor();
  if(!Ctor)return null;
  const lang=await ensureNativeLanguage(Ctor);
  if(!lang)return null;
  const recognition=new Ctor();
  if(!('processLocally' in recognition))return null;
  recognition.processLocally=true;
  recognition.lang=lang;
  recognition.continuous=true;
  recognition.interimResults=false;
  const buffer=await decodeAudio(blob);
  const audioContext=new AudioContext({sampleRate:buffer.sampleRate});
  const destination=audioContext.createMediaStreamDestination();
  const source=audioContext.createBufferSource();
  source.buffer=buffer;
  source.connect(destination);
  const track=destination.stream.getAudioTracks()[0];
  if(!track){await audioContext.close();return null;}
  let timer:number|undefined;
  try{
    const text=await new Promise<string>((resolve,reject)=>{
      const parts:string[]=[];
      let settled=false;
      const finish=(value:string,error?:unknown)=>{if(settled)return;settled=true;if(timer!==undefined)clearTimeout(timer);error?reject(error):resolve(value);};
      recognition.onresult=(event:any)=>{
        for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i]?.isFinal){const value=String(event.results[i][0]?.transcript||'').trim();if(value)parts.push(value);}
      };
      recognition.onerror=(event:any)=>finish('',new Error(String(event?.error||'speech_recognition_failed')));
      recognition.onend=()=>finish(parts.join(' ').replace(/\s+/g,' ').trim());
      timer=window.setTimeout(()=>{try{recognition.abort();}catch{}finish('',new Error('speech_recognition_timeout'));},Math.max(20000,Math.min(180000,buffer.duration*4000+15000)));
      try{
        recognition.start(track);
        void audioContext.resume().then(()=>source.start());
        source.onended=()=>{window.setTimeout(()=>{try{recognition.stop();}catch{}},350);};
      }catch(error){finish('',error);}
    });
    return text?{text,engine:'browser-local'}:null;
  }catch{return null;}
  finally{try{recognition.abort();}catch{}track.stop();try{source.disconnect();}catch{}try{destination.disconnect();}catch{}await audioContext.close();}
}

async function pcm16kMono(blob:Blob){
  const source=await decodeAudio(blob);
  const length=Math.max(1,Math.ceil(source.duration*16000));
  const offline=new OfflineAudioContext(1,length,16000);
  const node=offline.createBufferSource();
  node.buffer=source;
  node.connect(offline.destination);
  node.start();
  const rendered=await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

async function whisperTranscript(blob:Blob):Promise<LocalTranscript|null>{
  const samples=await pcm16kMono(blob);
  const worker=new Worker(chrome.runtime.getURL('vendor/whisper/selfrelay-whisper-worker.js'),{type:'module'});
  const id=crypto.randomUUID();
  try{
    const text=await new Promise<string>((resolve,reject)=>{
      const timeout=window.setTimeout(()=>reject(new Error('whisper_timeout')),180000);
      worker.onmessage=(event:MessageEvent<any>)=>{
        if(event.data?.id!==id)return;
        clearTimeout(timeout);
        if(event.data.ok)resolve(String(event.data.text||'').replace(/\s+/g,' ').trim());
        else reject(new Error(String(event.data.error||'whisper_failed')));
      };
      worker.onerror=event=>{clearTimeout(timeout);reject(new Error(event.message||'whisper_worker_failed'));};
      const data=samples.buffer;
      worker.postMessage({id,samples:data,language:'es',threads:Math.max(1,Math.min(4,navigator.hardwareConcurrency||2))},[data]);
    });
    return text?{text,engine:'whisper-local'}:null;
  }catch{return null;}
  finally{worker.terminate();}
}

export async function transcribeLocally(blob:Blob):Promise<LocalTranscript|null>{
  const native=await nativeTranscript(blob);
  if(native)return native;
  return whisperTranscript(blob);
}
