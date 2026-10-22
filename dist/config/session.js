import {identifyDevice,readPlan} from '../device/capabilities.js';
import {decodeBlock,patchBlock} from './codecs.js';
import {A80Transport} from '../device/transport.js';

const origins=new WeakMap(),busyTransports=new WeakSet();
const copy=object=>structuredClone(object);
const copyBlocks=blocks=>Object.fromEntries(Object.entries(blocks).map(([id,bytes])=>[id,bytes.slice()]));
const freeze=object=>{for(const value of Object.values(object))if(value&&typeof value==='object')freeze(value);return Object.freeze(object);};
const stopped=()=>new DOMException('Đã dừng giao dịch.','AbortError');
function checkConnection(transport,capability,sessionId,signal){
  if(signal?.aborted)throw stopped();
  const state=transport.getState();
  if(!state.opened||state.sessionId!==sessionId)throw new Error('Device session changed or disconnected. Read a new snapshot.');
  if(identifyDevice(transport.device)!==capability)throw new Error('Device identity does not match snapshot.');
}
function snapshotView(identity,blocks,coverage,provenance){
  // Typed arrays cannot be frozen. Return fresh byte copies on every access.
  const saved=copyBlocks(blocks);
  return Object.freeze({identity:freeze(copy(identity)),get blocks(){return copyBlocks(saved);},coverage:freeze(copy(coverage)),provenance:freeze(copy(provenance))});
}
function completeCoverage(blocks,coverage,plan){
  return plan.every(({id,length})=>blocks[id]?.length===length&&coverage?.[id]?.complete===true&&coverage[id].expectedBytes===length&&coverage[id].receivedBytes===length);
}

// Only this complete device read can mint live provenance. Serialized snapshots
// remain useful for drafts, but cannot recover this nonserializable origin token.
export async function readSnapshot(transport,capability,{signal,onProgress=()=>{}}={}){
  const plan=readPlan(capability);
  if(!(transport instanceof A80Transport))throw new Error('Snapshot requires A80Transport.');
  if(busyTransports.has(transport))throw new Error('Một giao dịch đang chạy.');
  const sessionId=transport.getState().sessionId;
  checkConnection(transport,capability,sessionId,signal);busyTransports.add(transport);
  try{
    return await transport.withTransaction(async io=>{
      const {writeEpoch}=transport.getState(),blocks={},coverage={};
      const total=plan.reduce((sum,block)=>sum+block.length,0);let completed=0;
      for(const {id,command,length} of plan){
        checkConnection(transport,capability,sessionId,signal);
        const bytes=await io.readBlock(command,length,{signal});
        checkConnection(transport,capability,sessionId,signal);
        blocks[id]=decodeBlock(id,bytes,capability).bytes;
        coverage[id]={complete:true,expectedBytes:length,receivedBytes:bytes.length};completed+=length;
        onProgress({phase:'read',block:id,completed,total});
      }
      checkConnection(transport,capability,sessionId,signal);
      if(transport.getState().writeEpoch!==writeEpoch)throw new Error('Snapshot became stale during reading; read a new snapshot.');
      const snapshot=snapshotView(capability.identity,blocks,coverage,{source:'device',sessionId,writeEpoch,readAt:new Date().toISOString()});
      origins.set(snapshot,{transport,sessionId,writeEpoch,capability});return snapshot;
    },{signal,sessionId});
  }finally{busyTransports.delete(transport);}
}

