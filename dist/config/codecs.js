import {readPlan} from '../device/capabilities.js';

const SETTINGS = {sleep:3,responseTime:4,polling:5,osMode:6,tftTime:7,topDeadZone:8,bottomDeadZone:9,stability:11,autoCalibration:14,wake:15};
const LIGHTING = {mode:0,red:1,green:2,blue:3,secondaryRed:5,secondaryGreen:6,secondaryBlue:7,colorMode:8,brightness:9,speed:10,direction:11,gearMode:12};
const DISTANCES = {actuationMm:2,pressMm:4,releaseMm:6};
const FLAGS = {whole:1,bottom:2,rtMode:4};
const KEY_TYPES = {0:'empty',1:'mouse',2:'keyboard',3:'media',6:'macro',7:'combination',8:'dks',9:'mt',10:'tgl',11:'socd',12:'rs',13:'function'};
const own = (object,key) => Object.hasOwn(object,key);
const word = (bytes,offset) => bytes[offset] | bytes[offset+1] << 8;
const fail = (field,reason='unsupported or unverified') => { throw new Error(`${field}: ${reason}`); };
const integer = (value,min,max,field) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(field,`expected integer ${min}..${max}`);
  return value;
};
const member = (value,values,field) => { if (!values.includes(value)) fail(field,'unsupported value');return value; };

function copyBlock(id,raw,capability) {
  const block = readPlan(capability).find(block=>block.id===id);
  if (!block) fail(id,'unknown block');
  let values;
  if (raw instanceof DataView) values = new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);
  else if (raw instanceof Uint8Array || Array.isArray(raw)) values = raw;
  else fail('raw','expected Uint8Array, DataView or byte array');
  if (values.length !== block.length) fail('raw.length',`${id} needs exactly ${block.length} complete bytes`);
  // Array.from includes holes: unlike .some(), it cannot silently skip missing bytes.
  if (Array.from(values).some(value=>!Number.isInteger(value)||value<0||value>255)) fail('raw','invalid byte');
  return Uint8Array.from(values);
}

function binding(bytes,offset) {
  const typeCode = bytes[offset], type = KEY_TYPES[typeCode] ?? 'unknown';
  const result = {type,typeCode,bytes:bytes.slice(offset,offset+4)};
  if (typeCode === 1) Object.assign(result,{mouseCode:bytes[offset+1],code:bytes[offset+2]});
  if (typeCode === 2) Object.assign(result,{modifier:bytes[offset+1],usage:bytes[offset+2]});
  if (typeCode === 3) result.usage = word(bytes,offset+1);
  if (typeCode === 6) Object.assign(result,{index:bytes[offset+1],mode:bytes[offset+2],repeat:bytes[offset+3]});
  if (typeCode === 7) result.keys = Array.from(bytes.slice(offset+1,offset+4));
  if (typeCode === 8) result.index = bytes[offset+1];
  if (typeCode === 9) Object.assign(result,{tap:bytes[offset+1],hold:bytes[offset+2],timeMs:bytes[offset+3]*10});
  if (typeCode === 10) result.key = bytes[offset+1];
  if (typeCode === 11) Object.assign(result,{mode:bytes[offset+1],key1:bytes[offset+2],key2:bytes[offset+3]});
  if (typeCode === 12) Object.assign(result,{key1:bytes[offset+2],key2:bytes[offset+3]});
  if (typeCode === 13) result.code = bytes[offset+1]*65536+bytes[offset+2]*256+bytes[offset+3];
  return result;
}

export function decodeBlock(blockId,raw,capability) {
  const bytes = copyBlock(blockId,raw,capability);
  const result = {id:blockId,bytes};
  if (blockId === 'rt') result.records = Array.from({length:bytes.length/8},(_,slot)=>{
    const offset = slot*8, flags = bytes[offset+1];
    return {slot,switchId:bytes[offset],flags,whole:!!(flags&1),bottom:!!(flags&2),rtMode:!!(flags&4),
      actuationRaw:word(bytes,offset+2),actuationMm:word(bytes,offset+2)/100,
      pressRaw:word(bytes,offset+4),pressMm:word(bytes,offset+4)/100,
      releaseRaw:word(bytes,offset+6),releaseMm:word(bytes,offset+6)/100,bytes:bytes.slice(offset,offset+8)};
  });
  else if (blockId === 'keymap' || blockId === 'fn') result.records = Array.from({length:bytes.length/4},(_,slot)=>({slot,binding:binding(bytes,slot*4)}));
  else if (blockId === 'colors') result.records = Array.from({length:bytes.length/4},(_,slot)=>({slot,marker:bytes[slot*4],red:bytes[slot*4+1],green:bytes[slot*4+2],blue:bytes[slot*4+3]}));
  else if (blockId === 'settings' || blockId === 'lighting') result.fields = Object.fromEntries(Object.entries(blockId==='settings'?SETTINGS:LIGHTING).map(([field,offset])=>[field,bytes[offset]]));
  else if (blockId === 'device') result.fields = {version:((bytes[8]&15)+10*(bytes[8]>>4)+100*bytes[9])/100,battery:bytes[17],axialModel:word(bytes,20)};
  // Macro and DKS semantic editors/validation belong to Task5. Their source formats
  // are documented in protocol-facts.json; opaque reads still round-trip exactly.
  else result.format = 'opaque';
  return result;
}

