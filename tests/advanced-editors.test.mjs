import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../dist/ui/advanced-editors.js').catch(()=>({}));
test('explicit recorder listens only while focused and detaches on blur, tab hide and destroy',()=>{
 assert.equal(typeof api.createMacroRecorder,'function','focus-only recorder required');
 class Surface extends EventTarget{visible=true;hasFocus(){return this.visible;}hidden=false;}
 const win=new Surface(),doc=new Surface(),events=[];const recorder=api.createMacroRecorder({window:win,document:doc,onEvent:e=>events.push(e)});
 const key=(type,code='KeyA',repeat=false,timeStamp=10)=>{const e=new Event(type,{cancelable:true});Object.defineProperties(e,{code:{value:code},repeat:{value:repeat},timeStamp:{value:timeStamp}});win.dispatchEvent(e);return e;};
 assert.equal(key('keydown').defaultPrevented,false);recorder.start();assert.equal(key('keydown').defaultPrevented,true);key('keydown','KeyA',true);key('keyup','KeyA',false,523);assert.equal(events.length,2);assert.equal(events[1].delayMs,513);
 win.dispatchEvent(new Event('blur'));assert.equal(recorder.recording,false);assert.equal(key('keydown').defaultPrevented,false);recorder.start();doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(recorder.recording,false);
 doc.hidden=false;recorder.start();recorder.destroy();assert.equal(key('keydown').defaultPrevented,false);assert.throws(()=>recorder.start(),/destroy/);
});

test('actual host locks editors during Apply and preserves unsaved macro input after failure',async()=>{
 const {identifyDevice,readPlan}=await import('../dist/device/capabilities.js');const {A80Reader,A80Transport,ConfigSession}=await import('../dist/protocol.js');
 const cap=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
 class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.style={setProperty(){}};this.classList={toggle(){}};this.textContent='';}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}async trigger(t,event={}){await this.listeners.get(t)?.({target:this,...event});}querySelectorAll(){return this.children.flatMap(c=>[c,...(c.querySelectorAll?.()??[])]).filter(c=>['input','select','button'].includes(c.tag));}}
 const all=[],roots=new Map(),get=id=>all.findLast(el=>el.id===id)??roots.get(id)??(()=>{const el=new Element();roots.set(id,el);return el;})();
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const device=new EventTarget();Object.assign(device,{vendorId:cap.vendorId,productId:cap.productId,productName:cap.name,opened:false,collections:[{usagePage:0xff80,usage:1,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}],async open(){this.opened=true;},async close(){this.opened=false;}});
 const hid=new EventTarget();hid.requestDevice=async()=>[device];globalThis.document=Object.assign(new EventTarget(),{getElementById:get,createElement:tag=>{const el=new Element(tag);all.push(el);return el;},createTextNode:text=>({textContent:text}),hasFocus:()=>true});globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
 const oldRead=A80Reader.prototype.readConfiguration,oldQualification=A80Transport.prototype.getWriteState,oldApply=ConfigSession.prototype.apply;let release,activeSession;
 A80Reader.prototype.readConfiguration=async function(){const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));for(const slot of cap.slots)blocks.rt[slot*8]=1;blocks.fn.set([2,0,0x3a,0],0);return {identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'device',sessionId:this.getState().sessionId}};};
 A80Transport.prototype.getWriteState=()=>({qualified:true,ready:true,evidence:'synthetic host busy-state fixture only',reason:null});ConfigSession.prototype.apply=function(){activeSession=this;return new Promise(resolve=>release=resolve);};
 let applying;
 try{
  await import('../dist/app.js?task5-host-regression');await get('connect-button').trigger('click');await get('read-button').trigger('click');
  assert.equal(get('settings-sleep').tag,'input');get('settings-sleep').value='31';await get('settings-sleep').trigger('change');assert.match(get('settings-status').textContent,/30/);
  await get('macro-add-event').trigger('click');await get('macro-save').trigger('click');assert.match(get('draft-count').textContent,/1 thay đổi/);
  await get('macro-add-event').trigger('click');const delay=all.filter(el=>el.attributes['aria-label']==='Delay ms sự kiện 2').at(-1);delay.value='123';await delay.trigger('change');
  assert.equal(get('apply-button').disabled,false);applying=get('apply-button').trigger('click');assert.equal(get('core-pressMm').disabled,true);assert.equal(get('macro-save').disabled,true);assert.equal(get('settings-sleep').disabled,true);assert.equal(get('apply-button').disabled,true);assert.equal(activeSession.diff().length,1);
  release({status:'failed',error:'Synthetic write gate failure'});await applying;assert.equal(delay.value,'123');assert.equal(get('settings-sleep').value,'31');assert.equal(get('settings-sleep').disabled,false);assert.equal(get('macro-save').disabled,false);assert.equal(activeSession.diff().length,1);assert.match(get('message').textContent,/Synthetic write gate failure/);
  await get('macro-record-start').trigger('click');assert.equal(get('macro-record-stop').disabled,false);await get('device-settings').trigger('focusin');assert.equal(get('macro-record-stop').disabled,true);await get('macro-record-start').trigger('click');await get('settings-tab-firmware').trigger('click');assert.equal(get('macro-record-stop').disabled,true);assert.equal(delay.value,'123');
  await get('disconnect-button').trigger('click');
 }finally{if(release)release({status:'failed',error:'cleanup'});await applying;A80Reader.prototype.readConfiguration=oldRead;A80Transport.prototype.getWriteState=oldQualification;ConfigSession.prototype.apply=oldApply;globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});


