import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {decodeBlock} from '../dist/config/codecs.js';
import {createPresetLibrary,presetEdits,presetFromDraft,matchingPreset,normalizeShortcut,shortcutFromEvent} from '../dist/config/presets.js';
import {mountCoreEditors} from '../dist/ui/core-editors.js';

const cap=identifyDevice({vendorId:0xc45,productId:0x80a1,productName:'A80RT U'});
function session(){
  const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
  for(const slot of cap.slots)blocks.rt.set([1,6,0,0,0,0,0,0],slot*8);
  blocks.settings[8]=7;blocks.settings[9]=9;
  return new ConfigSession({identity:cap.identity,blocks,coverage:Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}])),provenance:{source:'sample'}},cap);
}
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),map};};
const rt=s=>decodeBlock('rt',s.draft.rt,cap).records;

test('shortcuts normalize, need Ctrl/Alt/Win and come from key codes, not layout characters',()=>{
  assert.equal(normalizeShortcut(' alt + control + k '),'Ctrl+Alt+K');
  assert.equal(normalizeShortcut('Win+Shift+f13'),'Shift+Win+F13');
  assert.throws(()=>normalizeShortcut('Shift+K'),/Ctrl, Alt hoặc Win/);
  assert.throws(()=>normalizeShortcut('Ctrl+Alt+Space'),/A–Z/);
  assert.throws(()=>normalizeShortcut('Hyper+K'),/không hỗ trợ/);
  assert.equal(shortcutFromEvent({code:'Digit3',ctrlKey:true,altKey:true,key:'#'}),'Ctrl+Alt+3');
  assert.equal(shortcutFromEvent({code:'F5',ctrlKey:true,shiftKey:true}),'Ctrl+Shift+F5');
  assert.equal(shortcutFromEvent({code:'KeyW'}),null,'plain game keys never become shortcuts');
  assert.equal(shortcutFromEvent({code:'ControlLeft',ctrlKey:true}),null);
});

test('a saved draft becomes a profile that round-trips every key and the dead zones',()=>{
  const storage=memory(),library=createPresetLibrary(storage),s=session();
  s.transaction(presetEdits(cap,'apex'));const apex=rt(s);
  const saved=library.save('  My  Apex ',presetFromDraft(cap,s.draft));
  assert.equal(saved.label,'My Apex');assert.equal(saved.group,'user');assert.match(saved.id,/^u-/);assert.match(saved.description,/Profile của bạn/);
  assert.equal(matchingPreset(cap,s.draft,library.list()),'apex','built-ins keep priority when identical');
  s.transaction(presetEdits(cap,'office'));assert.notDeepEqual(rt(s),apex);
  s.transaction(presetEdits(cap,saved));
  for(const slot of cap.slots)for(const field of ['actuationMm','pressMm','releaseMm','whole'])assert.equal(rt(s)[slot][field],apex[slot][field],`${slot}.${field}`);
  for(const slot of cap.slots)assert.equal(rt(s)[slot].switchId,1,'switch IDs preserved');
  assert.deepEqual([...s.draft.settings.slice(8,10)],[7,9]);
  const reloaded=createPresetLibrary(storage);assert.deepEqual(reloaded.find(saved.id).keys,saved.keys,'persisted across restarts');
  assert.throws(()=>library.save('',presetFromDraft(cap,s.draft)),/Nhập tên/);
  assert.throws(()=>library.save('office',presetFromDraft(cap,s.draft)),/trùng tên profile cài sẵn/);
  assert.equal(library.save('my apex',presetFromDraft(cap,s.draft)).id,saved.id,'same name overwrites');
});

test('profiles can be deleted, built-ins hidden and restored, and shortcuts move between profiles',()=>{
  const storage=memory(),library=createPresetLibrary(storage),s=session();let changes=0;library.subscribe(()=>changes++);
  const mine=library.save('Valorant',presetFromDraft(cap,s.draft));
  assert.deepEqual(library.bindings().map(b=>[b.preset,b.keys]),[['lol','Ctrl+Alt+1'],['apex','Ctrl+Alt+2']]);
  library.setShortcut(mine.id,'ctrl+alt+2');
  assert.deepEqual(library.bindings().map(b=>[b.preset,b.keys]),[['lol','Ctrl+Alt+1'],[mine.id,'Ctrl+Alt+2']],'taking a combination removes it from apex');
  library.remove('lol');assert.ok(!library.list().some(p=>p.id==='lol'));assert.equal(library.hiddenCount(),1);
  assert.deepEqual(library.bindings().map(b=>b.preset),[mine.id],'hidden profiles lose their shortcut');
  library.restoreDefaults();assert.ok(library.list().some(p=>p.id==='lol'));assert.equal(library.find('lol').shortcut,'Ctrl+Alt+1');assert.equal(library.find('apex').shortcut,null,'combination still owned by Valorant');
  library.remove(mine.id);assert.equal(library.find(mine.id),null);assert.throws(()=>library.remove(mine.id),/Không tìm thấy/);
  library.setShortcut('lol',null);assert.equal(library.find('lol').shortcut,null);
  assert.ok(changes>=6);
  const reloaded=createPresetLibrary(storage);assert.deepEqual(reloaded.bindings(),library.bindings());
});

