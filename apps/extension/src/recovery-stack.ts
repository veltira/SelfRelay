import type {Checkpoint} from '@selfrelay/shared';

export function checkpointAppliesToMember(checkpoint:Checkpoint,memberId:string|null|undefined){
  const targets=checkpoint.targetMemberIds;
  return !targets?.length||Boolean(memberId&&targets.includes(memberId));
}

export function unresolvedRecoveryStack(checkpoints:Checkpoint[],memberId:string|null|undefined){
  return checkpoints
    .filter(checkpoint=>!checkpoint.resolvedAt&&checkpointAppliesToMember(checkpoint,memberId))
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
