import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
const api=await import('../dist/config/macros.js').catch(()=>({}));
const cap=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
const event=(action='down',delayMs=0)=>({device:'keyboard',code:4,action,delayMs});
function session(){const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));return new ConfigSession({identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}},cap);}
test('source macro delay/down/up layout round trips with reserved data untouched',()=>{
 assert.equal(typeof api.patchMacros,'function','macro patch API required');const raw=new Uint8Array(1024);raw[1000]=211;
 const result=api.patchMacros(raw,[{events:[event('down',513),event('up',25)]}],cap);
 assert.deepEqual(Array.from(result.bytes.slice(0,8)),[144,1,0,0,0,0,0,0]);
 assert.deepEqual(Array.from(result.bytes.slice(400,412)),[4,0,0,0,1,2,4,176,25,0,4,48]);
 assert.equal(result.bytes[1000],211);assert.equal(raw[400],0);
 const decoded=api.decodeMacros(result.bytes,cap);assert.equal(decoded[0].events[0].delayMs,513);assert.equal(decoded[0].events[1].action,'up');
 result.bytes[402]=93;result.bytes[407]|=1;const changed=api.decodeMacros(result.bytes,cap);changed[0].events[0].delayMs=7;
 const patched=api.patchMacros(result.bytes,changed,cap).bytes;assert.equal(patched[402],93);assert.equal(patched[407],177);assert.equal(patched[1000],211);
});
test('rejects macro pointers outside captured span, overlap, odd counts and capacity overflow',()=>{
 assert.equal(typeof api.decodeMacros,'function');
 for(const pointer of [399,1023,0xffffffff]){const raw=new Uint8Array(1024);new DataView(raw.buffer).setUint32(0,pointer,true);assert.throws(()=>api.decodeMacros(raw,cap),/pointer|span/);}
 const raw=new Uint8Array(1024);raw.set([144,1,0,0,144,1,0,0]);assert.throws(()=>api.decodeMacros(raw,cap),/overlap/);
 raw.fill(0);raw.set([144,1,0,0]);raw[400]=3;assert.throws(()=>api.decodeMacros(raw,cap),/odd/);
 assert.throws(()=>api.patchMacros(new Uint8Array(1024),[{events:Array.from({length:156},()=>event())}],cap),/capacity|span/);
});
test('macro assignments carry source repeat modes; deleting referenced macro requires atomic repairs',()=>{
 const s=session();assert.equal(typeof s.transaction,'function','cross-block transaction required');
 s.edit('macro',[{field:'macros',value:[{events:[event()]}]}]);
 s.edit('keymap',[{slot:34,field:'binding',value:{type:'macro',index:0,mode:1,repeat:5}}]);
 s.edit('fn',[{slot:49,field:'binding',value:{type:'macro',index:0,mode:2,repeat:1}}]);
 assert.deepEqual(Array.from(s.draft.keymap.slice(136,140)),[6,0,1,5]);const before=s.draft;
 assert.throws(()=>s.edit('macro',[{field:'macros',value:[]}]),/reference/);assert.deepEqual(s.draft,before);
 s.transaction({macro:[{field:'macros',value:[]}],keymap:[{slot:34,field:'binding',value:{type:'empty'}}],fn:[{slot:49,field:'binding',value:{type:'empty'}}]});assert.equal(s.draft.macro[0],0);
});
test('macro reindex cannot silently retarget existing base or Fn bindings',()=>{
 const s=session();assert.equal(typeof s.transaction,'function');s.edit('macro',[{field:'macros',value:[{events:[event()]},{events:[{...event(),code:5}]}]}]);s.edit('fn',[{slot:34,field:'binding',value:{type:'macro',index:1,mode:0,repeat:1}}]);
 const macros=api.decodeMacros(s.draft.macro,cap);assert.throws(()=>s.edit('macro',[{field:'macros',value:[macros[1]]}]),/reference/);
 s.transaction({macro:[{field:'macros',value:[macros[1]]}],fn:[{slot:34,field:'binding',value:{type:'macro',index:0,mode:0,repeat:1}}]});assert.equal(s.draft.fn[137],0);
});

test('macro payload cannot overwrite captured reserved header or flag bits',()=>{
 const raw=new Uint8Array(1024);raw.set([144,1,0,0]);raw.set([2,0,77,88,0,0,4,177],400);
 const value=api.decodeMacros(raw,cap);value[0].events[0].flags=48;value[0].reserved=[0,0];value[0].events[0].action='up';
 const after=api.patchMacros(raw,value,cap).bytes;assert.deepEqual(Array.from(after.slice(402,404)),[77,88]);assert.equal(after[407],49);
});

test('duplicate macro-list edits cannot bypass deletion and reindex repair checks',()=>{
 for(const layer of ['keymap','fn']){
  const s=session();s.edit('macro',[{field:'macros',value:[{events:[event()]},{events:[{...event(),code:5}]}]}]);
  s.edit(layer,[{slot:34,field:'binding',value:{type:'macro',index:0,mode:0,repeat:1}}]);
  const before=s.draft,diff=s.diff(),macros=api.decodeMacros(before.macro,cap);
  assert.throws(()=>s.transaction({macro:[{field:'macros',value:macros},{field:'macros',value:[macros[1]]}]}),/duplicate|reference/i);
  assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);assert.equal(api.decodeMacros(s.draft.macro,cap)[0].events[0].code,4);
 }
});
