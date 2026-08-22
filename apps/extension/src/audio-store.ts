export interface StoredAudioAsset {
  id: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  createdAt: string;
}

export interface AudioAssetStore {
  put(asset: StoredAudioAsset): Promise<void>;
  get(id: string): Promise<StoredAudioAsset | null>;
  delete(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

const DB_NAME='selfrelay-audio';
const STORE_NAME='assets';
const DB_VERSION=1;

function requestResult<T>(request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error('indexeddb_request_failed'));
  });
}

function transactionDone(transaction:IDBTransaction):Promise<void>{
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(transaction.error??new Error('indexeddb_transaction_aborted'));
    transaction.onerror=()=>reject(transaction.error??new Error('indexeddb_transaction_failed'));
  });
}

function openDatabase(factory:IDBFactory):Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=factory.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error('indexeddb_open_failed'));
    request.onblocked=()=>reject(new Error('indexeddb_open_blocked'));
  });
}

export function createAudioAssetStore(factory:IDBFactory):AudioAssetStore{
  async function withStore<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>Promise<T>):Promise<T>{
    const db=await openDatabase(factory);
    try{
      const transaction=db.transaction(STORE_NAME,mode);
      const store=transaction.objectStore(STORE_NAME);
      const result=await work(store);
      await transactionDone(transaction);
      return result;
    }finally{db.close();}
  }

  return {
    put:asset=>withStore('readwrite',async store=>{await requestResult(store.put(asset));}),
    get:id=>withStore('readonly',async store=>(await requestResult(store.get(id)) as StoredAudioAsset|undefined)??null),
    delete:id=>withStore('readwrite',async store=>{await requestResult(store.delete(id));}),
    has:id=>withStore('readonly',async store=>(await requestResult(store.count(id)))>0)
  };
}

export function browserAudioAssetStore():AudioAssetStore|null{
  return typeof indexedDB==='undefined'?null:createAudioAssetStore(indexedDB);
}
