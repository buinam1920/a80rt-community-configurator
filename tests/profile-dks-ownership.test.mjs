import assert from 'node:assert/strict';
import {test} from 'node:test';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {createProfile,previewProfile,loadProfile} from '../dist/config/profiles.js';
import {patchPattern,decodePattern} from '../dist/config/advanced.js';
const cap=identifyDevice({vendorId:0xc45,productId:0x80a1,productName:'A80RT U'});
const first={thresholds:[10,20,20,10],keys:[4,5,6,7],actions:[1,2,4,8]};
const second={thresholds:[5,15,15,5],keys:[8,9,10,11],actions:[1,2,4,8]};
function session(references,pattern=first){
 const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
 for(const slot of cap.slots)blocks.rt.set([1,0,100,0,20,0,20,0],slot*8);
 blocks.lighting[9]=3;blocks.lighting[10]=3;blocks.dks=patchPattern(blocks.dks,1,pattern,cap);
 for(const [id,slot]of references)blocks[id].set([8,1,17,19],slot*4);
 return new ConfigSession({identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}},cap);
}
const protectedReferences=[...cap.limits.fnLockedSlots.map(slot=>['fn',slot]),['keymap',127],['fn',127]];
test('each locked Fn F1–F12 and nonphysical reference keeps its DKS template even when incoming binding matches',()=>{
 for(const ref of protectedReferences){
  const target=session([ref]),p=createProfile(session([ref],second),'Khóa');p.blocks.colors[137]=25;
  const before=target.draft;assert.ok(previewProfile(p,target).every(c=>c.block!=='dks'));loadProfile(p,target);
  assert.deepEqual(decodePattern(target.draft.dks,1),first);assert.deepEqual(target.draft.fn,before.fn);assert.deepEqual(target.draft.keymap,before.keymap);assert.equal(target.draft.colors[137],25);
 }
});
test('shared editable/protected templates reject a changed pattern with a clear reason and no partial edit',()=>{
 for(const ref of protectedReferences){
  const refs=[ref,['keymap',34],['fn',49]],target=session(refs),p=createProfile(session(refs,second),'Dùng chung');
  target.edit('colors',[{slot:49,field:'rgb',value:{red:7,green:8,blue:9}}]);p.blocks.colors[137]=25;
  const before=target.draft,diff=target.diff();
  for(const action of [previewProfile,loadProfile]){assert.throws(()=>action(p,target),/DKS.*1.*(khóa|giữ|locked|preserv)/i);assert.deepEqual(target.draft,before);assert.deepEqual(target.diff(),diff);}
 }
});
test('shared unchanged patterns allow unrelated imports; editable references may move to a separate template',()=>{
 const refs=[['fn',1],['keymap',34]],target=session(refs),p=createProfile(target,'Tách');p.blocks.colors[137]=25;
 loadProfile(p,target);assert.equal(target.draft.colors[137],25);assert.deepEqual(decodePattern(target.draft.dks,1),first);
 const desired=patchPattern(Uint8Array.from(p.blocks.dks),2,second,cap);p.blocks.dks=[...desired];p.blocks.keymap.splice(136,4,8,2,0,0);
 previewProfile(p,target);loadProfile(p,target);assert.deepEqual(decodePattern(target.draft.dks,1),first);assert.deepEqual(decodePattern(target.draft.dks,2),second);assert.deepEqual([...target.draft.fn.slice(4,8)],[8,1,17,19]);
});
test('editable base and Fn references import a changed shared template when no preserved position uses it',()=>{
 const refs=[['keymap',34],['fn',49]],target=session(refs),p=createProfile(session(refs,second),'Sửa');
 assert.ok(previewProfile(p,target).some(c=>c.block==='dks'));loadProfile(p,target);assert.deepEqual(decodePattern(target.draft.dks,1),second);
});
