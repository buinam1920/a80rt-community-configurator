import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice, readPlan} from '../dist/device/capabilities.js';
const descriptor=(productId=0xfefc,productName='A80RT U Dongle')=>({vendorId:0x0c45,productId,productName});

test('identifies exact A80RT names plus VID/PID, never a shared PID alone',()=>{
  const cap=identifyDevice(descriptor());
  assert.equal(cap.model,'a80rt-u-dongle');
  assert.equal(cap.settings.polling,false);
  assert.equal(cap.settings.sleep,true);
  assert.deepEqual(cap.advanced,['rs','socd','dks','mt','tgl']);
  assert.equal(identifyDevice(descriptor(0x80a1,'A80RT U')).settings.polling,true);
  assert.equal(identifyDevice(descriptor(0x80a2,'A80RT')).model,'a80rt');
  for(const d of [descriptor(0x80a1,'OTHER'),descriptor(0xfefc,'A80RT'),descriptor(0x80a2,'A80RT U'),{...descriptor(),vendorId:0}]){
    assert.throws(()=>identifyDevice(d),/identity/);
  }
});

test('readPlan covers every source-requested A80RT block; macro span is not capacity',()=>{
  const cap=identifyDevice(descriptor());
  assert.deepEqual(readPlan(cap),[
    {id:'device',command:16,length:32},{id:'settings',command:17,length:32},
    {id:'keymap',command:18,length:512},{id:'lighting',command:19,length:16},
    {id:'colors',command:20,length:512},{id:'macro',command:21,length:1024},
    {id:'fn',command:22,length:512},{id:'rt',command:23,length:1024},
    {id:'dks',command:24,length:1024},
  ]);
  assert.equal(cap.limits.macroReadSpan,1024);
  assert.equal(cap.limits.macroPhysicalCapacity,null);
  assert.equal(cap.hardwareQualified,false);
  assert.equal(cap.limits.writeAckShape,null);
  assert.ok(Object.isFrozen(cap.settings));
  assert.ok(Object.isFrozen(cap.blocks.rt));
  const plan=readPlan(cap);plan[0].length=1;
  assert.equal(readPlan(cap)[0].length,32);
  assert.throws(()=>readPlan(JSON.parse(JSON.stringify(cap))),/Capability/);
});
