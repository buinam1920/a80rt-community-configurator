import {decodeBlock} from '../config/codecs.js';
import {KEYS,usageName} from '../layout.js';
import {readPlan} from '../device/capabilities.js';
import {RT_PRESETS,presetEdits,matchingPreset} from '../config/presets.js';

const RT_FIELDS=['switchId','actuationMm','pressMm','releaseMm','whole','bottom','rtMode'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const common=values=>({mixed:values.length>1&&!values.every(value=>same(value,values[0])),value:values.length&&values.every(value=>same(value,values[0]))?values[0]:undefined});
const colorHex=rgb=>'#'+['red','green','blue'].map(channel=>rgb[channel].toString(16).padStart(2,'0')).join('');
function parseColor(text){
  if(!/^#[\da-f]{6}$/i.test(text))throw new Error('Màu cần có dạng #RRGGBB.');
  return Object.fromEntries(['red','green','blue'].map((channel,index)=>[channel,parseInt(text.slice(1+index*2,3+index*2),16)]));
}

// Selection/rendering only reads detached session bytes. Edits are semantic and atomic.
export function createCoreEditorModel({session,capability,selectedSlots=[],onEdit=()=>{},isBusy=()=>false}){
  let slots=[],layer='base';
  const setSelection=selection=>{
    if(!Array.isArray(selection)||selection.some(slot=>!capability?.slots.includes(slot)))throw new Error('Selection needs physical A80RT slots.');
    slots=[...new Set(selection)];
  };
  setSelection(selectedSlots);
  const view=()=>{
    const draft=session?.draft??{},snapshot=session?.snapshot;
    const complete=!!session&&!!capability&&readPlan(capability).every(({id,length})=>draft[id]?.length===length&&snapshot.coverage?.[id]?.complete===true&&snapshot.coverage[id].expectedBytes===length&&snapshot.coverage[id].receivedBytes===length);
    const records=id=>draft[id]&&capability?decodeBlock(id,draft[id],capability).records:[];
    const rtRecords=records('rt'),colors=records('colors'),bindings=records(layer==='fn'?'fn':'keymap');
    const rt=Object.fromEntries(RT_FIELDS.map(field=>[field,common(slots.map(slot=>rtRecords[slot]?.[field]))]));
    const travels=slots.map(slot=>capability?.limits.switchTravelMm[rtRecords[slot]?.switchId]);
    const source=snapshot?.provenance.source;
    return {slots:[...slots],layer,complete,editable:complete&&slots.length>0&&!session?.applying&&!isBusy(),
      canApply:false,reason:!complete?'Đọc đủ snapshot 9 nhóm để chỉnh sửa.':source==='sample'?'Dữ liệu mẫu · chỉ sửa bản nháp trong trình duyệt, không gửi thiết bị.':source!=='device'?'Bản đã lưu · không có quyền ghi thiết bị.':'Bản nháp · chỉ gửi khi bấm Áp dụng và thiết bị đủ điều kiện.',
      rt,limits:{maxMm:travels.length&&travels.every(value=>value!==undefined)?Math.min(...travels):undefined,stepMm:capability?.limits.distanceStepMm},
      binding:common(slots.map(slot=>bindings[slot]?.binding)),bindingLocked:layer==='fn'&&slots.some(slot=>capability?.limits.fnLockedSlots.includes(slot)),
      rgb:common(slots.map(slot=>colors[slot]&&Object.fromEntries(['red','green','blue'].map(channel=>[channel,colors[slot][channel]])))),
      lighting:draft.lighting&&capability?decodeBlock('lighting',draft.lighting,capability).fields:{},changes:session?.diff().length??0};
  };
  return {view,setSelection,setLayer(next){if(!['base','fn'].includes(next))throw new Error('Unknown layer.');layer=next;},edit(block,field,value){
    const current=view();
    if(isBusy()||session?.applying)throw new Error('Một giao dịch đang chạy.');
    if(!current.complete)throw new Error('Complete snapshot required before editing.');
    if(!slots.length)throw new Error('Selection is empty.');
    if(block==='rt'&&field==='actuationMm'&&typeof value==='number'&&value<0.01)throw new Error('actuationMm: nhập tối thiểu 0.01 mm.');
    if(block==='binding'&&current.bindingLocked)throw new Error('Fn F1–F12 bị khóa theo cấu hình hãng.');
    const target=block==='binding'?(layer==='fn'?'fn':'keymap'):block;
    const edits=target==='lighting'?[{field,value}]:slots.map(slot=>({slot,field,value}));
    session.edit(target,edits);onEdit(session.diff());return view();
  }};
}

// Labels translated from the source led-options / function-table / special-key-table.
const EFFECTS=['Tắt','Sáng tĩnh','Sáng từng điểm','Tắt từng điểm','Sao lấp lánh','Tuyết rơi','Muôn hoa','Nhịp thở','Chu kỳ phổ màu','Suối màu','Đan màu','Theo sóng','Đường quanh co','Chạm sáng','Một mũi hai đích','Gợn sóng','Dòng chảy','Núi trùng điệp','Mưa nghiêng','Qua lại'];
const FUNCTIONS=['Khôi phục cài đặt gốc','Bluetooth 1','Bluetooth 2','Bluetooth 3','Kết nối lại không dây','Chuyển vùng F','Xem pin','WIN','MAC','ANDROID','Đổi hiệu ứng đèn','Đổi màu đèn','Tăng độ sáng','Giảm độ sáng','Tăng tốc độ đèn','Giảm tốc độ đèn','Tắt đèn','ALT + TAB','WIN + E','WIN + TAB','WIN + H','Khóa Win'];
const MEDIA=['Máy tính','Máy tính bỏ túi','Email','Đa phương tiện','Phát / Tạm dừng','Dừng phát','Bài trước','Bài sau','Tăng âm lượng','Giảm âm lượng','Tắt tiếng','Trang chủ','Làm mới','Tiến','Lùi','Yêu thích','Tìm kiếm'];
const MODIFIERS=['Ctrl trái','Shift trái','Alt trái','Win trái','Ctrl phải','Shift phải','Alt phải','Win phải'];
export function bindingOptions(capability){
  return [{label:'Trống',value:{type:'empty'}},
    ...capability.limits.keyboardUsages.filter(Boolean).map(usage=>({label:`Phím · ${usageName(usage)}`,value:{type:'keyboard',usage,modifier:0}})),
    ...capability.limits.modifierUsages.filter(Boolean).map((modifier,index)=>({label:`Modifier · ${MODIFIERS[index]}`,value:{type:'keyboard',usage:0,modifier}})),
    ...capability.limits.mediaUsages.map((usage,index)=>({label:`Media · ${MEDIA[index]}`,value:{type:'media',usage}})),
    ...[[1,1,'Chuột trái'],[1,2,'Chuột phải'],[1,4,'Chuột giữa'],[1,8,'Chuột lùi'],[1,16,'Chuột tiến'],[3,1,'Cuộn lên'],[3,255,'Cuộn xuống']].map(([mouseCode,code,label])=>({label,value:{type:'mouse',mouseCode,code}})),
    ...capability.limits.functionCodes.map(code=>({label:`Chức năng · ${FUNCTIONS[code-1]}`,value:{type:'function',code}}))];
}
function bindingValue(binding){
  if(!binding)return null;
  const {type}=binding;
  if(type==='empty')return {type};
  if(type==='keyboard')return {type,usage:binding.usage,modifier:binding.modifier};
  if(type==='media')return {type,usage:binding.usage};
  if(type==='mouse')return {type,mouseCode:binding.mouseCode,code:binding.code};
  if(type==='function')return {type,code:binding.code};
  return null;
}

export function mountCoreEditors(root,{session,capability,selectedSlots=[],onEdit=()=>{},onLayerChange=()=>{},onNavigate=()=>{},isBusy=()=>false}){
  const model=createCoreEditorModel({session,capability,selectedSlots,onEdit,isBusy});
  const listeners=[],controls=new Map(),panels=new Map(),tabs=new Map();let active='rt',destroyed=false,invalidInput=null;
  const make=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
  const listen=(el,type,fn)=>{el.addEventListener(type,fn);listeners.push(()=>el.removeEventListener(type,fn));};
  listen(root,'pointerdown',onNavigate);listen(root,'focusin',onNavigate);
  const intro=make('div',null,'editor-heading'),title=make('h2','Chỉnh cấu hình'),selection=make('p');intro.append(title,selection);
  const reason=make('p',null,'editor-reason'),error=make('p',null,'editor-error');error.setAttribute('role','alert');error.hidden=true;
  const tabbar=make('div',null,'editor-tabs');tabbar.setAttribute('role','tablist');tabbar.setAttribute('aria-label','Nhóm chỉnh sửa');
  for(const [id,label]of [['rt','Rapid Trigger'],['binding','Gán phím / Fn'],['rgb','RGB']]){
    const tab=make('button',label);tab.type='button';tab.id=`editor-tab-${id}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',`editor-panel-${id}`);
    const panel=make('div',null,'editor-panel');panel.id=`editor-panel-${id}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
    tabs.set(id,tab);panels.set(id,panel);tabbar.append(tab);listen(tab,'click',()=>{onNavigate();active=id;refresh();});
    listen(tab,'keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();onNavigate();const ids=[...tabs.keys()],index=ids.indexOf(active);active=event.key==='Home'?ids[0]:event.key==='End'?ids.at(-1):ids[(index+(event.key==='ArrowRight'?1:2))%3];refresh();tabs.get(active).focus();});
  }
  const errorContext=()=>{const view=model.view();return JSON.stringify([view.layer,[...view.slots].sort((a,b)=>a-b),session?.draft,view.editable]);};
  const clearError=()=>{invalidInput=null;error.hidden=true;error.textContent='';};
  const showError=(problem,key)=>{const input=controls.get(key)?.input;invalidInput=input&&key!=='binding'?{input,value:input.value,checked:input.checked,context:errorContext()}:null;error.textContent=problem.message;error.hidden=false;};
  const commit=(block,field,value)=>{try{model.edit(block,field,value);clearError();refresh();}catch(problem){showError(problem,block==='colors'?'selectedColor':field);}};
  const field=(panel,key,label,type='number')=>{
    const wrap=make('div',null,'editor-field'),caption=make('label',label),input=make(type==='select'?'select':'input');input.id=`core-${key}`;caption.htmlFor=input.id;if(type!=='select')input.type=type;
    wrap.append(caption,input);panel.append(wrap);controls.set(key,{input,wrap});return input;
  };
  const option=(select,value,label)=>{const el=make('option',label);el.value=String(value);select.append(el);};
  const rtPanel=panels.get('rt');rtPanel.append(make('p','Chỉ trường bạn sửa được đổi cho vùng chọn. Điểm nhận raw0 đọc được được giữ nguyên và có thể khôi phục từ hồ sơ; chưa xác định ý nghĩa vật lý. Nhập điểm nhận thủ công tối thiểu 0,01 mm.','editor-hint'));
  // Chế độ cài sẵn của hãng: một transaction cho cả bàn phím, chỉ vào bản nháp.
  const presetBar=make('div',null,'preset-bar'),presetButtons=new Map(),presetNote=make('p','Chọn chế độ cài sẵn của hãng để đưa vào bản nháp; chỉ gửi bàn phím khi bấm Áp dụng.','editor-hint');
  presetBar.setAttribute('role','group');presetBar.setAttribute('aria-label','Chế độ cài sẵn của hãng');
  const presetsEnabled=()=>{const view=model.view();return view.complete&&!session?.applying&&!isBusy();};
  for(const preset of [{id:null,label:'Tùy chỉnh',description:'Cấu hình hiện tại không trùng chế độ nào của hãng.'},...RT_PRESETS]){
    const item=make('button',preset.shortcut?`${preset.label} · ${preset.shortcut}`:preset.label,`preset-button${preset.group==='game'?' preset-game':''}`);item.type='button';item.id=`core-preset-${preset.id??'custom'}`;item.title=`${preset.description}${preset.shortcut?` Phím tắt ${preset.shortcut} khi cửa sổ app đang mở.`:''}`;presetBar.append(item);presetButtons.set(preset.id,item);
    listen(item,'click',()=>{onNavigate();
      if(!preset.id){presetNote.textContent='Tùy chỉnh: giữ nguyên cấu hình đang chỉnh. Muốn quay về bản đọc từ bàn phím, bấm Hoàn tác bản nháp.';return;}
      try{if(!presetsEnabled())throw new Error('Đọc đủ cấu hình và chờ giao dịch xong trước khi chọn chế độ.');
        session.transaction(presetEdits(capability,preset.id));onEdit(session.diff());clearError();
        presetNote.textContent=`Đã đưa chế độ ${preset.label} vào bản nháp: ${preset.description} Chưa gửi bàn phím.`;refresh();
      }catch(problem){error.textContent=problem.message;error.hidden=false;}
    });
  }
  // Thanh điểm nhận dọc như driver hãng: phần sáng là quãng nhấn tới điểm nhận.
  const visual=make('div',null,'rt-visual'),gauge=make('div',null,'travel-gauge'),gaugeValue=make('strong',null,'travel-gauge-value'),track=make('div',null,'travel-gauge-track');
  const pressPart=make('div',null,'travel-gauge-press'),restPart=make('div',null,'travel-gauge-rest'),marker=make('div',null,'travel-gauge-marker'),info=make('div',null,'rt-visual-info');
  track.append(pressPart,restPart,marker);gauge.append(make('span','Điểm nhận','travel-gauge-caption'),gaugeValue,track);visual.append(gauge,info);
  gauge.id='core-actuation-gauge';gauge.tabIndex=0;gauge.setAttribute('role','slider');gauge.setAttribute('aria-label','Điểm nhận (mm) · kéo hoặc dùng phím mũi tên');
  let gaugeState={enabled:false,value:null,max:3.4,isDefault:false},dragging=null;
  const drawGauge=(value,{isDefault=false,mixed=false}={})=>{
    const max=gaugeState.max,shown=value??0,ratio=Math.min(1,Math.max(0,shown/max));
    pressPart.style.height=`${ratio*100}%`;restPart.style.height=`${(1-ratio)*100}%`;marker.style.top=`calc(${ratio*100}% - 1px)`;marker.hidden=value==null;
    gaugeValue.replaceChildren(make('span',mixed?'Khác nhau':value==null?'—':value.toFixed(2)+' '),make('small',mixed||value==null?'':isDefault?'mm · mặc định':'mm'));
    gauge.classList.toggle('is-default',isDefault);gauge.setAttribute('aria-valuemin','0.01');gauge.setAttribute('aria-valuemax',String(max));
    if(value!=null){gauge.setAttribute('aria-valuenow',String(value));gauge.setAttribute('aria-valuetext',`${value.toFixed(2)} mm${isDefault?' (mặc định hãng)':''}`);}else gauge.setAttribute('aria-valuetext',mixed?'Giá trị khác nhau':'Chưa có dữ liệu');
  };
  const valueAt=clientY=>{const box=track.getBoundingClientRect(),raw=(clientY-box.top)/box.height*gaugeState.max;return Math.min(gaugeState.max,Math.max(0.01,Math.round(raw*100)/100));};
  listen(track,'pointerdown',event=>{if(!gaugeState.enabled)return;onNavigate();event.preventDefault();gauge.focus();track.setPointerCapture?.(event.pointerId);dragging=valueAt(event.clientY);drawGauge(dragging);});
  listen(track,'pointermove',event=>{if(dragging===null)return;dragging=valueAt(event.clientY);drawGauge(dragging);});
  // Chỉ cập nhật bản nháp khi thả chuột; không bao giờ tự gửi bàn phím.
  const finish=()=>{if(dragging===null)return;const value=dragging;dragging=null;commit('rt','actuationMm',value);refresh();};
  listen(track,'pointerup',finish);listen(track,'pointercancel',()=>{dragging=null;refresh();});
  listen(gauge,'keydown',event=>{
    if(!gaugeState.enabled||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(event.key))return;event.preventDefault();onNavigate();
    const step=event.shiftKey||event.key.startsWith('Page')?0.1:0.01,base=gaugeState.value??0;
    const next=event.key==='Home'?0.01:event.key==='End'?gaugeState.max:base+(['ArrowDown','ArrowRight','PageDown'].includes(event.key)?step:-step);
    commit('rt','actuationMm',Math.min(gaugeState.max,Math.max(0.01,Math.round(next*100)/100)));
  });
  rtPanel.append(presetBar,presetNote,visual);
  if(capability?.fields.rt.switchId){
    const switchInput=field(rtPanel,'switchId','Loại switch · ID từng phím','select');option(switchInput,'','—');
    for(const id of capability.limits.switchIds)option(switchInput,id,`${id} · ${capability.limits.switchLabels[id]} · ${capability.limits.switchTravelMm[id]} mm`);
    listen(switchInput,'change',()=>{if(switchInput.value!=='')commit('rt','switchId',Number(switchInput.value));});
    rtPanel.append(make('p','Tên switch giữ theo bản dịch hãng. Đổi loại switch cần hiệu chuẩn các phím bằng công cụ hãng; chọn ID không xác nhận tương thích hay đã hiệu chuẩn.','editor-hint'));
  }else rtPanel.append(make('p',capability?.transport==='dongle'?'Loại switch: nguồn hãng ẩn bộ chọn trên đầu thu. Giữ nguyên ID đọc được.':'Loại switch và RT toàn hành trình: chưa xác minh phạm vi áp dụng cho A80RT trong nguồn đã lưu. Giữ nguyên ID và cờ gốc.','editor-hint'));
  for(const [key,label]of [['actuationMm','Điểm nhận (mm)'],['pressMm','Ngưỡng nhấn RT (mm)'],['releaseMm','Ngưỡng nhả RT (mm)']]){
    const input=field(rtPanel,key,label);input.step='0.01';input.min=key==='actuationMm'?'0.01':'0';
    const range=make('input');range.type='range';range.setAttribute('aria-label',`${label} · thanh trượt`);range.step=input.step;range.min=input.min;controls.get(key).wrap.append(range);controls.get(key).range=range;
    listen(input,'change',()=>commit('rt',key,input.value.trim()===''?NaN:Number(input.value)));listen(range,'input',()=>commit('rt',key,Number(range.value)));
  }
  for(const [key,label]of [['whole','RT trên toàn hành trình']].filter(([key])=>capability?.fields.rt[key])){
    const input=field(rtPanel,key,label,'checkbox');listen(input,'change',()=>commit('rt',key,input.checked));
  }
  if(capability?.fields.rt.whole)rtPanel.append(make('p','Theo hãng: bật để RT duy trì hoạt động; tắt để RT có hiệu lực sau khi phím đạt điểm nhận. Chi tiết: Full Distance Fast Trigger · whole, bit 0. Hành vi này chưa được đo riêng trên phần cứng.','editor-hint'));
  rtPanel.append(make('p','Bottom Optimization (bottom, bit 1) và Rampage Mode (rtMode, bit 2) chỉ được xem trong dữ liệu gốc: nguồn chưa chứng minh bộ chỉnh cho model này. Các bit được giữ nguyên. Vùng chết toàn bàn phím nằm trong Thiết lập & bảo trì.','editor-hint'));
  const bindingPanel=panels.get('binding'),layer=field(bindingPanel,'layer','Lớp chỉnh sửa','select');option(layer,'base','Mặc định');option(layer,'fn','Fn');
  listen(layer,'change',()=>{model.setLayer(layer.value);onLayerChange(layer.value);refresh();});
  const binding=field(bindingPanel,'binding','Gán cho các phím đã chọn','select'),bindingNote=make('p',null,'editor-hint');bindingPanel.append(bindingNote);
  const options=capability?bindingOptions(capability):[];option(binding,'','—');for(const [index,item]of options.entries())option(binding,index,item.label);
  listen(binding,'change',()=>{if(binding.value!=='')commit('binding','binding',options[Number(binding.value)].value);});
  const rgbPanel=panels.get('rgb'),effect=field(rgbPanel,'mode','Hiệu ứng toàn bàn phím','select');option(effect,'','—');
  for(const mode of capability?.limits.lightingModes??[])option(effect,mode,mode===128?'128 · Màu từng phím':`${mode} · ${EFFECTS[mode]}`);
  listen(effect,'change',()=>{if(effect.value!=='')commit('lighting','mode',Number(effect.value));});
  for(const [key,label]of [['primaryColor','Màu chính (#RRGGBB)'],['secondaryColor','Màu phụ (#RRGGBB)'],['selectedColor','Màu vùng phím đã chọn (#RRGGBB)']]){
    const input=field(rgbPanel,key,label,'text');input.maxLength=7;input.autocomplete='off';
    listen(input,'change',()=>{
      try{const rgb=parseColor(input.value.trim());if(key==='selectedColor')commit('colors','rgb',rgb);
        else{const prefix=key==='secondaryColor'?'secondary':'';session.edit('lighting',Object.entries(rgb).map(([channel,value])=>({field:prefix?prefix+channel[0].toUpperCase()+channel.slice(1):channel,value})));onEdit(session.diff());clearError();refresh();}}
      catch(problem){showError(problem,key);}
    });
  }
  for(const [key,label,min,max]of [['brightness','Độ sáng (1–5)',1,5],['speed','Tốc độ (1–5)',1,5],['colorMode','Chế độ màu (0 / 1)',0,1],['direction','Hướng (0 / 1)',0,1]]){
    const input=field(rgbPanel,key,label);input.min=String(min);input.max=String(max);input.step='1';listen(input,'change',()=>commit('lighting',key,input.value.trim()===''?NaN:Number(input.value)));
  }
  rgbPanel.append(make('p','Màu vùng chọn nằm trong nhóm màu riêng; chọn hiệu ứng 128 để dùng màu từng phím. Hiệu ứng đồng bộ âm nhạc cần dịch vụ hãng, chưa tích hợp.','editor-hint'));
  root.replaceChildren(intro,reason,tabbar,...panels.values(),error);
  function refresh(){
    if(destroyed)return;const view=model.view();
    if(invalidInput&&invalidInput.context!==errorContext())clearError();
    selection.textContent=`${view.slots.length} phím đã chọn${view.slots.length?` · ${view.slots.map(slot=>KEYS.find(key=>key.slot===slot).label).slice(0,8).join(', ')}${view.slots.length>8?'…':''}`:''}`;
    reason.textContent=view.reason;
    for(const [id,tab]of tabs){tab.setAttribute('aria-selected',String(active===id));tab.tabIndex=active===id?0:-1;panels.get(id).hidden=active!==id;}
    for(const {input,range}of controls.values()){input.disabled=!view.editable;if(range)range.disabled=!view.editable;}
    for(const key of RT_FIELDS){if(!controls.has(key))continue;const {input,range}=controls.get(key),data=view.rt[key];
      if(input.type==='checkbox'){input.checked=data.value===true;input.indeterminate=data.mixed;input.setAttribute('aria-checked',data.mixed?'mixed':String(input.checked));}
      else{input.value=data.value===undefined?'':String(data.value);input.placeholder=data.mixed?'Giá trị khác nhau':'Chưa có dữ liệu';}
      if(key==='switchId'){
        if(data.value!==undefined&&!Array.from(input.options).some(option=>option.value===String(data.value)))option(input,data.value,`ID gốc chưa nhận diện (${data.value}) · hành trình chưa biết`);
        input.value=data.value===undefined?'':String(data.value);input.options[0].textContent=data.mixed?'Giá trị khác nhau':'—';
      }
      if(range){input.max=range.max=String(view.limits.maxMm??3.4);range.disabled=!view.editable||data.mixed||data.value===undefined||data.value<Number(input.min)||data.value>Number(input.max);range.hidden=data.mixed||data.value===undefined;if(!range.disabled)range.value=String(data.value);}
    }
    const presetActive=session?.draft&&capability?matchingPreset(capability,session.draft):null,canPreset=view.complete&&!session?.applying&&!isBusy();
    for(const [id,item]of presetButtons){item.setAttribute('aria-pressed',String(view.complete&&id===presetActive));item.disabled=!canPreset;}
    const actuation=view.rt.actuationMm,fallback=capability?.limits.vendorDefaultActuationMm??1.2;
    gaugeState={enabled:view.editable&&(actuation.value!==undefined||actuation.mixed),value:actuation.value===0?fallback:actuation.value??null,max:view.limits.maxMm??3.4,isDefault:actuation.value===0};
    gauge.setAttribute('aria-disabled',String(!gaugeState.enabled));
    if(dragging===null)drawGauge(gaugeState.value,{isDefault:gaugeState.isDefault,mixed:actuation.mixed});
    const press=view.rt.pressMm,release=view.rt.releaseMm,whole=view.rt.whole,fmt=data=>data.mixed?'khác nhau':data.value===undefined?'—':`${data.value.toFixed(2)} mm`;
    const infoLine=(label,value)=>{const line=make('span',label);line.append(make('strong',value));return line;};
    info.replaceChildren(...(view.slots.length?[
      make('span',`${view.slots.length} phím đang chọn${actuation.mixed?' · điểm nhận khác nhau':''}`),
      infoLine('Rapid Trigger: ',press.value===0&&release.value===0?'Tắt':`nhấn ${fmt(press)} · nhả ${fmt(release)}`),
      ...(capability?.fields.rt.whole?[infoLine('RT toàn hành trình: ',whole.mixed?'khác nhau':whole.value?'Bật':'Tắt')]:[]),
      ...(gaugeState.isDefault?[make('span',`Giá trị gốc 0: web hãng hiển thị mặc định ${fallback.toFixed(2)} mm. Kéo thanh để đặt giá trị cụ thể.`)]:[]),
    ]:[make('span','Chọn phím để xem và kéo điểm nhận.')]));
    layer.disabled=false;layer.value=view.layer;binding.disabled=!view.editable||view.bindingLocked;
    const index=options.findIndex(item=>same(item.value,bindingValue(view.binding.value)));binding.value=index<0?'':String(index);
    binding.options[0].textContent=view.binding.mixed?'Giá trị khác nhau':index<0&&view.binding.value?`Giữ nguyên · ${view.binding.value.type} (mã ${view.binding.value.typeCode})`:'—';
    bindingNote.textContent=view.bindingLocked?'Fn F1–F12 bị khóa trong driver A80RT hãng. Chọn vùng không chứa các phím này để gán.':`Đang sửa lớp ${view.layer==='fn'?'Fn':'mặc định'}. Chọn một gán phím để đổi toàn vùng chọn; lớp còn lại được giữ nguyên.`;
    for(const key of ['mode','brightness','speed','colorMode','direction'])controls.get(key).input.value=view.lighting[key]===undefined?'':String(view.lighting[key]);
    const colorEnabled=![0,6,8].includes(view.lighting.mode),speedEnabled=![0,1,128].includes(view.lighting.mode),directionEnabled=[10,11,12,16,18].includes(view.lighting.mode);
    for(const key of ['primaryColor','secondaryColor','colorMode'])controls.get(key).input.disabled=!view.editable||!colorEnabled;
    controls.get('speed').input.disabled=!view.editable||!speedEnabled;controls.get('direction').input.disabled=!view.editable||!directionEnabled;
    for(const [key,prefix]of [['primaryColor',''],['secondaryColor','secondary']]){
      const rgb=Object.fromEntries(['red','green','blue'].map(channel=>[channel,view.lighting[prefix?prefix+channel[0].toUpperCase()+channel.slice(1):channel]]));
      controls.get(key).input.value=Object.values(rgb).every(value=>value!==undefined)?colorHex(rgb):'';
    }
    controls.get('selectedColor').input.value=view.rgb.value?colorHex(view.rgb.value):'';controls.get('selectedColor').input.placeholder=view.rgb.mixed?'Giá trị khác nhau · #RRGGBB':'#RRGGBB';
    // Only the failing field belongs to the error. Layer, binding and selection
    // always follow the model, and a new context discards the invalid input.
    if(invalidInput){const {input,value,checked}=invalidInput;input.value=value;if(input.type==='checkbox')input.checked=checked;}
  }
  refresh();
  return {setSelection(slots){model.setSelection(slots);refresh();},setLayer(next){model.setLayer(next);refresh();},refresh,destroy(){destroyed=true;for(const remove of listeners)remove();root.replaceChildren();}};
}
