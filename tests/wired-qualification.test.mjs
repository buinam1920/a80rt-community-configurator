import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {A80Transport,ConfigSession,readSnapshot} from '../dist/protocol.js';
import {identifyDevice} from '../dist/device/capabilities.js';

const measured=JSON.parse(fs.readFileSync(new URL('./fixtures/a80rt-wired-color-qualification.json',import.meta.url)));
const synthetic=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic/config-blocks.json',import.meta.url)));
const cap=identifyDevice(measured.identity);
// Synthetic internal device, NOT another hardware capture. Header-only measured
// ACKs are padded with deliberately unrelated synthetic payload to test no echo.
class Wired extends EventTarget {
  vendorId=0x0c45;productId=0x80a1;productName='A80RT U';opened=false;sent=[];listeners=[];
  collections=[{usagePage:0xff68,usage:0x61,inputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}],outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];
  blocks=Object.fromEntries(Object.entries(synthetic.blocks).map(([id,bytes])=>[id,Uint8Array.from(bytes)]));
  constructor(){super();this.blocks.device.set([55,1],8);}
  async open(){this.opened=true;} async close(){this.opened=false;}
  addEventListener(type,listener,...args){if(type==='inputreport')this.listeners.push(listener);super.addEventListener(type,listener,...args);}
  event(bytes){const event=new Event('inputreport');event.reportId=0;event.data=new DataView(bytes.buffer);return event;}
  emit(bytes){this.dispatchEvent(this.event(bytes));}
  async sendReport(reportId,packet){
    assert.equal(reportId,0);this.sent.push(packet.slice());if(this.silent)return;
    const command=packet[1],offset=packet[3]|packet[4]<<8,count=packet[2];
    const reply=new Uint8Array(packet.length);reply.set([85,command,count,packet[3],packet[4],0,packet[6],0]);
    const block=Object.entries(cap.blocks).find(([,block])=>block.command===command||block.writeCommand===command);
    if(command>=0x10&&command<=0x18){
      reply.set(this.blocks[block[0]].slice(offset,offset+count),8);
      if(command===0x10&&offset===0&&count===32&&reply.length===measured.deviceRead.reportLength)reply.set(measured.deviceRead.header);
    }
    else {
      if(command!==0)this.blocks[block[0]].set(packet.slice(8,8+count),offset);
      const capture=measured.writeAcks.find(ack=>ack.header[1]===command&&(ack.header[3]|ack.header[4]<<8)===offset);
      if(capture)reply.set(capture.header);
      reply.fill(0xe3,8);
    }
    queueMicrotask(()=>{this.beforeReply?.(reply,packet);this.emit(this.alterReply?.(reply,packet)??reply);});
  }
}
async function setup(){const device=new Wired(),transport=new A80Transport(device,{timeoutMs:15});await transport.open();return {device,transport};}
const rgb={slot:34,field:'rgb',value:{red:27,green:128,blue:255}};

test('Fn WIN replacement sends canonical keyboard W through wired policy and restores its function',async()=>{
  const {device,transport}=await setup();
  try{
    device.blocks.fn.set([13,0,0,8],136);const original=device.blocks.fn.slice();
    const session=new ConfigSession(await readSnapshot(transport,cap),cap);device.sent=[];
    session.edit('fn',[{slot:34,field:'binding',value:{type:'keyboard',usage:26,modifier:0}}]);
    assert.deepEqual(Array.from(session.draft.fn.slice(136,140)),[2,0,26,0]);
    const result=await session.apply(transport);assert.equal(result.status,'verified',result.error);
    assert.deepEqual(result.verifiedFields,[{block:'fn',path:'records[34].binding'}]);
    const packet=device.sent.find(p=>p[1]===0x26&&(p[3]|p[4]<<8)===112);
    assert.deepEqual(Array.from(packet.slice(32,36)),[2,0,26,0]);
    assert.deepEqual(Array.from(session.snapshot.blocks.fn.slice(136,140)),[2,0,26,0]);
    session.edit('fn',[{slot:34,field:'binding',value:{type:'function',code:8}}]);
    assert.equal((await session.apply(transport)).status,'verified');assert.deepEqual(device.blocks.fn,original);
  }finally{await transport.close();}
});

class HostElement {
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.value='';this.disabled=false;this.hidden=false;this.attributes={};this.textContent='';this.style={setProperty(){}};this.classList={toggle(){}};}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}
  get options(){return this.children;}focus(){}
  querySelectorAll(){return this.children.flatMap(child=>[child,...(child.querySelectorAll?.()??[])]).filter(child=>['input','select','button'].includes(child.tag));}
  addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}
  async trigger(type,event={}){await this.listeners.get(type)?.({target:this,...event});}
}

