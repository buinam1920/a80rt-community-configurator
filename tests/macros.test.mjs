import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {createProfile,previewProfile,loadProfile,restoreProfile} from '../dist/config/profiles.js';
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

const save=(s,count)=>s.edit('macro',[{field:'macros',value:[{...(api.decodeMacros(s.draft.macro,cap).length?{sourceIndex:0}:{}),events:Array.from({length:count},()=>event())}]}]);
test('incremental growth to 100 events fits just like a one-shot macro, then shrink and grow reuse space',()=>{
 const s=session();for(let count=1;count<=100;count++)assert.doesNotThrow(()=>save(s,count),`save ${count}`);
 assert.equal(api.decodeMacros(s.draft.macro,cap)[0].events.length,100);
 assert.equal(api.decodeMacros(api.patchMacros(new Uint8Array(1024),[{events:Array.from({length:100},()=>event())}],cap).bytes,cap)[0].events.length,100);
 save(s,1);save(s,100);assert.equal(api.decodeMacros(s.draft.macro,cap)[0].events.length,100);
});

test('local allocation ownership preserves captured opaque islands, reserved bytes and flags across relocations',()=>{
 const seed=session(),blocks=seed.draft;blocks.macro.set([144,1,0,0]);blocks.macro.set([2,0,77,88,0,0,4,177],400);blocks.macro[650]=219;blocks.macro[1000]=211;
 const s=new ConfigSession({...seed.snapshot,blocks},cap);
 for(let count=1;count<=45;count++)save(s,count);
 const raw=s.draft.macro,m=api.decodeMacros(raw,cap)[0];
 assert.equal(raw[402],77);assert.equal(raw[403],88);assert.equal(raw[407],177);assert.equal(raw[650],219);assert.equal(raw[1000],211);
 assert.deepEqual(m.reserved,[77,88]);assert.equal(m.events[0].flags,177);
 const before=s.draft,diff=s.diff();assert.throws(()=>save(s,156),/capacity|span/);assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);
 save(s,46);assert.equal(api.decodeMacros(s.draft.macro,cap)[0].events.length,46);
});

test('macro growth keeps other macros and bindings, and failed multi-group edits do not consume capacity',()=>{
 const s=session();s.edit('macro',[{field:'macros',value:[{events:[event()]},{events:[{...event(),code:5}]}]}]);
 s.edit('keymap',[{slot:34,field:'binding',value:{type:'macro',index:1,mode:1,repeat:3}}]);
 for(let count=2;count<=50;count++){
  const before=s.draft,diff=s.diff(),list=api.decodeMacros(before.macro,cap);list[0].events=Array.from({length:count},()=>event());
  assert.throws(()=>s.transaction({macro:[{field:'macros',value:list}],lighting:[{field:'brightness',value:255}]}),/brightness/);
  assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);
  s.edit('macro',[{field:'macros',value:list}]);assert.equal(api.decodeMacros(s.draft.macro,cap)[1].events[0].code,5);
  assert.deepEqual([...s.draft.keymap.slice(136,140)],[6,1,1,3]);
 }
 const before=s.draft;assert.throws(()=>s.edit('macro',[{field:'macros',value:[]}]),/reference/);assert.deepEqual(s.draft,before);
 s.transaction({macro:[{field:'macros',value:[]}],keymap:[{slot:34,field:'binding',value:{type:'empty'}}]});save(s,100);
 assert.equal(api.decodeMacros(s.draft.macro,cap)[0].events.length,100);
});

test('profile preview and load reuse local ownership, stay atomic, and revert/restore start at their own baselines',()=>{
 const s=session();for(let count=1;count<=16;count++)save(s,count);
 const incoming=session();save(incoming,100);const p=createProfile(incoming,'Dài hơn'),before=s.draft,diff=s.diff();
 const preview=previewProfile(p,s);assert.ok(preview.some(c=>c.block==='macro'));assert.deepEqual(previewProfile(p,s),preview);assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);
 loadProfile(p,s);assert.equal(api.decodeMacros(s.draft.macro,cap)[0].events.length,100);
 s.revert();assert.equal(api.decodeMacros(s.draft.macro,cap).length,0);save(s,100);
 const restored=restoreProfile(createProfile(s,'Mở lại'));save(restored,101);assert.equal(api.decodeMacros(restored.draft.macro,cap)[0].events.length,101);
});

test('growing a captured macro can change known action/device flag bits in place while retaining opaque bits',()=>{
 for(const device of ['keyboard','mouse']){
  const seed=session(),blocks=seed.draft;blocks.macro.fill(0xcc,400);blocks.macro.set([144,1,0,0]);blocks.macro.set([2,0,77,88,0,0,4,177,0,0,0,0],400);
  const s=new ConfigSession({...seed.snapshot,blocks},cap),list=api.decodeMacros(s.draft.macro,cap);
  list[0].events[0].action='up';list[0].events[0].device=device;list[0].events.push(event());
  s.edit('macro',[{field:'macros',value:list}]);
  assert.deepEqual([...s.draft.macro.slice(402,404)],[77,88]);assert.equal(s.draft.macro[407],device==='keyboard'?49:17);assert.equal(s.draft.macro[412],0xcc);
  assert.equal(api.decodeMacros(s.draft.macro,cap)[0].events.length,2);
 }
});

test('alternating growth reclaims retired local allocations instead of promoting their flags to opaque data',()=>{
 const s=session();s.edit('macro',[{field:'macros',value:[{events:Array.from({length:50},()=>event())},{events:Array.from({length:50},()=>({...event(),code:5}))}]}]);
 const pointers=new Set();
 for(let count=51;count<=60;count++)for(const index of [0,1]){
  const list=api.decodeMacros(s.draft.macro,cap);list[index].events=Array.from({length:count},()=>({...event(),code:index?5:4}));
  s.edit('macro',[{field:'macros',value:list}]);pointers.add(api.decodeMacros(s.draft.macro,cap)[0].pointer);
 }
 assert.ok(pointers.size>1,'the regression must exercise retirement/relocation, not just extension');
 assert.deepEqual(api.decodeMacros(s.draft.macro,cap).map(m=>[m.events.length,m.events[0].code]),[[60,4],[60,5]]);
});

test('compaction keeps captured metadata anchors so incremental peers fit the same exact span as one-shot creation',()=>{
 const seed=session(),blocks=seed.draft;blocks.macro.set([144,1,0,0]);blocks.macro.set([2,0,77,88,0,0,4,177],400);
 const raw=blocks.macro.slice(),s=new ConfigSession({...seed.snapshot,blocks},cap),events=count=>Array.from({length:count},()=>event());
 s.edit('macro',[{field:'macros',value:[api.decodeMacros(raw,cap)[0],{events:events(50)},{events:events(50)}]}]);
 for(const index of [1,2]){const list=api.decodeMacros(s.draft.macro,cap);list[index].events=events(76);s.edit('macro',[{field:'macros',value:list}]);}
 assert.deepEqual(api.decodeMacros(s.draft.macro,cap).map(m=>[m.pointer,m.events.length]),[[400,1],[408,76],[716,76]]);
 const control=api.patchMacros(raw,[api.decodeMacros(raw,cap)[0],{events:events(76)},{events:events(76)}],cap).bytes;
 assert.deepEqual(s.draft.macro,control);assert.deepEqual([...s.draft.macro.slice(402,404)],[77,88]);assert.equal(s.draft.macro[407],177);
});
