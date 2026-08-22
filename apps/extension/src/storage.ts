import type {BrowserContext, BrowserTabSnapshot, Checkpoint, PendingCapture} from '@selfrelay/shared';

const KEYS={
  contexts:'checkpoint:contexts',
  checkpoints:'checkpoint:checkpoints',
  snapshots:'checkpoint:tabSnapshots',
  durableSnapshots:'checkpoint:durableTabSnapshots',
  browserSessionId:'checkpoint:browserSessionId',
  pending:'checkpoint:pendingCaptures'
} as const;

type StorageApi=Pick<typeof chrome,'storage'>;

export type DurableBrowserTabSnapshot=BrowserTabSnapshot&{browserSessionId:string};

export function createStorage(api:StorageApi){
  async function array<T>(key:string):Promise<T[]>{
    const value=await api.storage.local.get(key);
    return Array.isArray(value[key])?value[key] as T[]:[];
  }
  return {
    getContexts:()=>array<BrowserContext>(KEYS.contexts),
    setContexts:(value:BrowserContext[])=>api.storage.local.set({[KEYS.contexts]:value}),
    getCheckpoints:()=>array<Checkpoint>(KEYS.checkpoints),
    setCheckpoints:(value:Checkpoint[])=>api.storage.local.set({[KEYS.checkpoints]:value}),
    async getSnapshots(){
      const value=await api.storage.session.get(KEYS.snapshots);
      return (value[KEYS.snapshots]||{}) as Record<string,BrowserTabSnapshot>;
    },
    setSnapshots:(value:Record<string,BrowserTabSnapshot>)=>api.storage.session.set({[KEYS.snapshots]:value}),
    async getBrowserSessionId(){
      const value=await api.storage.session.get(KEYS.browserSessionId);
      return typeof value[KEYS.browserSessionId]==='string'?value[KEYS.browserSessionId] as string:null;
    },
    setBrowserSessionId:(value:string)=>api.storage.session.set({[KEYS.browserSessionId]:value}),
    async getDurableSnapshots(){
      const value=await api.storage.local.get(KEYS.durableSnapshots);
      return (value[KEYS.durableSnapshots]||{}) as Record<string,DurableBrowserTabSnapshot>;
    },
    setDurableSnapshots:(value:Record<string,DurableBrowserTabSnapshot>)=>api.storage.local.set({[KEYS.durableSnapshots]:value}),
    getPending:()=>array<PendingCapture>(KEYS.pending),
    setPending:(value:PendingCapture[])=>api.storage.local.set({[KEYS.pending]:value}),
    setPendingAndDurable:(pending:PendingCapture[],durable:Record<string,DurableBrowserTabSnapshot>)=>api.storage.local.set({[KEYS.pending]:pending,[KEYS.durableSnapshots]:durable}),
    async unresolvedFor(contextId:string){
      return (await array<Checkpoint>(KEYS.checkpoints)).filter(item=>item.contextId===contextId&&!item.resolvedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    }
  };
}
