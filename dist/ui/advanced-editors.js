import {KEYS,usageName} from '../layout.js';
import {readPlan} from '../device/capabilities.js';
import {decodeMacros,patchMacros} from '../config/macros.js';
import {decodePattern} from '../config/advanced.js';
const CODE_USAGE={Escape:41,Backquote:53,Minus:45,Equal:46,Backspace:42,Tab:43,BracketLeft:47,BracketRight:48,Backslash:49,CapsLock:57,Semicolon:51,Quote:52,Enter:40,ShiftLeft:225,ShiftRight:229,Comma:54,Period:55,Slash:56,ControlLeft:224,ControlRight:228,AltLeft:226,AltRight:230,MetaLeft:227,MetaRight:231,Space:44,Insert:73,PrintScreen:70,Delete:76,PageUp:75,PageDown:78,End:77,Home:74,ArrowUp:82,ArrowDown:81,ArrowLeft:80,ArrowRight:79};
for(let i=0;i<26;i++)CODE_USAGE[`Key${String.fromCharCode(65+i)}`]=4+i;
for(let i=1;i<=9;i++)CODE_USAGE[`Digit${i}`]=29+i;CODE_USAGE.Digit0=39;
for(let i=1;i<=12;i++)CODE_USAGE[`F${i}`]=57+i;
// No listeners exist until the explicit Start action. Stop detaches the entire
// recorder scope, including focus/visibility listeners, on every exit path.
export function createMacroRecorder({window:win=globalThis.window,document:doc=globalThis.document,onEvent=()=>{},onStop=()=>{}}={}){
 let recording=false,destroyed=false,last=null,remove=[];
 const stop=()=>{if(!recording)return;recording=false;for(const off of remove)off();remove=[];last=null;onStop();};
 const listen=(el,type,fn)=>{el.addEventListener(type,fn);remove.push(()=>el.removeEventListener(type,fn));};
 return {get recording(){return recording;},start(){
  if(destroyed)throw new Error('Recorder destroyed.');if(recording)return;if(doc.hidden||doc.hasFocus?.()===false)throw new Error('Trang cần được focus để ghi macro.');recording=true;
  const record=event=>{if(event.code==='Escape'){event.preventDefault();stop();return;}if(doc.hidden||doc.hasFocus?.()===false){stop();return;}const code=CODE_USAGE[event.code];if(code===undefined||event.repeat)return;event.preventDefault();const timestamp=Math.floor(event.timeStamp),delayMs=last===null?0:timestamp-last;last=timestamp;
   if(delayMs<0||delayMs>65535){stop();return;}try{onEvent({device:'keyboard',code,action:event.type==='keydown'?'down':'up',delayMs});}catch{stop();}
  };
  listen(win,'keydown',record);listen(win,'keyup',record);listen(win,'blur',stop);listen(doc,'visibilitychange',()=>{if(doc.hidden)stop();});
 },stop,destroy(){stop();destroyed=true;}};
}
export function mountAdvancedEditors(root,{session,capability,selectedSlots=[],onEdit=()=>{},onNavigate=()=>{},isBusy=()=>false}={}){
 const listeners=[],controls=[],make=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
 let slots=[...selectedSlots],layer='base',destroyed=false,active='macro',loaded=-1,loadedSource=null,retainedInput=false,events=[],macroError=null;
 const listen=(el,type,fn)=>{el.addEventListener(type,fn);listeners.push(()=>el.removeEventListener(type,fn));};
 const title=make('h2','Macro & phím nâng cao'),hint=make('p','Chỉnh bản nháp cục bộ, sau đó dùng Áp dụng để gửi và đọc lại.','editor-hint'),error=make('p',null,'editor-error');error.setAttribute('role','alert');error.hidden=true;
 const tabbar=make('div',null,'editor-tabs'),macroPanel=make('div',null,'advanced-panel'),advancedPanel=make('div',null,'advanced-panel');tabbar.setAttribute('role','tablist');tabbar.setAttribute('aria-label','Macro và phím nâng cao');
 const tabs=new Map();for(const [id,label,panel]of [['macro','Macro',macroPanel],['advanced','RS / SOCD / DKS / MT / TGL',advancedPanel]]){const tab=make('button',label);tab.type='button';tab.setAttribute('role','tab');tab.id=`advanced-tab-${id}`;panel.id=`advanced-panel-${id}`;tab.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);tabs.set(id,tab);tabbar.append(tab);listen(tab,'click',()=>{onNavigate();recorder.stop();active=id;refresh();});listen(tab,'keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();onNavigate();recorder.stop();active=event.key==='Home'?'macro':event.key==='End'?'advanced':active==='macro'?'advanced':'macro';refresh();tabs.get(active).focus();});}
 const field=(panel,id,label,type='number')=>{const wrap=make('div',null,'editor-field'),caption=make('label',label),input=make(type==='select'?'select':type==='textarea'?'textarea':'input');input.id=id;caption.htmlFor=id;if(!['select','textarea'].includes(type))input.type=type;wrap.append(caption,input);panel.append(wrap);controls.push(input);return input;};
 const option=(select,value,label)=>{const el=make('option',label);el.value=String(value);select.append(el);};
 const button=(panel,id,label,action)=>{const el=make('button',label,'button quiet small');el.id=id;el.type='button';panel.append(el);controls.push(el);listen(el,'click',action);return el;};
 const complete=()=>!!session&&readPlan(capability).every(({id,length})=>session.draft[id]?.length===length&&session.snapshot.coverage?.[id]?.complete===true);
 const editable=()=>complete()&&!session.applying&&!isBusy();
 const problem=e=>{error.textContent=e.message??String(e);error.hidden=false;};
 const run=fn=>{try{if(!editable())throw new Error('Đọc đủ snapshot và chờ giao dịch kết thúc.');fn();error.hidden=true;onEdit();refresh();}catch(e){refresh();problem(e);}};
 const macroSelect=field(macroPanel,'macro-select','Macro đã lưu','select'),macroActions=make('div',null,'actions');macroPanel.append(macroActions);
 const loadMacros=()=>{try{macroError=null;return session?decodeMacros(session.draft.macro,capability):[];}catch(e){macroError=e.message;return [];}};
 // Compare the selected source, including its opaque metadata, before using its
 // index. External profile/revert changes must never replace the current input.
 const syncMacroSource=(macros=loadMacros())=>{if(loaded>=0&&JSON.stringify(macros[loaded])!==loadedSource){loaded=-1;loadedSource=null;retainedInput=true;recorder.stop();}return macros;};
 const timeline=make('div',null,'macro-timeline');timeline.setAttribute('aria-label','Dòng thời gian macro');
 const summary=make('p',null,'editor-hint');
 button(macroActions,'macro-new','Tạo macro',()=>{recorder.stop();loaded=-1;loadedSource=null;retainedInput=false;events=[];drawTimeline();refresh();});
 const save=button(macroActions,'macro-save','Lưu macro vào bản nháp',()=>run(()=>{recorder.stop();const macros=syncMacroSource();const value={events:structuredClone(events)};if(loaded>=0){value.sourceIndex=loaded;macros[loaded]=value;}else macros.push(value);session.edit('macro',[{field:'macros',value:macros}]);loaded=loaded<0?macros.length-1:loaded;loadedSource=JSON.stringify(loadMacros()[loaded]);retainedInput=false;}));
 const repair=field(macroPanel,'macro-repair','Khi xóa: sửa chỉ số và bỏ gán macro bị xóa trong cùng giao dịch','checkbox');repair.checked=false;
 const deleteMacro=button(macroActions,'macro-delete','Xóa macro',()=>run(()=>{recorder.stop();const macros=syncMacroSource();if(loaded<0)throw new Error('Chọn macro đã lưu để xóa.');macros.splice(loaded,1);const groups={macro:[{field:'macros',value:macros}]};if(repair.checked){const draft=session.draft,remaps=patchMacros(draft.macro,macros,capability).referenceChanges;for(const id of ['keymap','fn']){const edits=[];for(let slot=0;slot<128;slot++){const o=slot*4;if(draft[id][o]!==6)continue;const map=remaps.find(r=>r.before===draft[id][o+1]);if(map)edits.push({slot,field:'binding',value:map.after===null?{type:'empty'}:{type:'macro',index:map.after,mode:draft[id][o+2],repeat:draft[id][o+3]}});}if(edits.length)groups[id]=edits;}}session.transaction(groups);loaded=-1;loadedSource=null;retainedInput=false;events=[];drawTimeline();}));
 listen(macroSelect,'change',()=>{recorder.stop();const index=Number(macroSelect.value),macro=Number.isInteger(index)&&index>=0&&String(index)===macroSelect.value?loadMacros()[index]:null;if(!macro){loaded=-1;loadedSource=null;retainedInput=false;refresh();return;}loaded=index;loadedSource=JSON.stringify(macro);retainedInput=false;events=structuredClone(macro.events);drawTimeline();refresh();});
 macroPanel.append(make('p','Delay tính bằng mili giây trước sự kiện. Dữ liệu nằm trong vùng đã đọc 1024 byte; dung lượng vật lý chưa được đo.','editor-hint'),timeline,summary);
 const rowActions=make('div',null,'actions');macroPanel.append(rowActions);
 button(rowActions,'macro-add-event','Thêm sự kiện',()=>{events.push({device:'keyboard',action:'down',code:4,delayMs:0});drawTimeline();refresh();});
 const recordStatus=make('p','Chưa ghi.','editor-hint'),recordStart=button(rowActions,'macro-record-start','Bắt đầu ghi bàn phím',()=>{try{if(!editable())throw new Error('Đọc đủ snapshot trước khi ghi.');recorder.start();refresh();}catch(e){problem(e);}}),recordStop=button(rowActions,'macro-record-stop','Dừng ghi',()=>{recorder.stop();refresh();});
 macroPanel.append(recordStatus,make('p','Chỉ thu bàn phím khi bạn bấm bắt đầu và trang đang focus. Bấm Esc, đổi tab, mất focus hoặc rời editor sẽ dừng thu. Có thể thêm sự kiện chuột trực tiếp.','editor-hint'));
 const recorder=createMacroRecorder({onEvent:event=>{syncMacroSource();if(!editable()||active!=='macro'||!recorder.recording){refresh();throw new Error('Recorder unavailable');}events.push(event);drawTimeline();refresh();},onStop:()=>{if(!destroyed){recordStatus.textContent='Đã dừng ghi; các sự kiện vẫn còn trong bản nhập.';recordStart.disabled=!editable();recordStop.disabled=true;}}});
 function drawTimeline(){timeline.replaceChildren();events.forEach((event,index)=>{const row=make('div',null,'macro-event');const label=make('strong',String(index+1));row.append(label);
  const input=(key,label,type,values)=>{const wrap=make('label',label),el=make(type==='select'?'select':'input');if(type!=='select'){el.type='number';el.min='0';el.max=key==='delayMs'?'65535':'255';}else for(const [v,text]of values)option(el,v,text);el.value=String(event[key]);el.setAttribute('aria-label',`${label} sự kiện ${index+1}`);el.disabled=!editable();wrap.append(el);row.append(wrap);el.addEventListener('change',()=>{event[key]=type==='select'?el.value:el.value.trim()===''?NaN:Number(el.value);});};
  input('delayMs','Delay ms','number');input('device','Thiết bị','select',[['keyboard','Bàn phím'],['mouse','Chuột']]);input('action','Thao tác','select',[['down','Nhấn'],['up','Nhả']]);input('code','Mã HID','number');const del=make('button','×','text-button');del.type='button';del.setAttribute('aria-label',`Xóa sự kiện ${index+1}`);del.disabled=!editable();del.addEventListener('click',()=>{events.splice(index,1);drawTimeline();refresh();});row.append(del);timeline.append(row);
 });}
 const assignment=make('div',null,'advanced-grid');macroPanel.append(assignment);
 const macroMode=field(assignment,'macro-mode','Chế độ chạy','select');for(const [v,label]of [[0,'Thông thường'],[2,'Nhấn lại để dừng'],[1,'Lặp theo số lần']])option(macroMode,v,label);
 const repeat=field(assignment,'macro-repeat','Số lần lặp (1–255)');repeat.value='1';repeat.min='1';repeat.max='255';
 const assignMacro=button(assignment,'macro-assign','Gán macro cho vùng chọn',()=>run(()=>{syncMacroSource();if(loaded<0)throw new Error('Lưu hoặc chọn macro trước khi gán.');if(!slots.length)throw new Error('Chọn phím trước khi gán.');session.edit(layer==='fn'?'fn':'keymap',slots.map(slot=>({slot,field:'binding',value:{type:'macro',index:loaded,mode:Number(macroMode.value),repeat:Number(repeat.value)}})));}));
 const selected=make('p',null,'editor-hint');advancedPanel.append(selected);
 const form=make('div',null,'advanced-grid');advancedPanel.append(form);
 const type=field(form,'advanced-type','Chế độ','select');for(const id of capability.advanced)option(type,id,id.toUpperCase());
 const description=make('p',null,'editor-hint');advancedPanel.append(description);
 const mode=field(form,'advanced-socd-mode','SOCD · ưu tiên','select');for(const [v,label]of [[3,'Phím nhấn sau'],[1,'Phím thứ nhất'],[2,'Phím thứ hai'],[4,'Triệt tiêu cả hai']])option(mode,v,label);
 const usages=[...new Set([...capability.limits.keyboardUsages,...capability.limits.modifierUsages])].filter(Boolean),keyField=(id,label)=>{const select=field(form,id,label,'select');for(const usage of usages)option(select,usage,`${usageName(usage)} · ${usage}`);return select;};
 const tap=keyField('advanced-tap','Phím nhấn / TGL'),hold=keyField('advanced-hold','Phím giữ (MT)'),time=field(form,'advanced-time','MT · ngưỡng giữ (10–1000 ms)');time.value='400';time.min='10';time.max='1000';time.step='10';
 const dksIndex=field(form,'advanced-dks-index','DKS · mẫu số (1–63)');dksIndex.value='1';dksIndex.min='1';dksIndex.max='63';
 const low=field(form,'advanced-dks-low','DKS · ngưỡng nông (mm)'),high=field(form,'advanced-dks-high','DKS · ngưỡng sâu (mm)');low.value='1.6';high.value='3';for(const el of [low,high]){el.step='0.1';el.min='0.1';el.max='3.4';}
 const dksKeys=Array.from({length:4},(_,i)=>{const select=keyField(`advanced-dks-key-${i}`,`DKS · phím ${i+1}`);option(select,0,'— Không dùng —');return select;});
 const actionInputs=Array.from({length:4},(_,trigger)=>Array.from({length:4},(_,keyIndex)=>{const input=field(form,`advanced-dks-action-${trigger}-${keyIndex}`,`DKS · mốc ${trigger+1}, phím ${keyIndex+1}`,'select');for(const [v,label]of [[0,'Không'],[1,'Nhấn/nhả'],...(trigger<3?[[2,'Giữ']]:[])])option(input,v,label);return input;}));
 button(advancedPanel,'advanced-load','Nạp gán phím đang chọn',()=>{try{if(slots.length!==1)throw new Error('Chọn một phím để nạp.');const draft=session.draft,o=slots[0]*4,[kind,a,b,c]=draft[layer==='fn'?'fn':'keymap'].slice(o,o+4),types={8:'dks',9:'mt',10:'tgl',11:'socd',12:'rs'};if(!types[kind])throw new Error('Phím chưa có chế độ nâng cao.');type.value=types[kind];if(kind===9){tap.value=String(a);hold.value=String(b);time.value=String(c*10);}if(kind===10)tap.value=String(a);if(kind===11)mode.value=String(a);if(kind===8){dksIndex.value=String(a);const p=decodePattern(draft.dks,a);low.value=String(p.thresholds[0]/10);high.value=String(p.thresholds[1]/10);dksKeys.forEach((el,i)=>el.value=String(p.keys[i]));actionInputs.forEach((row,t)=>row.forEach((el,k)=>el.value=String(p.actions[t]&(1<<(k+4))?2:p.actions[t]&(1<<k)?1:0)));}refresh();}catch(e){problem(e);}});
 button(advancedPanel,'advanced-assign','Gán chế độ vào bản nháp',()=>run(()=>{
  const binding={type:type.value,slots:[...slots],layer};if(binding.type==='socd')binding.mode=Number(mode.value);if(binding.type==='mt')Object.assign(binding,{tap:Number(tap.value),hold:Number(hold.value),timeMs:Number(time.value)});if(binding.type==='tgl')binding.key=Number(tap.value);
  if(binding.type==='dks'){const l=Number(low.value)*10,h=Number(high.value)*10;const keys=dksKeys.map(el=>{if(el.value===''||!Array.from(el.options).some(o=>o.value===el.value))throw new Error('DKS: chọn phím hợp lệ hoặc — Không dùng —.');return Number(el.value);});Object.assign(binding,{index:Number(dksIndex.value),pattern:{thresholds:[l,h,h,l],keys,actions:actionInputs.map(row=>row.reduce((mask,el,k)=>mask|(Number(el.value)===1?1<<k:Number(el.value)===2?1<<(k+4):0),0))}});}session.advanced(binding);
 }));
 button(advancedPanel,'advanced-remove','Bỏ gán vùng chọn (gồm cả cặp RS/SOCD)',()=>run(()=>{if(!slots.length)throw new Error('Chọn phím trước.');const data=session.draft[layer==='fn'?'fn':'keymap'],targets=new Set(slots);for(const slot of slots){const o=slot*4;if([11,12].includes(data[o]))for(const usage of [data[o+2],data[o+3]]){const match=KEYS.find(k=>k.usage===usage);if(match)targets.add(match.slot);}}session.edit(layer==='fn'?'fn':'keymap',[...targets].map(slot=>({slot,field:'binding',value:{type:'empty'}})));}));
 listen(type,'change',()=>refresh());root.replaceChildren(title,hint,tabbar,macroPanel,advancedPanel,error);
 function refresh(){if(destroyed)return;const enabled=editable();if(!enabled)recorder.stop();for(const el of controls)el.disabled=!enabled;
  for(const [id,tab]of tabs){tab.setAttribute('aria-selected',String(active===id));tab.tabIndex=id===active?0:-1;}macroPanel.hidden=active!=='macro';advancedPanel.hidden=active!=='advanced';
  const macros=syncMacroSource();macroSelect.replaceChildren();option(macroSelect,'-1','— Chọn macro —');macros.forEach((m,i)=>option(macroSelect,i,`Macro ${i+1} · ${m.events.length} sự kiện`));macroSelect.value=String(loaded);save.disabled=!enabled||!!macroError;deleteMacro.disabled=!enabled||loaded<0;assignMacro.disabled=!enabled||loaded<0;
  summary.textContent=macroError?`Không thể sửa macro: ${macroError}`:retainedInput?'Macro nguồn đã đổi; bản nhập được giữ nguyên. Lưu hoặc chọn macro trước khi gán.':`${events.length} sự kiện đang nhập · ${macros.length}/100 macro đã lưu. Bản nhập chỉ được thêm khi bấm Lưu.`;
  recordStart.disabled=!enabled||recorder.recording||!!macroError;recordStop.disabled=!recorder.recording;if(recorder.recording)recordStatus.textContent='Đang ghi bàn phím · bấm Dừng ghi để kết thúc.';
  selected.textContent=`Lớp ${layer==='fn'?'Fn':'mặc định'} · ${slots.map(s=>KEYS.find(k=>k.slot===s)?.label).join(', ')||'chưa chọn phím'}. RS/SOCD cần đúng hai phím; DKS/MT/TGL cần một phím.`;
  description.textContent={rs:'RS so sánh hành trình của hai phím.',socd:'SOCD phân xử khi hai phím cùng hoạt động.',dks:'DKS có bốn mốc: nhấn nông → nhấn sâu → nhả sâu → nhả nông. Cặp ngưỡng nhấn/nhả được đồng bộ theo driver hãng.',mt:'MT phát phím nhấn nhanh hoặc phím giữ theo ngưỡng thời gian.',tgl:'TGL bật/tắt giữ một phím khi nhấn lại.'}[type.value];
  for(const el of [mode,tap,hold,time,dksIndex,low,high,...dksKeys,...actionInputs.flat()]){let show=type.value==='dks'&&[dksIndex,low,high,...dksKeys,...actionInputs.flat()].includes(el)||type.value==='socd'&&el===mode||type.value==='mt'&&[tap,hold,time].includes(el)||type.value==='tgl'&&el===tap;el.parentElement&&(el.parentElement.hidden=!show);}
  for(const el of timeline.querySelectorAll?.('input,select,button')??[])el.disabled=!enabled;
 }
 refresh();return {setSelection(next){slots=[...next];refresh();},setLayer(next){layer=next;refresh();},refresh,stopRecording(){recorder.stop();refresh();},destroy(){destroyed=true;recorder.destroy();for(const off of listeners)off();root.replaceChildren();}};
}
