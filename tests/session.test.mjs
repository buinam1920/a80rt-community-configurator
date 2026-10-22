import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as protocol from '../dist/protocol.js';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';

// Synthetic boundary fixture only: this ACK shape is NOT manufacturer/hardware evidence.
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic/config-blocks.json',import.meta.url)));
const linkLoss=JSON.parse(fs.readFileSync(new URL('./fixtures/a80rt-link-loss-header.json',import.meta.url)));
const capability=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
const copyBlocks=()=>Object.fromEntries(Object.entries(data.blocks).map(([id,bytes])=>[id,Uint8Array.from(bytes)]));
const blockByRead=new Map(readPlan(capability).map(block=>[block.command,block]));
const blockByWrite=new Map(Object.entries(capability.blocks).filter(([,b])=>b.writeCommand).map(([id,b])=>[b.writeCommand,{id,...b}]));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Receiver extends EventTarget {
  vendorId=0x0c45;productId=0xfefc;productName='A80RT U Dongle';opened=false;sent=[];blocks=copyBlocks();
  collections=[{usagePage:0xff80,usage:1,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}];
  async open(){this.opened=true;}
  async close(){this.opened=false;}
  emit(bytes){const event=new Event('inputreport');event.reportId=0;event.data=new DataView(bytes.buffer);this.dispatchEvent(event);}
  async sendReport(id,packet){
    assert.equal(id,0);this.sent.push(packet.slice());
    if(this.beforeSend)await this.beforeSend(packet);
    if(this.silent)return;
    const command=packet[1],offset=packet[3]|packet[4]<<8,count=packet[2];
    const reply=new Uint8Array(packet.length);reply.set([0x55,command,count,packet[3],packet[4],0,0,0]);
    if(blockByRead.has(command)){
      const block=this.blocks[blockByRead.get(command).id];reply.set(block.slice(offset,offset+count),8);
    }else if(blockByWrite.has(command)){
      this.blocks[blockByWrite.get(command).id].set(packet.slice(8,8+count),offset);
      // ACK has no write-payload echo; fill with unrelated bytes to catch echo assumptions.
      reply.fill(0xe3,8);
      if(this.badAck)reply[3]^=1;
    }else assert.equal(command,0,'only source post-write control allowed');
    queueMicrotask(()=>{this.alterReply?.(reply,packet);this.emit(reply);});
  }
}
class QualifiedSyntheticTransport extends protocol.A80Transport {
  _getWriteQualification(){return {
    evidence:'synthetic test fixture only',
    parseAck(bytes,{command,offset,length}){
      if(bytes.length<8||bytes[0]!==0x55||bytes[1]!==command)return null;
      if(bytes[2]!==length||(bytes[3]|bytes[4]<<8)!==offset)throw new Error('Synthetic ACK mismatch');
      return {acknowledged:true};
    },
  };}
}
function api(){
  assert.equal(typeof protocol.ConfigSession,'function','draft transactions must be exposed');
  assert.equal(typeof protocol.readSnapshot,'function','complete read provenance must be exposed');
  return protocol;
}
async function setup({qualified=true,packetSize=32,cleanAdvanced=false}={}){
  const {ConfigSession,readSnapshot}=api(),device=new Receiver();
  if(cleanAdvanced)for(const id of ['macro','dks','keymap','fn'])device.blocks[id].fill(0);
  device.collections[0].outputReports[0].items[0].reportCount=packetSize;
  const transport=new (qualified?QualifiedSyntheticTransport:protocol.A80Transport)(device,{timeoutMs:10});
  await transport.open();const snapshot=await readSnapshot(transport,capability);
  device.sent=[];return {device,transport,snapshot,session:new ConfigSession(snapshot,capability)};
}
const rgb={slot:34,field:'rgb',value:{red:27,green:83,blue:191}};

