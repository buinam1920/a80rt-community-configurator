import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {decodeBlock} from '../dist/config/codecs.js';
import {RT_PROFILE_SCHEMA,parseRtProfile,exportRtProfile,rtProfileAiGuide,rtKeyNames,createPresetLibrary,presetEdits,presetFromDraft} from '../dist/config/presets.js';
import {mountCoreEditors} from '../dist/ui/core-editors.js';

const cap=identifyDevice({vendorId:0xc45,productId:0x80a1,productName:'A80RT U'});
const dongle=identifyDevice({vendorId:0xc45,productId:0xfefc,productName:'A80RT U Dongle'});
function session(capability=cap){
  const blocks=Object.fromEntries(readPlan(capability).map(({id,length})=>[id,new Uint8Array(length)]));
  for(const slot of capability.slots)blocks.rt.set([1,6,0,0,0,0,0,0],slot*8);
  blocks.settings[8]=7;blocks.settings[9]=9;
  return new ConfigSession({identity:capability.identity,blocks,coverage:Object.fromEntries(readPlan(capability).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}},capability);
}
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value))};};
const rt=s=>decodeBlock('rt',s.draft.rt,cap).records;
const slotOf=name=>rtKeyNames().find(entry=>entry.name===name).slot;

test('every physical key has one unique, ASCII-friendly name',()=>{
  const names=rtKeyNames().map(entry=>entry.name);
  assert.equal(names.length,82);assert.equal(new Set(names).size,82);
  for(const name of ['LShift','RShift','LCtrl','RCtrl','Minus','Up','Down','Left','Right','Space','Esc','F12'])assert.ok(names.includes(name),name);
});

test('a file written by a person or an AI becomes a profile, with aliases, code fences and inheritance',()=>{
  const text='```json\n'+JSON.stringify({schema:RT_PROFILE_SCHEMA,name:'  My   Valorant ',shortcut:'ctrl+alt+9',default:{actuation:1.5,rtPress:0.2},
    keys:{w:{actuation:0.4,rtPress:0.15,rtRelease:0.15,wholeTravel:true},'Left Shift':{actuation:0.8},ArrowUp:{actuation:1},'-':{actuation:2},'slot:83':{actuation:1.004}},
    deadZone:{top:0.05,bottom:0.1}})+'\n```';
  const {label,preset,shortcut,warnings}=parseRtProfile(text,cap);
  assert.equal(label,'My Valorant');assert.equal(shortcut,'Ctrl+Alt+9');assert.deepEqual(warnings,[]);
  assert.deepEqual(preset.rest,{actuationMm:1.5,pressMm:0.2,releaseMm:0,whole:false});
  const at=name=>preset.keys.find(entry=>entry.slot===slotOf(name));
  assert.deepEqual(at('W'),{slot:34,actuationMm:0.4,pressMm:0.15,releaseMm:0.15,whole:true});
  assert.deepEqual(at('LShift'),{slot:64,actuationMm:0.8,pressMm:0.2,releaseMm:0,whole:false},'unlisted fields inherit default');
  assert.equal(at('Up').actuationMm,1);assert.equal(at('Minus').actuationMm,2);assert.equal(at('Space').actuationMm,1,'rounded to 0.01 mm');
  assert.deepEqual(preset.deadZone,{top:5,bottom:10});
});

test('mistakes are rejected with a message that says what to fix',()=>{
  const base={schema:RT_PROFILE_SCHEMA,name:'X'};
  const bad=[[ 'not json',/Không đọc được JSON/],[{...base,schema:'nope'},/schema/],[{schema:RT_PROFILE_SCHEMA},/name/],
    [{...base,keys:{Hyper:{actuation:1}}},/Không biết phím "Hyper"/],[{...base,keys:{W:{actuation:5}}},/keys\.W\.actuation = 5/],
    [{...base,keys:{W:{actuation:'0.5'}}},/cần một số/],[{...base,keys:{W:{wholeTravel:'yes'}}},/true hoặc false/],
    [{...base,keys:{W:{actuation:1},w:{actuation:2}}},/hai lần/],[{...base,deadZone:{top:0.9,bottom:0}},/deadZone\.top/],[{...base,keys:[]},/"keys" phải là object/]];
  for(const [input,pattern]of bad)assert.throws(()=>parseRtProfile(typeof input==='string'?input:JSON.stringify(input),cap),pattern,JSON.stringify(input));
  const {warnings,shortcut}=parseRtProfile({...base,shortcut:'K',keys:{W:{actuation:1,colour:'red'}}},cap);
  assert.equal(shortcut,null);assert.equal(warnings.length,2,'unknown fields and bad shortcuts only warn');
});

