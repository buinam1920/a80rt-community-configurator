import test from 'node:test';
import assert from 'node:assert/strict';
import {A80Reader,READ_BLOCKS,DEVICE_FILTERS,describeDevice,buildReadPacket,parseReply,decodeKey,selectInterface} from '../dist/protocol.js';
import {KEYS} from '../dist/layout.js';

class Device extends EventTarget {
  vendorId=0x0c45;productId=0x80a2;productName='A80RT';opened=false;sent=[];badLength=false;noReply=false;
  collections=[{usagePage:0xff68,usage:0x61,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}];
  async open(){this.opened=true;}
  async close(){this.opened=false;}
  emit(bytes){const event=new Event('inputreport');event.reportId=0;event.data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.dispatchEvent(event);}
  async sendReport(id,packet){
    this.sent.push(Array.from(packet));
    assert.equal(id,0);
    assert.equal(packet[0],0xaa);
    assert.ok(packet.slice(8).every(b=>b===0),'read request payload must stay zero');
    assert.ok(READ_BLOCKS.some(b=>b.command===packet[1]),'never send write/save/reset opcodes');
    if(this.noReply)return;
    const offset=packet[3]|(packet[4]<<8),length=packet[2];
    // Response is held in a larger buffer to exercise DataView byteOffset handling.
    const backing=new Uint8Array(40),reply=backing.subarray(4,36);
    reply.set([0x55,packet[1],this.badLength?length-1:length,packet[3],packet[4],0,0,0]);
    for(let i=0;i<length;i++)reply[8+i]=(offset+i+packet[1])%256;
    queueMicrotask(()=>{
      const unrelated=reply.slice();unrelated[1]=0x37;this.emit(unrelated);
      if(offset>0){const stale=reply.slice();stale[3]=0;stale[4]=0;this.emit(stale);}
      this.emit(reply);
    });
  }
}
test('82 physical positions are unique and fit both backing tables',()=>{
  assert.equal(KEYS.length,82);assert.equal(new Set(KEYS.map(k=>k.slot)).size,82);
  assert.ok(KEYS.every(k=>k.slot*8+8<=1024&&k.slot*4+4<=512));
  assert.equal(KEYS.find(k=>k.label==='W').slot,34);
  assert.equal(KEYS.find(k=>k.label==='Backspace').slot,92);
});
test('reader reassembles all six blocks, ignoring unsolicited and stale responses',async()=>{
  const device=new Device(),reader=new A80Reader(device,{timeout:100});await reader.open();
  const progress=[];const data=await reader.readAll(p=>progress.push(p));
  for(const block of READ_BLOCKS){assert.equal(data[block.id].length,block.length);for(let i=0;i<block.length;i++)assert.equal(data[block.id][i],(i+block.command)%256);}
  assert.equal(progress.at(-1).completed,2128);assert.equal(progress.at(-1).completed,progress.at(-1).total);
  for(const block of READ_BLOCKS){const packets=device.sent.filter(p=>p[1]===block.command);assert.equal(packets.at(-1)[6],1);assert.ok(packets.slice(0,-1).every(p=>p[6]===0));}
  await reader.close();assert.equal(device.opened,false);
});
test('64 byte reports also reconstruct the non-contiguous key slots',async()=>{
  const device=new Device();device.collections[0].outputReports[0].items[0].reportCount=64;
  // Fake transport response also needs its 64-byte descriptor length.
  device.sendReport=async function(id,packet){this.sent.push(Array.from(packet));const reply=packet.slice();reply[0]=0x55;for(let i=0;i<packet[2];i++)reply[8+i]=((packet[3]|packet[4]<<8)+i)%256;queueMicrotask(()=>this.emit(reply));};
  const reader=new A80Reader(device,{timeout:100});await reader.open();const data=await reader.readAll();assert.equal(data.rt[865],97);assert.equal(data.rt.length,1024);await reader.close();
});
test('truncated replies fail without filling the snapshot with invented zeros',async()=>{
  const device=new Device();device.badLength=true;const reader=new A80Reader(device,{timeout:100});await reader.open();
  const blocks=[];await assert.rejects(reader.readAll(()=>{},id=>blocks.push(id)),/thiếu dữ liệu/);
  assert.equal(blocks.length,0);assert.equal(reader.active,false);assert.equal(device.sent.length,1);await reader.close();
});
test('cancellation halts the transfer and permits a subsequent read',async()=>{
  const device=new Device();device.noReply=true;const reader=new A80Reader(device,{timeout:500});await reader.open();
  const result=reader.readAll();reader.cancel();await assert.rejects(result,{name:'AbortError'});
  const count=device.sent.length;await new Promise(r=>setTimeout(r,10));assert.equal(device.sent.length,count);
  device.noReply=false;const data=await reader.readAll();assert.equal(data.keymap.length,512);await reader.close();
});
test('missing device responses time out and concurrent reads cannot overlap',async()=>{
  const device=new Device();device.noReply=true;const reader=new A80Reader(device,{timeout:15});await reader.open();
  const first=reader.readAll();await assert.rejects(reader.readAll(),/đang chạy/);await assert.rejects(first,/chưa trả lời/);assert.equal(reader.active,false);await reader.close();
});
test('write/reset opcodes and ambiguous hardware are rejected',()=>{
  for(const command of [0,0x0f,0x21,0x22,0x27,0x28,0x41,0x50])assert.throws(()=>buildReadPacket(command,0,24,32),/Chỉ cho phép/);
  const device=new Device();device.productName='Other HE keyboard';assert.throws(()=>selectInterface(device),/chưa được xác định/);
  device.productName='A80RT';device.collections[0].outputReports[0].reportId=1;assert.throws(()=>selectInterface(device),/Không thấy giao diện/);
});
test('decoding preserves zero sentinels, original mapping bytes, and RT flags',()=>{
  const rt=Array(1024).fill(0),keymap=Array(512).fill(0);rt.splice(34*8,8,1,6,80,0,20,0,35,0);keymap.splice(34*4,4,26,0,0,1);
  const decoded=decodeKey({rt,keymap},34);assert.equal(decoded.rt.actuationMm,.8);assert.equal(decoded.rt.flags,6);assert.equal(decoded.rt.releaseRaw,35);assert.deepEqual(decoded.keymap,[26,0,0,1]);
  assert.equal(decodeKey({rt},0).rt.actuationMm,null);assert.equal(decodeKey({},34).rt,null);
});
test('unrelated frames are not accepted as successful reads',()=>{
  assert.equal(parseReply(new Uint8Array([0x55,0x37,0,0,0,0,0,0]),0x10,0,24),null);
  assert.equal(parseReply(new Uint8Array([0xaa,0x10,0,0,0,0,0,0]),0x10,0,24),null);
});
test('device picker includes the exact A80RT U receiver collection',()=>{
  const matches=(device,usagePage,usage)=>DEVICE_FILTERS.some(f=>f.vendorId===device.vendorId&&f.productId===device.productId&&f.usagePage===usagePage&&f.usage===usage);
  const receiver={vendorId:0x0c45,productId:0xfefc};
  assert.equal(matches(receiver,0xff80,1),true,'wireless receiver must be offered by the picker');
  assert.equal(matches(receiver,1,6),false,'standard keyboard input is not a configuration interface');
  assert.equal(matches({vendorId:0x0c45,productId:0x80a2},0xff68,0x61),true);
  assert.equal(matches({vendorId:0x0c45,productId:0x80a1},0xff68,0x61),true);
  assert.equal(matches({vendorId:0x0c45,productId:0xfefe},0xff80,1),false,'a receiver for another model must not match');
});
test('A80RT U Dongle opens and reads all blocks over its separate 2.4 GHz collection',async()=>{
  const device=new Device();device.productId=0xfefc;device.productName='A80RT U Dongle';device.collections[0].usagePage=0xff80;device.collections[0].usage=1;
  const reader=new A80Reader(device,{timeout:100});assert.equal(reader.interface.usagePage,0xff80);
  await reader.open();const data=await reader.readAll();assert.equal(data.rt.length,1024);assert.equal(data.keymap[511],(511+0x12)%256);
  const description=describeDevice(device);assert.equal(description.transport,'Đầu thu 2.4 GHz');assert.equal(description.collections[0].outputReports[0].bytes,32);
  await reader.close();
});
test('receiver interfaces nested inside a vendor collection are discoverable',()=>{
  const device=new Device();device.productId=0xfefc;device.productName='A80RT U Dongle';
  const child={...device.collections[0],usagePage:0xff80,usage:1};device.collections=[{usagePage:0xffff,usage:1,children:[child]}];
  assert.equal(selectInterface(device).usagePage,0xff80);assert.equal(describeDevice(device).collections[0].children[0].outputReports[0].bytes,32);
});
