import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {decodeMacros} from '../dist/config/macros.js';
import {decodePattern} from '../dist/config/advanced.js';
import {createProfile,loadProfile} from '../dist/config/profiles.js';
import {mountAdvancedEditors} from '../dist/ui/advanced-editors.js';
const cap=identifyDevice({vendorId:0x0c45,productId:0x80a1,productName:'A80RT U'});
const event=code=>({device:'keyboard',action:'down',code,delayMs:0});
function sample(codes=[]){
 const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));for(const slot of cap.slots)blocks.rt[slot*8]=1;
 const snapshot={identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}};
 const seed=new ConfigSession(snapshot,cap);if(codes.length)seed.edit('macro',[{field:'macros',value:codes.map(code=>({events:[event(code)]}))}]);return new ConfigSession({...snapshot,blocks:seed.draft},cap);
}
// Select value semantics intentionally match the browser: absent options yield ''.
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this._value='';this.disabled=false;this.hidden=false;this.textContent='';}
 get value(){return this._value;}set value(value){this._value=this.tag==='select'&&!this.children.some(o=>o.value===String(value))?'':String(value);}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);if(this.tag==='select'&&this.children.length===1)this.value=n.value;}}
 replaceChildren(...nodes){this.children=[];this._value='';this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}trigger(t,event={}){this.listeners.get(t)?.({target:this,...event});}querySelectorAll(){return this.children.flatMap(c=>[c,...(c.querySelectorAll?.()??[])]).filter(c=>['input','select','button'].includes(c.tag));}
}
function editor(session,fn){const old={document:globalThis.document,window:globalThis.window},elements=[];globalThis.document=Object.assign(new EventTarget(),{createElement:tag=>{const el=new Element(tag);elements.push(el);return el;},hasFocus:()=>true});globalThis.window=new EventTarget();const root=new Element(),mount=mountAdvancedEditors(root,{session,capability:cap,selectedSlots:[34]});const get=id=>elements.findLast(el=>el.id===id),click=id=>get(id).trigger('click'),timeline=()=>elements.findLast(el=>el.attributes['aria-label']==='Dòng thời gian macro'),input=label=>elements.findLast(el=>el.attributes['aria-label']===label),error=()=>elements.find(el=>el.attributes.role==='alert');try{fn({get,click,timeline,input,error,mount,elements});}finally{mount.destroy();globalThis.document=old.document;globalThis.window=old.window;}}

test('macro save/revert/save retains input and restores a valid selected source for repeated saves and assignment',()=>{
 const s=sample();editor(s,({get,click,timeline,input,error,mount,elements})=>{
  click('macro-add-event');click('macro-save');click('macro-add-event');const delay=input('Delay ms sự kiện 2');delay.value='123';delay.trigger('change');s.revert();mount.refresh();
  assert.equal(get('macro-select').value,'-1');assert.equal(get('macro-assign').disabled,true);assert.equal(timeline().children.length,2);assert.equal(input('Delay ms sự kiện 2'),delay);assert.equal(delay.value,'123');assert.ok(elements.some(el=>/giữ.*lưu|giữ.*chọn/i.test(el.textContent)));
  click('macro-save');assert.equal(error().hidden,true);assert.equal(get('macro-select').value,'0');click('macro-save');const macros=decodeMacros(s.draft.macro,cap);assert.equal(macros.length,1);assert.deepEqual(macros[0].events.map(e=>e.delayMs),[0,123]);click('macro-assign');assert.deepEqual(s.draft.keymap.slice(136,140),Uint8Array.of(6,0,0,1));
 });
});

test('same-count profile replacement detaches source and stops recording before stale assignment without changing input',()=>{
 const s=sample([4]);editor(s,({get,click,timeline,input,error})=>{
  get('macro-select').value='0';get('macro-select').trigger('change');click('macro-add-event');const delay=input('Delay ms sự kiện 2');delay.value='321';delay.trigger('change');click('macro-record-start');assert.equal(get('macro-record-stop').disabled,false);
  loadProfile(createProfile(sample([5]),'Thay thế'),s);const before=s.draft;click('macro-assign');assert.deepEqual(s.draft,before);assert.match(error().textContent,/Lưu|chọn/);assert.equal(get('macro-record-stop').disabled,true);assert.equal(timeline().children.length,2);assert.equal(input('Delay ms sự kiện 2'),delay);assert.equal(delay.value,'321');
  click('macro-save');const macros=decodeMacros(s.draft.macro,cap);assert.equal(macros.length,2);assert.equal(macros[0].events[0].code,5);assert.deepEqual(macros[1].events.map(e=>e.code),[4,4]);assert.equal(macros[1].events[1].delayMs,321);
  get('macro-select').value='0';get('macro-select').trigger('change');click('macro-assign');assert.equal(s.draft.keymap[137],0);
 });
});

