import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));

test('recovery tab count uses singular for one tab and plural otherwise',async()=>{
  const source=await readFile(resolve(here,'../src/content.ts'),'utf8');
  assert.match(source,/function tabCountLabel\(count:number\)\{return count===1\?'1 pestaña':`\$\{count\} pestañas`;\}/);
  assert.match(source,/\.textContent=context\.members\?\.length\?tabCountLabel\(context\.members\.length\):/);
  const label=(count:number)=>count===1?'1 pestaña':`${count} pestañas`;
  assert.equal(label(1),'1 pestaña');
  assert.equal(label(2),'2 pestañas');
});
