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
 const hid=new EventTarget();hid.requestDevice=async()=>[device];globalThis.document={getElementById:get,createElement:tag=>{const el=new Element(tag);all.push(el);return el;},createTextNode:text=>({textContent:text}),hasFocus:()=>true};globalThis.window={isSecureContext:true};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
 const oldRead=A80Reader.prototype.readConfiguration,oldQualification=A80Transport.prototype.getWriteState,oldApply=ConfigSession.prototype.apply;let release,activeSession;
 A80Reader.prototype.readConfiguration=async function(){const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));for(const slot of cap.slots)blocks.rt[slot*8]=1;return {identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'device',sessionId:this.getState().sessionId}};};
 A80Transport.prototype.getWriteState=()=>({qualified:true});ConfigSession.prototype.apply=function(){activeSession=this;return new Promise(resolve=>release=resolve);};
 let applying;
 try{
  await import('../dist/app.js?task5-host-regression');await get('connect-button').trigger('click');await get('read-button').trigger('click');
  await get('macro-add-event').trigger('click');await get('macro-save').trigger('click');assert.match(get('draft-count').textContent,/1 thay đổi/);
  await get('macro-add-event').trigger('click');const delay=all.filter(el=>el.attributes['aria-label']==='Delay ms sự kiện 2').at(-1);delay.value='123';await delay.trigger('change');
  applying=get('apply-button').trigger('click');assert.equal(get('core-pressMm').disabled,true);assert.equal(get('macro-save').disabled,true);assert.equal(get('apply-button').disabled,true);assert.equal(activeSession.diff().length,1);
  release({status:'failed',error:'Synthetic write gate failure'});await applying;assert.equal(delay.value,'123');assert.equal(get('macro-save').disabled,false);assert.equal(activeSession.diff().length,1);assert.match(get('message').textContent,/Synthetic write gate failure/);
  await get('disconnect-button').trigger('click');
 }finally{if(release)release({status:'failed',error:'cleanup'});await applying;A80Reader.prototype.readConfiguration=oldRead;A80Transport.prototype.getWriteState=oldQualification;ConfigSession.prototype.apply=oldApply;globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});


test('Escape provides a keyboard exit from recording and returns normal keyboard handling',()=>{
 const win=new EventTarget(),doc=new EventTarget();doc.hasFocus=()=>true;const events=[];const recorder=api.createMacroRecorder({window:win,document:doc,onEvent:e=>events.push(e)});recorder.start();const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'code',{value:'Escape'});win.dispatchEvent(escape);assert.equal(recorder.recording,false);assert.equal(events.length,0);recorder.destroy();
});