test('corrupt or hostile stored data is dropped instead of reaching the keyboard',()=>{
  const storage=memory();
  storage.setItem('a80rt-rt-presets',JSON.stringify({hidden:['office','nope'],shortcuts:{lol:'K',apex:'Ctrl+Alt+2',game:'Ctrl+Alt+2'},custom:[
    {id:'u-good1234',label:'Ok',rest:{actuationMm:1,pressMm:0,releaseMm:0},keys:[{slot:34,actuationMm:0.5,pressMm:0.1,releaseMm:0.1,whole:true}]},
    {id:'u-bad12345',label:'Too deep',rest:{actuationMm:9,pressMm:0,releaseMm:0},keys:[]},
    {id:'../x',label:'Bad id',rest:{actuationMm:1,pressMm:0,releaseMm:0},keys:[]},
  ]}));
  const library=createPresetLibrary(storage);
  assert.deepEqual(library.list().filter(p=>!p.builtin).map(p=>p.id),['u-good1234']);
  assert.ok(!library.list().some(p=>p.id==='office'));
  assert.deepEqual(library.bindings().map(b=>[b.preset,b.keys]),[['apex','Ctrl+Alt+2']]);
  storage.setItem('a80rt-rt-presets','{not json');assert.equal(createPresetLibrary(storage).list().length,5);
});

class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.disabled=false;this.hidden=false;this.classList={toggle(){}};this.style={setProperty(){}};this.textContent='';}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}
  addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}async trigger(t,event={}){await this.listeners.get(t)?.({target:this,...event});}focus(){}querySelectorAll(){return [];}
}
test('the Rapid Trigger panel saves a named profile as a button, assigns a shortcut and deletes it',async()=>{
  const old=globalThis.document,elements=[];
  globalThis.document={createElement:tag=>{const el=new Element(tag);elements.push(el);return el;}};
  const get=id=>elements.findLast(el=>el.id===id);
  try{
    const library=createPresetLibrary(memory()),s=session();let edits=0;
    const mount=mountCoreEditors(new Element(),{session:s,capability:cap,selectedSlots:[34],library,onEdit:()=>edits++});
    await get('core-preset-apex').trigger('click');assert.equal(get('core-preset-apex').attributes['aria-pressed'],'true');assert.ok(edits>0);
    s.transaction({rt:[{slot:34,field:'actuationMm',value:0.45}]});mount.refresh();
    assert.equal(get('core-preset-custom').attributes['aria-pressed'],'true','Custom lights up for an unsaved edit');assert.equal(get('core-preset-apex').attributes['aria-pressed'],'false');
    get('core-preset-name').value='Valorant';await get('core-preset-save').trigger('click');
    const mine=library.list().find(p=>p.label==='Valorant');assert.ok(mine,'saved through the panel');
    assert.ok(get(`core-preset-${mine.id}`),'shown as a button next to the others');
    await get(`core-preset-keys-${mine.id}`).trigger('click');
    await get(`core-preset-keys-${mine.id}`).trigger('keydown',{key:'w',code:'KeyW',preventDefault(){},stopPropagation(){}});
    assert.equal(library.find(mine.id).shortcut,null,'a plain key is refused');
    await get(`core-preset-keys-${mine.id}`).trigger('keydown',{key:'3',code:'Digit3',ctrlKey:true,altKey:true,preventDefault(){},stopPropagation(){}});
    assert.equal(library.find(mine.id).shortcut,'Ctrl+Alt+3');assert.match(get(`core-preset-${mine.id}`).textContent,/Valorant · Ctrl\+Alt\+3/);
    await get('core-preset-office').trigger('click');await get(`core-preset-${mine.id}`).trigger('click');
    assert.equal(get(`core-preset-${mine.id}`).attributes['aria-pressed'],'true','the saved profile lights up when the draft matches');
    await get(`core-preset-delete-${mine.id}`).trigger('click');assert.ok(library.find(mine.id),'first click only asks for confirmation');
    await get(`core-preset-delete-${mine.id}`).trigger('click');assert.equal(library.find(mine.id),null);
    assert.ok(!get('core-preset-custom').parentElement.children.some(el=>el.id===`core-preset-${mine.id}`),'its button is gone');
    await get('core-preset-delete-lol').trigger('click');await get('core-preset-delete-lol').trigger('click');
    assert.equal(get('core-preset-restore').hidden,false);await get('core-preset-restore').trigger('click');assert.ok(library.find('lol')&&library.list().some(p=>p.id==='lol'));
    mount.destroy();
  }finally{globalThis.document=old;}
});

