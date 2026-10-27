import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindingOptions} from '../dist/ui/core-editors.js';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {createProfile} from '../dist/config/profiles.js';
const cap=identifyDevice({vendorId:0xc45,productId:0x80a1,productName:'A80RT U'});

// Only the DOM and file I/O are doubled. All app/session/editor logic is real.
class Element {
 constructor(tag='div'){Object.assign(this,{tag,children:[],listeners:new Map(),attributes:{},_value:'',disabled:false,hidden:false,textContent:'',style:{setProperty(){}},classList:{toggle(){}}});}
 get value(){return this._value;}set value(v){this._value=this.tag==='select'&&!this.children.some(o=>o.value===String(v))?'':String(v);}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}
 replaceChildren(...nodes){this.children=[];this._value='';this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}
 addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}
 async trigger(t,event={}){return this.listeners.get(t)?.({target:this,...event});}
 querySelectorAll(){return this.children.flatMap(c=>[c,...(c.querySelectorAll?.()??[])]).filter(c=>['input','select','button'].includes(c.tag));}
}
const all=[],roots=new Map(),get=id=>all.findLast(e=>e.id===id)??roots.get(id)??(()=>{const e=new Element();roots.set(id,e);return e;})();
globalThis.document=Object.assign(new EventTarget(),{getElementById:get,createElement:tag=>{const e=new Element(tag);all.push(e);return e;},createTextNode:text=>({textContent:text}),hasFocus:()=>true});
globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid:new EventTarget()}});
// Exercise the real profile/recovery adapters with asynchronous IDB-shaped I/O.
const stored=new Map();
const db={transaction(){const tx={objectStore(){const requestFor=action=>{const req={};setImmediate(()=>{req.result=action();req.onsuccess?.();tx.oncomplete?.();});return req;};return {get:key=>requestFor(()=>structuredClone(stored.get(key))),getAll:()=>requestFor(()=>structuredClone([...stored.values()])),put:(value,key)=>requestFor(()=>stored.set(key,structuredClone(value))),delete:key=>requestFor(()=>stored.delete(key))};}};return tx;}};
globalThis.indexedDB={open(){const req={};setImmediate(()=>{req.result=db;req.onsuccess?.();});return req;}};
await import('../dist/app.js');
const click=id=>get(id).trigger('click');
const freshSample=async()=>{await click('sample-button');await all.find(e=>e.attributes['aria-label']==='Phím W, vị trí 34').trigger('click');await click('layer-base');};
const change=async(id,value)=>{get(id).value=value;await get(id).trigger('change');};
const error=()=>all.findLast(e=>e.className==='editor-error');

test('RT error retains only its field; layer and binding follow Fn and edits reach that layer',async()=>{
 await freshSample();await change('core-actuationMm','4.1');
 await click('editor-tab-binding');assert.equal(get('core-actuationMm').value,'4.1');
 await click('layer-fn');
 assert.equal(get('layer-fn').attributes['aria-pressed'],'true');assert.equal(get('core-layer').value,'fn');
 assert.equal(get('core-binding').value,'0');assert.equal(get('core-actuationMm').value,'0.8');assert.equal(error().hidden,true);
 const b=bindingOptions(cap).findIndex(o=>o.value.type==='keyboard'&&o.value.usage===5);
 await change('core-binding',String(b));assert.equal(get('key-map-raw').textContent,'02 00 05 00');
 await click('layer-base');assert.equal(get('key-map-raw').textContent,'02 00 1a 00');
});

test('RT error is dropped when selection changes, including mixed and empty selection',async()=>{
 await freshSample();await change('core-actuationMm','4.1');
 const a=all.find(e=>e.attributes['aria-label']==='Phím A, vị trí 49');await a.trigger('click');
 assert.equal(get('core-actuationMm').value,'1.2');assert.equal(error().hidden,true);
 await change('core-actuationMm','4.1');await click('select-all');
 assert.equal(get('core-actuationMm').value,'');assert.equal(error().hidden,true);
 await change('core-actuationMm','4.1');await click('clear-selection');
 assert.equal(get('core-actuationMm').value,'');assert.equal(get('core-actuationMm').disabled,true);
});

