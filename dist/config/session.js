import {identifyDevice,readPlan} from '../device/capabilities.js';
import {decodeBlock,patchBlock,fieldChanges} from './codecs.js';
import {createMacroPatcher} from './macros.js';
import {validateReferenceEdits,advancedEdits} from './advanced.js';
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
  #capability;#snapshot;#blocks;#draft;#edits=new Map();#origin;#applying=false;#plan;#invalidReason=null;#patchMacro;
  constructor(snapshot,capability){
    this.#plan=readPlan(capability);this.#capability=capability;
    if(!snapshot||identifyDevice(snapshot.identity)!==capability)throw new Error('Snapshot identity does not match capability.');
    const blocks=snapshot.blocks;
    if(!blocks||typeof blocks!=='object')throw new Error('Snapshot blocks are required.');
    for(const id of Object.keys(blocks))if(!Object.hasOwn(capability.blocks,id))throw new Error(`Unknown block ${id}.`);
    this.#blocks=Object.fromEntries(Object.entries(blocks).map(([id,bytes])=>[id,decodeBlock(id,bytes,capability).bytes]));
    this.#snapshot=snapshotView(capability.identity,this.#blocks,snapshot.coverage??{},snapshot.provenance??{source:'unknown'});
    this.#origin=origins.get(snapshot);this.#draft=copyBlocks(this.#blocks);
    if(this.#blocks.macro)this.#patchMacro=createMacroPatcher(this.#blocks.macro,capability);
    if(this.#origin)origins.set(this.#snapshot,this.#origin);
  }
  get snapshot(){return this.#snapshot;}
  get draft(){return copyBlocks(this.#draft);}
  get applying(){return this.#applying;}
  get invalidated(){return this.#invalidReason!==null;}
  get invalidReason(){return this.#invalidReason;}
  invalidate(reason='Snapshot đã hết hiệu lực; đọc lại cấu hình.'){this.#invalidReason=reason;}
  #editable(){
    if(this.#applying)throw new Error('Một giao dịch đang chạy.');
    if(this.invalidated)throw new Error(this.#invalidReason);
    if(!completeCoverage(this.#blocks,this.#snapshot.coverage,this.#plan))throw new Error('Complete snapshot coverage is required before editing.');
  }
  edit(blockId,edits){return this.transaction({[blockId]:edits});}
  advanced(binding){return this.transaction(advancedEdits(this.#draft,binding,this.#capability));}
  preview(groups){
    const shadow=new ConfigSession({...this.#snapshot,blocks:this.#draft,provenance:{source:'profile'}},this.#capability);
    shadow.#patchMacro=this.#patchMacro;return shadow.transaction(groups);
  }
  transaction(groups){
    this.#editable();if(!groups||typeof groups!=='object'||Array.isArray(groups))throw new Error('Edit groups required.');
    // A macro list has one identity mapping per transaction. Reject ambiguous
    // repeated lists before any group is staged or reference identity is lost.
    if(Array.isArray(groups.macro)&&groups.macro.filter(edit=>edit?.field==='macros').length>1)throw new Error('Duplicate macro list edits are not allowed in one transaction.');
    const draft=copyBlocks(this.#draft),saved=new Map(this.#edits);let remaps=[];
    for(const [id,edits]of Object.entries(groups)){
      const result=patchBlock(id,draft[id],edits,this.#capability,{patchMacro:this.#patchMacro});draft[id]=result.bytes;
      if(id==='macro')remaps=result.referenceChanges??[];
      const fields=new Map(saved.get(id)??[]);for(const edit of edits)fields.set(`${edit.slot??'global'}:${edit.field}`,copy(edit));saved.set(id,fields);
    }
    if(groups.macro?.some(edit=>edit.field==='macros')){
      for(const id of ['keymap','fn'])for(let slot=0;slot<this.#draft[id].length/4;slot++){
        const offset=slot*4;if(this.#draft[id][offset]!==6||!remaps.some(r=>r.before===this.#draft[id][offset+1]))continue;
        if(!groups[id]?.some(e=>e.slot===slot&&e.field==='binding'))throw new Error(`${id}[${slot}] macro reference requires repair in the same transaction.`);
      }
    }
    if(Object.keys(groups).some(id=>['keymap','fn','macro','dks','rt'].includes(id))){
      const errors=validateReferenceEdits(this.#draft,draft,groups,this.#capability);
      if(errors.length)throw new Error(errors.join('; '));
    }
    this.#draft=draft;this.#edits=saved;return this.diff();
  }
  revert(){this.#editable();this.#edits.clear();this.#draft=copyBlocks(this.#blocks);}
  // Chụp bản nháp để "Lấy lại" sau khi người dùng bấm Hoàn tác nhầm.
  checkpoint(){return {draft:copyBlocks(this.#draft),edits:new Map([...this.#edits].map(([id,fields])=>[id,new Map(fields)]))};}
  restore(point){
    this.#editable();if(!point?.draft||!(point.edits instanceof Map))throw new Error('Không có bản nháp để lấy lại.');
    this.#draft=copyBlocks(point.draft);this.#edits=new Map([...point.edits].map(([id,fields])=>[id,new Map(fields)]));return this.diff();
  }
  diff(){
    return this.#plan.flatMap(({id})=>this.#edits.has(id)?fieldChanges(id,this.#blocks[id],this.#draft[id],[...this.#edits.get(id).values()],this.#capability):[]);
  }
  async apply(transport,{signal,onProgress=()=>{}}={}){
    if(this.#applying||busyTransports.has(transport))throw new Error('Một giao dịch đang chạy.');
    const result={status:'failed',writtenBlocks:[],verifiedFields:[],attemptedBlocks:[]};
    if(!(transport instanceof A80Transport))return {...result,error:'Apply requires A80Transport.'};
    this.#applying=true;busyTransports.add(transport);
    let activeBlock;
    try{
      if(this.invalidated)throw new Error(this.#invalidReason);
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
        // Preflight the entire atomic intent before any write/control or progress
        // callback. A known blocked command keeps the fresh baseline and draft.
        for(const command of [...plan.map(block=>this.#capability.blocks[block.id].writeCommand),0]){
          const state=transport.getWriteState(command);
          if(!state.ready)throw new Error(state.reason??'Write command qualification is unavailable for this device.');
        }
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
          const edits=[...this.#edits.get(id).values()].filter(edit=>paths.has(id==='settings'||id==='lighting'||id==='macro'?`fields.${edit.field}`:`records[${edit.slot}].${edit.field}`));
          if(edits.length!==fields.length)throw new Error(`Read-back cannot resolve every semantic field in ${id}; verification is unavailable.`);
          // Reapplying desired semantic values to the read bytes must be a no-op.
          // This checks all owned channels/bits, without comparing volatile or
          // opaque neighbors and without depending on a write-payload echo.
          const different=new Set((id==='macro'?fieldChanges(id,actualBlocks[id],this.#draft[id],edits,this.#capability):patchBlock(id,actualBlocks[id],edits,this.#capability).changes).map(change=>change.path));
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
        // Semantic verification does not attest opaque readback bytes. Rebase
        // ownership conservatively from the actual capture after verified apply.
        this.#patchMacro=createMacroPatcher(actualBlocks.macro,this.#capability);
        this.#origin={...this.#origin,writeEpoch};
        this.#snapshot=snapshotView(this.#capability.identity,actualBlocks,this.#snapshot.coverage,{...this.#snapshot.provenance,writeEpoch,verifiedAt:new Date().toISOString()});
        origins.set(this.#snapshot,this.#origin);return {...result,status:'verified'};
      },{signal,sessionId:this.#origin.sessionId,writeEpoch:this.#origin.writeEpoch});
    }catch(error){
      const mayHaveWritten=result.writtenBlocks.length>0||(error.writeProgress?.sentChunks??0)>0;
      if(mayHaveWritten)this.invalidate('Chưa xác nhận trạng thái thiết bị sau khi ghi; đọc lại đủ 9 nhóm cấu hình trước khi chỉnh sửa hoặc áp dụng tiếp. Bản nháp chỉ còn đến khi đọc lại; hoàn tác cục bộ không chứng minh thiết bị đã khôi phục.');
      if(activeBlock&&(error.writeProgress?.sentChunks??0)>0)result.partialBlock=activeBlock;
      if(error.writeProgress)result.writeProgress=copy(error.writeProgress);
      return {...result,status:mayHaveWritten?'unconfirmed':'failed',error:error.message??String(error)};
    }finally{this.#applying=false;busyTransports.delete(transport);}
  }
}
