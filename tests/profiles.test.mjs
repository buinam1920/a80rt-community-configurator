import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {ConfigSession} from '../dist/config/session.js';
import {patchMacros,decodeMacros} from '../dist/config/macros.js';
const api=await import('../dist/config/profiles.js').catch(()=>({}));
const cap=identifyDevice({vendorId:0x0c45,productId:0x80a1,productName:'A80RT U'});
function session(){
 const blocks=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,new Uint8Array(length)]));
 for(const slot of cap.slots){blocks.rt.set([1,128,100,0,20,0,30,0],slot*8);blocks.keymap.set([2,0,26,91],slot*4);}
 blocks.settings[0]=231;blocks.colors[136]=77;blocks.dks[20]=83;blocks.fn.set([13,0,0,9],4);
 const coverage=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}]));
 return new ConfigSession({identity:cap.identity,blocks,coverage,provenance:{source:'sample'}},cap);
}
function profile(s=session()){assert.equal(typeof api.createProfile,'function','profile creation API required');return api.createProfile(s,'Cấu hình chơi');}
const json=p=>JSON.stringify(p);
const pattern={thresholds:[10,20,20,10],keys:[4,5,6,7],actions:[1,2,4,8]};
test('original stored-zero profile previews without mutation and restores after a 1.2 draft',()=>{
 const seed=session(),raw=seed.draft;raw.rt.set([1,0xfd,0,0,17,0,29,0],792);
 const s=new ConfigSession({...seed.snapshot,blocks:raw},cap),original=api.parseProfile(api.exportProfile(profile(s)),cap);
 s.edit('rt',[{slot:99,field:'actuationMm',value:1.2}]);const before=s.draft,diff=s.diff();
 assert.deepEqual(api.previewProfile(original,s),[{block:'rt',path:'records[99].actuationMm',before:1.2,after:0,byteOffsets:[794]}]);
 assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);
 assert.deepEqual(api.loadProfile(original,s),[]);assert.deepEqual(s.draft,raw);
});

test('stored-zero profile and backend transactions preserve the whole draft when another group is invalid',()=>{
 const seed=session(),raw=seed.draft;raw.rt[794]=0;
 const s=new ConfigSession({...seed.snapshot,blocks:raw},cap),original=profile(s);
 s.edit('rt',[{slot:99,field:'actuationMm',value:1.2}]);const before=s.draft,diff=s.diff();
 original.blocks.lighting[9]=255;
 assert.throws(()=>api.previewProfile(original,s),/brightness/);assert.throws(()=>api.loadProfile(original,s),/brightness/);
 assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);
 assert.throws(()=>s.transaction({rt:[{slot:99,field:'actuationMm',value:0}],lighting:[{field:'brightness',value:255}]}),/brightness/);
 assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);
});

