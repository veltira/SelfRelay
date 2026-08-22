import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const publicDir=resolve(here,'../public');
const artifactDir=resolve(here,'../../../artifacts/chrome-extension-unpacked');

async function text(root:string,name:string){return readFile(resolve(root,name),'utf8');}

test('manifest capabilities remain identical to the preserved extension',async()=>{
  const current=JSON.parse(await text(publicDir,'manifest.json'));
  const preserved=JSON.parse(await text(artifactDir,'manifest.json'));
  assert.deepEqual(current,preserved);
});

test('capture, popup and base UI remain byte-for-byte aligned with the preserved artifact',async()=>{
  for(const name of ['checkpoint.html','popup.html','ui.css']){
    assert.equal(await text(publicDir,name),await text(artifactDir,name),`${name} drifted from the preserved artifact`);
  }
});
