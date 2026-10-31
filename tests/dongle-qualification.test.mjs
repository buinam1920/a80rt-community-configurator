import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {A80Transport,ConfigSession,readSnapshot} from '../dist/protocol.js';
import {identifyDevice} from '../dist/device/capabilities.js';
import {presetEdits} from '../dist/config/presets.js';

const measured=JSON.parse(fs.readFileSync(new URL('./fixtures/a80rt-dongle-write-qualification.json',import.meta.url)));
const synthetic=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic/config-blocks.json',import.meta.url)));
const cap=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
const measuredAck=new Map(measured.cases.flatMap(c=>c.ackHeaders).map(h=>[`${h[1]}:${h[3]|h[4]<<8}:${h[2]}:${h[6]}`,h]));

// Synthetic receiver, NOT another hardware capture. Device-info prefix and write
// ACK headers come from the 2026-10-31 native measurement; payload is synthetic.
class Receiver extends EventTarget {
  vendorId=0x0c45;productId=0xfefc;productName='A80RT U Dongle';opened=false;sent=[];
  collections=[{usagePage:0xff80,usage:1,inputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}],outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}];
  blocks=Object.fromEntries(Object.entries(synthetic.blocks).map(([id,bytes])=>[id,Uint8Array.from(bytes)]));
  constructor(){super();this.blocks.device.set(measured.deviceInfoPrefix.payload0to10,0);}
  async open(){this.opened=true;} async close(){this.opened=false;}
  emit(bytes){const event=new Event('inputreport');event.reportId=0;event.data=new DataView(bytes.buffer);this.dispatchEvent(event);}
  async sendReport(reportId,packet){
    assert.equal(reportId,0);assert.equal(packet.length,32);this.sent.push(packet.slice());
    const command=packet[1],offset=packet[3]|packet[4]<<8,count=packet[2];
    const reply=new Uint8Array(this.replyLength??32);reply.set([0x55,command,count,packet[3],packet[4],0,packet[6],0]);
    const block=Object.entries(cap.blocks).find(([,block])=>block.command===command||block.writeCommand===command);
    if(command>=0x10&&command<=0x18)reply.set(this.blocks[block[0]].slice(offset,offset+count),8);
    else{if(command!==0)this.blocks[block[0]].set(packet.slice(8,8+count),offset);reply.fill(0xe3,8);}
    queueMicrotask(()=>this.emit(reply));
  }
}
async function setup(alter){const device=new Receiver();alter?.(device);const transport=new A80Transport(device,{timeoutMs:15});await transport.open();return {device,transport};}

test('measured receiver ACK headers match the wired shape in 32-byte reports',()=>{
  for(const c of measured.cases){assert.equal(c.testReadbackMatches,true);assert.equal(c.restored,true);assert.equal(c.finalBlockMatchesOriginal,true);
    for(const h of c.ackHeaders){assert.equal(h[0],0x55);assert.equal(h[5],0);assert.equal(h[7],0);assert.ok([0,0x21,0x27].includes(h[1]));}}
  assert.deepEqual(measured.deviceInfoPrefix.payload0to10.slice(4,10),[0x45,0x0c,0xa1,0x80,55,1]);
});

test('a fresh info read through the receiver qualifies only RT, settings and control',async()=>{
  const {transport}=await setup();
  try{
    assert.equal(transport.getWriteState().qualified,false,'no attestation before reading');
    await transport.readBlock(0x10,32);
    assert.equal(transport.getWriteState().ready,true);
    for(const command of [0x27,0x21,0])assert.equal(transport.getWriteState(command).ready,true,`command ${command}`);
    for(const command of [0x22,0x23,0x24,0x25,0x26,0x28]){const state=transport.getWriteState(command);assert.equal(state.ready,false,`command ${command}`);assert.match(state.reason,/cáp USB|Fn|Unknown/);}
  }finally{await transport.close();}
});

test('wrong firmware, wrong inner keyboard, wrong report size or interface never qualify the receiver',async()=>{
  const cases=[d=>d.blocks.device[8]=54,d=>d.blocks.device[6]=0xa2,d=>{d.productName='A80RT U';},d=>d.collections[0].usagePage=0xff68,d=>d.collections[0].inputReports[0].items[0].reportCount=64];
  for(const alter of cases){
    const {device,transport}=await setup(alter);
    try{await transport.readBlock(0x10,32).catch(()=>{});assert.equal(transport.getWriteState(0x27).ready,false);device.sent=[];await assert.rejects(transport.writeBlock(0x27,device.blocks.rt));assert.equal(device.sent.length,0);}
    finally{await transport.close();}
  }
});

test('a 64-byte ACK through the receiver is rejected without retry',async()=>{
  const {device,transport}=await setup();
  try{await transport.readBlock(0x10,32);device.replyLength=64;device.sent=[];
    await assert.rejects(transport.writeBlock(0x27,device.blocks.rt),/report length/);assert.equal(device.sent.length,1);}
  finally{await transport.close();}
});

test('Apex and Office presets apply over the receiver with the measured chunking and verified readback',async()=>{
  const {device,transport}=await setup();
  try{
    for(const id of ['macro','dks','keymap','fn'])device.blocks[id].fill(0);
    for(const slot of cap.slots)device.blocks.rt.set([0,0,0,0,0,0,0,0],slot*8);
    const session=new ConfigSession(await readSnapshot(transport,cap),cap);
    session.transaction(presetEdits(cap,'apex'));device.sent=[];
    const result=await session.apply(transport);assert.equal(result.status,'verified',result.error);
    assert.deepEqual(result.writtenBlocks,['rt']);
    const writes=device.sent.filter(p=>p[1]===0x27);assert.equal(writes.length,Math.ceil(1024/24));
    for(const p of writes){const key=`${p[1]}:${p[3]|p[4]<<8}:${p[2]}:${p[6]}`;assert.ok(measuredAck.has(key),`chunk ${key} was measured on hardware`);}
    assert.deepEqual(device.blocks.rt.slice(34*8,34*8+8),Uint8Array.of(0,1,40,0,15,0,15,0));
    session.transaction(presetEdits(cap,'office'));
    const office=await session.apply(transport);assert.equal(office.status,'verified',office.error);assert.deepEqual(office.writtenBlocks.sort(),['rt','settings']);
    assert.deepEqual([device.blocks.settings[8],device.blocks.settings[9]],[0,0]);
  }finally{await transport.close();}
});

test('a draft touching unmeasured groups is blocked before any byte is sent over the receiver',async()=>{
  const {device,transport}=await setup();
  try{
    for(const slot of cap.slots)device.blocks.rt.set([0,0,0,0,0,0,0,0],slot*8);
    const session=new ConfigSession(await readSnapshot(transport,cap),cap);
    session.transaction({...presetEdits(cap,'game'),colors:[{slot:34,field:'rgb',value:{red:1,green:2,blue:3}}]});device.sent=[];
    const result=await session.apply(transport);assert.equal(result.status,'failed');assert.match(result.error,/cáp USB/);assert.equal(device.sent.length,0);
  }finally{await transport.close();}
});
