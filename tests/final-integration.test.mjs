import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {patchBlock} from '../dist/config/codecs.js';
import {ConfigSession} from '../dist/config/session.js';
import * as profiles from '../dist/config/profiles.js';
const {createProfile,parseProfile,exportProfile,previewProfile,loadProfile}=profiles;
import {settingsView,mountDeviceSettings} from '../dist/ui/device-settings.js';
import {mountCoreEditors} from '../dist/ui/core-editors.js';
const caps=[[0x80a1,'A80RT U'],[0xfefc,'A80RT U Dongle'],[0x80a2,'A80RT']].map(([productId,productName])=>identifyDevice({vendorId:0x0c45,productId,productName}));
function session(cap=caps[0]){
 const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
 for(const slot of cap.slots)blocks.rt.set([1,246,100,0,20,0,30,0],slot*8);
 blocks.settings[0]=219;blocks.settings[8]=48;blocks.settings[9]=254;blocks.lighting[9]=3;blocks.lighting[10]=3;
 return new ConfigSession({identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}},cap);
}
test('RT central edits reject source-inapplicable flags and selectors atomically, preserving raw bits',()=>{
 for(const [i,cap]of caps.entries()){
  const s=session(cap),before=s.draft;
  for(const field of ['bottom','rtMode',...(i!==0?['switchId']:[]),...(i===2?['whole']:[])]){
   assert.throws(()=>s.edit('rt',[{slot:34,field:'actuationMm',value:1.2},{slot:34,field,value:field==='switchId'?2:true}]),new RegExp(field));assert.deepEqual(s.draft,before);
  }
  if(i<2){s.edit('rt',[{slot:34,field:'whole',value:true}]);assert.equal(s.draft.rt[273],247);}
 }
});
test('global zones are U source-backed raw hundredths, patch one byte and preserve unknown values',()=>{
 for(const cap of caps.slice(0,2)){
  const s=session(cap),fields=settingsView(cap,s.snapshot).fields;
  for(const id of ['topDeadZone','bottomDeadZone']){const f=fields.find(f=>f.id===id);assert.ok(f,'deadzone control required');assert.equal(f.min,0);assert.equal(f.max,0.5);assert.equal(f.step,0.01);assert.equal(f.scale,100);}
  s.edit('settings',[{field:'topDeadZone',value:25}]);assert.equal(s.draft.settings[8],25);assert.equal(s.draft.settings[9],254);assert.equal(s.draft.settings[0],219);
  assert.throws(()=>s.edit('settings',[{field:'bottomDeadZone',value:51}]),/bottomDeadZone/);
 }
 assert.equal(settingsView(caps[2],session(caps[2]).snapshot).fields.some(f=>f.id==='topDeadZone'),false);
 assert.throws(()=>patchBlock('settings',new Uint8Array(32),[{field:'topDeadZone',value:20}],caps[2]),/topDeadZone/);
});
test('profile projection skips unsupported RT edits but applies supported ones without clearing current opaque bits',()=>{
 for(const [i,cap]of caps.entries()){
  const s=session(cap),p=createProfile(s,'Cũ');p.blocks.rt[272]=2;p.blocks.rt[273]=1;p.blocks.rt[274]=120;
  const preview=previewProfile(p,s);assert.equal(s.draft.rt[273],246);assert.ok(preview.every(c=>!c.path.endsWith('.bottom')&&!c.path.endsWith('.rtMode')));
  loadProfile(p,s);assert.equal(s.draft.rt[273],i<2?247:246);assert.equal(s.draft.rt[272],i===0?2:1);assert.equal(s.draft.rt[274],120);
 }
});
test('profile preview explains each unsupported RT semantic difference without claiming a draft change',()=>{
 const s=session(caps[1]),p=createProfile(s,'Cũ');p.blocks.rt[272]=3;p.blocks.rt[273]=0;
 assert.equal(typeof profiles.profileSkippedFields,'function');assert.deepEqual(profiles.profileSkippedFields(p,s),[{block:'rt',path:'records[34].switchId'},{block:'rt',path:'records[34].bottom'},{block:'rt',path:'records[34].rtMode'}]);
 assert.deepEqual(s.diff(),[]);
});
test('v1 sample origin survives normalized export and legacy demo imports while staying view-only',()=>{
 for(const source of ['demo','sample']){const p=parseProfile(JSON.stringify({schema:'a80rt-reader/v1',source,device:caps[0].identity,blocks:{colors:Array(512).fill(0)}}),caps[0]);const round=parseProfile(exportProfile(p),caps[0]);assert.equal(round.source,'sample');assert.equal(round.readOnly,true);}
});
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.classList={toggle(){}};this.style={setProperty(){}};this.textContent='';}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);if(this.tag==='select'&&this.children.length===1)this.value=n.value;}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}async trigger(t,event={}){await this.listeners.get(t)?.({target:this,...event});}focus(){}querySelectorAll(){return [];}
}
test('mounted zone mm input stages raw value, preserves invalid captured partner and reverts cleanly',async()=>{
 const elements=[],doc=Object.assign(new EventTarget(),{createElement:tag=>{const el=new Element(tag);elements.push(el);return el;}}),s=session();
 const mount=mountDeviceSettings(new Element(),{session:s,capability:caps[0],document:doc,window:new EventTarget()}),get=id=>elements.find(e=>e.id===id);
 try{const top=get('settings-topDeadZone'),bottom=get('settings-bottomDeadZone');assert.ok(top,'top zone input');assert.equal(top.value,'0.48');assert.equal(bottom.value,'2.54');top.value='0.25';await top.trigger('change');assert.equal(s.draft.settings[8],25);assert.equal(s.draft.settings[9],254);assert.equal(s.diff().length,1);top.value='0.501';await top.trigger('change');assert.equal(top.value,'0.501');assert.equal(s.draft.settings[8],25);s.revert();mount.refresh();assert.equal(s.diff().length,0);}finally{await mount.destroy();}
});
test('RT UI offers only applicable flags and switch IDs, retaining explicit unknown raw selection',()=>{
 const old=globalThis.document;
 try{for(const [i,cap]of caps.entries()){
  const elements=[];globalThis.document={createElement:tag=>{const el=new Element(tag);elements.push(el);return el;}};const s=session(cap),raw=s.draft;raw.rt[272]=240;const current=new ConfigSession({...s.snapshot,blocks:raw},cap),mount=mountCoreEditors(new Element(),{session:current,capability:cap,selectedSlots:[34]}),get=id=>elements.find(e=>e.id===id);
  assert.equal(get('core-bottom'),undefined);assert.equal(get('core-rtMode'),undefined);assert.equal(get('core-whole')?.disabled,i===2?undefined:false);assert.equal(get('core-switchId')?.disabled,i===0?false:undefined);
  if(i===0){assert.equal(get('core-switchId').value,'240');assert.ok(get('core-switchId').options.some(o=>o.value==='240'&&/240/.test(o.textContent)));}
  mount.destroy();
 }}finally{globalThis.document=old;}
});
test('host recovery completion stays in the selected model library after an in-flight save',async()=>{
 const old={document:globalThis.document,window:globalThis.window,indexedDB:globalThis.indexedDB,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 const rows=new Map(),dongle=createProfile(session(caps[1]),'Phục hồi đầu thu');rows.set('recovery:3141|65276|A80RT U Dongle|dongle|a80rt-u-dongle',dongle);
 let finishSave,putStarted=false;const hold=new Promise(resolve=>finishSave=resolve);
 const db={transaction(){const tx={objectStore(){const requestFor=(action,wait=false)=>{const req={};setImmediate(async()=>{if(wait){putStarted=true;await hold;}req.result=action();req.onsuccess?.();tx.oncomplete?.();});return req;};return {get:key=>requestFor(()=>rows.get(key)),getAll:()=>requestFor(()=>[...rows.values()]),put:(value,key)=>requestFor(()=>rows.set(key,value),true),delete:key=>requestFor(()=>rows.delete(key))};}};return tx;}};
 globalThis.indexedDB={open(){const req={};setImmediate(()=>{req.result=db;req.onsuccess?.();});return req;}};
 const elements=[],roots=new Map(),get=id=>elements.findLast(el=>el.id===id)??roots.get(id)??(()=>{const el=new Element();roots.set(id,el);return el;})();
 globalThis.document=Object.assign(new EventTarget(),{getElementById:get,createElement:tag=>{const el=new Element(tag);elements.push(el);return el;},createTextNode:text=>({textContent:text}),hasFocus:()=>true});globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid:new EventTarget()}});
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 try{
  await import('../dist/app.js?task8-recovery-library');await settle();await get('sample-button').trigger('click');await settle();
  const input=get('core-actuationMm');input.value='1.25';await input.trigger('change');await new Promise(resolve=>setTimeout(resolve,375));assert.equal(putStarted,true);
  get('profile-model').value='a80rt-u-dongle';await get('profile-model').trigger('change');await settle();finishSave();await settle();
  assert.equal(get('profile-model').value,'a80rt-u-dongle','browsing a library must persist across draft refresh');assert.equal(get('profile-recover').disabled,false);await get('profile-recover').trigger('click');
  assert.match(get('profile-status').textContent,/identity|model/i,'dongle recovery must be selected, so loading into a wired session is rejected');assert.equal(get('profile-confirm').disabled,true);
 }finally{finishSave();await settle();globalThis.document=old.document;globalThis.window=old.window;globalThis.indexedDB=old.indexedDB;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;}
});
