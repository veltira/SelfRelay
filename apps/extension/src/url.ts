import type {BrowserContext, BrowserContextScope} from '@selfrelay/shared';

export function normalizeUrl(raw:string){
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol))throw new Error('unsupported_url');
  url.hash='';
  if(url.pathname.length>1)url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString();
}

export function contextKey(raw:string,scope:BrowserContextScope){
  const normalized=normalizeUrl(raw);
  const url=new URL(normalized);
  return scope==='site'?`browser:site:${url.origin.toLowerCase()}`:`browser:url:${normalized}`;
}

export function matches(context:BrowserContext,raw:string,tabId?:number){
  try{
    const normalized=normalizeUrl(raw);
    if(context.scope==='tab'&&context.trackedTabId===tabId)return true;
    if(context.scope==='site')return new URL(normalized).origin===context.origin;
    return normalizeUrl(context.url)===normalized;
  }catch{return false;}
}