function checkEdit(edit) {
  if (!edit || typeof edit!=='object' || Array.isArray(edit) || typeof edit.field!=='string') fail('edits','expected {field,value,slot?}');
  for (const key of Object.keys(edit)) if (!['slot','field','value'].includes(key)) fail(key,'unknown edit property');
  if (!own(edit,'value')) fail(edit.field,'missing value');
}

function slotOffset(edit,stride,capability) {
  if (!Number.isInteger(edit.slot) || !capability.slots.includes(edit.slot)) fail('slot','not a physical A80RT slot');
  return edit.slot*stride;
}

function patchRT(bytes,edit,capability) {
  const {field,value} = edit, offset = slotOffset(edit,8,capability);
  if (field === 'switchId') bytes[offset] = member(value,capability.limits.switchIds,field);
  else if (own(FLAGS,field)) {
    if (typeof value !== 'boolean') fail(field,'expected boolean');
    bytes[offset+1] = value ? bytes[offset+1] | FLAGS[field] : bytes[offset+1] & ~FLAGS[field];
  } else if (own(DISTANCES,field)) {
    const scaled = value*100;
    if (typeof value!=='number' || !Number.isFinite(value) || Math.abs(scaled-Math.round(scaled))>1e-8 || value<(field==='actuationMm'?0.01:0) || value>3.4) fail(field,'expected 0.01mm steps within switch travel');
    const index = offset+DISTANCES[field], raw = Math.round(scaled);
    bytes[index] = raw&255; bytes[index+1] = raw>>8;
  } else fail(field);
}

function patchScalar(id,bytes,edit,capability) {
  const {field,value} = edit;
  if (own(edit,'slot')) fail('slot',`${id} fields are global`);
  if (id === 'settings') {
    if (!own(SETTINGS,field) || capability.settings[field]!==true) fail(field);
    if (field==='polling') member(value,capability.limits.pollingValues,field);
    else if (field==='sleep') integer(value,0,30,field);
    else if (field==='topDeadZone' || field==='bottomDeadZone') integer(value,0,50,field);
    else integer(value,0,1,field);
    bytes[SETTINGS[field]] = value;
  } else {
    if (!own(LIGHTING,field) || field==='gearMode') fail(field);
    if (field==='mode') member(value,capability.limits.lightingModes,field);
    else if (field==='colorMode' || field==='direction') integer(value,0,1,field);
    else if (field==='brightness' || field==='speed') integer(value,1,5,field);
    else integer(value,0,255,field);
    bytes[LIGHTING[field]] = value;
  }
}

function patchBinding(bytes,edit,capability) {
  const offset = slotOffset(edit,4,capability), {field,value} = edit;
  if (field!=='binding' || !value || typeof value!=='object' || Array.isArray(value)) fail(field);
  const types = {empty:['type'],keyboard:['type','usage','modifier'],mouse:['type','mouseCode','code'],media:['type','usage'],function:['type','code']};
  const properties = own(types,value.type) ? types[value.type] : null;
  if (!properties) fail(`binding.${value.type}`,'editor needs verified advanced reference validation');
  for (const key of Object.keys(value)) if (!properties.includes(key)) fail(`binding.${key}`,'unknown property');
  // Preserve byte3 for the simple types: manufacturer decoding leaves it opaque.
  if (value.type==='empty') bytes.fill(0,offset,offset+3);
  else if (value.type==='keyboard') {
    const usage = member(value.usage??0,capability.limits.keyboardUsages,'binding.usage'), modifier = member(value.modifier??0,capability.limits.modifierUsages,'binding.modifier');
    if (usage && modifier) fail('binding.modifier','combined modifier+usage has no verified source editor');
    bytes.set([2,modifier,usage],offset);
  } else if (value.type==='mouse') {
    const mouseCode=member(value.mouseCode,[1,3],'binding.mouseCode');
    bytes.set([1,mouseCode,member(value.code,capability.limits.mouseCodes[mouseCode],'binding.code')],offset);
  }
  else if (value.type==='media') {
    const usage=member(value.usage,capability.limits.mediaUsages,'binding.usage');bytes.set([3,usage&255,usage>>8],offset);
  } else {
    const code=member(value.code,capability.limits.functionCodes,'binding.function');bytes.set([13,code>>>16,code>>>8&255,code&255],offset);
  }
}

