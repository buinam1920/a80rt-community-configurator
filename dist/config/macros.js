import {readPlan} from '../device/capabilities.js';
const fail=reason=>{throw new Error(`macro: ${reason}`);};
function bytes(raw,capability){const length=readPlan(capability).find(b=>b.id==='macro').length;if(!(raw instanceof Uint8Array)||raw.length!==length)fail('complete captured span required');return raw.slice();}
const integer=(value,min,max,name)=>{if(!Number.isInteger(value)||value<min||value>max)fail(`${name} must be ${min}..${max}`);return value;};
export function decodeMacros(raw,capability){
 const data=bytes(raw,capability),view=new DataView(data.buffer),result=[],ranges=[];let ended=false;
 for(let index=0;index<100;index++){
  const pointer=view.getUint32(index*4,true);if(!pointer){ended=true;continue;}if(ended)fail('nonzero pointer after terminator');
  if(pointer<400||pointer+4>data.length)fail('pointer outside captured span');
  const count=view.getUint16(pointer,true);if(count%2)fail('odd event count');const end=pointer+4+count*2;
  if(end>data.length)fail('event body outside captured span');if(ranges.some(([start,finish])=>pointer<finish&&end>start))fail('overlapping pointers');ranges.push([pointer,end]);
  const events=Array.from({length:count/2},(_,i)=>{const offset=pointer+4+i*4,flags=data[offset+3];return {delayMs:view.getUint16(offset,true),code:data[offset+2],device:flags&32?'keyboard':'mouse',action:flags&128?'down':'up',flags};});
  result.push({index,sourceIndex:index,pointer,reserved:Array.from(data.slice(pointer+2,pointer+4)),events});
 }
 return result;
}
function reusableBytes(before,old){
 const free=Array.from(before,(value,index)=>index>=400&&value===0);
 for(const m of old){
  for(let i=m.pointer;i<m.pointer+4+m.events.length*4;i++)free[i]=true;
  for(const relative of [2,3])if(before[m.pointer+relative])free[m.pointer+relative]=false;
  for(let i=0;i<m.events.length;i++)if(m.events[i].flags&95)free[m.pointer+7+i*4]=false;
 }
 return free;
}
export const macroReferenceChanges=(old,macros)=>old.map(m=>({before:m.index,after:macros.findIndex(item=>item.sourceIndex===m.index)})).map(c=>({...c,after:c.after<0?null:c.after})).filter(c=>c.before!==c.after);

