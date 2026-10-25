import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {decodeBlock,patchBlock} from '../dist/config/codecs.js';
import {A80Transport} from '../dist/device/transport.js';
import {ConfigSession,readSnapshot} from '../dist/config/session.js';
import {mountCoreEditors} from '../dist/ui/core-editors.js';
import {mountAdvancedEditors} from '../dist/ui/advanced-editors.js';
const ui=await import('../dist/ui/device-settings.js').catch(()=>({}));
const wired=identifyDevice({vendorId:0x0c45,productId:0x80a2,productName:'A80RT'});
const dongle=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
const api=()=>{assert.equal(typeof ui.settingsView,'function','model settings view required');assert.equal(typeof ui.runDeviceAction,'function','maintenance lifecycle required');return ui;};
const blocksFor=cap=>Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
function snapshot(cap=wired,source='device'){
 const blocks=blocksFor(cap);blocks.device[8]=0x23;blocks.device[9]=1;blocks.device[17]=78;blocks.device[20]=42;blocks.settings[3]=4;blocks.settings[5]=6;blocks.settings[11]=1;
 return {identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source}};
}
// Synthetic ACKs exercise the internal boundary only; NO measured maintenance policy exists.
class Device extends EventTarget{
 constructor(cap=wired,size=64){super();Object.assign(this,cap.identity);this.opened=false;this.sent=[];this.blocks=blocksFor(cap);this.collections=[{usagePage:0xff80,usage:1,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:size}]}]}];}
 async open(){this.opened=true;}async close(){this.opened=false;}
 emit(bytes){const e=new Event('inputreport');e.reportId=0;e.data=new DataView(bytes.buffer);this.dispatchEvent(e);}
 async sendReport(id,p){assert.equal(id,0);this.sent.push(p.slice());if(this.beforeSend)await this.beforeSend(p);if(this.silent?.(p))return;const response=new Uint8Array(p.length);response.set([0x55,p[1],p[2],p[3],p[4]]);if(p[1]>=16&&p[1]<=24){const b=Object.entries(wired.blocks).find(([,b])=>b.command===p[1]);response.set(this.blocks[b[0]].slice(p[3]|p[4]<<8,(p[3]|p[4]<<8)+p[2]),8);}queueMicrotask(()=>this.emit(response));}
}
class Qualified extends A80Transport{
 _getMaintenanceQualification(){return {evidence:'synthetic maintenance fixture only',parseAck:(bytes,{command})=>bytes[0]===0x55&&bytes[1]===command?{acknowledged:true}:null};}
}
async function setup({qualified=true,cap=wired,size=64}={}){const device=new Device(cap,size),transport=new (qualified?Qualified:A80Transport)(device,{timeoutMs:15});await transport.open();return {device,transport,capability:cap};}

