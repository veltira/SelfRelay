type ChromeApi=typeof chrome;
const KEY='recoverySurfaceClaims';

type ClaimMap=Record<string,number>;

async function getClaims(api:ChromeApi):Promise<ClaimMap>{const result=await api.storage.session.get(KEY);const value=result[KEY];return value&&typeof value==='object'?value as ClaimMap:{};}
async function setClaims(api:ChromeApi,claims:ClaimMap){await api.storage.session.set({[KEY]:claims});}
async function tabStillOpen(api:ChromeApi,tabId:number){return(await api.tabs.query({})).some(tab=>tab.id===tabId);}
async function releaseTab(api:ChromeApi,tabId:number){const claims=await getClaims(api);let changed=false;for(const[id,owner]of Object.entries(claims))if(owner===tabId){delete claims[id];changed=true;}if(changed)await setClaims(api,claims);}

export function registerRecoveryClaims(api:ChromeApi){
  api.runtime.onConnect.addListener(port=>{
    if(!port.name.startsWith('selfrelay-recovery:'))return;
    const checkpointId=decodeURIComponent(port.name.slice('selfrelay-recovery:'.length));
    const tabId=port.sender?.tab?.id;
    if(!checkpointId||typeof tabId!=='number'){port.postMessage({claimed:false});port.disconnect();return;}
    let owned=false;
    void(async()=>{
      const claims=await getClaims(api);const current=claims[checkpointId];
      if(typeof current==='number'&&current!==tabId&&await tabStillOpen(api,current)){port.postMessage({claimed:false});port.disconnect();return;}
      claims[checkpointId]=tabId;await setClaims(api,claims);owned=true;port.postMessage({claimed:true});
    })().catch(()=>{try{port.postMessage({claimed:false});port.disconnect();}catch{}});
    port.onDisconnect.addListener(()=>{if(!owned)return;void(async()=>{const claims=await getClaims(api);if(claims[checkpointId]===tabId){delete claims[checkpointId];await setClaims(api,claims);}})();});
  });
  api.tabs.onRemoved.addListener(tabId=>{void releaseTab(api,tabId);});
  api.tabs.onUpdated.addListener((tabId,changeInfo)=>{if(changeInfo.url)void releaseTab(api,tabId);});
}