test('shorter external profile is synchronized before save/delete and cannot overwrite or clear retained input',()=>{
 for(const action of ['macro-save','macro-delete']){const s=sample([4,5]);editor(s,({get,click,timeline,error})=>{
  get('macro-select').value='1';get('macro-select').trigger('change');click('macro-add-event');loadProfile(createProfile(sample([6]),'Ngắn hơn'),s);click(action);
  const macros=decodeMacros(s.draft.macro,cap);assert.equal(macros[0].events[0].code,6);assert.equal(timeline().children.length,2);if(action==='macro-save'){assert.equal(error().hidden,true);assert.equal(macros.length,2);assert.equal(macros[1].events[0].code,5);}else{assert.match(error().textContent,/Chọn/);assert.equal(macros.length,1);}
 });}
});

test('unrelated refresh and macro edits keep an unchanged selected source; own New and delete still clear input',()=>{
 const s=sample([4,5]);editor(s,({get,click,timeline,mount})=>{
  get('macro-select').value='0';get('macro-select').trigger('change');click('macro-add-event');s.edit('colors',[{slot:34,field:'rgb',value:{red:1,green:2,blue:3}}]);const macros=decodeMacros(s.draft.macro,cap);macros[1].events[0].code=6;s.edit('macro',[{field:'macros',value:macros}]);mount.setSelection([49]);mount.refresh();assert.equal(get('macro-select').value,'0');assert.equal(timeline().children.length,2);click('macro-save');assert.equal(decodeMacros(s.draft.macro,cap).length,2);click('macro-delete');assert.equal(timeline().children.length,0);click('macro-add-event');click('macro-new');assert.equal(timeline().children.length,0);
 });
});

test('DKS offers explicit inactive keys, preserves fresh defaults and round-trips loaded inactive slots',()=>{
 const s=sample();s.advanced({type:'dks',slots:[34],layer:'base',index:1,pattern:{thresholds:[16,30,30,16],keys:[4,5,0,0],actions:[1,2,0,0]}});
 editor(s,({get,click,error})=>{
  for(let i=0;i<4;i++){assert.equal(get(`advanced-dks-key-${i}`).value,'4');assert.ok(get(`advanced-dks-key-${i}`).options.some(o=>o.value==='0'&&o.textContent==='— Không dùng —'));}for(const id of ['advanced-tap','advanced-hold'])assert.ok(!get(id).options.some(o=>o.value==='0'));
  click('advanced-load');assert.deepEqual([0,1,2,3].map(i=>get(`advanced-dks-key-${i}`).value),['4','5','0','0']);get('advanced-dks-low').value='1.7';click('advanced-assign');assert.equal(error().hidden,true);assert.deepEqual(decodePattern(s.draft.dks,1).keys,[4,5,0,0]);assert.deepEqual(decodePattern(s.draft.dks,1).thresholds,[17,30,30,17]);
 });
});

test('DKS rejects empty or unrepresented source selectors atomically instead of interpreting them as zero',()=>{
 for(const source of ['','200']){const seed=sample();seed.advanced({type:'dks',slots:[34],layer:'base',index:1,pattern:{thresholds:[16,30,30,16],keys:[4,5,6,7],actions:[1,2,0,0]}});const raw=seed.draft;if(source)raw.dks[1*16+5]=200;const s=new ConfigSession({...seed.snapshot,blocks:raw},cap);
  editor(s,({get,click,error})=>{click('advanced-load');get('advanced-dks-low').value='1.7';if(!source)get('advanced-dks-key-0').value='';else assert.equal(get('advanced-dks-key-0').value,'');const before=s.draft;click('advanced-assign');assert.equal(error().hidden,false);assert.deepEqual(s.draft,before);});
 }
});

test('macro recording stops before adding input after a direct external source replacement',()=>{
 const s=sample([4]);editor(s,({get,click,timeline})=>{get('macro-select').value='0';get('macro-select').trigger('change');click('macro-record-start');loadProfile(createProfile(sample([5]),'Khác'),s);const key=new Event('keydown',{cancelable:true});Object.defineProperties(key,{code:{value:'KeyB'},repeat:{value:false}});window.dispatchEvent(key);assert.equal(get('macro-record-stop').disabled,true);assert.equal(timeline().children.length,1);});
});

test('same-count source changes are synchronized before direct save or delete; revert retains the edited input',()=>{
 for(const action of ['macro-save','macro-delete']){const s=sample([4]);editor(s,({get,click,error,timeline})=>{get('macro-select').value='0';get('macro-select').trigger('change');click('macro-add-event');loadProfile(createProfile(sample([5]),'Khác'),s);click(action);const macros=decodeMacros(s.draft.macro,cap);assert.equal(macros[0].events[0].code,5);assert.equal(timeline().children.length,2);assert.equal(macros.length,action==='macro-save'?2:1);assert.equal(error().hidden,action==='macro-save');});}
 const s=sample([4]);editor(s,({get,click,input,mount,timeline})=>{get('macro-select').value='0';get('macro-select').trigger('change');const code=input('Mã HID sự kiện 1');code.value='5';code.trigger('change');click('macro-save');s.revert();mount.refresh();assert.equal(get('macro-select').value,'-1');assert.equal(timeline().children.length,1);assert.equal(input('Mã HID sự kiện 1').value,'5');click('macro-save');assert.deepEqual(decodeMacros(s.draft.macro,cap).map(m=>m.events[0].code),[4,5]);});
});