test('an invalid editor value marks its field aria-invalid and points at the error text',async()=>{
  const old=globalThis.document,elements=[];
  globalThis.document={createElement:tag=>{const el=new Element(tag);elements.push(el);return el;}};
  const get=id=>elements.findLast(el=>el.id===id);
  try{
    const mount=mountCoreEditors(new Element(),{session:session(),capability:cap,selectedSlots:[34],library:createPresetLibrary(memory())});
    const input=get('core-actuationMm');input.value='9';await input.trigger('change');
    assert.equal(input.attributes['aria-invalid'],'true');assert.equal(input.attributes['aria-describedby'],'core-editor-error');
    assert.equal(get('core-editor-error').hidden,false);
    input.removeAttribute=name=>{delete input.attributes[name];};
    input.value='1.5';await input.trigger('change');
    assert.equal(input.attributes['aria-invalid'],undefined,'cleared once the value is accepted');
    mount.destroy();
  }finally{globalThis.document=old;}
});

test('deleting a profile can be undone with its position and shortcut',()=>{
  const library=createPresetLibrary(memory()),s=session();
  const a=library.save('Alpha',presetFromDraft(cap,s.draft)),b=library.save('Beta',presetFromDraft(cap,s.draft));
  library.setShortcut(a.id,'Ctrl+Alt+7');
  const token=library.remove(a.id);assert.equal(library.find(a.id),null);
  library.undoRemove(token);
  assert.deepEqual(library.list().filter(p=>!p.builtin).map(p=>p.id),[a.id,b.id],'back in its old place');
  assert.equal(library.find(a.id).shortcut,'Ctrl+Alt+7');
  const hidden=library.remove('apex');assert.ok(!library.list().some(p=>p.id==='apex'));
  library.undoRemove(hidden);assert.ok(library.list().some(p=>p.id==='apex'));assert.equal(library.find('apex').shortcut,'Ctrl+Alt+2');
});

test('the panel offers Undo right after a delete',async()=>{
  const old=globalThis.document,elements=[];
  globalThis.document={createElement:tag=>{const el=new Element(tag);elements.push(el);return el;}};
  const get=id=>elements.findLast(el=>el.id===id);
  try{
    const library=createPresetLibrary(memory()),s=session();
    const mount=mountCoreEditors(new Element(),{session:s,capability:cap,selectedSlots:[34],library});
    assert.equal(get('core-preset-undo').hidden,true);
    await get('core-preset-delete-lol').trigger('click');await get('core-preset-delete-lol').trigger('click');
    assert.ok(!library.list().some(p=>p.id==='lol'));assert.equal(get('core-preset-undo').hidden,false);
    await get('core-preset-undo').trigger('click');
    assert.ok(library.list().some(p=>p.id==='lol'));assert.equal(library.find('lol').shortcut,'Ctrl+Alt+1');assert.equal(get('core-preset-undo').hidden,true);
    mount.destroy();
  }finally{globalThis.document=old;}
});

