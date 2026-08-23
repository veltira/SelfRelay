import assert from 'node:assert/strict';
import test from 'node:test';
import type {Checkpoint} from '@selfrelay/shared';
import {unresolvedRecoveryStack} from '../src/recovery-stack.ts';

function checkpoint(id:string,createdAt:string,options:{resolvedAt?:string|null;targets?:string[]|null}={}):Checkpoint{
  return{id,contextId:'context',originalText:id,createdAt,resolvedAt:options.resolvedAt??null,targetMemberIds:options.targets??null,audioRef:null,audioMimeType:null,audioDurationMs:null,transcript:null,transcriptionEngine:null};
}

const A=checkpoint('A','2026-08-22T09:20:00.000Z');
const B=checkpoint('B','2026-08-22T11:45:00.000Z');
const C=checkpoint('C','2026-08-22T14:10:00.000Z');

test('unresolved checkpoints accumulate instead of replacing older hints',()=>{
  assert.deepEqual(unresolvedRecoveryStack([A],null).map(item=>item.id),['A']);
  assert.deepEqual(unresolvedRecoveryStack([B,A],null).map(item=>item.id),['A','B']);
  assert.deepEqual(unresolvedRecoveryStack([C,A,B],null).map(item=>item.id),['A','B','C']);
});

test('resolving one checkpoint removes only that checkpoint from active recovery',()=>{
  const resolvedB={...B,resolvedAt:'2026-08-22T15:00:00.000Z'};
  assert.deepEqual(unresolvedRecoveryStack([C,resolvedB,A],null).map(item=>item.id),['A','C']);
  const resolvedA={...A,resolvedAt:'2026-08-22T15:01:00.000Z'};
  assert.deepEqual(unresolvedRecoveryStack([C,resolvedB,resolvedA],null).map(item=>item.id),['C']);
  const resolvedC={...C,resolvedAt:'2026-08-22T15:02:00.000Z'};
  assert.deepEqual(unresolvedRecoveryStack([resolvedC,resolvedB,resolvedA],null),[]);
});

test('storage order never changes chronological recovery order',()=>{
  assert.deepEqual(unresolvedRecoveryStack([C,A,B],null).map(item=>item.id),['A','B','C']);
});

test('equal timestamps use id as a deterministic tie breaker',()=>{
  const first=checkpoint('a','2026-08-22T09:20:00.000Z'),second=checkpoint('b','2026-08-22T09:20:00.000Z');
  assert.deepEqual(unresolvedRecoveryStack([second,first],null).map(item=>item.id),['a','b']);
});

test('workset targeting is preserved while collecting unresolved checkpoints',()=>{
  const general=checkpoint('general','2026-08-22T09:00:00.000Z');
  const onlyA=checkpoint('only-a','2026-08-22T10:00:00.000Z',{targets:['member-a']});
  const subset=checkpoint('subset','2026-08-22T11:00:00.000Z',{targets:['member-a','member-b']});
  const onlyC=checkpoint('only-c','2026-08-22T12:00:00.000Z',{targets:['member-c']});
  assert.deepEqual(unresolvedRecoveryStack([onlyC,subset,onlyA,general],'member-a').map(item=>item.id),['general','only-a','subset']);
  assert.deepEqual(unresolvedRecoveryStack([onlyC,subset,onlyA,general],'member-b').map(item=>item.id),['general','subset']);
  assert.deepEqual(unresolvedRecoveryStack([onlyC,subset,onlyA,general],'member-c').map(item=>item.id),['general','only-c']);
});

test('dismiss semantics require no storage mutation: unresolved input remains unresolved',()=>{
  const stack=unresolvedRecoveryStack([A,B],null);
  assert.equal(stack.every(item=>item.resolvedAt===null),true);
  assert.deepEqual(stack.map(item=>item.id),['A','B']);
});
