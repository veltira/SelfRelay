export async function runTransientBusy<T>(setBusy:(value:boolean)=>void,work:()=>Promise<T>):Promise<T>{
  setBusy(true);
  try{return await work();}
  finally{setBusy(false);}
}
