const ROOT_ID='checkpoint-recovery-root';
void lookup();

async function lookup(){
  if(document.getElementById(ROOT_ID))return;
  let result:any;try{result=await chrome.runtime.sendMessage({type:'LOOKUP_CHECKPOINT',url:location.href});}catch{return;}
  if(!result?.checkpoint||!result?.context)return;
  render(result);
}

function render(result:any){
  const checkpoint=result.checkpoint;
  const host=document.createElement('div');
  host.id=ROOT_ID;
  host.style.cssText='all:initial;position:fixed;z-index:2147483647;right:18px;top:18px;width:min(390px,calc(100vw - 28px));font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:#172033;';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`
    <style>
      :host{all:initial}.card{box-sizing:border-box;background:#fff;border:1px solid #d8e0ea;border-radius:10px;box-shadow:0 16px 38px rgba(15,23,42,.18),0 2px 7px rgba(15,23,42,.08);padding:0;color:#172033;overflow:hidden}
      .top{height:39px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid #e4e9f0}.brand{font-size:12px;font-weight:720;letter-spacing:-.01em;color:#111c31}.return{font-size:10.5px;font-weight:650;color:#526176}.content{padding:14px}.eyebrow{font-size:10px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;color:#0891b2}.title{font-size:16px;font-weight:720;letter-spacing:-.018em;color:#111c31;margin:4px 0 10px}.body{white-space:pre-wrap;font-size:13.5px;line-height:1.5;margin:0;color:#253247}.note{margin-top:10px;padding-top:9px;border-top:1px solid #e8edf3}.note-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#7a8799}.note-text{white-space:pre-wrap;margin:4px 0 0;font-size:12px;line-height:1.45;color:#536176}.meta{font-size:10.5px;color:#8793a4;margin-top:11px}.audio{display:inline-flex;align-items:center;gap:6px;margin-top:11px;border:1px solid #cbd6e5;background:#f8fafc;color:#31516c;border-radius:7px;padding:6px 9px;font:650 11.5px inherit;cursor:pointer}.audio:hover{background:#edf4ff;border-color:#b9cbea;color:#1e55c5}.audio svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.status{min-height:0;margin-top:7px;font-size:10.5px;color:#b42318}.actions{display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;background:#f8fafc;border-top:1px solid #e5eaf1}.btn{appearance:none;min-height:31px;border:1px solid #c9d3df;background:#fff;color:#4b586c;border-radius:7px;padding:6px 10px;font:650 11.5px inherit;cursor:pointer}.btn:hover{background:#f1f5f9}.primary{background:#2463eb;border-color:#2463eb;color:#fff}.primary:hover{background:#1d4ed8;border-color:#1d4ed8}.btn:focus-visible,.audio:focus-visible{outline:2px solid #5d8ff3;outline-offset:2px}@media(max-width:520px){:host{right:12px!important;top:12px!important;width:calc(100vw - 24px)!important}}
    </style>
    <div class="card" role="dialog" aria-label="Checkpoint pendiente de SelfRelay">
      <div class="top"><span class="brand">SelfRelay</span><span class="return">Volviste a este contexto</span></div>
      <div class="content"><div class="eyebrow">Tu último checkpoint</div><div class="title">Retomá desde acá</div><p class="body"></p><div class="note" hidden><div class="note-label">Nota escrita</div><p class="note-text"></p></div><button class="audio" data-action="audio" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11l9-5.5-9-5.5Z"/></svg>Escuchar audio</button><div class="meta"></div><div class="status" role="status"></div></div>
      <div class="actions"><button class="btn" data-action="dismiss">Ahora no</button><button class="btn primary" data-action="resolve">Ya lo retomé</button></div>
    </div>`;
  const body=shadow.querySelector<HTMLElement>('.body')!;
  const note=shadow.querySelector<HTMLElement>('.note')!;
  const noteText=shadow.querySelector<HTMLElement>('.note-text')!;
  const transcript=String(checkpoint.transcript||'').trim();
  const typed=String(checkpoint.originalText||'').trim();
  body.textContent=transcript||typed||(checkpoint.audioRef?'Dejaste un checkpoint de audio.':'Tu checkpoint está listo para retomar.');
  if(transcript&&typed&&typed!==transcript){note.hidden=false;noteText.textContent=typed;}
  shadow.querySelector<HTMLElement>('.meta')!.textContent=`Guardado ${formatDate(checkpoint.createdAt)}`;
  const audioButton=shadow.querySelector<HTMLButtonElement>('[data-action="audio"]')!;
  if(checkpoint.audioRef){audioButton.hidden=false;audioButton.onclick=async()=>{const response=await chrome.runtime.sendMessage({type:'OPEN_AUDIO_PLAYER',audioRef:checkpoint.audioRef});if(!response?.ok)shadow.querySelector<HTMLElement>('.status')!.textContent='El audio no se pudo abrir.';};}
  shadow.querySelector<HTMLButtonElement>('[data-action="dismiss"]')!.onclick=()=>host.remove();
  shadow.querySelector<HTMLButtonElement>('[data-action="resolve"]')!.onclick=async event=>{
    const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
    const response=await chrome.runtime.sendMessage({type:'RESOLVE_CHECKPOINT',checkpointId:checkpoint.id});
    if(response?.ok){host.remove();return;}
    button.disabled=false;shadow.querySelector<HTMLElement>('.status')!.textContent='No se pudo cerrar el checkpoint. Probá de nuevo.';
  };
  document.documentElement.append(host);
}

function formatDate(raw:string){try{return new Intl.DateTimeFormat('es-UY',{dateStyle:'medium',timeStyle:'short'}).format(new Date(raw));}catch{return'';}}
