import {registerBackground} from './background-core.js';
import {registerRecoveryClaims} from './recovery-claims.js';

const offscreen=chrome.offscreen as typeof chrome.offscreen&{hasDocument?:()=>Promise<boolean>};
if(typeof offscreen.hasDocument!=='function'){
  offscreen.hasDocument=async()=>{
    const url=chrome.runtime.getURL('offscreen.html');
    const runtime=chrome.runtime as any;
    const contexts=await runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]}) as any[];
    return Array.isArray(contexts)&&contexts.length>0;
  };
}

const runtime=chrome.runtime as any;
const nativeSendMessage=runtime.sendMessage.bind(chrome.runtime);
runtime.sendMessage=(message:any,...args:any[])=>{
  const result=nativeSendMessage(message,...args);
  if(message?.target==='offscreen'&&result&&typeof result.then==='function'){
    return result.then((response:any)=>{if(response?.ok===false)throw new Error(String(response.error||'offscreen_failed'));return response;});
  }
  return result;
};

registerRecoveryClaims(chrome);
registerBackground(chrome);
