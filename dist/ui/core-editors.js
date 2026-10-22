import {decodeBlock} from '../config/codecs.js';
import {KEYS,usageName} from '../layout.js';
import {readPlan} from '../device/capabilities.js';

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

export function mountCoreEditors(root,{session,capability,selectedSlots=[],onEdit=()=>{},onLayerChange=()=>{},isBusy=()=>false}){
  const model=createCoreEditorModel({session,capability,selectedSlots,onEdit,isBusy});
  const listeners=[],controls=new Map(),panels=new Map(),tabs=new Map();let active='rt',destroyed=false;
  const make=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
  const listen=(el,type,fn)=>{el.addEventListener(type,fn);listeners.push(()=>el.removeEventListener(type,fn));};
  const intro=make('div',null,'editor-heading'),title=make('h2','Chỉnh cấu hình'),selection=make('p');intro.append(title,selection);
  const reason=make('p',null,'editor-reason'),error=make('p',null,'editor-error');error.setAttribute('role','alert');error.hidden=true;
  const tabbar=make('div',null,'editor-tabs');tabbar.setAttribute('role','tablist');tabbar.setAttribute('aria-label','Nhóm chỉnh sửa');
  for(const [id,label]of [['rt','Rapid Trigger'],['binding','Gán phím / Fn'],['rgb','RGB']]){
    const tab=make('button',label);tab.type='button';tab.id=`editor-tab-${id}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',`editor-panel-${id}`);
    const panel=make('div',null,'editor-panel');panel.id=`editor-panel-${id}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
    tabs.set(id,tab);panels.set(id,panel);tabbar.append(tab);listen(tab,'click',()=>{active=id;refresh();});
    listen(tab,'keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const ids=[...tabs.keys()],index=ids.indexOf(active);active=event.key==='Home'?ids[0]:event.key==='End'?ids.at(-1):ids[(index+(event.key==='ArrowRight'?1:2))%3];refresh();tabs.get(active).focus();});
  }
  const commit=(block,field,value)=>{try{model.edit(block,field,value);error.hidden=true;error.textContent='';refresh();}catch(problem){error.textContent=problem.message;error.hidden=false;}};
  const field=(panel,key,label,type='number')=>{
    const wrap=make('div',null,'editor-field'),caption=make('label',label),input=make(type==='select'?'select':'input');input.id=`core-${key}`;caption.htmlFor=input.id;if(type!=='select')input.type=type;
    wrap.append(caption,input);panel.append(wrap);controls.set(key,{input,wrap});return input;
  };
  const option=(select,value,label)=>{const el=make('option',label);el.value=String(value);select.append(el);};
  const rtPanel=panels.get('rt');rtPanel.append(make('p','Chỉ trường bạn sửa được đổi cho vùng chọn. Giá trị 0 đọc được được giữ nguyên; không thay bằng mặc định.','editor-hint'));
  const switchInput=field(rtPanel,'switchId','Switch (ID)','select');option(switchInput,'','—');
  for(const id of capability?.limits.switchIds??[])option(switchInput,id,id===0?'0 · chưa xác định':`${id} · hành trình ${capability.limits.switchTravelMm[id]} mm`);
  listen(switchInput,'change',()=>{if(switchInput.value!=='')commit('rt','switchId',Number(switchInput.value));});
  for(const [key,label]of [['actuationMm','Điểm nhận (mm)'],['pressMm','Ngưỡng nhấn RT (mm)'],['releaseMm','Ngưỡng nhả RT (mm)']]){
    const input=field(rtPanel,key,label);input.step='0.01';input.min=key==='actuationMm'?'0.01':'0';
    const range=make('input');range.type='range';range.setAttribute('aria-label',`${label} · thanh trượt`);range.step=input.step;range.min=input.min;controls.get(key).wrap.append(range);controls.get(key).range=range;
    listen(input,'change',()=>commit('rt',key,input.value.trim()===''?NaN:Number(input.value)));listen(range,'input',()=>commit('rt',key,Number(range.value)));
  }
  for(const [key,label]of [['whole','whole · bit 0'],['bottom','bottom · bit 1'],['rtMode','rtMode · bit 2']]){
    const input=field(rtPanel,key,label,'checkbox');listen(input,'change',()=>commit('rt',key,input.checked));
  }
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
        else{const prefix=key==='secondaryColor'?'secondary':'';session.edit('lighting',Object.entries(rgb).map(([channel,value])=>({field:prefix?prefix+channel[0].toUpperCase()+channel.slice(1):channel,value})));onEdit(session.diff());error.hidden=true;refresh();}}
      catch(problem){error.textContent=problem.message;error.hidden=false;}
    });
  }
  for(const [key,label,min,max]of [['brightness','Độ sáng (1–5)',1,5],['speed','Tốc độ (1–5)',1,5],['colorMode','Chế độ màu (0 / 1)',0,1],['direction','Hướng (0 / 1)',0,1]]){
    const input=field(rgbPanel,key,label);input.min=String(min);input.max=String(max);input.step='1';listen(input,'change',()=>commit('lighting',key,input.value.trim()===''?NaN:Number(input.value)));
  }
  rgbPanel.append(make('p','Màu vùng chọn nằm trong nhóm màu riêng; chọn hiệu ứng 128 để dùng màu từng phím. Hiệu ứng đồng bộ âm nhạc cần dịch vụ hãng, chưa tích hợp.','editor-hint'));
  root.replaceChildren(intro,reason,tabbar,...panels.values(),error);
  function refresh(){
    if(destroyed)return;const view=model.view(),entered=error.hidden?null:[...controls.values()].map(({input})=>[input,input.value]);
    selection.textContent=`${view.slots.length} phím đã chọn${view.slots.length?` · ${view.slots.map(slot=>KEYS.find(key=>key.slot===slot).label).slice(0,8).join(', ')}${view.slots.length>8?'…':''}`:''}`;
    reason.textContent=view.reason;
    for(const [id,tab]of tabs){tab.setAttribute('aria-selected',String(active===id));tab.tabIndex=active===id?0:-1;panels.get(id).hidden=active!==id;}
    for(const {input,range}of controls.values()){input.disabled=!view.editable;if(range)range.disabled=!view.editable;}
    for(const key of RT_FIELDS){const {input,range}=controls.get(key),data=view.rt[key];
      if(input.type==='checkbox'){input.checked=data.value===true;input.indeterminate=data.mixed;input.setAttribute('aria-checked',data.mixed?'mixed':String(input.checked));}
      else{input.value=data.value===undefined?'':String(data.value);input.placeholder=data.mixed?'Giá trị khác nhau':'Chưa có dữ liệu';}
      if(key==='switchId')input.options[0].textContent=data.mixed?'Giá trị khác nhau':'—';
      if(range){input.max=range.max=String(view.limits.maxMm??3.4);range.disabled=!view.editable||data.mixed||data.value===undefined||data.value<Number(input.min)||data.value>Number(input.max);range.hidden=data.mixed||data.value===undefined;if(!range.disabled)range.value=String(data.value);}
    }
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
    // Preserve entered values on an error while still recomputing every lock.
    if(entered)for(const [input,value]of entered)input.value=value;
  }
  refresh();
  return {setSelection(slots){model.setSelection(slots);refresh();},setLayer(next){model.setLayer(next);refresh();},refresh,destroy(){destroyed=true;for(const remove of listeners)remove();root.replaceChildren();}};
}