test('dongle hides polling/manual and wired hides idle; OS/wake stay unavailable',()=>{
 const {settingsView}=api();const d=settingsView(dongle,snapshot(dongle)),w=settingsView(wired,snapshot());
 assert.deepEqual(d.fields.map(f=>f.id),['sleep','stability','autoCalibration','topDeadZone','bottomDeadZone']);assert.deepEqual(w.fields.map(f=>f.id),['polling','stability','autoCalibration','topDeadZone','bottomDeadZone']);assert.equal(d.actions.manualCalibration.supported,false);assert.equal(w.actions.manualCalibration.supported,true);assert.deepEqual(w.fields[0].options.map(o=>o.value),[3,5,6]);
});
test('settings patch owns only the requested offsets and rejects unknown OS/wake encodings',()=>{
 const raw=Uint8Array.from({length:32},(_,i)=>170+i),before=raw.slice();
 const patched=patchBlock('settings',raw,[{field:'stability',value:1},{field:'autoCalibration',value:0},{field:'sleep',value:30}],dongle).bytes;
 for(let i=0;i<32;i++)assert.equal(patched[i],i===3?30:i===11?1:i===14?0:before[i]);assert.deepEqual(raw,before);
 for(const field of ['wake','osMode','polling'])assert.throws(()=>patchBlock('settings',raw,[{field,value:1}],dongle),/unsupported/);
});
test('only complete valid actual device bytes produce firmware/battery values',()=>{
 const {settingsView}=api(),live=snapshot(),v=settingsView(wired,live);assert.equal(v.info.version,'1.23');assert.equal(v.info.battery,78);
 for(const source of ['sample','import','unknown'])assert.deepEqual(settingsView(wired,snapshot(wired,source)).info,{version:null,battery:null,axialModel:null});
 live.blocks.device[8]=0xfa;live.blocks.device[17]=255;assert.equal(settingsView(wired,live).info.version,null);assert.equal(settingsView(wired,live).info.battery,null);
 live.coverage.device.complete=false;assert.equal(settingsView(wired,live).info.axialModel,null);
 assert.equal(decodeBlock('device',live.blocks.device,wired).fields.version,null);assert.equal(decodeBlock('device',live.blocks.device,wired).fields.battery,null);
});
test('production maintenance stays gated independently from ordinary write qualification',async()=>{
 const {runDeviceAction}=api(),ctx=await setup({qualified:false});try{for(const type of ['beginCalibration','reset']){const result=await runDeviceAction(type,ctx);assert.equal(result.status,'unsupported');assert.equal(result.requiresReload,false);assert.match(result.reason,/ACK|xác minh/);}assert.equal(ctx.device.sent.length,0);assert.equal(ctx.transport.getState().writeEpoch,0);}finally{await ctx.transport.close();}
});
test('qualified start/end use compact packets, reserve the whole lifecycle and invalidate Apply',async()=>{
 const {runDeviceAction}=api(),ctx=await setup(),captured=await readSnapshot(ctx.transport,wired),session=new ConfigSession(captured,wired);ctx.device.sent=[];session.edit('settings',[{field:'stability',value:1}]);
 try{const started=await runDeviceAction('beginCalibration',{...ctx,session});assert.equal(started.status,'active');assert.equal(session.invalidated,true);assert.throws(()=>session.edit('settings',[{field:'stability',value:0}]),/snapshot|đọc lại/i);assert.equal((await session.apply(ctx.transport)).status,'failed');await assert.rejects(ctx.transport.readBlock(16,32),/giao dịch/);
 const end=await runDeviceAction('endCalibration',ctx);assert.equal(end.status,'unconfirmed');assert.equal(end.requiresReload,true);assert.equal(ctx.transport.getState().writeEpoch,2);
 assert.deepEqual(ctx.device.sent.map(p=>Array.from(p.slice(0,8))),[[170,100,0,0,0,0,0,0],[170,101,0,0,0,0,0,0]]);assert.ok(ctx.device.sent.every(p=>p.length===64&&p.slice(2).every(b=>b===0)));
 const stale=await session.apply(ctx.transport);assert.equal(stale.status,'failed');assert.match(stale.error,/snapshot|đọc lại/i);
 }finally{await runDeviceAction('cancelCalibration',ctx);await ctx.transport.close();}
});
test('cancel and abort send end101 once and never destructive calibration-clear15/5',async()=>{
 const {runDeviceAction}=api(),ctx=await setup({size:32}),abort=new AbortController();try{await runDeviceAction('beginCalibration',{...ctx,signal:abort.signal});abort.abort();const result=await runDeviceAction('cancelCalibration',ctx);assert.equal(result.requiresReload,true);assert.match(result.reason,/lưu|hoàn tác/);assert.deepEqual(ctx.device.sent.map(p=>p[1]),[100,101]);assert.equal(ctx.device.sent[1].length,32);await runDeviceAction('cancelCalibration',ctx);assert.equal(ctx.device.sent.length,2);}finally{await ctx.transport.close();}
});
test('aborted start waiting for ACK still attempts end101 without claiming completion',async()=>{
 const {runDeviceAction}=api(),ctx=await setup(),abort=new AbortController();ctx.device.silent=p=>p[1]===100;
 try{const pending=runDeviceAction('beginCalibration',{...ctx,signal:abort.signal});for(let i=0;i<100&&!ctx.device.sent.length;i++)await new Promise(r=>setImmediate(r));assert.equal(ctx.device.sent[0]?.[1],100);abort.abort();const result=await pending;assert.equal(result.status,'unconfirmed');assert.deepEqual(ctx.device.sent.map(p=>p[1]),[100,101]);
 }finally{await ctx.transport.close();}
});
test('reset has explicit full-device confirmation, compact scope and never claims completion',async()=>{
 const {runDeviceAction}=api(),ctx=await setup(),s=new ConfigSession(snapshot(),wired);try{assert.equal((await runDeviceAction('reset',{...ctx,session:s})).status,'confirmation-required');assert.equal(ctx.device.sent.length,0);
 for(const confirmed of ['false',1,{}])assert.equal((await runDeviceAction({type:'reset',confirmed},{...ctx,session:s})).status,'confirmation-required');assert.equal(ctx.device.sent.length,0);
 const r=await runDeviceAction({type:'reset',confirmed:true},{...ctx,session:s});assert.equal(r.status,'unconfirmed');assert.equal(r.requiresReload,true);assert.equal(s.invalidated,true);assert.deepEqual(Array.from(ctx.device.sent[0].slice(0,8)),[170,15,255,0,0,0,0,0]);assert.match(r.reason,/đọc lại/);
 }finally{await ctx.transport.close();}
});
test('reset and Apply/read reservation exclude each other without queuing a later reset',async()=>{
 const {runDeviceAction}=api(),ctx=await setup();let release;const hold=ctx.transport.withTransaction(()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));try{await assert.rejects(runDeviceAction({type:'reset',confirmed:true},ctx),/giao dịch/);assert.equal(ctx.device.sent.length,0);}finally{release();await hold;await ctx.transport.close();}
});
test('wrong model/image is rejected; official handoff only reports page opened and direct flash stays unsupported',async()=>{
 const {runDeviceAction}=api(),opened=[],ctx={capability:wired,openOfficial:url=>{opened.push(url);return {};}};
 assert.equal((await runDeviceAction({type:'firmware',model:dongle.model},ctx)).status,'rejected');assert.equal((await runDeviceAction({type:'firmware',model:wired.model,image:new Uint8Array(2)},ctx)).status,'unsupported');assert.equal(opened.length,0);
 const r=await runDeviceAction({type:'firmware',model:wired.model},ctx);assert.equal(r.status,'external-opened');assert.equal(r.requiresReload,false);assert.deepEqual(opened,['https://leobog.driveall.cn/']);assert.match(r.reason,/A80RT/);assert.match(r.reason,/chưa.*flash|không.*flash/);
 assert.equal((await runDeviceAction({type:'flash',model:wired.model},ctx)).status,'unsupported');
});