test('draft edits isolate caller bytes, snapshots and returned views; revert restores every original byte',async()=>{
  const {device,transport,snapshot,session}=await setup();
  try{
    const original=snapshot.blocks.colors.slice(),changes=session.edit('colors',[rgb]);
    const beforeConstruction=snapshot.blocks;beforeConstruction.colors.fill(0);
    const rebuilt=new protocol.ConfigSession(snapshot,capability);assert.deepEqual(rebuilt.snapshot.blocks.colors,original);
    assert.equal(changes[0].path,'records[34].rgb');assert.deepEqual(snapshot.blocks.colors,original);
    const view=session.draft;view.colors.fill(0);snapshot.blocks.colors.fill(0);
    assert.equal(session.draft.colors[137],27);assert.deepEqual(session.snapshot.blocks.colors,original);
    changes[0].after.red=255;assert.equal(session.diff()[0].after.red,27);
    session.edit('colors',[{...rgb,value:{red:original[137],green:original[138],blue:original[139]}}]);assert.deepEqual(session.diff(),[]);
    session.edit('colors',[rgb]);session.revert();assert.deepEqual(session.draft.colors,original);assert.deepEqual(session.diff(),[]);assert.equal(device.sent.length,0);
  }finally{await transport.close();}
});

test('snapshot requires all nine complete reads and records source coverage/session without writable aliases',async()=>{
  const {transport,snapshot,session}=await setup();
  try{
    assert.equal(Object.keys(snapshot.blocks).length,9);assert.equal(snapshot.provenance.source,'device');
    assert.equal(snapshot.provenance.sessionId,transport.getState().sessionId);
    assert.deepEqual(snapshot.coverage.colors,{complete:true,expectedBytes:512,receivedBytes:512});
    assert.throws(()=>{snapshot.coverage.colors.complete=false;},TypeError);
    assert.throws(()=>session.edit('unknown',[{field:'command',value:0x41}]),/unknown/i);
    assert.throws(()=>session.edit('device',[{field:'battery',value:2}]),/battery/);
  }finally{await transport.close();}
});

test('only changed blocks are written, source post-write control is framed once, semantic readback clears the draft',async()=>{
  const {device,transport,session}=await setup();const progress=[];
  try{
    const original=device.blocks.colors.slice();session.edit('colors',[rgb]);
    const result=await session.apply(transport,{onProgress:event=>progress.push(event)});
    assert.equal(result.status,'verified');assert.deepEqual(result.writtenBlocks,['colors']);
    assert.deepEqual(result.verifiedFields,[{block:'colors',path:'records[34].rgb'}]);
    const writes=device.sent.filter(packet=>packet[1]>=0x21&&packet[1]<=0x28);
    assert.equal(writes.length,22);assert.ok(writes.every(packet=>packet[1]===0x24));
    assert.deepEqual(Array.from(writes[0].slice(0,8)),[170,36,24,0,0,0,0,0]);
    assert.deepEqual(Array.from(writes.at(-1).slice(0,8)),[170,36,8,248,1,0,1,0]);
    assert.deepEqual(Array.from(device.sent.find(packet=>packet[1]===0).slice(0,12)),[170,0,24,0,0,0,1,0,0,0,0,0]);
    assert.ok(device.sent.filter(packet=>packet[1]>=0x10&&packet[1]<=0x18).every(packet=>packet[1]===0x14));
    assert.deepEqual(Array.from(device.blocks.colors.keys()).filter(i=>device.blocks.colors[i]!==original[i]),[137,138,139]);
    assert.deepEqual(session.diff(),[]);assert.equal(session.snapshot.blocks.colors[137],27);
    assert.ok(progress.some(event=>event.phase==='readback'));
  }finally{await transport.close();}
});

test('readback compares the complete changed RGB field, including a channel that did not change in the draft',async()=>{
  const {device,transport,session}=await setup();
  try{
    const red=device.blocks.colors[137];session.edit('colors',[{...rgb,value:{red,green:83,blue:191}}]);
    device.alterReply=(reply,packet)=>{if(packet[1]===0x14&&(packet[3]|packet[4]<<8)===120)reply[8+17]^=1;};
    const result=await session.apply(transport);assert.equal(result.status,'unconfirmed');assert.deepEqual(result.verifiedFields,[]);
    assert.equal(session.diff().length,1);assert.match(result.error,/read.back|đọc lại/i);
  }finally{await transport.close();}
});

