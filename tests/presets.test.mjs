import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {decodeBlock} from '../dist/config/codecs.js';
import {RT_PRESETS,presetEdits,matchingPreset} from '../dist/config/presets.js';

const cap=identifyDevice({vendorId:0xc45,productId:0x80a1,productName:'A80RT U'});
function session(){
  const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
  // raw0 actuation, switch ID 1, bottom+rtMode bits set to prove they are preserved.
  for(const slot of cap.slots)blocks.rt.set([1,6,0,0,0,0,0,0],slot*8);
  blocks.settings[8]=7;blocks.settings[9]=9;blocks.lighting[9]=3;blocks.lighting[10]=3;
  return new ConfigSession({identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}},cap);
}
const rt=s=>decodeBlock('rt',s.draft.rt,cap).records,settings=s=>decodeBlock('settings',s.draft.settings,cap).fields;

test('vendor getDefault values map to the exact millimetre targets',()=>{
  const s=session();s.transaction(presetEdits(cap,'game'));const r=rt(s);
  assert.deepEqual([r[34].actuationMm,r[34].pressMm,r[34].releaseMm,r[34].whole],[0.5,0.16,0.16,true]);
  assert.deepEqual([r[80].actuationMm,r[80].pressMm,r[80].whole],[0.5,0.16,true]);
  assert.deepEqual([r[83].actuationMm,r[83].pressMm,r[83].whole],[3,0,false]);
  assert.deepEqual([r[52].actuationMm,r[52].pressMm,r[52].releaseMm,r[52].whole],[1.5,0,0,false]);
  assert.equal(matchingPreset(cap,s.draft),'game');
  s.transaction(presetEdits(cap,'beginner'));const b=rt(s);
  assert.deepEqual([b[49].actuationMm,b[49].pressMm,b[49].releaseMm,b[49].whole],[1,0.56,0.56,false]);
  assert.equal(b[0].actuationMm,1.5);assert.equal(matchingPreset(cap,s.draft),'beginner');
});
test('only office resets dead zones; the others leave settings alone',()=>{
  const s=session();s.transaction(presetEdits(cap,'game'));assert.deepEqual([settings(s).topDeadZone,settings(s).bottomDeadZone],[7,9]);
  assert.equal(presetEdits(cap,'beginner').settings,undefined);
  s.transaction(presetEdits(cap,'office'));assert.deepEqual([settings(s).topDeadZone,settings(s).bottomDeadZone],[0,0]);
  assert.ok(cap.slots.map(slot=>rt(s)[slot]).every(r=>r.slot===83?r.actuationMm===3:r.actuationMm===2));assert.equal(matchingPreset(cap,s.draft),'office');
});
test('presets keep switch IDs, bottom/rtMode bits, Fn and keymap untouched and stay in the draft only',()=>{
  const s=session(),before=s.draft;s.transaction(presetEdits(cap,'game'));
  for(const record of cap.slots.map(slot=>rt(s)[slot])){assert.equal(record.switchId,1);assert.equal(record.bottom,true);assert.equal(record.rtMode,true);}
  assert.deepEqual(s.draft.fn,before.fn);assert.deepEqual(s.draft.keymap,before.keymap);assert.deepEqual(s.snapshot.blocks.rt,before.rt);
  s.revert();assert.equal(matchingPreset(cap,s.draft),null);
});
test('a failing preset is atomic and unknown ids are rejected',()=>{
  const s=session(),blocks=s.draft;blocks.rt[34*8]=9;// unknown switch: travel unproven
  const odd=new ConfigSession({identity:cap.identity,blocks,coverage:s.snapshot.coverage,provenance:{source:'sample'}},cap);
  assert.throws(()=>odd.transaction(presetEdits(cap,'game')));assert.equal(odd.diff().length,0);
  assert.throws(()=>presetEdits(cap,'nope'),/không tồn tại/);
  assert.deepEqual(RT_PRESETS.map(p=>p.id),['office','beginner','game','lol','apex']);
});
test('vendor default actuation for raw0 display is 1.2 mm on every A80RT model',()=>{
  for(const [productId,productName]of [[0x80a1,'A80RT U'],[0x80a2,'A80RT'],[0xfefc,'A80RT U Dongle']])assert.equal(identifyDevice({vendorId:0xc45,productId,productName}).limits.vendorDefaultActuationMm,1.2);
});
test('LoL and Apex profiles target real physical keys with the documented values',()=>{
  for(const preset of RT_PRESETS)for(const entry of preset.keys){assert.ok(cap.slots.includes(entry.slot),`${preset.id} slot ${entry.slot}`);assert.ok(entry.actuationMm>=0.01&&entry.actuationMm<=3.3);}
  const s=session();s.transaction(presetEdits(cap,'apex'));let r=rt(s);
  assert.deepEqual([r[34].actuationMm,r[34].pressMm,r[34].releaseMm,r[34].whole],[0.4,0.15,0.15,true]);
  assert.deepEqual([r[80].actuationMm,r[80].pressMm,r[67].actuationMm,r[83].actuationMm,r[64].actuationMm,r[35].actuationMm,r[52].actuationMm],[0.6,0.2,0.6,0.8,0.8,1.2,1.5]);
  assert.equal(matchingPreset(cap,s.draft),'apex');
  s.transaction(presetEdits(cap,'lol'));r=rt(s);
  assert.deepEqual([r[33].actuationMm,r[52].actuationMm,r[17].actuationMm,r[83].actuationMm,r[49].actuationMm],[1,1,1.4,1.8,1.5]);
  assert.ok(cap.slots.every(slot=>r[slot].pressMm===0&&r[slot].releaseMm===0&&r[slot].whole===false));
  assert.equal(matchingPreset(cap,s.draft),'lol');
  assert.deepEqual(RT_PRESETS.filter(p=>p.shortcut).map(p=>[p.id,p.shortcut]),[['lol','Ctrl+Alt+1'],['apex','Ctrl+Alt+2']]);
});