class Element extends EventTarget{
 constructor(tag='div'){super();this.tag=tag;this.children=[];this.value='';this.disabled=false;this.hidden=false;this.attributes={};this.textContent='';this.style={setProperty(){}};this.classList={toggle(){}};}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}
 get options(){return this.children;}focus(){this.focused=true;}
 querySelectorAll(){return this.children.flatMap(child=>[child,...(child.querySelectorAll?.()??[])]).filter(child=>['input','select','button'].includes(child.tag));}
 async trigger(type,properties={}){const event=new Event(type,{cancelable:true});Object.defineProperty(event,'target',{value:this});for(const [key,value]of Object.entries(properties))Object.defineProperty(event,key,{value});this.dispatchEvent(event);await new Promise(r=>setImmediate(r));}
}
async function mountContext(ctx){
 assert.equal(typeof ui.mountDeviceSettings,'function','mounted settings controls required');
 const elements=[],doc=new EventTarget(),win=new EventTarget();doc.createElement=tag=>{const el=new Element(tag);elements.push(el);return el;};doc.hidden=false;
 const session=ctx.session??new ConfigSession(snapshot(ctx.capability),ctx.capability),root=new Element();const mount=ui.mountDeviceSettings(root,{...ctx,session,document:doc,window:win});
 return {mount,root,doc,win,session,get:id=>elements.find(e=>e.id===id)};
}
test('mounted settings stage only explicit valid changes and retain failed numeric input',async()=>{
 api();const v=await mountContext({capability:dongle});try{assert.equal(v.get('settings-polling'),undefined);const input=v.get('settings-sleep');input.value='31';await input.trigger('change');assert.equal(input.value,'31');assert.equal(v.session.diff().length,0);assert.match(v.get('settings-status').textContent,/30/);input.value='8';await input.trigger('change');assert.equal(v.session.diff()[0].path,'fields.sleep');assert.equal(v.session.draft.settings[3],8);assert.equal(v.session.draft.settings[6],0);}finally{await v.mount.destroy();}
});
test('changing tabs, hidden page and destroy end a qualified calibration exactly once',async()=>{
 api();for(const exit of ['tab','hidden','destroy']){const ctx=await setup(),v=await mountContext(ctx);try{await v.get('settings-tab-maintenance').trigger('click');await v.get('settings-calibration-begin').trigger('click');assert.equal(v.get('settings-calibration-cancel').disabled,false);
 if(exit==='tab')await v.get('settings-tab-general').trigger('click');else if(exit==='hidden'){v.doc.hidden=true;await v.doc.dispatchEvent(new Event('visibilitychange'));await new Promise(r=>setImmediate(r));}else await v.mount.destroy();
 assert.deepEqual(ctx.device.sent.map(p=>p[1]),[100,101]);assert.equal(v.session.invalidated,true);
 }finally{await v.mount.destroy();await ctx.transport.close();}}
});
test('unqualified mounted maintenance has reasons and cannot send; firmware never shows sample values',async()=>{
 api();const ctx=await setup({qualified:false}),v=await mountContext({...ctx,session:new ConfigSession(snapshot(wired,'sample'),wired)});try{assert.equal(v.get('settings-calibration-begin').disabled,true);assert.equal(v.get('settings-reset').disabled,true);assert.match(v.get('settings-maintenance-reason').textContent,/ACK/);assert.match(v.get('settings-device-info').textContent,/Chưa có/);await v.get('settings-calibration-begin').trigger('click');assert.equal(ctx.device.sent.length,0);}finally{await v.mount.destroy();await ctx.transport.close();}
});
test('transport close and receiver link-loss release the lifecycle without waiting for another UI action',async()=>{
 const {runDeviceAction}=api();for(const loss of ['close','receiver']){const ctx=await setup(),progress=[];try{await runDeviceAction('beginCalibration',{...ctx,onProgress:event=>progress.push(event)});if(loss==='close')await ctx.transport.close();else{const packet=new Uint8Array(64);packet.set([0x55,0xfc,4,0,0]);ctx.device.emit(packet);}await new Promise(r=>setImmediate(r));
 const ended=progress.find(event=>event.phase==='ended');assert.ok(ended,'session end must finish the calibration lifecycle');assert.equal(ended.result.status,'unconfirmed');assert.equal(ended.result.requiresReload,true);assert.deepEqual(ctx.device.sent.map(p=>p[1]),[100]);await ctx.transport.open();assert.equal((await ctx.transport.readBlock(16,32)).length,32);
 }finally{await runDeviceAction('cancelCalibration',ctx);await ctx.transport.close();}}
});
test('an unconfirmed model cannot use the fallback display capability to open a firmware route',async()=>{
 api();const v=await mountContext({capability:wired,modelConfirmed:false});try{assert.equal(v.get('settings-official').disabled,true);}finally{await v.mount.destroy();}
});