test('readback ignores untouched fields and shared flag neighbors instead of comparing whole blocks',async()=>{
  const {device,transport,session}=await setup();
  try{
    session.edit('rt',[{slot:34,field:'whole',value:true}]);
    device.alterReply=(reply,packet)=>{if(packet[1]===0x17&&(packet[3]|packet[4]<<8)===264)reply[8+9]^=128;};
    assert.equal((await session.apply(transport)).status,'verified');
  }finally{await transport.close();}
});

test('unqualified real writer rejects before any output despite valid complete reads',async()=>{
  const {device,transport,session}=await setup({qualified:false});
  try{
    session.edit('colors',[rgb]);const result=await session.apply(transport);
    assert.equal(result.status,'failed');assert.match(result.error,/ACK|qualification/i);assert.equal(device.sent.length,0);
    await assert.rejects(transport.writeBlock(0x24,device.blocks.colors),/ACK|qualification/i);
    await assert.rejects(transport.sendControl(0,Uint8Array.of(0,0,0,0)),/ACK|qualification/i);
  }finally{await transport.close();}
});

test('wrong ACK cannot verify or retry an ambiguous write; progress records the partially sent block',async()=>{
  const {device,transport,session}=await setup();
  try{
    session.edit('colors',[rgb]);device.badAck=true;const result=await session.apply(transport);
    assert.equal(result.status,'unconfirmed');assert.deepEqual(result.writtenBlocks,[]);assert.deepEqual(result.attemptedBlocks,['colors']);
    assert.equal(result.partialBlock,'colors');assert.equal(device.sent.length,1);assert.equal(session.diff().length,1);
  }finally{await transport.close();}
});

test('disconnect after the first group retains acknowledged blocks and draft, then refuses stale reconnect provenance',async()=>{
  const {device,transport,session}=await setup();
  try{
    session.edit('settings',[{field:'sleep',value:9}]);session.edit('colors',[rgb]);
    device.beforeSend=async packet=>{if(packet[1]===0x24)await transport.close();};
    const result=await session.apply(transport);assert.equal(result.status,'unconfirmed');
    assert.deepEqual(result.writtenBlocks,['settings']);assert.equal(session.diff().length,2);
    device.beforeSend=null;await transport.open();device.sent=[];
    assert.equal((await session.apply(transport)).status,'failed');assert.equal(device.sent.length,0);
  }finally{await transport.close();}
});

test('apply overlap across sessions and edits during apply are blocked; cancellation preserves draft without more writes',async()=>{
  const {ConfigSession}=api(),{device,transport,snapshot,session}=await setup();
  try{
    session.edit('colors',[rgb]);const second=new ConfigSession(snapshot,capability);second.edit('colors',[rgb]);
    device.silent=true;const abort=new AbortController(),pending=session.apply(transport,{signal:abort.signal});await tick();
    await assert.rejects(session.apply(transport),/running|đang/i);await assert.rejects(second.apply(transport),/running|đang/i);
    await assert.rejects(protocol.readSnapshot(transport,capability),/running|đang/i);
    assert.throws(()=>session.edit('colors',[rgb]),/running|đang/i);assert.throws(()=>session.revert(),/running|đang/i);
    abort.abort();const result=await pending;assert.equal(result.status,'unconfirmed');assert.equal(device.sent.length,1);
    assert.equal(session.diff().length,1);await tick();assert.equal(device.sent.length,1);
  }finally{await transport.close();}
});

test('sample, import, incomplete coverage, unknown command metadata and identity mismatch never emit writes',async()=>{
  const {ConfigSession}=api(),{device,transport,snapshot}=await setup();
  try{
    for(const source of ['sample','import','device']){
      const imported={identity:snapshot.identity,blocks:snapshot.blocks,coverage:snapshot.coverage,provenance:{...snapshot.provenance,source}};
      const session=new ConfigSession(imported,capability);session.edit('colors',[rgb]);
      assert.equal((await session.apply(transport)).status,'failed');
    }
    const incomplete={identity:snapshot.identity,blocks:snapshot.blocks,coverage:{...snapshot.coverage,macro:{complete:false,expectedBytes:1024,receivedBytes:400}},provenance:snapshot.provenance};
    const missing=new ConfigSession(incomplete,capability);assert.throws(()=>missing.edit('colors',[rgb]),/coverage|complete/i);
    assert.throws(()=>new ConfigSession({...incomplete,identity:{...snapshot.identity,productId:0x80a2}},capability),/identity/i);
    assert.throws(()=>new ConfigSession({...incomplete,blocks:{...snapshot.blocks,evil:[0x41]}},capability),/unknown/i);
    const forgedCap={...capability,blocks:{...capability.blocks,colors:{command:0x41,length:512,writeCommand:0x41}}};
    assert.throws(()=>new ConfigSession(snapshot,forgedCap),/identifyDevice/);assert.equal(device.sent.length,0);
  }finally{await transport.close();}
});