test('baseline profile restores ordinary binding after DKS without clearing the unused current pattern',()=>{
 const s=session(),baseline=api.parseProfile(json(profile(s)),cap);
 s.advanced({type:'dks',slots:[34],index:1,pattern});const dks=s.draft.dks;
 const before=s.draft;assert.ok(api.previewProfile(baseline,s).some(c=>c.block==='keymap'));assert.deepEqual(s.draft,before);
 // Source getUpdateKeyData canonicalizes the explicitly replaced binding;
 // the profile's old fourth byte is not payload for this keyboard target.
 api.loadProfile(baseline,s);assert.deepEqual(s.draft.keymap.slice(136,140),Uint8Array.of(2,0,26,0));assert.deepEqual(s.draft.dks,dks);
});
test('stale unreferenced profile DKS record cannot block an unrelated supported edit',()=>{
 const s=session(),p=profile(s);p.blocks.dks[32]=255;p.blocks.colors[137]=12;
 const parsed=api.parseProfile(json(p),cap),before=s.draft;assert.equal(api.previewProfile(parsed,s).length,1);assert.deepEqual(s.draft,before);
 api.loadProfile(parsed,s);assert.equal(s.draft.colors[137],12);assert.deepEqual(s.draft.dks,before.dks);
});
test('profile preserves patterns referenced by retained locked Fn and nonphysical records',()=>{
 const original=session(),baseline=profile(original);original.advanced({type:'dks',slots:[34],index:1,pattern});
 const raw=original.draft;raw.fn.set([8,1,17,19],4);raw.keymap.set([8,1,21,23],127*4);
 const s=new ConfigSession({...original.snapshot,blocks:raw},cap),before=s.draft;baseline.blocks.colors[137]=12;
 api.previewProfile(baseline,s);assert.deepEqual(s.draft,before);api.loadProfile(baseline,s);
 assert.deepEqual(s.draft.fn,before.fn);assert.deepEqual(s.draft.keymap.slice(508),Uint8Array.of(8,1,21,23));assert.deepEqual(s.draft.dks,before.dks);assert.equal(s.draft.colors[137],12);
});
test('profile stages active base and Fn DKS patterns and rejects invalid active patterns atomically',()=>{
 const source=session();source.advanced({type:'dks',slots:[34],index:1,pattern});source.advanced({type:'dks',layer:'fn',slots:[49],index:2,pattern:{...pattern,thresholds:[5,15,15,5]}});
 const p=profile(source),s=session();api.loadProfile(p,s);assert.equal(s.draft.keymap[136],8);assert.equal(s.draft.fn[196],8);assert.deepEqual(Array.from(s.draft.dks.slice(32,36)),[5,15,15,5]);
 const bad=structuredClone(p);bad.blocks.dks.splice(16,4,20,10,10,20);bad.blocks.colors[137]=22;const before=s.draft,diff=s.diff();
 assert.throws(()=>api.previewProfile(bad,s),/DKS.*order/);assert.throws(()=>api.loadProfile(bad,s),/DKS.*order/);assert.deepEqual(s.draft,before);assert.deepEqual(s.diff(),diff);
});
test('profile round trip keeps exact identity, full bytes and truthful sample origin',()=>{
 const s=session(),p=profile(s),out=api.parseProfile(api.exportProfile(p),cap);
 assert.equal(out.schema,'a80rt-profile/v2');assert.deepEqual(out.identity,cap.identity);assert.equal(out.source,'sample');assert.deepEqual(out.blocks.colors.slice(136,140),[77,0,0,0]);
 assert.deepEqual(out.blocks,JSON.parse(json(p.blocks)));assert.match(out.name,/Cấu hình/);
});
test('rejects wrong model, identity field forgery, unknown schema, missing spans and every nonbyte',()=>{
 const p=profile();const other=identifyDevice({vendorId:0x0c45,productId:0x80a2,productName:'A80RT'});
 assert.throws(()=>api.parseProfile(json(p),other),/identity|model/i);
 for(const mutate of [p=>p.identity.model='a80rt',p=>p.identity.transport='dongle',p=>p.schema='future',p=>delete p.blocks.rt,p=>p.blocks.unknown=[0],p=>p.blocks.colors.pop(),p=>p.blocks.colors[0]=256,p=>p.blocks.colors[0]=-1,p=>p.blocks.colors[0]=0.5,p=>p.blocks.colors[0]=null]){const bad=structuredClone(p);mutate(bad);assert.throws(()=>api.parseProfile(json(bad),cap));}
});
test('rejects malformed macro pointer and broken macro/advanced references',()=>{
 for(const mutate of [p=>p.blocks.macro[0]=1,p=>p.blocks.keymap.splice(136,4,6,0,0,1),p=>p.blocks.keymap.splice(136,4,8,1,0,0),p=>p.blocks.keymap.splice(136,4,12,0,26,4)]){const p=profile();mutate(p);assert.throws(()=>api.parseProfile(json(p),cap),/macro|reference|pair/i);}
});
test('v1 opens only as view-only data and cannot load or save as full profile',async()=>{
 const p={schema:'a80rt-reader/v1',source:'demo',device:{...cap.identity,productName:'A80RT · mẫu minh họa'},createdAt:'2026-10-23T00:00:00.000Z',blocks:{colors:Array(512).fill(0)}};
 const view=api.parseProfile(json(p),cap);assert.equal(view.readOnly,true);assert.equal(view.source,'sample');assert.throws(()=>api.loadProfile(view,session()),/view|cũ|read.only/i);await assert.rejects(api.saveProfile(view,api.createMemoryStorage()),/view|cũ|read.only/i);
});
test('preview and load use semantic atomic patches retaining current opaque bytes and locked Fn',()=>{
 const target=session(),p=profile();p.blocks.settings[0]=19;p.blocks.colors.splice(136,4,2,3,4,5);p.blocks.rt[273]=7;p.blocks.fn.splice(4,4,13,0,0,3);p.blocks.keymap.splice(136,4,2,0,4,199);
 const before=target.draft,preview=api.previewProfile(p,target);assert.deepEqual(target.draft,before);assert.equal(preview.length,3);
 const changes=api.loadProfile(p,target);assert.equal(changes.length,3);assert.deepEqual(target.draft.colors.slice(136,140),Uint8Array.of(77,3,4,5));assert.equal(target.draft.settings[0],231);assert.equal(target.draft.rt[273],129);assert.equal(target.draft.keymap[139],0);assert.deepEqual(target.draft.keymap.slice(140),before.keymap.slice(140));assert.deepEqual(target.draft.fn,before.fn);assert.deepEqual(target.draft.device,before.device);
});
test('invalid supported field rejects whole transaction and preserves an existing draft',()=>{
 const target=session();target.edit('colors',[{slot:49,field:'rgb',value:{red:8,green:9,blue:10}}]);const before=target.draft,diff=target.diff(),p=profile();p.blocks.colors[137]=7;p.blocks.lighting[9]=255;
 assert.throws(()=>api.loadProfile(p,target),/brightness/);assert.deepEqual(target.draft,before);assert.deepEqual(target.diff(),diff);
});
test('macro imports preserve current header/flag bytes and repair references atomically',()=>{
 const target=session();target.edit('macro',[{field:'macros',value:[{events:[{delayMs:10,code:4,device:'keyboard',action:'down'}]}]}]);target.edit('keymap',[{slot:34,field:'binding',value:{type:'macro',index:0,mode:0,repeat:1}}]);
 const raw=target.draft;raw.macro[402]=83;raw.macro[407]|=1;
 const source=new ConfigSession({...target.snapshot,blocks:raw},cap);const p=profile(source);p.blocks.macro[404]=25;p.blocks.macro[402]=99;p.blocks.macro[407]=176;
 api.loadProfile(p,source);const m=decodeMacros(source.draft.macro,cap)[0];assert.equal(m.events[0].delayMs,25);assert.equal(source.draft.macro[402],83);assert.equal(source.draft.macro[407],177);assert.equal(source.draft.keymap[136],6);
 const removal=profile();api.loadProfile(removal,source);assert.equal(decodeMacros(source.draft.macro,cap).length,0);assert.equal(source.draft.keymap[136],2);
});
test('offline recovery cannot obtain live source authority from serialized metadata',()=>{
 const p=profile();p.source='device';p.provenance={source:'device',sessionId:'forged',writeEpoch:0};const parsed=api.parseProfile(json(p),cap),restored=api.restoreProfile(parsed);assert.equal(restored.snapshot.provenance.source,'profile');assert.equal(restored.snapshot.provenance.sessionId,undefined);assert.equal(restored.diff().length,0);
});

