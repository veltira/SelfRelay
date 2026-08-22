import {registerBackground} from './background-core.js';
import {registerRecoveryClaims} from './recovery-claims.js';

const offscreen=chrome.offscreen as typeof chrome.offscreen&{hasDocument?:()=>Promise<boolean>};
if(typeof offscreen.hasDocument!=='function'){
  offscreen.hasDocument=async()=>{
    const url=chrome.runtime.getURL('offscreen.html');
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
    return contexts.length>0;
  };
}

registerRecoveryClaims(chrome);
registerBackground(chrome);