test('writer rejects unknown opcodes, wrong lengths and control payloads before queueing',async()=>{
  const {device,transport}=await setup();
  try{
    for(const command of [0x20,0x29,0x41,0x50,0x10])await assert.rejects(transport.writeBlock(command,new Uint8Array(32)),/command|opcode/i);
    await assert.rejects(transport.writeBlock(0x24,new Uint8Array(511)),/length|complete/i);
    await assert.rejects(transport.sendControl(0x41,Uint8Array.of(0,0,0,0)),/command|opcode/i);
    await assert.rejects(transport.sendControl(0,Uint8Array.of(1,0,0,0)),/payload/i);assert.equal(device.sent.length,0);
  }finally{await transport.close();}
});

test('complete snapshot cannot be minted from a short reply or a read spanning reconnect',async()=>{
  const {readSnapshot}=api(),device=new Receiver(),transport=new QualifiedSyntheticTransport(device,{timeoutMs:10});await transport.open();
  try{
    device.alterReply=(reply,packet)=>{if(packet[1]===0x15)reply[2]-=1;};
    await assert.rejects(readSnapshot(transport,capability),/thiếu dữ liệu/);
    device.alterReply=null;let once=false;device.beforeSend=async()=>{if(!once){once=true;await transport.close();}};
    await assert.rejects(readSnapshot(transport,capability),/dừng|session/i);
  }finally{await transport.close();}
});

test('measured link-loss header invalidates responding session immediately while the USB handle remains open',async()=>{
  const device=new Receiver(),transport=new protocol.A80Transport(device,{timeoutMs:100});await transport.open();
  try{
    await transport.readBlock(0x10,32);assert.equal(transport.getState().hasResponse,true);
    const sessionId=transport.getState().sessionId;device.silent=true;const pending=transport.readBlock(0x11,32);
    const rejected=assert.rejects(pending,/link|liên kết/i);await tick();
    // Actual native capture retained exactly these first5 bytes, no full notification payload.
    device.emit(Uint8Array.from(linkLoss.capturedHeader));await rejected;
    assert.equal(device.opened,true);assert.equal(transport.getState().deviceOpened,true);
    assert.equal(transport.getState().opened,false);assert.equal(transport.getState().linkLost,true);
    assert.equal(transport.getState().hasResponse,false);assert.notEqual(transport.getState().sessionId,sessionId);
  }finally{await transport.close();}
});


test('a second session cannot overwrite edits using a snapshot from before another write',async()=>{
  const {ConfigSession}=api(),{device,transport,snapshot,session}=await setup();
  try{
    const stale=new ConfigSession(snapshot,capability);stale.edit('colors',[{slot:92,field:'rgb',value:{red:1,green:2,blue:3}}]);
    session.edit('colors',[rgb]);assert.equal((await session.apply(transport)).status,'verified');device.sent=[];
    const result=await stale.apply(transport);assert.equal(result.status,'failed');assert.match(result.error,/stale|snapshot|epoch/i);
    assert.equal(device.sent.length,0);assert.equal(device.blocks.colors[137],27);
    session.edit('colors',[{...rgb,value:{red:7,green:8,blue:9}}]);assert.equal((await session.apply(transport)).status,'verified');
  }finally{await transport.close();}
});

test('an ambiguous partial write invalidates its original snapshot for a blind second apply',async()=>{
  const {device,transport,session}=await setup();
  try{
    session.edit('colors',[rgb]);device.badAck=true;assert.equal((await session.apply(transport)).status,'unconfirmed');
    device.badAck=false;device.sent=[];assert.equal((await session.apply(transport)).status,'failed');
    assert.equal(device.sent.length,0);assert.equal(session.diff().length,1);
  }finally{await transport.close();}
});