for(const [name,mountEditor,tabId,panelId]of [
 ['core',mountCoreEditors,'editor-tab-rt','editor-panel-binding'],
 ['advanced',mountAdvancedEditors,'advanced-tab-macro','advanced-panel-advanced'],
])test(`actual ${name} keyboard tab navigation ends calibration once and releases its reservation`,async()=>{
 api();const oldDocument=globalThis.document,oldWindow=globalThis.window;
 for(const key of ['ArrowRight','ArrowLeft','Home','End']){
  const ctx=await setup(),v=await mountContext(ctx);let editor;
  try{
   globalThis.document=v.doc;globalThis.window=v.win;
   const root=new Element();editor=mountEditor(root,{session:v.session,capability:wired,selectedSlots:[34],onNavigate:()=>v.mount.cancelCalibration()});
   await v.get('settings-tab-maintenance').trigger('click');await v.get('settings-calibration-begin').trigger('click');
   assert.deepEqual(ctx.device.sent.map(packet=>packet[1]),[100]);await assert.rejects(ctx.transport.readBlock(16,32),/giao dịch/);
   await v.get(tabId).trigger('keydown',{key});
   assert.deepEqual(ctx.device.sent.map(packet=>packet[1]),[100,101],`${key} must end the active calibration`);
   assert.equal(v.session.invalidated,true);assert.equal(v.get('settings-calibration-cancel').disabled,true);
   if(key==='ArrowRight')assert.equal(v.get(panelId).hidden,false,'the actual editor must switch its panel');
   assert.equal((await ctx.transport.readBlock(16,32)).length,32,'navigation must release transport reservation');
   await v.get(tabId).trigger('click');assert.equal(ctx.device.sent.filter(packet=>packet[1]===101).length,1,'follow-up click must not duplicate cleanup');
  }finally{editor?.destroy();await v.mount.destroy();await ctx.transport.close();globalThis.document=oldDocument;globalThis.window=oldWindow;}
 }
});

