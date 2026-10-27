import {identifyDevice,readPlan} from '../device/capabilities.js';
import {ConfigSession} from './session.js';
import {decodeBlock,patchBlock} from './codecs.js';
import {decodeMacros,macroReferenceChanges} from './macros.js';
import {decodePattern,validateReferences} from './advanced.js';

const SCHEMA='a80rt-profile/v2',clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=reason=>{throw new Error(`Profile: ${reason}`);};
const identityKeys=['vendorId','productId','productName','transport','model'];
function capabilityFor(identity){const cap=identifyDevice(identity);if(identityKeys.some(key=>identity[key]!==cap.identity[key]))fail('identity/model không khớp.');return cap;}
function keyFor(identity){const cap=capabilityFor(identity);return identityKeys.map(key=>cap.identity[key]).join('|');}
function nameFor(name){if(typeof name!=='string'||!name.trim()||name.trim().length>120)fail('Tên cần có 1–120 ký tự.');return name.trim();}
function full(profile,capability){
 if(profile?.readOnly)fail('Bản cũ view-only, không phải hồ sơ đầy đủ.');
 if(profile?.schema!==SCHEMA)fail('schema không được hỗ trợ.');
 const cap=capabilityFor(profile.identity);if(capability&&cap!==capability)fail('identity/model khác hồ sơ hiện tại.');
 const plan=readPlan(cap);if(!profile.blocks||Object.keys(profile.blocks).length!==plan.length)fail('Cần đủ 9 vùng cấu hình.');
 const blocks={};for(const {id}of plan)blocks[id]=decodeBlock(id,profile.blocks[id],cap).bytes;
 const errors=validateReferences(blocks,undefined,cap);if(errors.length)fail(errors.join('; '));
 return {cap,blocks};
}
function normalized(profile,capability){
 const {cap,blocks}=full(profile,capability);
 return {schema:SCHEMA,...(typeof profile.id==='string'?{id:profile.id}:{}),name:nameFor(profile.name),identity:{...cap.identity},source:profile.source==='sample'?'sample':profile.source==='device'?'device':'profile',createdAt:typeof profile.createdAt==='string'?profile.createdAt:new Date().toISOString(),blocks:Object.fromEntries(Object.entries(blocks).map(([id,bytes])=>[id,Array.from(bytes)]))};
}
export function createProfile(session,name){
 if(!session||session.invalidated||session.applying)fail('Phiên cấu hình chưa sẵn sàng.');
 const snapshot=session.snapshot,cap=capabilityFor(snapshot.identity);
 for(const {id,length}of readPlan(cap))if(snapshot.coverage?.[id]?.complete!==true||snapshot.coverage[id].receivedBytes!==length||snapshot.coverage[id].expectedBytes!==length)fail('Cần đủ coverage 9 vùng.');
 return normalized({schema:SCHEMA,name,identity:snapshot.identity,source:snapshot.provenance.source,blocks:session.draft});
}
export function parseProfile(json,capability){
 const input=JSON.parse(json);
 if(input?.schema==='a80rt-reader/v1'){
  if(!input.blocks||typeof input.blocks!=='object'||!input.device)fail('Bản JSON cũ không hợp lệ.');
  // Diagnostic files can be partial; validation never upgrades them to a session.
  const blocks={};for(const [id,bytes]of Object.entries(input.blocks)){
   if(!capability?.blocks[id]||!Array.isArray(bytes)||bytes.length!==capability.blocks[id].length||Array.from(bytes).some(v=>!Number.isInteger(v)||v<0||v>255))fail('Byte bản cũ không hợp lệ.');blocks[id]=bytes.slice();
  }
  return {schema:input.schema,readOnly:true,source:['demo','sample'].includes(input.source)?'sample':'profile',device:clone(input.device),createdAt:input.createdAt,blocks};
 }
 return normalized(input,capability);
}
export function exportProfile(profile){if(profile?.readOnly)return JSON.stringify(profile,null,2);return JSON.stringify(normalized(profile),null,2);}
export function duplicateProfile(profile,name){const p=normalized(profile);delete p.id;p.name=nameFor(name);p.createdAt=new Date().toISOString();return p;}
export function restoreProfile(profile){
 const p=normalized(profile),{cap,blocks}=full(p),coverage=Object.fromEntries(readPlan(cap).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}]));
 return new ConfigSession({identity:cap.identity,blocks,coverage,provenance:{source:'profile',savedSource:p.source,restoredAt:new Date().toISOString()}},cap);
}
function bindingValue(binding){
 const fields={empty:[],keyboard:['modifier','usage'],mouse:['mouseCode','code'],media:['usage'],function:['code'],macro:['index','mode','repeat'],combination:['keys'],dks:['index'],mt:['tap','hold','timeMs'],tgl:['key'],socd:['mode','key1','key2'],rs:['key1','key2']}[binding.type];
 if(!fields)return {type:'unknown',bytes:Array.from(binding.bytes)};
 return {type:binding.type,...Object.fromEntries(fields.map(field=>[field,binding[field]]))};
}
function semanticGroups(profile,session){
 const {cap,blocks:desired}=full(profile,capabilityFor(session.snapshot.identity)),current=session.draft,groups={};
 const add=(id,edit)=>{(groups[id]??=[]).push(edit);};
 for(const id of ['settings','lighting']){
  const before=decodeBlock(id,current[id],cap).fields,after=decodeBlock(id,desired[id],cap).fields;
  for(const [field,enabled]of Object.entries(cap.fields[id]))if(enabled&&before[field]!==after[field])add(id,{field,value:after[field]});
 }
 for(const id of ['rt','colors','keymap','fn']){
  const before=decodeBlock(id,current[id],cap).records,after=decodeBlock(id,desired[id],cap).records;
  for(const slot of cap.slots){
   if(id==='fn'&&cap.limits.fnLockedSlots.includes(slot))continue;
   if(id==='rt'){for(const [field,enabled]of Object.entries(cap.fields.rt))if(enabled&&before[slot][field]!==after[slot][field])add(id,{slot,field,value:after[slot][field]});}
   else if(id==='colors'){const rgb=record=>Object.fromEntries(['red','green','blue'].map(field=>[field,record[field]]));if(!same(rgb(before[slot]),rgb(after[slot])))add(id,{slot,field:'rgb',value:rgb(after[slot])});}
   else{const a=bindingValue(before[slot].binding),b=bindingValue(after[slot].binding);if(['unknown','combination'].includes(b.type))continue;if(!same(a,b))add(id,{slot,field:'binding',value:b});}
  }
 }
 const events=macros=>macros.map(m=>m.events.map(({flags,...event})=>event)),old=decodeMacros(current.macro,cap),next=decodeMacros(desired.macro,cap);
 if(!same(events(old),events(next))){
  // Imported source indices have no authority over current opaque metadata.
  // Corresponding current entries own the preserved reserved bytes and flags.
  const macros=next.map((m,index)=>({...index<old.length?{sourceIndex:index}:{},events:events([m])[0]}));
  add('macro',{field:'macros',value:macros});
  const remaps=macroReferenceChanges(old,macros);
  for(const id of ['keymap','fn'])for(let slot=0;slot<128;slot++)if(current[id][slot*4]===6&&remaps.some(r=>r.before===current[id][slot*4+1])&&!groups[id]?.some(e=>e.slot===slot)){
   // Explicit repairs are required by the session, even if a semantic binding
   // already happens to match the requested final value. Locked Fn stays locked.
   if(!cap.slots.includes(slot)||id==='fn'&&cap.limits.fnLockedSlots.includes(slot))fail('macro reference trong vị trí khóa không thể sửa.');
   add(id,{slot,field:'binding',value:bindingValue(decodeBlock(id,desired[id],cap).records[slot].binding)});
  }
 }
 // Only import templates used by the final semantic projection. Locked,
 // nonphysical and skipped bindings still own their current references; an
 // unreferenced captured template has no authority to clear those patterns.
 const imported=new Set(),preserved=new Map();
 for(const id of ['keymap','fn']){
  const projected=groups[id]?patchBlock(id,current[id],groups[id],cap).bytes:current[id];
  for(let offset=0;offset<projected.length;offset+=4)if(projected[offset]===8){
   const index=projected[offset+1],slot=offset/4;
   const editable=cap.slots.includes(slot)&&!(id==='fn'&&cap.limits.fnLockedSlots.includes(slot));
   if(editable&&desired[id][offset]===8&&desired[id][offset+1]===index)imported.add(index);
   else preserved.set(index,[...(preserved.get(index)??[]),`${id}[${slot}]`]);
  }
 }
 for(const slot of imported){
  const a=decodePattern(current.dks,slot),b=decodePattern(desired.dks,slot);if(same(a,b))continue;
  if(preserved.has(slot))fail(`DKS ${slot} dùng chung với vị trí phải giữ nguyên (${preserved.get(slot).join(', ')}); không thể thay mẫu. Chọn mẫu DKS riêng cho các phím được sửa.`);
  add('dks',{slot,field:'pattern',value:b});
 }
 return groups;
}
export function previewProfile(profile,session){
 return session.preview(semanticGroups(profile,session));
}
export function profileSkippedFields(profile,session){
 const {cap,blocks:desired}=full(profile,capabilityFor(session.snapshot.identity)),current=session.draft,skipped=[];
 for(const id of ['settings','lighting','rt']){
  const before=decodeBlock(id,current[id],cap),after=decodeBlock(id,desired[id],cap);
  for(const [field,enabled]of Object.entries(cap.fields[id]))if(!enabled){
   if(id==='rt'){for(const slot of cap.slots)if(before.records[slot][field]!==after.records[slot][field])skipped.push({block:id,path:`records[${slot}].${field}`});}
   else if(before.fields[field]!==after.fields[field])skipped.push({block:id,path:`fields.${field}`});
  }
 }
 return skipped;
}
export function loadProfile(profile,session){return session.transaction(semanticGroups(profile,session));}