// Read the edited semantic value and its owned bytes from the final block.
// Keep slot/field identity separate from the byte offsets used for preservation.
function editedField(blockId,bytes,{slot,field}) {
  if (blockId==='settings' || blockId==='lighting') {
    const offset=(blockId==='settings' ? SETTINGS : LIGHTING)[field];
    return {value:bytes[offset],offsets:[offset]};
  }
  if (blockId==='rt') {
    const offset=slot*8;
    if (field==='switchId') return {value:bytes[offset],offsets:[offset]};
    if (own(FLAGS,field)) return {value:!!(bytes[offset+1]&FLAGS[field]),offsets:[offset+1]};
    const index=offset+DISTANCES[field];
    return {value:word(bytes,index)/100,offsets:[index,index+1]};
  }
  const offset=slot*4;
  if (blockId==='colors') return {value:{red:bytes[offset+1],green:bytes[offset+2],blue:bytes[offset+3]},offsets:[offset+1,offset+2,offset+3]};
  return {value:binding(bytes,offset),offsets:[offset,offset+1,offset+2,offset+3]};
}

function fieldChanges(blockId,before,after,edits) {
  const fields=new Map();
  for (const edit of edits) {
    const path=blockId==='settings' || blockId==='lighting' ? `fields.${edit.field}` : `records[${edit.slot}].${edit.field}`;
    fields.set(path,edit);
  }
  const changes=[];
  for (const [path,edit] of fields) {
    const original=editedField(blockId,before,edit), final=editedField(blockId,after,edit);
    // Flags share a byte: a changed neighbor must not revive a reverted flag edit.
    if (Object.is(original.value,final.value)) continue;
    const byteOffsets=final.offsets.filter(offset=>before[offset]!==after[offset]);
    if (byteOffsets.length) changes.push({block:blockId,path,before:original.value,after:final.value,byteOffsets});
  }
  return changes.sort((a,b)=>a.byteOffsets[0]-b.byteOffsets[0] || a.path.localeCompare(b.path));
}

export function patchBlock(blockId,raw,edits,capability) {
  const bytes=copyBlock(blockId,raw,capability), before=bytes.slice();
  if (!Array.isArray(edits)) fail('edits','expected edit array');
  for (const edit of edits) {
    checkEdit(edit);
    if (blockId==='rt') patchRT(bytes,edit,capability);
    else if (blockId==='settings' || blockId==='lighting') patchScalar(blockId,bytes,edit,capability);
    else if (blockId==='keymap' || blockId==='fn') {
      if(blockId==='fn'&&capability.limits.fnLockedSlots.includes(edit.slot))fail('Fn','F1–F12 bindings are locked by the A80RT source editor');
      patchBinding(bytes,edit,capability);
    }
    else if (blockId==='colors') {
      const offset=slotOffset(edit,4,capability), {field,value}=edit;
      if (field!=='rgb' || !value || typeof value!=='object' || Array.isArray(value)) fail(field);
      for (const key of Object.keys(value)) if (!['red','green','blue'].includes(key)) fail(`rgb.${key}`);
      bytes.set(['red','green','blue'].map(key=>integer(value[key],0,255,`rgb.${key}`)),offset+1);
    } else fail(edit.field,`${blockId} field editing is not verified`);
  }
  // Validate coupled fields after the full atomic edit, regardless of edit order.
  // Untouched out-of-range device data is preserved, never silently normalized.
  if (blockId==='rt') for (const slot of new Set(edits.map(edit=>edit.slot))) {
    if (!edits.some(edit=>edit.slot===slot&&(own(DISTANCES,edit.field)||edit.field==='switchId'))) continue;
    const offset=slot*8, travel=capability.limits.switchTravelMm[bytes[offset]];
    if (travel===undefined) fail('switchId','unknown switch travel');
    for (const [field,relative] of Object.entries(DISTANCES)) {
      if (edits.some(edit=>edit.slot===slot&&(edit.field===field||edit.field==='switchId')) && word(bytes,offset+relative)>Math.round(travel*100)) fail(field,'exceeds switch travel');
    }
  }
  return {bytes,changes:fieldChanges(blockId,before,bytes,edits)};
}