test('Escape provides a keyboard exit from recording and returns normal keyboard handling',()=>{
 const win=new EventTarget(),doc=new EventTarget();doc.hasFocus=()=>true;const events=[];const recorder=api.createMacroRecorder({window:win,document:doc,onEvent:e=>events.push(e)});recorder.start();const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'code',{value:'Escape'});win.dispatchEvent(escape);assert.equal(recorder.recording,false);assert.equal(events.length,0);recorder.destroy();
});

test('actual host stops recording on core entry and tab navigation while retaining the unsaved timeline',async t=>{
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.style={setProperty(){}};this.classList={toggle(){}};this.textContent='';}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}
  addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}
  async trigger(type,event={}){const e=event instanceof Event?event:{target:this,...event};for(let el=this;el;el=el.parentElement)await el.listeners?.get(type)?.(e);}
  focus(){this.trigger('focusin');}querySelectorAll(){return this.children.flatMap(c=>[c,...(c.querySelectorAll?.()??[])]).filter(c=>['input','select','button'].includes(c.tag));}
 }
 const old={document:globalThis.document,window:globalThis.window,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 const elements=[],roots=new Map(),get=id=>elements.findLast(el=>el.id===id)??roots.get(id)??(()=>{const el=new Element();roots.set(id,el);return el;})();
 globalThis.document=Object.assign(new EventTarget(),{getElementById:get,createElement:tag=>{const el=new Element(tag);elements.push(el);return el;},createTextNode:text=>({textContent:text}),hasFocus:()=>true});
 globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid:new EventTarget()}});
 const key=code=>{const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{code:{value:code},repeat:{value:false}});window.dispatchEvent(event);return event;};
 const timeline=()=>elements.findLast(el=>el.attributes['aria-label']==='Dòng thời gian macro');
 try{
  await import('../dist/app.js?final-core-recorder');await get('sample-button').trigger('click');
  for(const [name,exit]of [
   ['pointer into a core input',()=>get('core-actuationMm').trigger('pointerdown')],
   ['focus into a core input',()=>get('core-actuationMm').trigger('focusin')],
   ['core RGB tab click',()=>get('editor-tab-rgb').trigger('click')],
   ['core tab keyboard navigation',async()=>{const event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{key:{value:'ArrowRight'},code:{value:'ArrowRight'}});await get('editor-tab-rt').trigger('keydown',event);window.dispatchEvent(event);assert.equal(get('editor-tab-binding').attributes['aria-selected'],'true');}]
  ])await t.test(name,async()=>{
   await get('editor-tab-rt').trigger('click');await get('macro-new').trigger('click');await get('macro-add-event').trigger('click');const delay=elements.findLast(el=>el.attributes['aria-label']==='Delay ms sự kiện 1');delay.value='123';await delay.trigger('change');
   await get('macro-record-start').trigger('pointerdown');await get('macro-record-start').trigger('focusin');await get('macro-record-start').trigger('click');
   try{
    await get('macro-record-stop').trigger('focusin');await get('advanced-editors').trigger('pointerdown');assert.equal(get('macro-record-stop').disabled,false,'macro controls keep explicit recording usable');
    assert.equal(key('KeyA').defaultPrevented,true);assert.equal(timeline().children.length,2);await exit();
    assert.equal(get('macro-record-stop').disabled,true);assert.equal(key('KeyB').defaultPrevented,false);assert.equal(timeline().children.length,2);assert.equal(elements.findLast(el=>el.attributes['aria-label']==='Delay ms sự kiện 1').value,'123');assert.match(get('draft-count').textContent,/^0 /);
   }finally{await get('macro-record-stop').trigger('click');}
  });
 }finally{globalThis.document=old.document;globalThis.window=old.window;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;}
});

