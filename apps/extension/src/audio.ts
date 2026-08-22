import {browserAudioAssetStore} from './audio-store.js';

const ref=new URLSearchParams(location.search).get('ref')||'';
const audio=document.querySelector<HTMLAudioElement>('#audio')!;
const status=document.querySelector<HTMLElement>('#playerStatus')!;
const store=browserAudioAssetStore();
let objectUrl:string|null=null;

void load();

async function load(){
  if(!ref||!store){fail();return;}
  try{
    const asset=await store.get(ref);
    if(!asset){fail();return;}
    objectUrl=URL.createObjectURL(asset.blob);
    audio.src=objectUrl;
    status.textContent=`${formatDuration(asset.durationMs)} · guardado en este dispositivo`;
  }catch{fail();}
}

function fail(){audio.hidden=true;status.textContent='Este audio ya no está disponible.';}
function formatDuration(ms:number){const seconds=Math.max(0,Math.round(ms/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
window.addEventListener('beforeunload',()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);});
