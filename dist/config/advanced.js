import {KEYS} from '../layout.js';
import {readPlan} from '../device/capabilities.js';
import {patchBlock} from './codecs.js';
import {decodeMacros} from './macros.js';
const fail=reason=>{throw new Error(`advanced: ${reason}`);};
const integer=(v,min,max,name)=>{if(!Number.isInteger(v)||v<min||v>max)fail(`${name} must be ${min}..${max}`);return v;};
const key=(v,cap)=>{if(![...cap.limits.keyboardUsages,...cap.limits.modifierUsages].includes(v)||!v)fail('unsupported key usage');return v;};
export function encodeAdvancedBinding(value,original,capability){
 const bytes=original.slice();if(!capability.advanced.includes(value.type)&&value.type!=='macro')fail('unsupported binding');
 const properties={macro:['type','index','mode','repeat'],rs:['type','key1','key2'],socd:['type','mode','key1','key2'],dks:['type','index'],mt:['type','tap','hold','timeMs'],tgl:['type','key']}[value.type];
 for(const name of Object.keys(value))if(!properties.includes(name))fail(`unknown ${name}`);
 if(value.type==='macro'){bytes.set([6,integer(value.index,0,99,'macro index'),integer(value.mode,0,2,'macro mode'),integer(value.repeat,1,255,'macro repeat')]);}
 else if(value.type==='rs'||value.type==='socd'){
  const a=key(value.key1,capability),b=key(value.key2,capability);if(a===b)fail('pair requires distinct keys');let mode=0;
  if(value.type==='socd'){mode=integer(value.mode,1,4,'SOCD mode');}bytes.set([value.type==='rs'?12:11,mode,a,b]);
 }else if(value.type==='dks'){bytes[0]=8;bytes[1]=integer(value.index,1,63,'DKS index');}
 else if(value.type==='mt'){integer(value.timeMs,10,1000,'MT timeMs');if(value.timeMs%10)fail('MT time uses 10ms steps');bytes.set([9,key(value.tap,capability),key(value.hold,capability),value.timeMs/10]);}
 else{bytes[0]=10;bytes[1]=key(value.key,capability);}
 return bytes;
}
export function decodePattern(bytes,index){const offset=index*16;return {thresholds:Array.from(bytes.slice(offset,offset+4)),keys:[5,7,9,11].map(n=>bytes[offset+n]),actions:Array.from(bytes.slice(offset+12,offset+16))};}
export function patchPattern(bytes,index,pattern,capability){
 integer(index,1,63,'DKS index');if(!pattern||Object.keys(pattern).some(k=>!['thresholds','keys','actions'].includes(k)))fail('DKS pattern fields invalid');
 for(const name of ['thresholds','keys','actions'])if(!Array.isArray(pattern[name])||pattern[name].length!==4)fail(`DKS ${name} requires four values`);
 const t=pattern.thresholds;t.forEach(v=>integer(v,1,34,'DKS threshold'));
 if(t[0]!==t[3]||t[1]!==t[2]||t[0]>=t[1])fail('DKS threshold paired travel order invalid');
 pattern.keys.forEach(v=>{if(v!==0)key(v,capability);});pattern.actions.forEach((v,i)=>{integer(v,0,i===3?15:255,'DKS action');if((v&15)&(v>>4))fail('DKS action cannot click and hold the same key');});
 const result=bytes.slice(),offset=index*16;result.set(t,offset);[5,7,9,11].forEach((n,i)=>result[offset+n]=pattern.keys[i]);result.set(pattern.actions,offset+12);return result;
}
export function advancedEdits(blocks,binding,capability){
 readPlan(capability);const layer=binding.layer==='fn'?'fn':'keymap';if(binding.layer!==undefined&&!['base','fn'].includes(binding.layer))fail('unknown layer');
 const slots=binding.slots;if(!Array.isArray(slots)||!slots.length||slots.some(s=>!capability.slots.includes(s)))fail('physical slots required');
 if(new Set(slots).size!==slots.length)fail('distinct physical positions required');
 const value={...binding};for(const k of ['slots','layer','pattern'])delete value[k];
 if(['rs','socd'].includes(value.type)){
  if(slots.length!==2)fail('pair requires two distinct positions');const usages=slots.map(slot=>KEYS.find(k=>k.slot===slot).usage);value.key1=usages[0];value.key2=usages[1];
 }else if(slots.length!==1)fail('advanced assignment requires one physical position');
 const edits={[layer]:slots.map(slot=>({slot,field:'binding',value}))};
 if(value.type==='dks'){
  for(const id of ['keymap','fn'])for(let slot=0;slot<128;slot++)if(blocks[id]?.[slot*4]===8&&blocks[id][slot*4+1]===value.index&&(id!==layer||!slots.includes(slot)))fail('DKS pattern already used by another key reference');
 }
 if(value.type==='dks')edits.dks=[{slot:value.index,field:'pattern',value:binding.pattern}];return edits;
}
export function patchAdvanced(blocks,binding,capability){
 const edits=advancedEdits(blocks,binding,capability),result=Object.fromEntries(Object.entries(blocks).map(([id,raw])=>[id,Uint8Array.from(raw)])),changes=[];
 for(const [id,list]of Object.entries(edits)){const patched=patchBlock(id,result[id],list,capability);result[id]=patched.bytes;changes.push(...patched.changes);}
 const errors=validateReferenceEdits(blocks,result,edits,capability);if(errors.length)fail(errors.join('; '));return {blocks:result,changes};
}
// Unrelated malformed captured data remains readable/editable. Matching old
// error text does not exempt a relationship whose inputs this edit touches.
export function validateReferenceEdits(before,after,groups,capability){
 const scope={bindings:new Set(),patterns:new Set(),switches:new Set(),macro:!!groups.macro?.some(edit=>edit.field==='macros')};
 for(const id of ['keymap','fn'])for(const edit of groups[id]??[])if(edit.field==='binding')scope.bindings.add(`${id}[${edit.slot}]`);
 for(const edit of groups.dks??[])if(edit.field==='pattern')scope.patterns.add(edit.slot);
 for(const edit of groups.rt??[])if(edit.field==='switchId')scope.switches.add(edit.slot);
 const original=new Set(validateReferences(before,undefined,capability));
 const affected=new Set(validateReferences(after,undefined,capability,scope));
 return validateReferences(after,undefined,capability).filter(error=>affected.has(error)||!original.has(error));
}
export function validateReferences(blocks,macros,capability,scope){
 readPlan(capability);const errors=[];if(!macros){try{macros=decodeMacros(blocks.macro,capability);}catch(e){if(!scope||scope.macro)errors.push(e.message);macros=[];}}
 for(const id of ['keymap','fn']){const data=blocks[id];if(!data)continue;
  for(let slot=0;slot<data.length/4;slot++){const [type,a,b,c]=data.slice(slot*4,slot*4+4),label=`${id}[${slot}]`;
   if(scope){
    const pairSlots=[11,12].includes(type)?[b,c].map(usage=>KEYS.find(key=>key.usage===usage)?.slot):[];
    const affected=scope.bindings.has(label)||(type===6&&scope.macro)||(type===8&&(scope.patterns.has(a)||scope.switches.has(slot)))||pairSlots.some(member=>scope.bindings.has(`${id}[${member}]`));
    if(!affected)continue;
   }
   if(type===6&&a>=macros.length)errors.push(`${label} macro reference ${a} missing`);
   if(type===8){const t=blocks.dks?.slice(a*16,a*16+4);if(a<1||a>63||!t||!t.some(Boolean))errors.push(`${label} DKS reference ${a} missing`);else if(capability.slots.includes(slot)){const travel=capability.limits.switchTravelMm[blocks.rt?.[slot*8]];if(travel===undefined||Math.max(...t)>travel*10)errors.push(`${label} DKS threshold exceeds switch travel`);}}
   if((type===11||type===12)&&capability.slots.includes(slot)){
    const first=KEYS.find(k=>k.usage===b),second=KEYS.find(k=>k.usage===c);if(!first||!second||b===c||![first.slot,second.slot].includes(slot)||[first,second].some(k=>!data.slice(k.slot*4,k.slot*4+4).every((v,i)=>v===[type,a,b,c][i])))errors.push(`${label} broken advanced pair`);
   }
  }
 }
 return errors;
}