test('profile projection skips unverified binding types and retains current opaque records',()=>{
 const target=session(),raw=target.draft;raw.keymap.set([254,9,8,7],34*4);const s=new ConfigSession({...target.snapshot,blocks:raw},cap),p=profile();p.blocks.keymap.splice(136,4,253,4,5,6);p.blocks.fn.splice(49*4,4,7,4,5,6);p.blocks.colors[137]=12;
 api.loadProfile(p,s);assert.deepEqual(s.draft.keymap.slice(136,140),Uint8Array.of(254,9,8,7));assert.deepEqual(s.draft.fn.slice(196,200),Uint8Array.of(0,0,0,0));assert.equal(s.draft.colors[137],12);
});
test('memory storage isolates models, updates named profiles, duplicates and deletes defensively',async()=>{
 const storage=api.createMemoryStorage(),p=profile(),id=await api.saveProfile(p,storage);assert.equal(typeof id,'string');let list=await api.listProfiles(cap.identity,storage);assert.equal(list.length,1);list[0].blocks.colors[137]=222;
 assert.equal((await api.listProfiles(cap.identity,storage))[0].blocks.colors[137],0);
 const copy=api.duplicateProfile({...p,id},'Bản sao');const copyId=await api.saveProfile(copy,storage);assert.notEqual(copyId,id);assert.equal((await api.listProfiles(cap.identity,storage)).length,2);
 await api.saveProfile({...p,id,name:'Tên mới'},storage);assert.equal((await api.listProfiles(cap.identity,storage)).find(p=>p.id===id).name,'Tên mới');
 const other=identifyDevice({vendorId:0x0c45,productId:0x80a2,productName:'A80RT'});assert.deepEqual(await api.listProfiles(other.identity,storage),[]);await api.deleteProfile(id,cap.identity,storage);assert.equal((await api.listProfiles(cap.identity,storage)).length,1);
});
test('quota failure preserves previous saved profile, recovery and current session draft',async()=>{
 const storage=api.createMemoryStorage({quotaBytes:25000}),s=session(),p=profile(s),id=await api.saveProfile(p,storage);await api.saveRecovery(p,storage);const before=await api.readRecovery(cap.identity,storage);
 s.edit('colors',[{slot:34,field:'rgb',value:{red:4,green:5,blue:6}}]);const draft=s.draft;storage.quotaBytes=1;
 await assert.rejects(api.saveProfile({...profile(s),id},storage),/quota|dung lượng/i);await assert.rejects(api.saveRecovery(profile(s),storage),/quota|dung lượng/i);
 assert.deepEqual(await api.readRecovery(cap.identity,storage),before);assert.deepEqual(s.draft,draft);assert.equal((await api.listProfiles(cap.identity,storage))[0].blocks.colors[137],0);
});