test('actual host locks editors and apply after unconfirmed readback, preserves draft, and a nine-block read recovers',async()=>{
  const old={document:globalThis.document,window:globalThis.window,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
  const device=new Wired(),hid=new EventTarget(),elements=[],roots=new Map(),doc=new EventTarget(),win=new EventTarget();
  const get=id=>elements.findLast(el=>el.id===id)??roots.get(id)??(()=>{const el=new HostElement();roots.set(id,el);return el;})();
  doc.getElementById=get;doc.createElement=tag=>{const el=new HostElement(tag);elements.push(el);return el;};doc.createTextNode=text=>({textContent:text});doc.hasFocus=()=>true;win.isSecureContext=true;hid.requestDevice=async()=>[device];
  globalThis.document=doc;globalThis.window=win;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
  try{
    await import('../dist/app.js?task9-unconfirmed-host');await get('connect-button').trigger('click');await get('read-button').trigger('click');
    const input=get('core-pressMm'),original=input.value;input.value='0.01';await input.trigger('change');
    assert.equal(get('apply-button').disabled,false);
    device.alterReply=(reply,packet)=>{if(packet[1]===0x17&&(packet[3]|packet[4]<<8)===224)reply[60]^=1;return reply;};
    await get('apply-button').trigger('click');
    assert.match(get('message').textContent,/Read-back mismatch/);assert.match(get('apply-reason').textContent,/đọc lại.*9|9.*đọc lại/i);
    assert.equal(get('core-pressMm').disabled,true);assert.equal(get('settings-topDeadZone').disabled,true);
    assert.equal(get('apply-button').disabled,true);assert.equal(get('revert-button').disabled,true);
    assert.match(get('draft-count').textContent,/1 thay đổi/);assert.equal(get('core-pressMm').value,'0.01');
    assert.equal(get('read-button').disabled,false);assert.equal(get('export-button').disabled,false);
    assert.match(get('source-note').textContent,/chưa đủ/);
    device.alterReply=null;device.sent=[];await get('read-button').trigger('click');
    assert.equal(new Set(device.sent.map(p=>p[1])).size,9);
    assert.equal(get('core-pressMm').disabled,false);assert.equal(get('settings-topDeadZone').disabled,false);
    assert.match(get('draft-count').textContent,/0 thay đổi/);
    get('core-pressMm').value=original;await get('core-pressMm').trigger('change');assert.equal(get('apply-button').disabled,false);
  }finally{
    await get('disconnect-button').trigger('click');globalThis.document=old.document;globalThis.window=old.window;
    if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;
  }
});

test('production policy requires a fresh complete genuine firmware read; reconnect and link loss reset it',async()=>{
  const {device,transport}=await setup();
  try {
    assert.equal(transport.getWriteState().qualified,false);
    await transport.readBlock(0x11,32);assert.equal(transport.getWriteState().qualified,false);
    await transport.readBlock(0x10,10);assert.equal(transport.getWriteState().qualified,false);
    await transport.readBlock(0x10,32);assert.equal(transport.getWriteState().qualified,true);
    await transport.close();await transport.open();assert.equal(transport.getWriteState().qualified,false);
    device.silent=true;const pending=transport.readBlock(0x10,32);await new Promise(resolve=>setImmediate(resolve));
    const old=new Uint8Array(64);old.set([85,16,32,0,0,0,1,0]);old.set([55,1],16);
    device.listeners[0](device.event(old));assert.equal(transport.getWriteState().qualified,false);
    device.emit(old);await pending;assert.equal(transport.getWriteState().qualified,true);
    device.emit(Uint8Array.of(85,252,4,0,0));assert.equal(transport.getWriteState().qualified,false);
    assert.equal(transport.getWriteState().ready,false);
  } finally {await transport.close();}
});

test('unknown identity, report, input descriptor and other firmware never qualify',async()=>{
  for(const alter of [d=>d.productName='A80RT U other',d=>{d.productId=0x80a2;d.productName='A80RT';},d=>{d.productId=0xfefc;d.productName='A80RT U Dongle';},d=>d.collections[0].usage=1,d=>d.collections[0].inputReports=[],d=>d.collections[0].inputReports[0].items[0].reportCount=32,d=>d.collections[0].outputReports[0].items[0].reportCount=32,d=>d.blocks.device[8]=54]){
    const device=new Wired();alter(device);const transport=new A80Transport(device,{timeoutMs:15});await transport.open();
    try {await transport.readBlock(0x10,32);assert.equal(transport.getWriteState().qualified,false);device.sent=[];await assert.rejects(transport.writeBlock(0x24,device.blocks.colors));assert.equal(device.sent.length,0);}finally{await transport.close();}
  }
});

test('malformed and partial version rereads revoke existing attestation',async()=>{
  const {device,transport}=await setup();
  try {
    await transport.readBlock(0x10,32);assert.equal(transport.getWriteState().qualified,true);
    await transport.readBlock(0x10,10);assert.equal(transport.getWriteState().qualified,false);
    await transport.readBlock(0x10,32);assert.equal(transport.getWriteState().qualified,true);
    device.alterReply=reply=>reply.slice(0,39);
    await assert.rejects(transport.readBlock(0x10,32));assert.equal(transport.getWriteState().qualified,false);
  }finally{await transport.close();}
});

test('matching version responses with malformed header flags cannot attest firmware',async()=>{
  for(const index of [5,6,7]){
    const {device,transport}=await setup();
    try {device.alterReply=reply=>{reply[index]^=1;return reply;};await transport.readBlock(0x10,32);assert.equal(transport.getWriteState().qualified,false);}finally{await transport.close();}
  }
});

test('all editor families stage locally and verify through the production wired policy in one session',async()=>{
  const {device,transport}=await setup();
  try {
    for(const id of ['macro','dks','keymap','fn'])device.blocks[id].fill(0);
    const session=new ConfigSession(await readSnapshot(transport,cap),cap);device.sent=[];
    session.edit('settings',[{field:'polling',value:3},{field:'stability',value:1},{field:'autoCalibration',value:0}]);
    session.edit('rt',[{slot:34,field:'pressMm',value:0.4}]);
    session.edit('lighting',[{field:'brightness',value:2}]);
    session.edit('colors',[rgb]);
    session.edit('keymap',[{slot:34,field:'binding',value:{type:'keyboard',usage:4,modifier:0}}]);
    session.edit('fn',[{slot:34,field:'binding',value:{type:'media',usage:233}}]);
    session.edit('macro',[{field:'macros',value:[{events:[{device:'keyboard',code:4,action:'down',delayMs:0},{device:'keyboard',code:4,action:'up',delayMs:10}]}]}]);
    session.advanced({type:'tgl',slots:[49],key:5});
    assert.equal(device.sent.length,0);const count=session.diff().length;assert.ok(count>=8);
    const result=await session.apply(transport);assert.equal(result.status,'verified',result.error);assert.equal(result.verifiedFields.length,count);assert.deepEqual(session.diff(),[]);
    assert.deepEqual(result.writtenBlocks,['settings','keymap','lighting','colors','macro','fn','rt']);
  }finally{await transport.close();}
});

test('measured header-only color/control ACKs permit explicit apply and semantic readback without payload echo',async()=>{
  const {device,transport}=await setup();
  try {
    const snapshot=await readSnapshot(transport,cap),session=new ConfigSession(snapshot,cap);device.sent=[];
    session.edit('colors',[rgb]);assert.equal(device.sent.length,0);
    assert.equal(transport.getWriteState().qualified,true);
    assert.equal((await session.apply(transport)).status,'verified');assert.deepEqual(session.diff(),[]);
    assert.equal(device.sent.filter(packet=>packet[1]===0x24).length,10);
    assert.deepEqual(Array.from(device.sent.find(packet=>packet[1]===0).slice(0,12)),[170,0,56,0,0,0,1,0,0,0,0,0]);
    assert.equal(transport.getMaintenanceState('reset').qualified,false);
    assert.equal(transport.getMaintenanceState('beginCalibration').qualified,false);
    for(const source of ['sample','import','device']){
      const serialized=new ConfigSession({...snapshot,provenance:{...snapshot.provenance,source}},cap);serialized.edit('colors',[{...rgb,value:{red:1,green:2,blue:3}}]);device.sent=[];
      assert.equal((await serialized.apply(transport)).status,'failed');assert.equal(device.sent.length,0);assert.equal(serialized.diff().length,1);
    }
  }finally{await transport.close();}
});

test('source-inferred mapped config commands share strict header policy; arbitrary and maintenance opcodes remain blocked',async()=>{
  const {device,transport}=await setup();
  try {
    await transport.readBlock(0x10,32);
    for(const [id,block]of Object.entries(cap.blocks).filter(([,b])=>b.writeCommand)){
      const progress=await transport.writeBlock(block.writeCommand,device.blocks[id]);assert.ok(progress.acknowledgedChunks>0);
    }
    device.sent=[];for(const command of [0x20,0x29,100,101,15])await assert.rejects(transport.writeBlock(command,new Uint8Array(32)),/Unknown/);
    await assert.rejects(transport.sendControl(1,[0,0,0,0]),/Unknown/);assert.equal(device.sent.length,0);
  }finally{await transport.close();}
});

test('matching malformed ACK fails closed without retries and preserves draft; unrelated frames are ignored',async()=>{
  for(const corrupt of [r=>r[2]--,r=>r[5]=1,r=>r[6]^=1,r=>r[7]=1,r=>r.slice(0,63)]){
    const {device,transport}=await setup();
    try {
      const session=new ConfigSession(await readSnapshot(transport,cap),cap);session.edit('colors',[rgb]);device.sent=[];
      device.alterReply=(reply,packet)=>{
        if(packet[1]!==0x24)return reply;
        const changed=corrupt(reply);return changed instanceof Uint8Array?changed:reply;
      };
      const result=await session.apply(transport);assert.equal(result.status,'unconfirmed');assert.equal(session.diff().length,1);assert.equal(device.sent.length,1);
    }finally{await transport.close();}
  }
  const {device,transport}=await setup();
  try {
    const session=new ConfigSession(await readSnapshot(transport,cap),cap);session.edit('colors',[rgb]);
    device.beforeReply=(reply,packet)=>{if(packet[1]===0x24){const wrong=reply.slice();wrong[1]=0x23;device.emit(wrong);wrong[1]=0x24;wrong[3]^=1;device.emit(wrong);}};
    assert.equal((await session.apply(transport)).status,'verified');
  }finally{await transport.close();}
});