test('configuration short-block count owns only captured bytes while control uses source zero padding',async()=>{
  const {device,transport}=await setup();
  try{
    const original=device.blocks.lighting.slice();await transport.writeBlock(0x23,original);await transport.sendControl(0,Uint8Array.of(0,0,0,0));
    assert.deepEqual(Array.from(device.sent[0].slice(0,8)),[170,35,16,0,0,0,1,0]);
    assert.deepEqual(device.sent[0].slice(8,24),original);assert.ok(device.sent[0].slice(24).every(byte=>byte===0));
    assert.equal(device.sent[1][2],24);assert.deepEqual(device.blocks.lighting,original);
  }finally{await transport.close();}
});

test('write timeout and send failure are ambiguous, never retried, and keep the complete draft',async()=>{
  for(const failure of ['timeout','send']){
    const {device,transport,session}=await setup();
    try{
      session.edit('colors',[rgb]);
      if(failure==='timeout')device.silent=true;else device.beforeSend=()=>{throw new Error('OS write failure');};
      const result=await session.apply(transport);assert.equal(result.status,'unconfirmed');assert.equal(device.sent.length,1);
      assert.equal(result.writeProgress.sentChunks,1);assert.equal(result.writeProgress.acknowledgedChunks,0);assert.equal(session.diff().length,1);
      assert.match(result.error,failure==='timeout'?/ACK timeout/:/OS write failure/);
    }finally{await transport.close();}
  }
});

test('cancellation before any send emits nothing and readback failure never clears the draft',async()=>{
  const {device,transport,session}=await setup();
  try{
    session.edit('colors',[rgb]);const abort=new AbortController();abort.abort();
    assert.equal((await session.apply(transport,{signal:abort.signal})).status,'failed');assert.equal(device.sent.length,0);
    device.beforeSend=packet=>{if(packet[1]===0x14)device.silent=true;};
    const result=await session.apply(transport);assert.equal(result.status,'unconfirmed');assert.deepEqual(result.writtenBlocks,['colors']);
    assert.deepEqual(result.verifiedFields,[]);assert.equal(session.diff().length,1);
  }finally{await transport.close();}
});

test('an invalid atomic edit cannot replace an earlier valid draft or create extra changed groups',async()=>{
  const {transport,session}=await setup();
  try{
    session.edit('colors',[rgb]);const before=session.draft,changes=session.diff();
    assert.throws(()=>session.edit('colors',[{slot:92,field:'rgb',value:{red:1,green:2,blue:3}},{slot:34,field:'rgb',value:{red:999,green:2,blue:3}}]),/rgb.red/);
    assert.deepEqual(session.draft,before);assert.deepEqual(session.diff(),changes);
    session.edit('lighting',[{field:'red',value:9}]);session.edit('lighting',[{field:'red',value:session.snapshot.blocks.lighting[1]}]);
    assert.deepEqual(session.diff().map(change=>change.block),['colors']);
  }finally{await transport.close();}
});

test('all eight source write groups preserve whole input bytes and use bounded chunks at32 and64 byte reports',async()=>{
  for(const packetSize of [32,64]){
    const {device,transport}=await setup({packetSize});
    try{
      for(const [command,{id,length}] of blockByWrite){
        device.sent=[];const original=device.blocks[id].slice(),receipt=await transport.writeBlock(command,original);
        assert.deepEqual(device.blocks[id],original);assert.equal(receipt.sentBytes,length);
        assert.equal(receipt.acknowledgedChunks,Math.ceil(length/(packetSize-8)));
        const assembled=new Uint8Array(length);let expectedOffset=0;
        for(const packet of device.sent){
          const count=packet[2],offset=packet[3]|packet[4]<<8;
          assert.equal(packet.length,packetSize);assert.equal(packet[1],command);assert.equal(offset,expectedOffset);
          assert.ok(count>0&&count<=packetSize-8&&offset+count<=length);assembled.set(packet.slice(8,8+count),offset);expectedOffset+=count;
        }
        assert.equal(expectedOffset,length);assert.deepEqual(assembled,original);assert.equal(device.sent.at(-1)[6],1);
        assert.ok(device.sent.slice(0,-1).every(packet=>packet[6]===0));
      }
    }finally{await transport.close();}
  }
});

