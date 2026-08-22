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

registerRecoveryClaims(chrome);
registerBackground(chrome);
