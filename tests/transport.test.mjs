import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {A80Reader,A80Transport} from '../dist/protocol.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/a80rt-dongle-descriptor.json',import.meta.url),'utf8'));

class Receiver extends EventTarget {
  vendorId=0x0c45;productId=0xfefc;productName='A80RT U Dongle';opened=false;sent=[];
  // The export has byte totals, not report items. Reconstruct only that boundary.
  collections=fixture.descriptor.collections.map(c=>({...c,...Object.fromEntries(['inputReports','outputReports','featureReports'].map(key=>[key,c[key].map(r=>({reportId:r.reportId,items:[{reportSize:8,reportCount:r.bytes}]}))]))}));
  async open(){this.opened=true;}
  async close(){this.opened=false;}
  emit(packet,{offset=packet[3]|packet[4]<<8,count=packet[2]}={}){
    const bytes=new Uint8Array(32);bytes.set([0x55,packet[1],count,offset&255,offset>>>8,0,0,0]);
    bytes.fill(7,8);const event=new Event('inputreport');event.reportId=0;event.data=new DataView(bytes.buffer);this.dispatchEvent(event);
  }
  async sendReport(id,packet){assert.equal(id,0);this.sent.push(packet.slice());this.respond?.(packet);}
}

test('a receiver that answers only the manufacturer retry can complete the first block',async()=>{
  const device=new Receiver(),reader=new A80Reader(device,{timeout:15});
  device.respond=packet=>{if(device.sent.length===2||packet[3]!==0||packet[1]!==0x10)queueMicrotask(()=>device.emit(packet));};
  await reader.open();
  try {const blocks=await reader.readAll();assert.equal(blocks.device.length,32);assert.deepEqual(device.sent[0],device.sent[1]);}
  finally {await reader.close();}
});

test('an aborted queued block rejects before a silent active block times out',async()=>{
  const device=new Receiver(),transport=new A80Transport(device,{timeoutMs:100});await transport.open();
  const first=transport.readBlock(0x10,32);const firstFailure=assert.rejects(first,{name:'AbortError'});
  const controller=new AbortController();const queued=transport.readBlock(0x11,32,{signal:controller.signal});controller.abort();
  let outcome='pending';queued.then(()=>{outcome='resolved';},error=>{outcome=error.name;});
  await new Promise(resolve=>setImmediate(resolve));
  try{assert.equal(outcome,'AbortError');assert.equal(device.sent.length,1);}
  finally{await transport.close();await firstFailure;await assert.rejects(queued,{name:'AbortError'});}
});

test('a detached old-session listener cannot complete a matching request after close/open',async()=>{
  const device=new Receiver(),listeners=[];
  const add=device.addEventListener.bind(device);device.addEventListener=(name,listener,...args)=>{if(name==='inputreport')listeners.push(listener);add(name,listener,...args);};
  const transport=new A80Transport(device,{timeoutMs:50});await transport.open();const oldId=transport.getState().sessionId;
  const old=transport.readBlock(0x10,24);const oldFailure=assert.rejects(old,{name:'AbortError'});await new Promise(resolve=>setImmediate(resolve));
  await transport.close();await oldFailure;await transport.open();assert.notEqual(transport.getState().sessionId,oldId);
  let completed=false;const current=transport.readBlock(0x10,24).then(bytes=>{completed=true;return bytes;});await new Promise(resolve=>setImmediate(resolve));
  const bytes=new Uint8Array(32);bytes.set([0x55,0x10,24,0,0,0,0,0]);bytes.fill(99,8);
  listeners[0]({reportId:0,data:new DataView(bytes.buffer)});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false);assert.equal(transport.getState().hasResponse,false);
  // Deliver a fresh synthetic reply to the current request, after proving that
  // the explicitly invoked detached callback above could not settle it.
  device.emit(device.sent.at(-1));assert.deepEqual(await current,new Uint8Array(24).fill(7));assert.equal(transport.getState().hasResponse,true);
  await transport.close();assert.equal(transport.getState().hasResponse,false);
});

test('format limitation: a byte-identical old frame through the current listener is accepted after reopen',async()=>{
  const device=new Receiver(),trace=[],transport=new A80Transport(device,{timeoutMs:50,onTrace:event=>trace.push(event)});
  // Cache a complete response from the first session. No header byte identifies
  // a session/transaction, so its delayed duplicate also matches the next read.
  const cached=new Uint8Array(32);cached.set([0x55,0x10,24,0,0,0,0,0]);cached.fill(99,8);
  const deliverCached=()=>{const event=new Event('inputreport');event.reportId=0;event.data=new DataView(cached.buffer);device.dispatchEvent(event);};
  await transport.open();const oldSession=transport.getState().sessionId;
  const old=transport.readBlock(0x10,24);await new Promise(resolve=>setImmediate(resolve));deliverCached();assert.deepEqual(await old,new Uint8Array(24).fill(99));
  await transport.close();await transport.open();const currentSession=transport.getState().sessionId;assert.notEqual(currentSession,oldSession);
  assert.equal(transport.getState().hasResponse,false);
  const current=transport.readBlock(0x10,24);await new Promise(resolve=>setImmediate(resolve));
  deliverCached(); // EventTarget routes this through the newly registered listener.
  assert.deepEqual(await current,new Uint8Array(24).fill(99));assert.equal(transport.getState().hasResponse,true);
  assert.equal(trace.filter(event=>event.type==='rx').at(-1).sessionId,currentSession);
  await transport.close();
});

