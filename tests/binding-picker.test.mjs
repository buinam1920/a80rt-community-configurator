import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {mountCoreEditors} from '../dist/ui/core-editors.js';
import {createPresetLibrary} from '../dist/config/presets.js';

const cap=identifyDevice({vendorId:0xc45,productId:0x80a1,productName:'A80RT U'});
function session(){
  const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
  for(const slot of cap.slots)blocks.rt.set([1,6,0,0,0,0,0,0],slot*8);
  blocks.keymap.set([2,0,26,0],34*4);
  return new ConfigSession({identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}},cap);
}
class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.classList={toggle(){}};this.style={setProperty(){}};this.textContent='';}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];}get options(){return this.children;}
  addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}async trigger(t,event={}){await this.listeners.get(t)?.({target:this,...event});}focus(){}querySelectorAll(){return [];}
}
function mount(selectedSlots=[34]){
  const elements=[];globalThis.document={createElement:tag=>{const el=new Element(tag);elements.push(el);return el;}};
  const s=session(),m=mountCoreEditors(new Element(),{session:s,capability:cap,selectedSlots,library:createPresetLibrary()});
  const get=id=>elements.findLast(el=>el.id===id),grid=()=>get('core-binding-grid').children,labels=()=>grid().map(el=>el.textContent);
  return {s,m,get,grid,labels};
}

test('the binding picker groups bindings into tabs and opens on the current one',async()=>{
  const old=globalThis.document;
  try{
    const {s,m,get,grid,labels}=mount();
    assert.equal(get('core-binding').hidden,true,'the long native list is no longer shown');
    assert.equal(get('core-binding-current').textContent,'Đang gán: Phím · W');
    assert.equal(get('core-binding-tab-key').attributes['aria-selected'],'true');
    assert.ok(labels().includes('A')&&labels().includes('F5'));assert.ok(!labels().some(l=>/Bluetooth/.test(l)),'functions are on their own tab');
    assert.equal(grid().find(b=>b.textContent==='W').attributes['aria-pressed'],'true');
    await get('core-binding-tab-media').trigger('click');assert.ok(labels().includes('Tắt tiếng'));assert.equal(labels().length,cap.limits.mediaUsages.length);
    await grid().find(b=>b.textContent==='Tắt tiếng').trigger('click');
    assert.deepEqual([...s.draft.keymap.slice(34*4,34*4+3)],[3,226,0],'Mute written to the draft for W');
    assert.equal(get('core-binding-current').textContent,'Đang gán: Media · Tắt tiếng');
    await get('core-binding-empty').trigger('click');assert.equal(s.draft.keymap[34*4],0,'unassigned');assert.equal(get('core-binding-empty').attributes['aria-pressed'],'true');
    m.destroy();
  }finally{globalThis.document=old;}
});

test('search finds bindings across tabs in Vietnamese and English',async()=>{
  const old=globalThis.document;
  try{
    const {m,get,labels}=mount();
    get('core-binding-search').value='bluetooth';await get('core-binding-search').trigger('input');
    assert.deepEqual(labels(),['Bluetooth 1','Bluetooth 2','Bluetooth 3']);
    get('core-binding-search').value='mute';await get('core-binding-search').trigger('input');assert.deepEqual(labels(),['Tắt tiếng'],'English name finds the Vietnamese label');
    get('core-binding-search').value='tắt tiếng';await get('core-binding-search').trigger('input');assert.deepEqual(labels(),['Tắt tiếng']);
    get('core-binding-search').value='zzz';await get('core-binding-search').trigger('input');assert.equal(labels()[0],'Không có kết quả.');
    m.destroy();
  }finally{globalThis.document=old;}
});

test('locked Fn F1–F12 disable the whole picker',async()=>{
  const old=globalThis.document;
  try{
    const {m,get,grid}=mount([1]);
    get('core-layer').value='fn';await get('core-layer').trigger('change');
    assert.ok(grid().every(b=>b.disabled));assert.equal(get('core-binding-empty').disabled,true);assert.equal(get('core-binding-search').disabled,true);
    m.destroy();
  }finally{globalThis.document=old;}
});

test('an empty Fn slot says which firmware default is in effect',async()=>{
  const old=globalThis.document;
  try{
    const {m,get}=mount([34]);
    get('core-layer').value='fn';await get('core-layer').trigger('change');
    assert.equal(get('core-binding-current').textContent,'Đang gán: Trống · firmware dùng mặc định WIN');
    m.destroy();
  }finally{globalThis.document=old;}
});
