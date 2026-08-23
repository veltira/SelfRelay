import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const publicDir=resolve(here,'../public');

test('first-run copy describes following tabs without exposing context jargon',async()=>{
  const popup=await readFile(resolve(publicDir,'popup.html'),'utf8');
  assert.match(popup,/Seguir esta pestaña/);
  assert.match(popup,/Seguir varias pestañas/);
  assert.doesNotMatch(popup,/Crear contexto|Armá un contexto de trabajo/);
});

test('capture copy makes writing and voice recording independently discoverable',async()=>{
  const capture=await readFile(resolve(publicDir,'checkpoint.html'),'utf8');
  assert.match(capture,/Escribí una nota/);
  assert.match(capture,/Grabar nota de voz/);
  assert.match(capture,/Nota de voz/);
  assert.doesNotMatch(capture,/Grabar audio|Audio listo/);
});
