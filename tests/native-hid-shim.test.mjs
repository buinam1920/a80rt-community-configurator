import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../scripts/native/hid-shim.js',import.meta.url),'utf8');
const dongle={path:'\\\\?\\hid#vid_0c45&pid_fefc&mi_02',vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle',
  collections:[{usagePage:0xff80,usage:1,inputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}],outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}],featureReports:[],children:[]}]};
const other={...dongle,path:'\\\\?\\hid#vid_0c45&pid_fefc&mi_03',collections:[{...dongle.collections[0],usagePage:0xff70,usage:0x71}]};

// A sandboxed page with a fake WebView2 channel; the host side is driven by the test.
function page(){
  const webview=new EventTarget(),sent=[];
  webview.postMessage=text=>sent.push(JSON.parse(text));
  const context=vm.createContext({EventTarget,Event,DOMException,DataView,Uint8Array,ArrayBuffer,btoa,atob,JSON,Promise,Object,String,Map});
  context.window=context;context.chrome={webview};context.Navigator=class Navigator{};context.navigator=new context.Navigator();
  vm.runInContext(source,context);
  const host=message=>{const event=new Event('message');event.data=message;webview.dispatchEvent(event);};
  const reply=(result,ok=true,extra={})=>{const request=sent.at(-1);host({kind:'reply',id:request.id,ok,result,...extra});};
  return {hid:context.navigator.hid,sent,host,reply,context};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('getDevices and requestDevice use the host list, keep device identity and apply the app filters',async()=>{
  const {hid,sent,reply}=page();
  const listing=hid.getDevices();await tick();assert.deepEqual(sent.at(-1),{id:1,op:'list'});reply([dongle,other]);
  const [a,b]=await listing;assert.equal(a.productName,'A80RT U Dongle');assert.equal(a.collections[0].usagePage,0xff80);assert.equal(a.opened,false);
  const chosen=hid.requestDevice({filters:[{vendorId:0x0c45,productId:0xfefc,usagePage:0xff80,usage:1}]});await tick();reply([dongle,other]);
  const picked=await chosen;assert.equal(picked.length,1);assert.equal(picked[0],a,'same object for the same path');assert.notEqual(b,a);
});

test('open, sendReport and inputreport pass bytes through unchanged',async()=>{
  const {hid,sent,host,reply}=page();
  const listing=hid.getDevices();await tick();reply([dongle]);const [device]=await listing;
  await assert.rejects(device.sendReport(0,new Uint8Array([1])),{name:'InvalidStateError'});
  const opening=device.open();await tick();assert.equal(sent.at(-1).op,'open');assert.equal(sent.at(-1).path,dongle.path);reply(null);await opening;assert.equal(device.opened,true);
  const packet=Uint8Array.from([0xaa,0x10,24,0,0,0,0,0,...new Array(24).fill(0)]);
  const sending=device.sendReport(0,packet);await tick();
  const request=sent.at(-1);assert.equal(request.op,'send');assert.equal(request.reportId,0);assert.deepEqual([...Buffer.from(request.data,'base64')],[...packet]);
  reply(null);await sending;
  const received=[];device.addEventListener('inputreport',event=>received.push([event.reportId,[...new Uint8Array(event.data.buffer)],event.device===device]));
  const answer=Uint8Array.from([0x55,0x10,24,0,0,0,0,0,7,7,7]);
  host({kind:'input',path:dongle.path,reportId:0,data:Buffer.from(answer).toString('base64')});
  assert.deepEqual(received,[[0,[...answer],true]]);
});

test('host errors reject with a DOMException and a closed device ignores input',async()=>{
  const {hid,host,reply}=page();
  const listing=hid.getDevices();await tick();reply([dongle]);const [device]=await listing;
  const opening=device.open();await tick();reply(undefined,false,{error:'Windows từ chối mở thiết bị',name:'NotAllowedError'});
  await assert.rejects(opening,{name:'NotAllowedError',message:/từ chối/});assert.equal(device.opened,false);
  let count=0;device.addEventListener('inputreport',()=>count++);
  host({kind:'input',path:dongle.path,reportId:0,data:'VQ=='});assert.equal(count,0);
});

test('connect and disconnect events carry the device object the app compares against',async()=>{
  const {hid,host,reply}=page();
  const seen=[];hid.addEventListener('connect',event=>seen.push(['connect',event.device.productName]));hid.addEventListener('disconnect',event=>seen.push(['disconnect',event.device]));
  const listing=hid.getDevices();await tick();reply([dongle]);const [device]=await listing;
  const opening=device.open();await tick();reply(null);await opening;
  host({kind:'disconnect',path:dongle.path});
  assert.equal(seen[0][0],'disconnect');assert.equal(seen[0][1],device);assert.equal(device.opened,false);
  host({kind:'connect',device:dongle});assert.deepEqual(seen[1],['connect','A80RT U Dongle']);
});
