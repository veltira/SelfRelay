import assert from 'node:assert/strict';
import test from 'node:test';
import {runTransientBusy} from '../src/popup-busy.js';

test('popup transient busy releases after a successful hot transition',async()=>{
  const states:boolean[]=[];
  const result=await runTransientBusy(value=>states.push(value),async()=>{await Promise.resolve();return 'done';});
  assert.equal(result,'done');
  assert.deepEqual(states,[true,false]);
});

test('popup transient busy releases after an error so retry remains possible',async()=>{
  const states:boolean[]=[];
  await assert.rejects(()=>runTransientBusy(value=>states.push(value),async()=>{throw new Error('expected failure');}),/expected failure/);
  assert.deepEqual(states,[true,false]);
});