test('a blank receiver copy (Fn layer all zeros) blocks Apply and asks for the cable',async()=>{
 const {identifyDevice,readPlan}=await import('../dist/device/capabilities.js');const {A80Reader,A80Transport,ConfigSession}=await import('../dist/protocol.js');
 const cap=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
 class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.style={setProperty(){}};this.classList={toggle(){}};this.textContent='';}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}async trigger(t,event={}){await this.listeners.get(t)?.({target:this,...event});}querySelectorAll(){return this.children.flatMap(c=>[c,...(c.querySelectorAll?.()??[])]).filter(c=>['input','select','button'].includes(c.tag));}}
 const all=[],roots=new Map(),get=id=>all.findLast(el=>el.id===id)??roots.get(id)??(()=>{const el=new Element();roots.set(id,el);return el;})();
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const device=new EventTarget();Object.assign(device,{vendorId:cap.vendorId,productId:cap.productId,productName:cap.name,opened:false,collections:[{usagePage:0xff80,usage:1,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}],async open(){this.opened=true;},async close(){this.opened=false;}});
 const hid=new EventTarget();hid.requestDevice=async()=>[device];globalThis.document=Object.assign(new EventTarget(),{getElementById:get,createElement:tag=>{const el=new Element(tag);all.push(el);return el;},createTextNode:text=>({textContent:text}),hasFocus:()=>true});globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
 const oldRead=A80Reader.prototype.readConfiguration,oldQualification=A80Transport.prototype.getWriteState;
 A80Transport.prototype.getWriteState=()=>({qualified:true,ready:true,evidence:'synthetic receiver fixture only',reason:null});
 A80Reader.prototype.readConfiguration=async function(){const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));for(const slot of cap.slots)blocks.rt[slot*8]=1;return {identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'device',sessionId:this.getState().sessionId}};};
 try{
  await import('../dist/app.js?receiver-blank-copy');await get('connect-button').trigger('click');await get('read-button').trigger('click');
  await get('macro-add-event').trigger('click');await get('macro-save').trigger('click');assert.match(get('draft-count').textContent,/1 thay đổi/);
  assert.equal(get('apply-button').disabled,true);assert.match(get('apply-reason').textContent,/Đầu thu trả về cấu hình trống.*cáp USB/);
  await get('disconnect-button').trigger('click');
 }finally{A80Reader.prototype.readConfiguration=oldRead;A80Transport.prototype.getWriteState=oldQualification;globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});