test('undo drops an RT error and redraws the baseline without restoring stale controls',async()=>{
 await freshSample();await change('core-pressMm','0.25');await change('core-actuationMm','4.1');
 await click('revert-button');assert.equal(get('core-actuationMm').value,'0.8');assert.equal(get('core-pressMm').value,'0.2');
 assert.equal(error().hidden,true);assert.match(get('draft-count').textContent,/^0 /);
});

const v1=(productName='A80RT U')=>JSON.stringify({schema:'a80rt-reader/v1',source:'import',createdAt:'2026-10-27T00:00:00Z',device:{...cap.identity,productName},blocks:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,Array(length).fill(0)]))});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,file:{size:1000,text:()=>promise}};};
const importFile=(id,file)=>get(id).trigger('change',{target:{files:[file],value:'fixture.json'}});
test('late JSON v1 completion preserves a newer sample and its RT draft',async()=>{
 await click('exit-sample');const file=deferred(),pending=importFile('import-file',file.file);
 await freshSample();await change('core-pressMm','0.25');file.resolve(v1());await pending;
 assert.match(get('draft-count').textContent,/^1 /);assert.equal(get('core-pressMm').disabled,false);assert.equal(get('profile-save').disabled,false);
});

test('overlapping JSON v1 reads keep the newest request even when the old read finishes last',async()=>{
 await click('exit-sample');const a=deferred(),b=deferred(),pa=importFile('import-file',a.file),pb=importFile('import-file',b.file);
 b.resolve(v1('New'));await pb;a.resolve(v1('Old'));await pa;
 assert.equal(get('device-name').textContent,'New');assert.equal(get('profile-save').disabled,true);assert.equal(get('apply-button').disabled,true);
});
test('late import failure cannot overwrite a newer successful result or its message',async()=>{
 await click('exit-sample');const a=deferred(),pa=importFile('import-file',a.file);
 await importFile('import-file',{size:1000,text:async()=>v1('New')});const message=get('message').textContent;
 a.reject(new Error('old read failed'));await pa;assert.equal(get('message').textContent,message);assert.equal(get('device-name').textContent,'New');
});
test('editing or undoing the same session invalidates pending JSON v1 completion',async()=>{
 for(const undo of [false,true]){
  await freshSample();await change('core-pressMm','0.25');const a=deferred(),pa=importFile('import-file',a.file);
  if(undo)await click('revert-button');else await change('core-releaseMm','0.35');
  const count=get('draft-count').textContent;a.resolve(v1());await pa;
  assert.equal(get('draft-count').textContent,count);assert.equal(get('profile-save').disabled,false);assert.equal(get('core-pressMm').value,undo?'0.2':'0.25');
 }
});
function fullProfile(name='Incoming'){
 const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));for(const slot of cap.slots)blocks.rt.set([1,0,100,0,20,0,20,0],slot*8);
 blocks.lighting[9]=3;blocks.lighting[10]=3;blocks.colors[137]=25;
 const coverage=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}]));
 return createProfile(new ConfigSession({identity:cap.identity,blocks,coverage,provenance:{source:'sample'}},cap),name);
}
const importProfile=p=>importFile('profile-file',{size:1000,text:async()=>JSON.stringify(p)});
test('profile preview and confirmation supersede a pending legacy import, including an empty-session preview',async()=>{
 await click('exit-sample');const a=deferred(),pa=importFile('import-file',a.file);await importProfile(fullProfile());
 const preview=get('profile-preview').textContent;a.resolve(v1());await pa;
 assert.equal(get('profile-preview').hidden,false);assert.equal(get('profile-preview').textContent,preview);assert.equal(get('profile-confirm').disabled,false);
 await click('profile-confirm');assert.equal(get('profile-save').disabled,false);assert.equal(get('core-pressMm').value,'0.2');assert.equal(get('apply-button').disabled,true);
});
test('delayed profile imports cannot attach to a newer sample, edit or undo',async()=>{
 for(const transition of ['sample','edit','undo']){
  await freshSample();await change('core-pressMm','0.25');const a=deferred(),pa=importFile('profile-file',a.file);
  if(transition==='sample')await freshSample();else if(transition==='edit')await change('core-releaseMm','0.35');else await click('revert-button');
  const count=get('draft-count').textContent;a.resolve(JSON.stringify(fullProfile()));await pa;
  assert.equal(get('profile-preview').hidden,true,transition);assert.equal(get('profile-confirm').disabled,true);assert.equal(get('draft-count').textContent,count);
 }
});
test('profile import busy gate rejects overlap, and stale profile failures do not replace newer status',async()=>{
 await freshSample();const a=deferred(),pa=importFile('profile-file',a.file);let secondReads=0;
 await importFile('profile-file',{size:1000,text:async()=>{secondReads++;return JSON.stringify(fullProfile());}});assert.equal(secondReads,0);
 await freshSample();const status=get('profile-status').textContent;a.reject(new Error('stale profile failure'));await pa;
 assert.equal(get('profile-status').textContent,status);assert.equal(get('profile-confirm').disabled,true);
});
test('a current profile semantic validation failure reports its reason and keeps the draft atomic',async()=>{
 await freshSample();await change('core-pressMm','0.25');const p=fullProfile();p.blocks.lighting[9]=255;const count=get('draft-count').textContent;
 await importProfile(p);assert.match(get('profile-status').textContent,/brightness/);assert.equal(get('profile-preview').hidden,true);assert.equal(get('profile-confirm').disabled,true);assert.equal(get('draft-count').textContent,count);
});
test('recovery preview and library changes supersede pending JSON v1 reads without auto-loading recovery',async()=>{
 await freshSample();await change('core-pressMm','0.25');
 // Wait for the production debounce and adapter completion, with a bounded wait.
 const deadline=Date.now()+2000;while(get('profile-recover').disabled&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 assert.equal(get('profile-recover').disabled,false);const a=deferred(),pa=importFile('import-file',a.file);await click('profile-recover');
 const preview=get('profile-preview').textContent;a.resolve(v1());await pa;assert.equal(get('profile-preview').textContent,preview);assert.equal(get('profile-preview').hidden,false);assert.match(get('draft-count').textContent,/^1 /);
 const b=deferred(),pb=importFile('import-file',b.file);await get('profile-model').trigger('change');b.resolve(v1());await pb;assert.equal(get('profile-save').disabled,false);assert.equal(get('profile-preview').hidden,true);
});
test('starting a connection invalidates a pending import even while the chooser has not completed',async()=>{
 await click('exit-sample');const a=deferred(),pa=importFile('import-file',a.file);let finish;
 navigator.hid.requestDevice=()=>new Promise(resolve=>finish=resolve);const connecting=click('connect-button');a.resolve(v1('Old'));await pa;
 assert.notEqual(get('device-name').textContent,'Old');finish([]);await connecting;
});
test('a new view-only JSON import can replace a disconnected invalidated session without granting edit authority',async()=>{
 await freshSample();let session;const edit=ConfigSession.prototype.edit;
 try{ConfigSession.prototype.edit=function(...args){session=this;return edit.apply(this,args);};await change('core-pressMm','0.25');}finally{ConfigSession.prototype.edit=edit;}
 session.invalidate('Unconfirmed disconnected session');await importFile('import-file',{size:1000,text:async()=>v1('Saved view')});
 assert.equal(get('device-name').textContent,'Saved view');assert.equal(get('profile-save').disabled,true);assert.equal(get('apply-button').disabled,true);assert.equal(get('core-pressMm').disabled,true);
});