test('readSnapshot excludes direct writes between complete block reads and returns an unmixed snapshot',async()=>{
  const {device,transport}=await setup();let writing;
  try{
    const snapshot=await protocol.readSnapshot(transport,capability,{onProgress:event=>{
      if(event.block==='device')writing=assert.rejects(transport.writeBlock(0x23,device.blocks.lighting),/đang|running/i);
    }});
    await writing;assert.equal(Object.keys(snapshot.blocks).length,9);
    assert.equal(device.sent.filter(packet=>packet[1]===0x23).length,0);
  }finally{await transport.close();}
});

test('read and write block requests share one queue and copy write inputs before queueing',async()=>{
  const {device,transport}=await setup();
  try{
    const original=device.blocks.colors.slice(),queued=original.slice();
    const first=transport.writeBlock(0x21,device.blocks.settings),read=transport.readBlock(0x13,16),last=transport.writeBlock(0x24,queued);
    queued.fill(0);await Promise.all([first,read,last]);
    assert.deepEqual(device.sent.map(packet=>packet[1]),[0x21,0x21,0x13,...Array(22).fill(0x24)]);
    assert.deepEqual(device.blocks.colors,original);
  }finally{await transport.close();}
});

test('the source post-write control needs its own ACK and cannot convert missing verification into success',async()=>{
  const {device,transport,session}=await setup();
  try{
    session.edit('colors',[rgb]);device.alterReply=(reply,packet)=>{if(packet[1]===0)reply[1]=0x37;};
    const result=await session.apply(transport);assert.equal(result.status,'unconfirmed');assert.deepEqual(result.writtenBlocks,['colors']);
    assert.deepEqual(result.verifiedFields,[]);assert.equal(device.sent.filter(packet=>packet[1]===0).length,1);
    assert.equal(device.sent.filter(packet=>packet[1]===0x14).length,0);assert.equal(session.diff().length,1);
  }finally{await transport.close();}
});

test('cancellation from a TX observer before the OS send cannot leak a write after abort',async()=>{
  const {device,transport,session}=await setup();
  try{
    session.edit('colors',[rgb]);const epoch=transport.getState().writeEpoch,abort=new AbortController();
    transport.onTrace=event=>{if(event.operation==='write')abort.abort();};
    const result=await session.apply(transport,{signal:abort.signal});await tick();
    assert.equal(device.sent.length,0);assert.equal(result.status,'failed');assert.equal(transport.getState().writeEpoch,epoch);
  }finally{await transport.close();}
});

test('invalid apply transport cannot leave a valid session locked or discard its draft',async()=>{
  const {transport,session}=await setup();
  try{
    session.edit('colors',[rgb]);const result=await session.apply(null);
    assert.equal(result.status,'failed');assert.equal(session.applying,false);assert.equal(session.diff().length,1);
    session.revert();assert.deepEqual(session.diff(),[]);
  }finally{await transport.close();}
});

test('a direct write queued before apply cannot be overwritten by the stale session block',async()=>{
  const {device,transport,session}=await setup();
  try{
    const foreign=device.blocks.colors.slice();foreign[92*4+1]=123;
    session.edit('colors',[rgb]);const queued=transport.writeBlock(0x24,foreign),applying=session.apply(transport);
    await queued;const result=await applying;
    assert.equal(device.blocks.colors[92*4+1],123,'the earlier queued edit must survive');
    assert.equal(device.sent.filter(packet=>packet[1]===0x24).length,22,'no stale session chunk may be sent');
    assert.equal(result.status,'failed');assert.deepEqual(result.writtenBlocks,[]);assert.deepEqual(result.attemptedBlocks,[]);
    assert.match(result.error,/stale|snapshot|epoch/i);assert.equal(session.diff().length,1);
  }finally{await transport.close();}
});

