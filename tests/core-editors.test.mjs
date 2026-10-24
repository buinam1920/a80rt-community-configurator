import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {createCoreEditorModel} from '../dist/ui/core-editors.js';

const cap=identifyDevice({vendorId:0x0c45,productId:0x80a1,productName:'A80RT U'});
function sample(){
  const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
  for(const slot of cap.slots){blocks.rt.set([1,0,100,0,20,0,30,0],slot*8);blocks.keymap.set([2,0,26,91],slot*4);}
  blocks.rt[49*8+2]=180;blocks.rt[49*8+1]=1;
  const coverage=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}]));
  return new ConfigSession({identity:cap.identity,blocks,coverage,provenance:{source:'sample'}},cap);
}
test('W/A mixed selection preserves every byte until an explicit field edit',()=>{
  const session=sample(),before=session.draft,vm=createCoreEditorModel({session,capability:cap,selectedSlots:[34,49]});
  assert.equal(vm.view().rt.actuationMm.mixed,true);assert.equal(vm.view().rt.whole.mixed,true);
  vm.setSelection([49]);vm.setSelection([34,49]);assert.deepEqual(session.draft,before);assert.equal(session.diff().length,0);
  vm.edit('rt','pressMm',0.4);assert.equal(session.draft.rt[34*8+4],40);assert.equal(session.draft.rt[49*8+4],40);
  assert.equal(session.draft.rt[34*8+2],100);assert.equal(session.draft.rt[49*8+2],180);
});
test('Fn remap changes only Fn and respects source locked F1–F12 slots',()=>{
  const session=sample(),before=session.draft.keymap,vm=createCoreEditorModel({session,capability:cap,selectedSlots:[34]});
  vm.setLayer('fn');vm.edit('binding','binding',{type:'media',usage:233});assert.deepEqual(session.draft.keymap,before);assert.equal(session.draft.fn[34*4],3);
  vm.setSelection([1,34]);assert.equal(vm.view().bindingLocked,true);assert.throws(()=>vm.edit('binding','binding',{type:'empty'}),/Fn/);
});

test('direct session edits cannot bypass Fn locks and base F1–F12 remain editable',()=>{
  const session=sample(),before=session.draft;
  for(let slot=1;slot<=12;slot++){
    assert.throws(()=>session.edit('fn',[{slot:34,field:'binding',value:{type:'media',usage:233}},{slot,field:'binding',value:{type:'empty'}}]),/Fn/);
    assert.deepEqual(session.draft,before);assert.deepEqual(session.diff(),[]);
  }
  session.edit('keymap',Array.from({length:12},(_,index)=>({slot:index+1,field:'binding',value:{type:'media',usage:233}})));
  assert.equal(session.diff().length,12);
  // Source ordinary replacement owns all four bytes, including trailing zero.
  for(let slot=1;slot<=12;slot++)assert.deepEqual(session.draft.keymap.slice(slot*4,slot*4+4),Uint8Array.of(3,233,0,0));
  assert.deepEqual(session.draft.fn,before.fn);
});
test('switch edits recalculate valid travel without silently clamping unrelated distances',()=>{
  const session=sample(),vm=createCoreEditorModel({session,capability:cap,selectedSlots:[34]});
  vm.edit('rt','switchId',2);assert.equal(vm.view().limits.maxMm,3.3);
  const before=session.draft;assert.throws(()=>vm.edit('rt','actuationMm',3.4),/travel/);assert.deepEqual(session.draft,before);
});
test('per-key RGB edits affect only selected physical slots and keep markers',()=>{
  const session=sample(),vm=createCoreEditorModel({session,capability:cap,selectedSlots:[34,49]}),before=session.draft.colors;
  vm.edit('colors','rgb',{red:4,green:5,blue:6});
  for(let slot=0;slot<128;slot++)assert.deepEqual(session.draft.colors.slice(slot*4,slot*4+4),[34,49].includes(slot)?Uint8Array.of(0,4,5,6):before.slice(slot*4,slot*4+4));
  assert.throws(()=>vm.setSelection([15]),/physical/);
});
test('opened without complete snapshot locks editing and Apply; samples are local',()=>{
  const vm=createCoreEditorModel({session:null,capability:cap,selectedSlots:[34]});
  assert.equal(vm.view().editable,false);assert.equal(vm.view().canApply,false);assert.throws(()=>vm.edit('rt','pressMm',0.2),/snapshot/i);
  const session=sample(),local=createCoreEditorModel({session,capability:cap,selectedSlots:[34]});
  assert.equal(local.view().editable,true);assert.equal(local.view().canApply,false);assert.match(local.view().reason,/mẫu/);
});
test('empty selection and invalid edits retain draft; raw zero remains zero',()=>{
  const session=sample(),vm=createCoreEditorModel({session,capability:cap,selectedSlots:[34]});
  vm.edit('rt','releaseMm',0);assert.equal(vm.view().rt.releaseMm.value,0);
  const before=session.draft;assert.throws(()=>vm.edit('rt','pressMm',NaN));assert.deepEqual(session.draft,before);
  vm.setSelection([]);assert.equal(vm.view().editable,false);assert.throws(()=>vm.edit('colors','rgb',{red:0,green:0,blue:0}),/selection/i);
});

test('host busy state immediately disables core edits before apply enters the session',()=>{
 let busy=false;const vm=createCoreEditorModel({session:sample(),capability:cap,selectedSlots:[34],isBusy:()=>busy});assert.equal(vm.view().editable,true);busy=true;assert.equal(vm.view().editable,false);assert.throws(()=>vm.edit('rt','pressMm',0.3),/running|giao dịch/);
});