export class ConfigSession {
  #capability;#snapshot;#blocks;#draft;#edits=new Map();#origin;#applying=false;#plan;
  constructor(snapshot,capability){
    this.#plan=readPlan(capability);this.#capability=capability;
    if(!snapshot||identifyDevice(snapshot.identity)!==capability)throw new Error('Snapshot identity does not match capability.');
    const blocks=snapshot.blocks;
    if(!blocks||typeof blocks!=='object')throw new Error('Snapshot blocks are required.');
    for(const id of Object.keys(blocks))if(!Object.hasOwn(capability.blocks,id))throw new Error(`Unknown block ${id}.`);
    this.#blocks=Object.fromEntries(Object.entries(blocks).map(([id,bytes])=>[id,decodeBlock(id,bytes,capability).bytes]));
    this.#snapshot=snapshotView(capability.identity,this.#blocks,snapshot.coverage??{},snapshot.provenance??{source:'unknown'});
    this.#origin=origins.get(snapshot);this.#draft=copyBlocks(this.#blocks);
    if(this.#origin)origins.set(this.#snapshot,this.#origin);
  }
  get snapshot(){return this.#snapshot;}
  get draft(){return copyBlocks(this.#draft);}
  get applying(){return this.#applying;}
  #editable(){
    if(this.#applying)throw new Error('Một giao dịch đang chạy.');
    if(!completeCoverage(this.#blocks,this.#snapshot.coverage,this.#plan))throw new Error('Complete snapshot coverage is required before editing.');
  }
  edit(blockId,edits){
    this.#editable();
    // Validate the atomic edit against current bytes before changing any draft state.
    patchBlock(blockId,this.#draft[blockId],edits,this.#capability);
    const fields=new Map(this.#edits.get(blockId)??[]);
    for(const edit of edits)fields.set(`${edit.slot??'global'}:${edit.field}`,copy(edit));
    const result=patchBlock(blockId,this.#blocks[blockId],[...fields.values()],this.#capability);
    this.#edits.set(blockId,fields);this.#draft[blockId]=result.bytes;return this.diff();
  }
  revert(){this.#editable();this.#edits.clear();this.#draft=copyBlocks(this.#blocks);}
  diff(){
    return this.#plan.flatMap(({id})=>this.#edits.has(id)?patchBlock(id,this.#blocks[id],[...this.#edits.get(id).values()],this.#capability).changes:[]);
  }
  async apply(transport,{signal,onProgress=()=>{}}={}){
    if(this.#applying||busyTransports.has(transport))throw new Error('Một giao dịch đang chạy.');
    const result={status:'failed',writtenBlocks:[],verifiedFields:[],attemptedBlocks:[]};
    if(!(transport instanceof A80Transport))return {...result,error:'Apply requires A80Transport.'};
    this.#applying=true;busyTransports.add(transport);
    let activeBlock;
    try{
      if(!this.#origin||this.#origin.transport!==transport||this.#origin.capability!==this.#capability||this.#snapshot.provenance.source!=='device')throw new Error('Only a complete device-read snapshot from this transport can write; sample/import provenance is not writable.');
      if(!completeCoverage(this.#blocks,this.#snapshot.coverage,this.#plan))throw new Error('Complete snapshot coverage is required before writing.');
      return await transport.withTransaction(async io=>{
        const sessionId=this.#origin.sessionId;let writeEpoch=this.#origin.writeEpoch;
        const check=()=>{
          checkConnection(transport,this.#capability,sessionId,signal);
          if(transport.getState().writeEpoch!==writeEpoch)throw new Error('Snapshot is stale after another write; read a new snapshot.');
        };
        check();
        if(!transport.getWriteState().qualified)throw new Error('Write ACK qualification is unavailable for this device.');
        const changes=this.diff(),changedIds=new Set(changes.map(change=>change.block));
        const plan=this.#plan.filter(block=>changedIds.has(block.id));
        if(!plan.length)return {...result,status:'verified'};
        for(const {id} of plan){
          check();
          onProgress({phase:'write',block:id,completed:result.writtenBlocks.length,total:plan.length});
          check();
          activeBlock=id;result.attemptedBlocks.push(id);
          writeEpoch++;
          await io.writeBlock(this.#capability.blocks[id].writeCommand,this.#draft[id],{signal});
          result.writtenBlocks.push(id);activeBlock=undefined;
        }
        check();
        onProgress({phase:'control',completed:plan.length,total:plan.length});
        check();
        // Source post-write step. This does not establish flash persistence.
        writeEpoch++;
        await io.sendControl(0,Uint8Array.of(0,0,0,0),{signal});
        const actualBlocks=copyBlocks(this.#blocks),mismatches=[];
        for(const {id,command,length} of plan){
          check();
          onProgress({phase:'readback',block:id,completed:result.verifiedFields.length,total:changes.length});
          check();
          const actual=await io.readBlock(command,length,{signal});
          check();
          actualBlocks[id]=decodeBlock(id,actual,this.#capability).bytes;
          const fields=changes.filter(change=>change.block===id),paths=new Set(fields.map(change=>change.path));
          const edits=[...this.#edits.get(id).values()].filter(edit=>paths.has(id==='settings'||id==='lighting'?`fields.${edit.field}`:`records[${edit.slot}].${edit.field}`));
          if(edits.length!==fields.length)throw new Error(`Read-back cannot resolve every semantic field in ${id}; verification is unavailable.`);
          // Reapplying desired semantic values to the read bytes must be a no-op.
          // This checks all owned channels/bits, without comparing volatile or
          // opaque neighbors and without depending on a write-payload echo.
          const different=new Set(patchBlock(id,actualBlocks[id],edits,this.#capability).changes.map(change=>change.path));
          for(const {block,path} of fields){
            if(different.has(path))mismatches.push(`${block}:${path}`);
            else result.verifiedFields.push({block,path});
          }
        }
        if(mismatches.length)throw new Error(`Read-back mismatch: ${mismatches.join(', ')}.`);
        check();
        onProgress({phase:'verified',completed:changes.length,total:changes.length});
        check();
        this.#blocks=actualBlocks;this.#draft=copyBlocks(actualBlocks);this.#edits.clear();
        this.#origin={...this.#origin,writeEpoch};
        this.#snapshot=snapshotView(this.#capability.identity,actualBlocks,this.#snapshot.coverage,{...this.#snapshot.provenance,writeEpoch,verifiedAt:new Date().toISOString()});
        origins.set(this.#snapshot,this.#origin);return {...result,status:'verified'};
      },{signal,sessionId:this.#origin.sessionId,writeEpoch:this.#origin.writeEpoch});
    }catch(error){
      const mayHaveWritten=result.writtenBlocks.length>0||(error.writeProgress?.sentChunks??0)>0;
      if(activeBlock&&(error.writeProgress?.sentChunks??0)>0)result.partialBlock=activeBlock;
      if(error.writeProgress)result.writeProgress=copy(error.writeProgress);
      return {...result,status:mayHaveWritten?'unconfirmed':'failed',error:error.message??String(error)};
    }finally{this.#applying=false;busyTransports.delete(transport);}
  }
}