// A session owns exactly the bytes proven reusable at its baseline: zero bytes
// and decoded body channels, excluding captured reserved/opaque flag bytes.
// Every local allocation stays inside this immutable set. Its retired bytes can
// be restored/reused even after their pointer disappears. The closure is never
// serialized, inferred from imported metadata, or used to grant USB authority.
export function createMacroPatcher(raw,capability){
 const baseline=bytes(raw,capability);let free;
 // Reading unrelated fields must remain possible for an opaque macro capture.
 return (current,macros)=>{free??=reusableBytes(baseline,decodeMacros(baseline,capability));return patchOwnedMacros(current,macros,capability,{baseline,free});};
}
// Standalone callers have only the current capture, so stay conservative.
export function patchMacros(raw,macros,capability){return patchOwnedMacros(raw,macros,capability);}
function patchOwnedMacros(raw,macros,capability,ownership){
 const before=bytes(raw,capability),old=decodeMacros(before,capability);if(!Array.isArray(macros)||macros.length>100)fail('100 pointer entries maximum');
 if(macros.reduce((sum,m)=>sum+1+(m.events?.length??0),0)>=capability.limits.macroSourceUiBudget)fail('source UI event budget exceeded');
 const used=new Set(),encoded=macros.map(m=>{
  if(!m||!Array.isArray(m.events))fail('events required');let original;
  if(m.sourceIndex!==undefined){integer(m.sourceIndex,0,old.length-1,'sourceIndex');if(used.has(m.sourceIndex))fail('duplicate sourceIndex');used.add(m.sourceIndex);original=old[m.sourceIndex];}
  const body=new Uint8Array(4+m.events.length*4),view=new DataView(body.buffer);view.setUint16(0,integer(m.events.length*2,0,65534,'event count'),true);
  if(original)body.set(original.reserved,2);
  m.events.forEach((event,index)=>{if(!['keyboard','mouse'].includes(event.device)||!['down','up'].includes(event.action))fail('event device/action invalid');const offset=4+index*4;view.setUint16(offset,integer(event.delayMs,0,65535,'delay'),true);body[offset+2]=integer(event.code,0,255,'code');const flags=original?.events[index]?.flags??(event.device==='keyboard'?48:16);integer(flags,0,255,'flags');body[offset+3]=(flags&95)|(event.device==='keyboard'?32:0)|(event.action==='down'?128:0);});
  return {body,original};
 });
 const free=ownership?.free??reusableBytes(before,old),occupied=new Set();
 let placements=encoded.map(({body,original})=>{const start=original?.pointer,end=start+body.length;if(original&&body.length<=4+original.events.length*4){for(let i=start;i<end;i++)occupied.add(i);return start;}return null;});
 const canStay=({body,original})=>original&&original.pointer+body.length<=before.length&&body.every((value,relative)=>{
  const i=original.pointer+relative,flag=relative>=7&&(relative-7)%4===0;
  return !occupied.has(i)&&(free[i]||relative<4+original.events.length*4&&(flag?(value&95)===(before[i]&95):value===before[i]));
 });
 let fragmented=false;
 encoded.forEach(({body,original},index)=>{
  if(fragmented||placements[index]!==null)return;
  // Grow in place if captured reserved bytes/opaque flag bits stay identical
  // and the extension is owned/free. Known device/action bits remain editable.
  const stays=canStay({body,original});
  let start=stays?original.pointer:400;
  if(!stays)for(;start+body.length<=before.length;start++){let fits=true;for(let i=start;i<start+body.length;i++)if(!free[i]||occupied.has(i)){fits=false;break;}if(fits)break;}
  if(start+body.length>before.length){fragmented=true;return;}
  placements[index]=start;for(let i=start;i<start+body.length;i++)occupied.add(i);
 });
 if(fragmented){
  // Stable pointers can fragment otherwise sufficient local space. Retry a
  // compact layout using only proven reusable bytes, including retired bodies.
  // Encoded metadata travels with its macro; captured opaque anchors stay put.
  occupied.clear();placements=Array(encoded.length).fill(null);
  // Keep bodies already carrying captured anchors at those offsets. Moving
  // them needlessly would duplicate protected metadata and waste usable space.
  encoded.forEach((item,index)=>{const {body,original}=item;if(original&&body.some((_,relative)=>!free[original.pointer+relative])&&canStay(item)){
   placements[index]=original.pointer;for(let i=original.pointer;i<original.pointer+body.length;i++)occupied.add(i);
  }});
  for(const {body,index}of encoded.map(({body},index)=>({body,index})).sort((a,b)=>b.body.length-a.body.length)){
   if(placements[index]!==null)continue;
   let start=400;for(;start+body.length<=before.length;start++)if(body.every((_,relative)=>free[start+relative]&&!occupied.has(start+relative)))break;
   if(start+body.length>before.length)fail('capacity of captured span exceeded; opaque bytes cannot be overwritten');
   placements[index]=start;for(let i=start;i<start+body.length;i++)occupied.add(i);
  }
 }
 const result=before.slice(),view=new DataView(result.buffer);result.fill(0,0,400);
 if(ownership)for(let i=400;i<result.length;i++)if(free[i]&&!occupied.has(i))result[i]=ownership.baseline[i];
 encoded.forEach(({body},index)=>{view.setUint32(index*4,placements[index],true);result.set(body,placements[index]);});
 const referenceChanges=macroReferenceChanges(old,macros);
 return {bytes:result,referenceChanges};
}
