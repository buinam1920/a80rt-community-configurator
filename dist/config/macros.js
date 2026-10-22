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
// Allocation stays within captured bytes. Unreferenced nonzero data is opaque,
// never treated as free space; only source-owned old bodies may be reused.
export function patchMacros(raw,macros,capability){
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
 const free=Array.from(before,(value,index)=>index>=400&&value===0),occupied=new Set();
 for(const m of old){
  for(let i=m.pointer;i<m.pointer+4+m.events.length*4;i++)free[i]=true;
  for(const relative of [2,3])if(before[m.pointer+relative])free[m.pointer+relative]=false;
  for(let i=0;i<m.events.length;i++)if(m.events[i].flags&95)free[m.pointer+7+i*4]=false;
 }
 const placements=encoded.map(({body,original})=>{const start=original?.pointer,end=start+body.length;if(original&&body.length<=4+original.events.length*4){for(let i=start;i<end;i++)occupied.add(i);return start;}return null;});
 encoded.forEach(({body},index)=>{if(placements[index]!==null)return;let start=400;for(;start+body.length<=before.length;start++){let fits=true;for(let i=start;i<start+body.length;i++)if(!free[i]||occupied.has(i)){fits=false;break;}if(fits)break;}if(start+body.length>before.length)fail('capacity of captured span exceeded; opaque bytes cannot be overwritten');placements[index]=start;for(let i=start;i<start+body.length;i++)occupied.add(i);});
 const result=before.slice(),view=new DataView(result.buffer);result.fill(0,0,400);
 encoded.forEach(({body},index)=>{view.setUint32(index*4,placements[index],true);result.set(body,placements[index]);});
 const referenceChanges=old.map(m=>({before:m.index,after:macros.findIndex(item=>item.sourceIndex===m.index)})).map(c=>({...c,after:c.after<0?null:c.after})).filter(c=>c.before!==c.after);
 return {bytes:result,referenceChanges};
}
