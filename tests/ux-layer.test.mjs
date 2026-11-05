import test from 'node:test';
import assert from 'node:assert/strict';

// DOM shim with simple layout boxes so arrow navigation can find the key above/below.
class Element {
  constructor(tag='div'){
    this.tag=tag;this.children=[];this.parentElement=null;this.listeners=new Map();this.attributes={};this.dataset={};this.width=1;
    this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.tabIndex=0;this.classes=new Set();const self=this;
    this.style={setProperty(name,value){if(name==='--width')self.width=Number(value)||1;}};
    this.classList={toggle(name,on){if(on===undefined)on=!self.classes.has(name);if(on)self.classes.add(name);else self.classes.delete(name);return on;},contains:name=>self.classes.has(name),add:name=>self.classes.add(name)};
  }
  append(...nodes){for(const n of nodes){if(n&&typeof n==='object'){n.parentElement=this;this.children.push(n);}}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}removeAttribute(k){delete this.attributes[k];}
  addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}
  async trigger(t,event={}){await this.listeners.get(t)?.({target:this,preventDefault(){},stopPropagation(){},...event});}
  focus(){globalThis.document.activeElement=this;}querySelector(){return null;}querySelectorAll(){return [];}get options(){return this.children;}
  getBoundingClientRect(){
    const row=this.parentElement,index=row?row.children.indexOf(this):0;let left=0;
    for(let k=0;k<index;k++)left+=40*row.children[k].width;
    return {left,width:40*this.width,top:0,height:40};
  }
}
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
function* walk(el){yield el;for(const child of el.children)yield* walk(child);}

async function host(tag){
  const elements=new Map(),get=id=>{if(!elements.has(id)){const el=new Element();el.id=id;elements.set(id,el);}return elements.get(id);};
  const old={document:globalThis.document,window:globalThis.window,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
  const hid=new EventTarget();hid.getDevices=async()=>[];hid.requestDevice=async()=>[];
  globalThis.document={getElementById:get,createElement:t=>new Element(t),createTextNode:text=>({textContent:text}),title:'A80RT Configurator',activeElement:null};
  globalThis.window={isSecureContext:true};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
  await import(`../dist/app.js?${tag}`);await settle();
  const restore=()=>{globalThis.document=old.document;globalThis.window=old.window;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;};
  return {get,restore};
}

test('the keyboard is one Tab stop; arrows move focus, Shift+arrow extends the selection',async()=>{
  const {get,restore}=await host('ux-arrows');
  try{
    const keyboard=get('keyboard'),keys=keyboard.children.flatMap(row=>row.children);
    assert.equal(keys.filter(k=>k.tabIndex===0).length,1,'exactly one focusable key');
    const start=keys.find(k=>k.tabIndex===0);assert.equal(start.dataset.slot,'34','starts on the selected key (W)');
    await keyboard.trigger('keydown',{key:'ArrowRight',target:start});
    const right=keys.find(k=>k.tabIndex===0);assert.notEqual(right,start);assert.equal(globalThis.document.activeElement,right);
    assert.equal(right.parentElement,start.parentElement,'stays on the same row');
    await keyboard.trigger('keydown',{key:'ArrowDown',target:right});
    const down=keys.find(k=>k.tabIndex===0);assert.notEqual(down.parentElement,right.parentElement,'moved to the next row');
    await keyboard.trigger('keydown',{key:'ArrowLeft',target:down,shiftKey:true});
    const extended=keys.find(k=>k.tabIndex===0);
    assert.equal(extended.attributes['aria-pressed'],'true','Shift+arrow selects the key it lands on');
    assert.equal(start.attributes['aria-pressed'],'true','and keeps the earlier selection');
    let prevented=0;await keyboard.trigger('keydown',{key:'a',target:extended,preventDefault(){prevented++;}});assert.equal(prevented,0,'other keys are left alone');
  }finally{restore();}
});

test('the draft bar becomes sticky while the draft has changes and clears on revert',async()=>{
  const {get,restore}=await host('ux-draftbar');
  try{
    assert.equal(get('draft-bar').classList.contains('is-active'),false);
    await get('sample-button').trigger('click');await settle();
    const input=[...walk(get('core-editors'))].find(el=>el.id==='core-actuationMm');assert.ok(input,'actuation input mounted');
    input.value='1.25';await input.trigger('change');
    assert.match(get('draft-count').textContent,/^[1-9]\d* thay đổi/);assert.equal(get('draft-bar').classList.contains('is-active'),true);
    await get('revert-button').trigger('click');
    // Revert offers "Restore draft" for 10 s, so the bar stays in view until then.
    assert.match(get('draft-count').textContent,/^0 thay đổi/);assert.equal(get('revert-undo').hidden,false);assert.equal(get('draft-bar').classList.contains('is-active'),true);
    await get('revert-undo').trigger('click');
    assert.match(get('draft-count').textContent,/^[1-9]\d* thay đổi/);assert.equal(get('revert-undo').hidden,true);assert.equal(input.value,'1.25');
    await get('revert-button').trigger('click');input.value='0.9';await input.trigger('change');
    assert.equal(get('revert-undo').hidden,true,'a new edit withdraws the restore offer');
  }finally{restore();}
});

test('a failed connection keeps the current draft',async()=>{
  const {get,restore}=await host('ux-connect-fail');
  try{
    await get('sample-button').trigger('click');await settle();
    const input=[...walk(get('core-editors'))].find(el=>el.id==='core-actuationMm');input.value='1.25';await input.trigger('change');
    const before=get('draft-count').textContent;assert.match(before,/^[1-9]\d* thay đổi/);
    // A device that matches the filter but exposes no usable configuration interface.
    navigator.hid.requestDevice=async()=>[{vendorId:0x0c45,productId:0x80a1,productName:'A80RT U',collections:[],opened:false,async open(){},async close(){},addEventListener(){},removeEventListener(){}}];
    await get('connect-button').trigger('click');await settle();
    assert.match(get('message').textContent,/Kết nối chưa thành công/);
    assert.equal(get('draft-count').textContent,before,'the draft survives the failed connection');
  }finally{restore();}
});
