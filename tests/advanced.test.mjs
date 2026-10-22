import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
const api=await import('../dist/config/advanced.js').catch(()=>({}));
const cap=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
const blocks=()=>Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
const pattern={thresholds:[16,30,30,16],keys:[4,5,6,7],actions:[1,32,4,8]};
test('RS and SOCD assign paired HID usages to physical slots and reject duplicate positions',()=>{
 assert.equal(typeof api.patchAdvanced,'function','advanced API required');const raw=blocks();
 const result=api.patchAdvanced(raw,{type:'rs',slots:[34,49],layer:'base'},cap);
 assert.deepEqual(Array.from(result.blocks.keymap.slice(136,140)),[12,0,26,4]);assert.deepEqual(result.blocks.keymap.slice(136,140),result.blocks.keymap.slice(196,200));
 for(const type of ['rs','socd'])assert.throws(()=>api.patchAdvanced(raw,{type,slots:[34,34],mode:3},cap),/distinct/);
 const socd=api.patchAdvanced(raw,{type:'socd',slots:[34,49],mode:3},cap);assert.deepEqual(Array.from(socd.blocks.keymap.slice(136,140)),[11,3,26,4]);
 assert.throws(()=>api.patchAdvanced(raw,{type:'rs',slots:[1,34],layer:'fn'},cap),/Fn/);assert.deepEqual(raw,blocks());
});
test('DKS source slot1 allocation preserves reserved bytes and enforces travel, paired order and action limits',()=>{
 assert.equal(typeof api.patchAdvanced,'function');const raw=blocks();raw.rt[34*8]=1;raw.dks[20]=99;raw.dks[22]=88;
 const result=api.patchAdvanced(raw,{type:'dks',slots:[34],index:1,pattern},cap);
 assert.deepEqual(Array.from(result.blocks.keymap.slice(136,140)),[8,1,0,0]);assert.deepEqual(Array.from(result.blocks.dks.slice(16,32)),[16,30,30,16,99,4,88,5,0,6,0,7,1,32,4,8]);
 for(const invalid of [{thresholds:[30,16,16,30]},{thresholds:[16,35,35,16]},{thresholds:[16,30,29,16]},{actions:[1,0,0,128]}])assert.throws(()=>api.patchAdvanced(raw,{type:'dks',slots:[34],index:1,pattern:{...pattern,...invalid}},cap),/DKS|threshold|action/);
 assert.throws(()=>api.patchAdvanced(raw,{type:'dks',slots:[34],index:64,pattern},cap),/index/);
});
test('MT and TGL use source encodings and preserve unowned bytes',()=>{
 assert.equal(typeof api.patchAdvanced,'function');const raw=blocks();raw.keymap.set([2,0,26,203],136);
 const mt=api.patchAdvanced(raw,{type:'mt',slots:[34],tap:4,hold:225,timeMs:400},cap);assert.deepEqual(Array.from(mt.blocks.keymap.slice(136,140)),[9,4,225,40]);
 const tgl=api.patchAdvanced(raw,{type:'tgl',slots:[34],key:4},cap);assert.deepEqual(Array.from(tgl.blocks.keymap.slice(136,140)),[10,4,26,203]);
 assert.throws(()=>api.patchAdvanced(raw,{type:'mt',slots:[34],tap:4,hold:225,timeMs:1001},cap),/time/);
});
test('reference validator detects dangling macros and DKS across base/Fn, and broken paired relationships',()=>{
 assert.equal(typeof api.validateReferences,'function');const raw=blocks();raw.fn.set([6,0,0,1],136);raw.keymap.set([8,64,0,0],196);
 const errors=api.validateReferences(raw,[],cap);assert.equal(errors.length,2);assert.match(errors.join(' '),/fn.*macro/);assert.match(errors.join(' '),/keymap.*DKS/);
 const pair=api.patchAdvanced(blocks(),{type:'rs',slots:[34,49]},cap).blocks;pair.keymap.fill(0,196,200);assert.match(api.validateReferences(pair,[],cap).join(' '),/pair/);
});

test('DKS pattern edits and advanced deletion share one session and reject partial relationship changes',async()=>{
 const {ConfigSession}=await import('../dist/config/session.js');const raw=blocks();raw.rt[34*8]=1;
 const s=new ConfigSession({identity:cap.identity,blocks:raw,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}]))},cap);
 assert.equal(typeof s.advanced,'function');s.advanced({type:'dks',slots:[34],index:1,pattern});assert.equal(s.diff().find(c=>c.block==='dks').path,'records[1].pattern');
 const before=s.draft;assert.throws(()=>s.transaction({keymap:[{slot:49,field:'binding',value:{type:'tgl',key:4}}],dks:[{slot:64,field:'pattern',value:pattern}]}),/index/);assert.deepEqual(s.draft,before);
 s.advanced({type:'rs',slots:[34,49]});assert.throws(()=>s.edit('keymap',[{slot:34,field:'binding',value:{type:'empty'}}]),/pair/);
 s.transaction({keymap:[34,49].map(slot=>({slot,field:'binding',value:{type:'empty'}}))});assert.equal(s.draft.keymap[136],0);
});

test('a new DKS assignment cannot overwrite a pattern used by another base/Fn key',()=>{
 const raw=blocks();raw.rt[34*8]=raw.rt[49*8]=1;
 const first=api.patchAdvanced(raw,{type:'dks',slots:[34],index:1,pattern},cap).blocks;
 assert.throws(()=>api.patchAdvanced(first,{type:'dks',slots:[49],layer:'fn',index:1,pattern:{...pattern,keys:[5,6,7,8]}},cap),/DKS.*used|reference/);
});
