import type {LocalTranscriptionEngine} from '@selfrelay/shared';

export interface LocalTranscript{text:string;engine:LocalTranscriptionEngine;}
export class LocalTranscriptionError extends Error{
  constructor(public readonly code:string,public readonly detail?:string){super(code);this.name='LocalTranscriptionError';}
}
const TARGET_SAMPLE_RATE=16000;

function diagnostic(code:string,error:unknown){
  const detail=error instanceof Error?error.message:String(error||'');
  return error instanceof LocalTranscriptionError?error:new LocalTranscriptionError(code,detail.slice(0,240));
}

async function decodeAudio(blob:Blob){
  const context=new AudioContext();
  try{return await context.decodeAudioData(await blob.arrayBuffer());}
  catch(error){throw diagnostic('audio_decode_failed',error);}
  finally{await context.close();}
}
function trimSilence(samples:Float32Array,sampleRate:number){const threshold=.0035,padding=Math.round(sampleRate*.12);let first=0,last=samples.length-1;while(first<samples.length&&Math.abs(samples[first]!)<threshold)first++;while(last>first&&Math.abs(samples[last]!)<threshold)last--;if(first>=samples.length)return samples;first=Math.max(0,first-padding);last=Math.min(samples.length-1,last+padding);return samples.slice(first,last+1);}
function normalizeSpeech(samples:Float32Array){let peak=0,sumSquares=0;for(const sample of samples){const abs=Math.abs(sample);if(abs>peak)peak=abs;sumSquares+=sample*sample;}const rms=Math.sqrt(sumSquares/Math.max(1,samples.length));if(peak<1e-5||rms<1e-6)return samples;const gain=Math.min(8,.96/peak,.12/rms);if(gain<=1.02)return samples;const output=new Float32Array(samples.length);for(let i=0;i<samples.length;i++)output[i]=Math.max(-.98,Math.min(.98,samples[i]!*gain));return output;}
function linearResample(samples:Float32Array,sourceRate:number,targetRate:number){if(sourceRate===targetRate)return samples.slice();const outputLength=Math.max(1,Math.round(samples.length*targetRate/sourceRate)),output=new Float32Array(outputLength),ratio=sourceRate/targetRate;for(let i=0;i<outputLength;i++){const position=i*ratio,left=Math.min(samples.length-1,Math.floor(position)),right=Math.min(samples.length-1,left+1),fraction=position-left;output[i]=samples[left]!+(samples[right]!-samples[left]!)*fraction;}return output;}

/** Pure deterministic fallback/test path: downmix -> trim -> resample -> normalize. */
export function preparePcm16kMonoFromChannels(channels:ReadonlyArray<Float32Array>,sourceRate:number){if(!channels.length||!Number.isFinite(sourceRate)||sourceRate<=0)return new Float32Array();const frames=Math.max(...channels.map(channel=>channel.length)),mono=new Float32Array(frames);for(let i=0;i<frames;i++){let value=0,count=0;for(const channel of channels)if(i<channel.length){value+=channel[i]!;count++;}mono[i]=count?value/count:0;}return normalizeSpeech(linearResample(trimSilence(mono,sourceRate),sourceRate,TARGET_SAMPLE_RATE));}

async function webAudioPcm16k(buffer:AudioBuffer){
  const frames=Math.max(1,Math.ceil(buffer.duration*TARGET_SAMPLE_RATE)),offline=new OfflineAudioContext(1,frames,TARGET_SAMPLE_RATE),source=offline.createBufferSource(),highpass=offline.createBiquadFilter(),lowpass=offline.createBiquadFilter();
  source.buffer=buffer;highpass.type='highpass';highpass.frequency.value=80;highpass.Q.value=.707;lowpass.type='lowpass';lowpass.frequency.value=7600;lowpass.Q.value=.707;source.connect(highpass).connect(lowpass).connect(offline.destination);source.start();
  const rendered=await offline.startRendering();return normalizeSpeech(trimSilence(new Float32Array(rendered.getChannelData(0)),TARGET_SAMPLE_RATE));
}

async function pcm16kMono(blob:Blob){
  const buffer=await decodeAudio(blob);
  try{return await webAudioPcm16k(buffer);}catch{const channels:Array<Float32Array>=[];for(let channel=0;channel<buffer.numberOfChannels;channel++)channels.push(new Float32Array(buffer.getChannelData(channel)));return preparePcm16kMonoFromChannels(channels,buffer.sampleRate);}
}

async function whisperTranscript(blob:Blob,language='es'):Promise<LocalTranscript|null>{
  const samples=await pcm16kMono(blob);if(samples.length<TARGET_SAMPLE_RATE*.15)return null;
  let worker:Worker;
  try{worker=new Worker(chrome.runtime.getURL('vendor/whisper/selfrelay-whisper-worker.js'),{type:'module'});}catch(error){throw diagnostic('worker_load_failed',error);}
  const id=crypto.randomUUID();
  try{
    const text=await new Promise<string>((resolve,reject)=>{
      const timeout=globalThis.setTimeout(()=>reject(new LocalTranscriptionError('timeout')),240000);
      worker.onmessage=(event:MessageEvent<any>)=>{
        if(event.data?.id!==id||event.data?.status)return;
        clearTimeout(timeout);
        if(event.data?.ok)resolve(String(event.data.text||'').replace(/\s+/g,' ').trim());
        else reject(new LocalTranscriptionError(String(event.data?.error||'whisper_runtime_failed'),String(event.data?.detail||'').slice(0,240)));
      };
      worker.onerror=event=>{clearTimeout(timeout);reject(new LocalTranscriptionError('worker_load_failed',event.message));};
      const data=samples.buffer;
      worker.postMessage({id,samples:data,language:language.startsWith('es')?'es':language,threads:Math.max(1,Math.min(4,navigator.hardwareConcurrency||2))},[data]);
    });
    return text?{text,engine:'whisper-local'}:null;
  }finally{worker.terminate();}
}

/** Packaged Whisper only: no speech service, no network fallback and no post-install model download. */
export async function transcribeLocally(blob:Blob,language=navigator.language||'es'):Promise<LocalTranscript|null>{return whisperTranscript(blob,language);}