test('a failed storage write reports an error and rolls back instead of claiming success',()=>{
  const storage=memory();let full=false;const real=storage.setItem;
  storage.setItem=(key,value)=>{if(full)throw new DOMException('quota','QuotaExceededError');real(key,value);};
  const library=createPresetLibrary(storage),s=session(),before=library.list().length;let changes=0;library.subscribe(()=>changes++);
  const kept=library.save('Kept',presetFromDraft(cap,s.draft));changes=0;full=true;
  assert.throws(()=>library.save('Lost',presetFromDraft(cap,s.draft)),/Không lưu được/);
  assert.equal(library.list().length,before+1,'failed save is not visible in this session');
  assert.throws(()=>library.remove(kept.id),/Không lưu được/);assert.ok(library.find(kept.id),'failed delete keeps the profile');
  assert.throws(()=>library.setShortcut(kept.id,'Ctrl+Alt+9'),/Không lưu được/);assert.equal(library.find(kept.id).shortcut,null);
  assert.throws(()=>library.remove('office'),/Không lưu được/);assert.equal(library.hiddenCount(),0);
  assert.equal(changes,0,'listeners are not told about rolled-back changes');
  full=false;assert.deepEqual(createPresetLibrary(storage).list().map(p=>p.id),library.list().map(p=>p.id),'memory matches storage');
});

test('the profile panel shows the storage error instead of a success note',async()=>{
  const old=globalThis.document,elements=[];
  globalThis.document={createElement:tag=>{const el=new Element(tag);elements.push(el);return el;}};
  const get=id=>elements.findLast(el=>el.id===id);
  try{
    const storage=memory();storage.setItem=()=>{throw new DOMException('quota','QuotaExceededError');};
    const library=createPresetLibrary(storage),mount=mountCoreEditors(new Element(),{session:session(),capability:cap,selectedSlots:[34],library});
    get('core-preset-name').value='Valorant';await get('core-preset-save').trigger('click');
    assert.equal(library.list().some(p=>p.label==='Valorant'),false);
    assert.equal(get('core-editor-error').hidden,false);assert.match(get('core-editor-error').textContent,/Không lưu được/);
    assert.equal(elements.some(el=>/Đã lưu profile/.test(el.textContent)),false,'no false success note');
    mount.destroy?.();
  }finally{globalThis.document=old;}
});

test('without usable storage (localStorage blocked) saving reports an error instead of a session-only success',()=>{
  for(const storage of [null,{getItem:()=>null}]){
    const library=createPresetLibrary(storage),before=library.list().length;
    assert.throws(()=>library.save('Session only',presetFromDraft(cap,session().draft)),/Không lưu được/);
    assert.equal(library.list().length,before);
  }
});

test('two windows sharing storage never overwrite each other’s profiles',()=>{
  const store=memory(),a=createPresetLibrary(store),b=createPresetLibrary(store),s=session();
  b.list();// B has loaded the library before A saves
  const saved=a.save('Window A',presetFromDraft(cap,s.draft));
  const target=b.list().find(item=>item.builtin);b.setShortcut(target.id,'Ctrl+Alt+F9');
  const fresh=createPresetLibrary(store);
  assert.ok(fresh.find(saved.id),'A’s profile survives B’s later write');
  assert.equal(fresh.find(target.id).shortcut,'Ctrl+Alt+F9');
  let notified=0;a.subscribe(()=>notified++);a.refresh();assert.equal(notified,1,'B’s shortcut change reaches A');
  b.save('From B',presetFromDraft(cap,s.draft));a.list();// A reads the change before the storage event arrives
  a.refresh();assert.equal(notified,2,'refresh still notifies after an earlier read picked the change up');a.refresh();assert.equal(notified,2,'no change, no notification');
});

test('undo of a delete is refused when the library is already full, instead of losing a profile on reload',()=>{
  const store=memory(),library=createPresetLibrary(store),preset=presetFromDraft(cap,session().draft);
  for(let index=0;index<24;index++)library.save(`P${index}`,preset);
  const token=library.remove(library.list().find(item=>item.label==='P0').id);library.save('Newcomer',preset);
  assert.throws(()=>library.undoRemove(token),/24 profile/);
  assert.equal(createPresetLibrary(store).list().filter(item=>!item.builtin).length,24);
  assert.ok(createPresetLibrary(store).list().some(item=>item.label==='Newcomer'));
});

test('importing a profile whose name is taken gets a new name instead of replacing the existing one',()=>{
  const library=createPresetLibrary(memory()),preset=presetFromDraft(cap,session().draft);
  const original=library.save('Aim',preset);
  assert.equal(library.uniqueLabel('aim'),'aim (2)');
  assert.equal(library.uniqueLabel('Fresh'),'Fresh');
  const builtin=library.list().find(item=>item.builtin);assert.equal(library.uniqueLabel(builtin.label),`${builtin.label} (2)`);
  const copy=library.save(library.uniqueLabel('Aim'),preset);
  assert.notEqual(copy.id,original.id);assert.ok(library.find(original.id));
  assert.equal(library.uniqueLabel('x'.repeat(32)).length,32);
});