test('foreign writes control and direct exchanges cannot enter write control or readback transaction phases',async()=>{
  const {device,transport,session}=await setup();const attempts=[];
  try{
    session.edit('colors',[rgb]);
    const result=await session.apply(transport,{onProgress:event=>{
      if(!['write','control','readback'].includes(event.phase))return;
      for(const operation of [()=>transport.writeBlock(0x21,device.blocks.settings),()=>transport.sendControl(0,Uint8Array.of(0,0,0,0)),()=>transport.exchange(0x10,0,24,false)]){
        attempts.push(operation().then(()=>({phase:event.phase,blocked:false}),()=>({phase:event.phase,blocked:true})));
      }
    }});
    assert.equal(result.status,'verified');assert.equal(attempts.length,9);assert.ok((await Promise.all(attempts)).every(item=>item.blocked));
    assert.equal(device.sent.filter(packet=>packet[1]===0x21).length,0);assert.equal(device.sent.filter(packet=>packet[1]===0).length,1);
    assert.equal(device.sent.filter(packet=>packet[1]===0x10).length,0);
  }finally{await transport.close();}
});

test('queued transaction cancellation emits no owned writes and releases transport admission',async()=>{
  const {device,transport,session}=await setup();
  try{
    device.silent=true;session.edit('colors',[rgb]);const earlier=transport.readBlock(0x10,32);
    const earlierFailure=assert.rejects(earlier,/chưa trả lời/),abort=new AbortController();
    const applying=session.apply(transport,{signal:abort.signal});abort.abort();
    await assert.rejects(transport.sendControl(0,Uint8Array.of(0,0,0,0)),/đang|running/i);
    await earlierFailure;assert.equal((await applying).status,'failed');assert.equal(device.sent.filter(packet=>packet[1]===0x24).length,0);
    device.silent=false;assert.equal((await transport.readBlock(0x10,32)).length,32);
  }finally{await transport.close();}
});

test('a failed owned callback drains requests, expires its scope and releases transport admission',async()=>{
  const {device,transport}=await setup();let scope;
  try{
    await assert.rejects(transport.withTransaction(async io=>{scope=io;await io.writeBlock(0x21,device.blocks.settings);throw new Error('owner callback failed');}),/owner callback failed/);
    const count=device.sent.length;await assert.rejects(scope.writeBlock(0x21,device.blocks.settings),{name:'AbortError'});assert.equal(device.sent.length,count);
    assert.equal((await transport.readBlock(0x10,32)).length,32);
  }finally{await transport.close();}
});

test('macro and DKS semantic paths verify complete events and patterns without opaque-byte equality',async()=>{
 const {device,transport,session}=await setup({cleanAdvanced:true});
 try{
  session.edit('macro',[{field:'macros',value:[{events:[{device:'keyboard',action:'down',code:4,delayMs:513}]}]}]);
  session.advanced({type:'dks',slots:[34],index:1,pattern:{thresholds:[10,20,20,10],keys:[4,5,6,7],actions:[1,2,4,8]}});
  device.alterReply=(reply,packet)=>{if(packet[1]===0x18&&packet[3]===0)reply[8+20]^=1;};
  const result=await session.apply(transport);assert.equal(result.status,'verified',result.error);assert.deepEqual(result.verifiedFields.map(c=>`${c.block}:${c.path}`),['keymap:records[34].binding','macro:fields.macros','dks:records[1].pattern']);assert.equal(session.diff().length,0);
 }finally{await transport.close();}
});
test('a changed macro event or DKS action mismatch cannot pass semantic readback',async()=>{
 for(const id of ['macro','dks']){const {device,transport,session}=await setup({cleanAdvanced:true});try{
  if(id==='macro')session.edit('macro',[{field:'macros',value:[{events:[{device:'keyboard',action:'down',code:4,delayMs:513}]}]}]);
  else session.advanced({type:'dks',slots:[34],index:1,pattern:{thresholds:[10,20,20,10],keys:[4,5,6,7],actions:[1,2,4,8]}});
  const changedOffset=id==='macro'?404:28,command=capability.blocks[id].command;
  device.alterReply=(reply,packet)=>{const offset=packet[3]|packet[4]<<8;if(packet[1]===command&&changedOffset>=offset&&changedOffset<offset+packet[2])reply[8+changedOffset-offset]^=1;};
  const result=await session.apply(transport);assert.equal(result.status,'unconfirmed');assert.match(result.error,/mismatch/);assert.ok(session.diff().length>0);
 }finally{await transport.close();}}
});