test('actual host previews import without USB, applies only on confirmation and keeps recorder input on storage failure',async()=>{
 class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.value='';this.files=[];this.disabled=false;this.hidden=false;this.style={setProperty(){}};this.classList={toggle(){}};this.textContent='';}append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.value;}}replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attributes[k]=v;}get options(){return this.children;}addEventListener(t,fn){this.listeners.set(t,fn);}removeEventListener(t){this.listeners.delete(t);}async trigger(t,event={}){await this.listeners.get(t)?.({target:this,...event});}querySelectorAll(){return this.children.flatMap(c=>[c,...(c.querySelectorAll?.()??[])]).filter(c=>['input','select','button'].includes(c.tag));}}
 const elements=[],roots=new Map(),get=id=>elements.findLast(el=>el.id===id)??roots.get(id)??(()=>{const el=new Element();roots.set(id,el);return el;})();
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');let requests=0;
 const hid=new EventTarget();hid.requestDevice=async()=>{requests++;throw new Error('No HID permitted by this test');};globalThis.document=Object.assign(new EventTarget(),{getElementById:get,createElement:tag=>{const el=new Element(tag);elements.push(el);return el;},createTextNode:text=>({textContent:text}),hasFocus:()=>true});globalThis.window=Object.assign(new EventTarget(),{isSecureContext:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
 try{
  await import('../dist/app.js?task7-profile-host');await get('sample-button').trigger('click');
  await get('macro-add-event').trigger('click');const delay=elements.findLast(el=>el.attributes['aria-label']==='Delay ms sự kiện 1');delay.value='123';await delay.trigger('change');await get('macro-record-start').trigger('click');assert.equal(get('macro-record-stop').disabled,false);
  await get('profiles-panel').trigger('focusin');assert.equal(get('macro-record-stop').disabled,true);
  const p=profile();p.blocks.lighting.splice(0,12,128,195,245,107,0,40,70,120,0,3,3,0);p.blocks.colors[137]=12;get('profile-file').files=[{size:10000,text:async()=>json(p)}];await get('profile-file').trigger('change');
  assert.match(get('profile-preview').textContent,/colors/);assert.match(get('draft-count').textContent,/0 thay đổi/);assert.equal(get('profile-confirm').disabled,false);
  get('profile-file').files=[{size:4,text:async()=>'{bad'}];await get('profile-file').trigger('change');assert.equal(get('profile-confirm').disabled,true,'invalid replacement import cannot confirm a stale preview');assert.match(get('draft-count').textContent,/0 thay đổi/);
  get('profile-file').files=[{size:10000,text:async()=>json(p)}];await get('profile-file').trigger('change');
  await get('profile-confirm').trigger('click');assert.doesNotMatch(get('draft-count').textContent,/^0 /);assert.equal(get('apply-button').disabled,true);assert.equal(requests,0);
  get('profile-name').value='Kiểm tra lỗi';await get('profile-save').trigger('click');assert.match(get('profile-status').textContent,/IndexedDB/);assert.equal(delay.value,'123');assert.equal(elements.findLast(el=>el.attributes['aria-label']==='Delay ms sự kiện 1'),delay);assert.doesNotMatch(get('draft-count').textContent,/^0 /);
  await get('revert-button').trigger('click');get('profile-file').files=[{size:4,text:async()=>'{bad'}];await get('profile-file').trigger('change');assert.match(get('draft-count').textContent,/0 thay đổi/);assert.match(get('profile-status').textContent,/JSON|property/i);
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});

test('offline raw restoration retains captured unsupported bytes without authority; live-style projection validates edits against current ownership',async()=>{
 const {A80Transport}=await import('../dist/device/transport.js');const dongle=identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'}),seed=session(),raw=seed.draft;raw.rt[272]=240;
 const target=new ConfigSession({...seed.snapshot,identity:dongle.identity,blocks:raw},dongle),p=api.createProfile(target,'Giữ byte gốc');p.source='device';p.provenance={source:'device',sessionId:'forged'};p.blocks.lighting[9]=255;p.blocks.rt[272]=2;p.blocks.fn.splice(4,4,2,0,4,0);p.blocks.settings[0]=17;p.blocks.colors[137]=12;
 const restored=api.restoreProfile(api.parseProfile(JSON.stringify(p),dongle));assert.equal(restored.snapshot.provenance.source,'profile');assert.equal(restored.snapshot.provenance.sessionId,undefined);assert.deepEqual(restored.diff(),[]);assert.deepEqual(Object.fromEntries(Object.entries(restored.draft).map(([id,b])=>[id,Array.from(b)])),p.blocks);assert.deepEqual(JSON.parse(api.exportProfile(api.createProfile(restored,'Xuất lại'))).blocks,p.blocks);
 let sends=0;const device={...dongle.identity,opened:true,collections:[{usagePage:0xff80,usage:1,outputReports:[{reportId:0,items:[{reportSize:8,reportCount:32}]}]}],sendReport(){sends++;}};const transport=new A80Transport(device);restored.edit('colors',[{slot:49,field:'rgb',value:{red:1,green:2,blue:3}}]);const result=await restored.apply(transport);assert.equal(result.status,'failed');assert.match(result.error,/complete device.read snapshot|provenance/i);assert.equal(sends,0);
 target.edit('colors',[{slot:49,field:'rgb',value:{red:9,green:8,blue:7}}]);const before=target.draft,diff=target.diff();assert.throws(()=>api.loadProfile(p,target),/brightness.*1.*5/);assert.deepEqual(target.draft,before);assert.deepEqual(target.diff(),diff);
 p.blocks.lighting[9]=5;api.loadProfile(p,target);assert.equal(target.draft.lighting[9],5);assert.equal(target.draft.rt[272],240);assert.deepEqual(target.draft.fn,before.fn);assert.equal(target.draft.settings[0],231);assert.equal(target.draft.colors[137],12);
});
