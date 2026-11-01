import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {identifyDevice} from '../dist/device/capabilities.js';

const measured=JSON.parse(fs.readFileSync(new URL('./fixtures/a80rt-dongle-write-qualification.json',import.meta.url)));
const synthetic=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic/config-blocks.json',import.meta.url)));
const cap=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});

// Synthetic receiver answering reads only; the info prefix (identity + firmware 1.37)
// is the measured one, battery byte 17 is set by each test.
class Receiver extends EventTarget {
  vendorId=0x0c45;productId=0xfefc;productName='A80RT U Dongle';opened=false;sent=[];
  collections=[{usagePage:0xff80,usage:1,inputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}],outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}];
  blocks=Object.fromEntries(Object.entries(synthetic.blocks).map(([id,bytes])=>[id,Uint8Array.from(bytes)]));
  constructor(battery){super();this.blocks.device.set(measured.deviceInfoPrefix.payload0to10,0);this.blocks.device[17]=battery;}
  async open(){this.opened=true;} async close(){this.opened=false;}
  async sendReport(reportId,packet){
    this.sent.push(packet.slice());const command=packet[1],offset=packet[3]|packet[4]<<8,count=packet[2];
    const reply=new Uint8Array(32);reply.set([0x55,command,count,packet[3],packet[4],0,packet[6],0]);
    const block=Object.entries(cap.blocks).find(([,block])=>block.command===command);
    if(block)reply.set(this.blocks[block[0]].slice(offset,offset+count),8);
    queueMicrotask(()=>{const event=new Event('inputreport');event.reportId=0;event.data=new DataView(reply.buffer);this.dispatchEvent(event);});
  }
}
class Element {
  textContent='';hidden=false;disabled=false;open=false;listeners=new Map();style={setProperty(){}};classList={toggle(){}};dataset={};
  children=[];get options(){return this.children;}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}setAttribute(){}removeEventListener(){}
  addEventListener(type,callback){this.listeners.set(type,callback);}
  async trigger(type,event={}){await this.listeners.get(type)?.(event);}
}
const settle=async()=>{for(let i=0;i<40;i++)await new Promise(resolve=>setImmediate(resolve));};
async function host(tag,{permitted,requestDevice}){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const old={document:globalThis.document,window:globalThis.window,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
  const hid=new EventTarget();hid.getDevices=async()=>permitted;hid.requestDevice=requestDevice??(async()=>{throw new Error('chooser must not open');});
  globalThis.document={getElementById:get,createElement:()=>new Element(),createTextNode:text=>({textContent:text}),title:'A80RT Configurator'};
  globalThis.window={isSecureContext:true};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
  await import(`../dist/app.js?${tag}`);await settle();
  const meta=()=>Object.fromEntries(get('device-meta').children.reduce((rows,el,i,all)=>i%2?rows:[...rows,[el.textContent,all[i+1]?.textContent]],[]));
  const restore=async()=>{await get('disconnect-button').trigger('click');globalThis.document=old.document;globalThis.window=old.window;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;};
  return {get,meta,hid,restore};
}

test('a previously permitted receiver is opened and read on start without the chooser, and battery is shown',async()=>{
  const device=new Receiver(76),{get,meta,restore}=await host('auto-start',{permitted:[device]});
  try{
    assert.ok(device.sent.length>0,'auto connect sent read requests');
    assert.ok(device.sent.every(packet=>packet[0]===0xaa&&packet[1]>=0x10&&packet[1]<=0x18),'auto connect only reads');
    assert.match(get('message').textContent,/Đã đọc đủ 9/);
    assert.equal(meta()['Pin'],'76%');
    assert.match(globalThis.document.title,/^🔋76% · A80RT Configurator/);
    assert.equal(get('battery-chip').hidden,false);assert.equal(get('battery-chip').dataset.level,'ok');
  }finally{await restore();}
  assert.equal(get('battery-chip').hidden,true,'battery clears after disconnect');
});

test('the cable is preferred over the receiver when both are permitted, and wired shows no battery row',async()=>{
  const receiver=new Receiver(50);
  const wired=new Receiver(16);Object.assign(wired,{productId:0x80a1,productName:'A80RT U'});
  wired.collections=[{usagePage:0xff68,usage:0x61,inputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}],outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];
  const {meta,restore}=await host('auto-prefer-cable',{permitted:[receiver,wired]});
  try{assert.equal(receiver.sent.length,0,'receiver untouched');assert.ok(wired.opened);assert.equal(meta()['Pin'],undefined);}
  finally{await restore();}
});

test('a low battery warns once through the toast',async()=>{
  const device=new Receiver(9),{get,restore}=await host('auto-low',{permitted:[device]});
  try{assert.match(get('toast').textContent,/Pin bàn phím còn 9%/);assert.equal(get('battery-chip').dataset.level,'low');}
  finally{await restore();}
});

test('no permitted device leaves the app idle and never opens the chooser by itself',async()=>{
  let chooser=0;const {get,restore}=await host('auto-none',{permitted:[],requestDevice:async()=>{chooser++;return [];}});
  try{assert.equal(chooser,0);assert.doesNotMatch(get('message').textContent,/Đã đọc/);assert.match(get('message').textContent,/chọn đúng thiết bị.*A80RT U/);}
  finally{await restore();}
});

// The receiver stays enumerated while the keyboard sleeps; it answers with the
// measured link-loss header 55 FC 04 instead of a reply.
class SleepyReceiver extends Receiver {
  asleep=false;
  linkLoss(){const event=new Event('inputreport');event.reportId=0;event.data=new DataView(Uint8Array.from([0x55,0xfc,4,0,0,...new Array(27).fill(0)]).buffer);this.dispatchEvent(event);}
  async sendReport(reportId,packet){if(!this.asleep)return super.sendReport(reportId,packet);this.sent.push(packet.slice());queueMicrotask(()=>this.linkLoss());}
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('a receiver link loss releases the stale reader and reconnects by reading once the keyboard wakes',async()=>{
  const device=new SleepyReceiver(80),{get,meta,restore}=await host('relink',{permitted:[device]});
  try{
    assert.equal(meta()['Pin'],'80%');
    device.asleep=true;device.linkLoss();await settle();
    assert.match(get('message').textContent,/mất liên lạc với bàn phím/);
    assert.equal(get('battery-chip').hidden,true,'stale battery cleared');
    assert.equal(device.opened,false,'stale HID handle closed');
    device.asleep=false;const before=device.sent.length;
    await wait(3300);await settle();
    assert.ok(device.sent.length>before,'retried after the first back-off');
    assert.ok(device.sent.every(packet=>packet[0]===0xaa&&packet[1]>=0x10&&packet[1]<=0x18),'recovery only reads');
    assert.match(get('message').textContent,/Đã đọc đủ 9/);
    assert.equal(meta()['Pin'],'80%');
  }finally{await restore();}
});

test('a manual disconnect after a link loss stops automatic reconnection',async()=>{
  const device=new SleepyReceiver(80),{get,restore}=await host('relink-stop',{permitted:[device]});
  try{
    device.asleep=true;device.linkLoss();await settle();
    await get('disconnect-button').trigger('click');device.asleep=false;
    const before=device.sent.length;await wait(3300);await settle();
    assert.equal(device.sent.length,before,'no traffic after the user disconnected');
  }finally{await restore();}
});