test('actual host connects both keyboard tablists to calibration cleanup',async()=>{
 api();const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldQualification=A80Transport.prototype._getMaintenanceQualification;
 const device=new Device(),hid=new EventTarget(),elements=[],roots=new Map(),doc=new EventTarget(),win=new EventTarget();
 const get=id=>elements.findLast(el=>el.id===id)??roots.get(id)??(()=>{const el=new Element();roots.set(id,el);return el;})();
 doc.getElementById=get;doc.createElement=tag=>{const el=new Element(tag);elements.push(el);return el;};doc.createTextNode=text=>({textContent:text});doc.hasFocus=()=>true;win.isSecureContext=true;hid.requestDevice=async()=>[device];
 globalThis.document=doc;globalThis.window=win;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
 A80Transport.prototype._getMaintenanceQualification=Qualified.prototype._getMaintenanceQualification;
 try{
  await import('../dist/app.js?task6-keyboard-navigation-host');await get('connect-button').trigger('click');
  for(const tabId of ['editor-tab-rt','advanced-tab-macro']){
   await get('read-button').trigger('click');device.sent=[];
   await get('settings-tab-maintenance').trigger('click');await get('settings-calibration-begin').trigger('click');
   assert.deepEqual(device.sent.map(packet=>packet[1]),[100]);await get(tabId).trigger('keydown',{key:'ArrowRight'});
   assert.deepEqual(device.sent.map(packet=>packet[1]),[100,101]);assert.match(get('apply-reason').textContent,/Snapshot.*đọc lại/);assert.equal(get('read-button').disabled,false);
   await get(tabId).trigger('click');assert.equal(device.sent.filter(packet=>packet[1]===101).length,1);
  }
 }finally{await get('disconnect-button').trigger('click');A80Transport.prototype._getMaintenanceQualification=oldQualification;globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});
