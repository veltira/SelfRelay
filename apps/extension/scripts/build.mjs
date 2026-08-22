import {cp, mkdir, readdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const dist=resolve(root,'dist');
await rm(dist,{recursive:true,force:true});
const bin=process.platform==='win32'?'tsc.cmd':'tsc';
const result=spawnSync(bin,['-p','tsconfig.json'],{cwd:root,stdio:'inherit',shell:false});
if(result.status!==0)process.exit(result.status??1);
await mkdir(dist,{recursive:true});
for(const entry of await readdir(resolve(root,'public'),{withFileTypes:true})){
  await cp(resolve(root,'public',entry.name),resolve(dist,entry.name),{recursive:true});
}
console.log(`SelfRelay extension built: ${dist}`);