test('simultaneous block reads queue whole blocks and preserve exact measured first TX',async()=>{
  const device=new Receiver(),trace=[],transport=new A80Transport(device,{timeoutMs:30,onTrace:event=>trace.push(event)});
  device.respond=packet=>queueMicrotask(()=>device.emit(packet));await transport.open();
  const [first,second]=await Promise.all([transport.readBlock(0x10,32),transport.readBlock(0x11,32)]);
  assert.equal(first.length,32);assert.equal(second.length,32);assert.deepEqual(Array.from(device.sent[0]),fixture.firstReadPacket);
  assert.deepEqual(device.sent.map(packet=>[packet[1],packet[3],packet[2],packet[6]]),[[16,0,24,0],[16,24,8,1],[17,0,24,0],[17,24,8,1]]);
  assert.equal(trace.filter(event=>event.type==='rx').length,4);assert.ok(trace.every(event=>event.sessionId===transport.getState().sessionId));await transport.close();
});

test('send failure rejects immediately without retry and a later block can still read',async()=>{
  const device=new Receiver(),transport=new A80Transport(device,{timeoutMs:30});
  device.respond=()=>{throw new Error('OS send failed');};await transport.open();
  await assert.rejects(transport.readBlock(0x10,32),/OS send failed/);assert.equal(device.sent.length,1);assert.equal(transport.getState().hasResponse,false);
  device.respond=packet=>queueMicrotask(()=>device.emit(packet));assert.equal((await transport.readBlock(0x11,32)).length,32);await transport.close();
});

test('silent input allows exactly one retry and never creates response qualification',async()=>{
  const device=new Receiver(),transport=new A80Transport(device,{timeoutMs:5});await transport.open();
  await assert.rejects(transport.readBlock(0x10,32),/chưa trả lời/);assert.equal(device.sent.length,2);assert.deepEqual(device.sent[0],device.sent[1]);assert.equal(transport.getState().hasResponse,false);await transport.close();
});

test('opening the HID handle without RX never reports a responding device',async()=>{
  const reader=new A80Reader(new Receiver(),{timeout:5});await reader.open();
  try {assert.equal(reader.getState?.().hasResponse,false);await assert.rejects(reader.readAll(),/chưa trả lời/);assert.equal(reader.getState().hasResponse,false);}
  finally {await reader.close();}
});

test('wrong-offset frames time out rather than producing a complete block',async()=>{
  const device=new Receiver(),reader=new A80Reader(device,{timeout:5});device.respond=packet=>queueMicrotask(()=>device.emit(packet,{offset:24}));await reader.open();
  const blocks=[];
  try {await assert.rejects(reader.readAll(()=>{},id=>blocks.push(id)),/chưa trả lời/);assert.deepEqual(blocks,[]);}
  finally {await reader.close();}
});

test('a short first chunk never publishes a zero-filled complete block',async()=>{
  const device=new Receiver(),reader=new A80Reader(device,{timeout:5});device.respond=packet=>queueMicrotask(()=>device.emit(packet,{count:23}));await reader.open();
  const blocks=[];
  try {await assert.rejects(reader.readAll(()=>{},id=>blocks.push(id)),/thiếu dữ liệu/);assert.deepEqual(blocks,[]);}
  finally {await reader.close();}
});

test('disconnect during a read immediately permits a new connection without stale read UI',async()=>{
  class Element {
    textContent='';hidden=false;disabled=false;open=false;listeners=new Map();style={setProperty(){}};classList={toggle(){}};
    append(){}replaceChildren(){}setAttribute(){}
    addEventListener(type,callback){this.listeners.set(type,callback);}
    async trigger(type,event={}){await this.listeners.get(type)?.(event);}
  }
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const firstDevice=new Receiver(),secondDevice=new Receiver();secondDevice.productName='A80RT second receiver';
  const hid=new EventTarget();let next=firstDevice;hid.requestDevice=async()=>[next];
  globalThis.document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
  globalThis.window={isSecureContext:true};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
  let reading;
  try{
    await import('../dist/app.js');await get('connect-button').trigger('click');
    reading=get('read-button').trigger('click');await new Promise(resolve=>setImmediate(resolve));
    const disconnected=new Event('disconnect');disconnected.device=firstDevice;hid.dispatchEvent(disconnected);
    assert.equal(get('connect-button').disabled,false,'a detached read must not keep the new-device picker disabled');
    next=secondDevice;await get('connect-button').trigger('click');await reading;
    assert.equal(get('device-name').textContent,'A80RT second receiver');
    assert.doesNotMatch(get('message').textContent,/Đã dừng đọc/,'old cancellation must not overwrite the new connection result');
    await get('disconnect-button').trigger('click');
  }finally{
    await reading;
    globalThis.document=oldDocument;globalThis.window=oldWindow;
    if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
  }
});