// Adapters commit a record atomically. Failed quota/transaction requests leave
// the previous value intact and are allowed to reach the UI unchanged.
export function createMemoryStorage({quotaBytes=Infinity}={}){
 const records=new Map();return {quotaBytes,async get(key){return clone(records.get(key));},async values(){return [...records.values()].map(clone);},async put(key,value){const next=new Map(records);next.set(key,clone(value));if(new TextEncoder().encode(JSON.stringify([...next])).length>this.quotaBytes)throw new Error('Quota: hết dung lượng lưu cục bộ.');records.set(key,clone(value));},async delete(key){records.delete(key);}};
}
export function createIndexedDBStorage(indexedDB=globalThis.indexedDB){
 let database;
 async function open(){if(!indexedDB)throw new Error('Trình duyệt không hỗ trợ IndexedDB.');if(!database)database=new Promise((resolve,reject)=>{const request=indexedDB.open('a80rt-local-profiles',1);request.onupgradeneeded=()=>request.result.createObjectStore('profiles');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Kho hồ sơ đang bị khóa bởi tab khác.'));}).catch(error=>{database=undefined;throw error;});return database;}
 async function run(mode,action){const db=await open();return new Promise((resolve,reject)=>{let value;const tx=db.transaction('profiles',mode),request=action(tx.objectStore('profiles'));request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error??request.error??new Error('Giao dịch lưu hồ sơ bị hủy.'));tx.onerror=()=>reject(tx.error??request.error);});}
 return {get:key=>run('readonly',store=>store.get(key)),values:()=>run('readonly',store=>store.getAll()),put:(key,value)=>run('readwrite',store=>store.put(clone(value),key)),delete:key=>run('readwrite',store=>store.delete(key))};
}
const newId=()=>globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export async function saveProfile(profile,storage){const p=normalized(profile),id=p.id??newId();p.id=id;await storage.put(`profile:${keyFor(p.identity)}:${id}`,p);return id;}
export async function listProfiles(identity,storage){const key=keyFor(identity);return (await storage.values()).filter(p=>p?.schema===SCHEMA&&p.id&&keyFor(p.identity)===key).map(p=>normalized(p,capabilityFor(identity))).sort((a,b)=>a.name.localeCompare(b.name,'vi'));}
export async function deleteProfile(id,identity,storage){await storage.delete(`profile:${keyFor(identity)}:${id}`);}
export async function saveRecovery(profile,storage){const p=normalized(profile);delete p.id;await storage.put(`recovery:${keyFor(p.identity)}`,p);}
export async function readRecovery(identity,storage){const p=await storage.get(`recovery:${keyFor(identity)}`);return p?normalized(p,capabilityFor(identity)):null;}
