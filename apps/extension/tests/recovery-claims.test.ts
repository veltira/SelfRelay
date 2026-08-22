import assert from 'node:assert/strict';
import test from 'node:test';
import {registerRecoveryClaims} from '../src/recovery-claims.ts';

class Event<T extends(...args:any[])=>any>{listeners:T[]=[];addListener=(listener:T)=>{this.listeners.push(listener);};emit(...args:Parameters<T>){for(const listener of this.listeners)listener(...args);}}
class Area{data:Record<string,any>={};async get(key:string){return{[key]:this.data[key]};}async set(value:Record<string,any>){Object.assign(this.data,value);}}
function port(name:string,tabId:number){const onDisconnect=new Event<()=>void>(),messages:any[]=[];let disconnected=false;return{name,sender:{tab:{id:tabId}},onDisconnect,postMessage:(message:any)=>messages.push(message),disconnect(){if(disconnected)return;disconnected=true;onDisconnect.emit();},messages,get disconnected(){return disconnected;}};}
function env(){const onConnect=new Event<(port:any)=>void>(),onRemoved=new Event<(tabId:number)=>void>(),onUpdated=new Event<(tabId:number,change:any)=>void>(),session=new Area(),tabs=[{id:1},{id:2}];const api:any={storage:{session},tabs:{query:async()=>tabs,onRemoved,onUpdated},runtime:{onConnect}};return{api,tabs,onConnect,onRemoved,onUpdated};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('only one workset tab can own a visible recovery surface for the same checkpoint',async()=>{const e=env();registerRecoveryClaims(e.api);const first=port('selfrelay-recovery:checkpoint-1',1);e.onConnect.emit(first as any);await tick();assert.deepEqual(first.messages,[{claimed:true}]);const second=port('selfrelay-recovery:checkpoint-1',2);e.onConnect.emit(second as any);await tick();assert.deepEqual(second.messages,[{claimed:false}]);assert.equal(second.disconnected,true);first.disconnect();await tick();const retry=port('selfrelay-recovery:checkpoint-1',2);e.onConnect.emit(retry as any);await tick();assert.deepEqual(retry.messages,[{claimed:true}]);});

test('a navigation releases that tab recovery claim',async()=>{const e=env();registerRecoveryClaims(e.api);const first=port('selfrelay-recovery:checkpoint-2',1);e.onConnect.emit(first as any);await tick();e.onUpdated.emit(1,{url:'https://other.example'});await tick();const second=port('selfrelay-recovery:checkpoint-2',2);e.onConnect.emit(second as any);await tick();assert.deepEqual(second.messages,[{claimed:true}]);});