test('export and import round-trip every key, for built-in and saved profiles',()=>{
  const library=createPresetLibrary(memory());
  for(const id of ['apex','lol','office']){
    const exported=exportRtProfile(library.find(id),cap),back=parseRtProfile(JSON.stringify(exported),cap);
    const a=session(),b=session();a.transaction(presetEdits(cap,id));b.transaction(presetEdits(cap,back.preset));
    assert.deepEqual(rt(b),rt(a),id);
  }
  const s=session();s.transaction(presetEdits(cap,'apex'));s.transaction({rt:[{slot:34,field:'actuationMm',value:0.37}]});
  const saved=library.save('Mine',presetFromDraft(cap,s.draft));library.setShortcut(saved.id,'Ctrl+Alt+4');
  const file=exportRtProfile(library.find(saved.id),cap);
  assert.equal(file.shortcut,'Ctrl+Alt+4');assert.deepEqual(file.deadZone,{top:0.07,bottom:0.09});assert.equal(file.keys.W.actuation,0.37);
  const other=session();other.transaction(presetEdits(cap,parseRtProfile(file,cap).preset));
  assert.deepEqual(rt(other).map(r=>[r.actuationMm,r.pressMm,r.releaseMm,r.whole]),rt(s).map(r=>[r.actuationMm,r.pressMm,r.releaseMm,r.whole]));
});

test('the AI guide states the format, limits and every key name, and parses its own example',()=>{
  const guide=rtProfileAiGuide(dongle);
  assert.match(guide,/a80rt-rt-profile\/v1/);assert.match(guide,/0\.01–3\.3/);assert.match(guide,/LShift/);assert.match(guide,/Reply with ONE JSON object only/);
  const example=guide.slice(guide.indexOf('{'),guide.indexOf('\n}\n')+2);
  assert.equal(parseRtProfile(example,dongle).label,'Valorant');
  assert.match(rtProfileAiGuide(cap,{name:'Current'}),/My current profile/);
});

test('the bundled example profiles are valid',()=>{
  const dir=new URL('../examples/rt-profiles/',import.meta.url),files=fs.readdirSync(dir).filter(name=>name.endsWith('.json'));
  assert.ok(files.length>=2);
  for(const name of files)assert.ok(parseRtProfile(fs.readFileSync(new URL(name,dir),'utf8'),cap).label,name);
});

class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.classList={toggle(){}};this.style={setProperty(){}};this.textContent='';}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}get options(){return this.children;}
  addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}async trigger(t,event={}){await this.listeners.get(t)?.({target:this,...event});}focus(){}select(){}querySelectorAll(){return [];}
}
test('the panel imports pasted JSON, exports a profile file and copies the AI guide',async()=>{
  const old={document:globalThis.document,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')},elements=[];let clicked=null,copied=null;
  globalThis.document={createElement:tag=>{const el=new Element(tag);if(tag==='a')el.click=()=>{clicked={download:el.download,href:el.href};};elements.push(el);return el;}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copied=text;}}}});
  const get=id=>elements.findLast(el=>el.id===id),note=()=>elements.find(el=>el.textContent?.startsWith?.('Đã'))?.textContent;
  try{
    const library=createPresetLibrary(memory()),mount=mountCoreEditors(new Element(),{session:session(),capability:cap,selectedSlots:[34],library});
    get('core-preset-paste-text').value=JSON.stringify({schema:RT_PROFILE_SCHEMA,name:'From AI',shortcut:'Ctrl+Alt+2',keys:{W:{actuation:0.5}}});
    await get('core-preset-paste-import').trigger('click');
    const mine=library.list().find(p=>p.label==='From AI');assert.ok(mine,'imported');assert.ok(get(`core-preset-${mine.id}`),'shown as a button');
    assert.equal(mine.shortcut,null,'a shortcut owned by Apex is not stolen');assert.equal(library.find('apex').shortcut,'Ctrl+Alt+2');
    assert.equal(get('core-preset-paste-text').value,'');
    get('core-preset-paste-text').value='{oops';await get('core-preset-paste-import').trigger('click');
    assert.equal(get('core-preset-paste-text').value,'{oops','bad input stays for fixing');
    await get(`core-preset-export-${mine.id}`).trigger('click');assert.equal(clicked.download,'From-AI.a80rt-rt.json');
    await get('core-preset-ai').trigger('click');assert.match(copied,/a80rt-rt-profile\/v1/);assert.match(copied,/My current profile/);
    mount.destroy();
  }finally{globalThis.document=old.document;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;}
});
