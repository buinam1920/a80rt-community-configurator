import {withIcon} from './icons.js';
import {decodeBlock} from '../config/codecs.js';
import {KEYS,usageName} from '../layout.js';
import {readPlan} from '../device/capabilities.js';
import {translate} from '../i18n.js';
import {presetEdits,matchingPreset,presetLibrary,presetFromDraft,shortcutFromEvent,MAX_PRESET_LABEL,parseRtProfile,exportRtProfile,rtProfileAiGuide} from '../config/presets.js';

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
      canApply:false,reason:!complete?'Đọc đủ snapshot 9 nhóm để chỉnh sửa.':source==='sample'?'Dữ liệu mẫu · không gửi thiết bị':source!=='device'?'Bản đã lưu · không có quyền ghi thiết bị.':'Bản nháp · gửi khi bấm Áp dụng',
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
// Nhãn trên phím khi xem lớp Fn, giống driver hãng: chức năng/media hiện tên chức năng
// (đánh dấu nổi bật), phím thường hiện tên phím mà Fn gửi ra, mã chưa biết giữ nhãn gốc.
const FN_SHORT=['Reset gốc','BT 1','BT 2','BT 3','Nối lại','Đổi F','Xem pin','WIN','MAC','Android','Hiệu ứng đèn','Màu đèn','Sáng +','Sáng −','Tốc độ +','Tốc độ −','Tắt đèn','Alt+Tab','Win+E','Win+Tab','Win+H','Khóa Win'];
const MEDIA_SHORT=['Máy tính','Calc','Email','Media','Play / Pause','Dừng','Bài trước','Bài sau','Vol +','Vol −','Mute','Home','Làm mới','Tiến','Lùi','Yêu thích','Tìm'];
const HID_NAMES={40:'Enter',41:'Esc',42:'Backspace',43:'Tab',44:'Space',57:'Caps',70:'Print',71:'Scroll',72:'Pause',73:'Ins',74:'Home',75:'PgUp',76:'Del',77:'End',78:'PgDn',79:'→',80:'←',81:'↓',82:'↑'};
const MOD_NAMES={1:'Ctrl',2:'Shift',4:'Alt',8:'Win',16:'Ctrl',32:'Shift',64:'Alt',128:'Win'};
const MOD_USAGE={1:224,2:225,4:226,8:227,16:228,32:229,64:230,128:231};
const SPECIAL_TYPES={mouse:'Chuột',macro:'Macro',combination:'Tổ hợp',dks:'DKS',mt:'MT',tgl:'TGL',socd:'SOCD',rs:'RS'};
// Lớp Fn mặc định của firmware. Sau khi khôi phục cài đặt gốc, khối Fn đọc về toàn 0 và
// firmware dùng bảng có sẵn (giống khối gán phím thường luôn đọc 0 mà vẫn gõ bình thường).
// Bảng này đọc từ A80RT U firmware 1.37 trước khi reset: qua cáp (2026-10-25) và qua đầu thu
// (2026-10-31), hai lần đọc giống hệt nhau. Chỉ dùng để HIỂN THỊ ô trống, không bao giờ để ghi.
const FACTORY_FN={0:[13,0,0,1],1:[3,35,2,0],2:[3,138,1,0],3:[13,0,0,18],4:[13,0,0,19],5:[13,0,0,14],6:[13,0,0,13],7:[3,182,0,0],8:[3,205,0,0],9:[3,181,0,0],10:[3,226,0,0],11:[3,234,0,0],12:[3,233,0,0],
  16:[13,0,0,5],17:[13,0,0,2],18:[13,0,0,3],19:[13,0,0,4],20:[2,0,33,0],21:[2,0,34,0],22:[2,0,35,0],23:[2,0,36,0],24:[2,0,37,0],25:[2,0,38,0],26:[2,0,39,0],27:[2,0,45,0],28:[2,0,46,0],
  32:[13,0,0,12],33:[13,0,0,10],34:[13,0,0,8],35:[13,0,0,9],36:[13,0,0,58],37:[2,0,23,0],38:[2,0,28,0],39:[2,0,70,0],40:[2,0,71,0],41:[2,0,72,0],42:[2,0,19,0],43:[2,0,47,0],44:[2,0,48,0],
  48:[2,0,57,0],49:[2,0,4,0],50:[2,0,22,0],51:[2,0,7,0],52:[2,0,9,0],53:[2,0,10,0],54:[2,0,11,0],55:[2,0,13,0],56:[2,0,14,0],57:[2,0,15,0],58:[2,0,51,0],59:[2,0,52,0],60:[13,0,0,11],
  64:[2,2,0,0],65:[2,0,29,0],66:[2,0,27,0],67:[2,0,6,0],68:[2,0,25,0],69:[13,0,0,7],70:[2,0,17,0],71:[13,0,0,75],72:[2,0,54,0],73:[2,0,55,0],74:[2,0,56,0],75:[2,32,0,0],76:[2,0,40,0],
  80:[2,1,0,0],81:[13,0,0,22],82:[2,4,0,0],83:[2,0,44,0],85:[2,0,175,0],87:[2,16,0,0],88:[13,0,0,16],89:[13,0,0,14],90:[13,0,0,13],91:[13,0,0,15],92:[2,0,42,0],
  99:[2,0,70,0],103:[2,0,73,0],105:[2,0,75,0],106:[2,0,74,0],107:[2,0,77,0],108:[2,0,78,0]};
export const FACTORY_SUFFIX=' (mặc định firmware)';
const factoryRecords=new WeakMap();
function factoryBinding(slot,capability){
  if(!capability||!FACTORY_FN[slot])return null;
  let records=factoryRecords.get(capability);
  if(!records){const length=readPlan(capability).find(block=>block.id==='fn')?.length??512,bytes=new Uint8Array(length);
    for(const [at,value]of Object.entries(FACTORY_FN))if(Number(at)*4+4<=length)bytes.set(value,Number(at)*4);
    records=decodeBlock('fn',bytes,capability).records;factoryRecords.set(capability,records);}
  return records[slot]?.binding??null;
}
export function fnKeyCap(binding,key,capability){
  if(binding?.type==='empty'){
    const fallback=factoryBinding(key.slot,capability),cap=fallback&&fnKeyCapRaw(fallback,key,capability);
    if(cap)return {...cap,full:cap.full+FACTORY_SUFFIX,factory:true};
  }
  return fnKeyCapRaw(binding,key,capability);
}
function fnKeyCapRaw(binding,key,capability){
  if(!binding)return null;
  if(binding.type==='function'){
    const index=binding.code-1;
    if(FUNCTIONS[index])return {short:FN_SHORT[index],full:FUNCTIONS[index],special:true};
    return {short:key.label,full:key.label,special:false};
  }
  if(binding.type==='media'){
    const index=capability?.limits.mediaUsages.indexOf(binding.usage)??-1;
    return index>=0?{short:MEDIA_SHORT[index],full:MEDIA[index],special:true}:{short:'Media',full:`Media 0x${binding.usage.toString(16)}`,special:true};
  }
  if(binding.type==='keyboard'){
    if(binding.usage===175&&!binding.modifier)return {short:'Fn',full:'Fn',special:false};
    if(!binding.usage&&MOD_NAMES[binding.modifier]){
      const name=MOD_NAMES[binding.modifier];return {short:name,full:name,special:false,remapped:MOD_USAGE[binding.modifier]!==key.usage};
    }
    const name=HID_NAMES[binding.usage]??usageName(binding.usage),mods=Object.entries(MOD_NAMES).filter(([bit])=>binding.modifier&Number(bit)).map(([,label])=>label);
    const text=[...new Set(mods),name].join('+');
    return {short:text,full:text,special:false,remapped:binding.usage!==key.usage||binding.modifier!==0};
  }
  if(binding.type==='empty')return {short:key.label,full:'Trống',special:false,empty:true};
  const label=SPECIAL_TYPES[binding.type]??'?';return {short:label,full:label,special:true};
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

export function mountCoreEditors(root,{session,capability,selectedSlots=[],onEdit=()=>{},onLayerChange=()=>{},onNavigate=()=>{},isBusy=()=>false,library=presetLibrary}){
  const model=createCoreEditorModel({session,capability,selectedSlots,onEdit,isBusy});
  const listeners=[],controls=new Map(),panels=new Map(),tabs=new Map();let active='rt',destroyed=false,invalidInput=null;
  const make=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
  const listen=(el,type,fn)=>{el.addEventListener(type,fn);listeners.push(()=>el.removeEventListener(type,fn));};
  listen(root,'pointerdown',onNavigate);listen(root,'focusin',onNavigate);
  const intro=make('div',null,'editor-heading'),title=make('h2','Chỉnh cấu hình'),selection=make('p');intro.append(title,selection);
  const reason=make('p',null,'editor-reason'),error=make('p',null,'editor-error');error.id='core-editor-error';error.setAttribute('role','alert');error.hidden=true;
  const tabbar=make('div',null,'editor-tabs');tabbar.setAttribute('role','tablist');tabbar.setAttribute('aria-label','Nhóm chỉnh sửa');
  for(const [id,label]of [['rt','Rapid Trigger'],['binding','Gán phím / Fn'],['rgb','RGB']]){
    const tab=make('button',label);tab.type='button';tab.id=`editor-tab-${id}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',`editor-panel-${id}`);
    const panel=make('div',null,'editor-panel');panel.id=`editor-panel-${id}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
    tabs.set(id,tab);panels.set(id,panel);tabbar.append(tab);listen(tab,'click',()=>{onNavigate();active=id;refresh();});
    listen(tab,'keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();onNavigate();const ids=[...tabs.keys()],index=ids.indexOf(active);active=event.key==='Home'?ids[0]:event.key==='End'?ids.at(-1):ids[(index+(event.key==='ArrowRight'?1:2))%3];refresh();tabs.get(active).focus();});
  }
  const errorContext=()=>{const view=model.view();return JSON.stringify([view.layer,[...view.slots].sort((a,b)=>a-b),session?.draft,view.editable]);};
  // Ô đang sai được đánh dấu aria-invalid và trỏ tới dòng lỗi để trình đọc màn hình đọc kèm.
  let invalidField=null;
  const markInvalid=input=>{if(invalidField&&invalidField!==input){invalidField.removeAttribute?.('aria-invalid');invalidField.removeAttribute?.('aria-describedby');}invalidField=input??null;if(input){input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',error.id);}};
  const clearError=()=>{invalidInput=null;markInvalid(null);error.hidden=true;error.textContent='';};
  const showError=(problem,key)=>{const input=controls.get(key)?.input;invalidInput=input&&key!=='binding'?{input,value:input.value,checked:input.checked,context:errorContext()}:null;markInvalid(input);error.textContent=problem.message;error.hidden=false;};
  const commit=(block,field,value)=>{try{model.edit(block,field,value);clearError();refresh();}catch(problem){showError(problem,block==='colors'?'selectedColor':field);}};
  const field=(panel,key,label,type='number')=>{
    const wrap=make('div',null,'editor-field'),caption=make('label',label),input=make(type==='select'?'select':'input');input.id=`core-${key}`;caption.htmlFor=input.id;if(type!=='select')input.type=type;
    wrap.append(caption,input);panel.append(wrap);controls.set(key,{input,wrap});return input;
  };
  const option=(select,value,label)=>{const el=make('option',label);el.value=String(value);select.append(el);};
  const rtPanel=panels.get('rt');rtPanel.append(make('p','Chỉ đổi trường bạn sửa. Điểm nhận tối thiểu 0,01 mm.','editor-hint'));
  // Profile Rapid Trigger: cài sẵn của hãng, gợi ý của app và profile bạn tự lưu. Mỗi lần
  // chọn là một transaction cho cả bàn phím, chỉ vào bản nháp; gửi khi bấm Áp dụng.
  const presetBar=make('div',null,'preset-bar'),presetButtons=new Map(),presetNote=make('p','Chọn profile → bản nháp → Áp dụng','editor-hint');
  presetBar.setAttribute('role','group');presetBar.setAttribute('aria-label','Profile Rapid Trigger');
  const presetsEnabled=()=>{const view=model.view();return view.complete&&!session?.applying&&!isBusy();};
  const presetSave=make('div',null,'preset-save'),presetName=make('input',null,'preset-name'),presetSaveButton=make('button','Lưu thành profile','preset-tool'),presetManageButton=make('button','Quản lý profile & phím tắt','preset-tool');
  presetName.type='text';presetName.id='core-preset-name';presetName.placeholder='Tên profile mới (vd. Valorant)';presetName.maxLength=MAX_PRESET_LABEL;presetName.setAttribute('aria-label','Tên profile mới');
  presetSaveButton.type='button';presetSaveButton.id='core-preset-save';withIcon(presetSaveButton,'save');presetManageButton.type='button';presetManageButton.id='core-preset-manage';presetManageButton.setAttribute('aria-expanded','false');
  presetSave.append(presetName,presetSaveButton,presetManageButton);
  const presetUndo=make('button','Hoàn tác','preset-tool undo-button');presetUndo.type='button';presetUndo.id='core-preset-undo';withIcon(presetUndo,'undo');presetUndo.hidden=true;let undoToken=null,undoTimer=null;
  const offerUndo=token=>{undoToken=token;presetUndo.hidden=!token;clearTimeout(undoTimer);if(token){undoTimer=setTimeout(()=>offerUndo(null),10000);undoTimer?.unref?.();}};
  const presetManage=make('div',null,'preset-manage');presetManage.id='core-preset-manage-panel';presetManage.hidden=true;
  // Nhập/xuất file profile: file JSON dễ đọc, dán JSON từ AI, chép hướng dẫn cho AI.
  const ioTools=make('div',null,'preset-io'),importFile=make('input'),importButton=make('button','Nhập file JSON','preset-tool'),pasteButton=make('button','Dán JSON','preset-tool'),aiButton=make('button','Chép hướng dẫn cho AI','preset-tool');
  importFile.type='file';importFile.accept='.json,application/json';importFile.hidden=true;importFile.id='core-preset-import-file';
  for(const [el,id,name]of [[importButton,'core-preset-import','upload'],[pasteButton,'core-preset-paste',null],[aiButton,'core-preset-ai','copy']]){el.type='button';el.id=id;withIcon(el,name);}
  pasteButton.setAttribute('aria-expanded','false');
  const pasteBox=make('div',null,'preset-paste'),pasteText=make('textarea',null,'preset-paste-text'),pasteImport=make('button','Nhập profile từ JSON','preset-tool');
  pasteBox.hidden=true;pasteBox.id='core-preset-paste-box';pasteText.id='core-preset-paste-text';pasteText.rows=8;pasteText.spellcheck=false;pasteText.setAttribute('aria-label','JSON profile Rapid Trigger');
  pasteText.placeholder='Dán JSON profile (từ file hoặc AI)';pasteImport.type='button';pasteImport.id='core-preset-paste-import';
  pasteBox.append(pasteText,pasteImport);ioTools.append(importButton,pasteButton,aiButton,importFile);
  const importProfileText=text=>{
    try{
      const parsed=parseRtProfile(text,capability),label=library.uniqueLabel(parsed.label),saved=library.save(label,parsed.preset),notes=[...parsed.warnings];
      if(label!==parsed.label)notes.unshift(`Tên “${parsed.label}” đã có nên lưu thành profile mới.`);
      if(parsed.shortcut){const owner=library.list().find(item=>item.shortcut===parsed.shortcut&&item.id!==saved.id);
        if(owner)notes.push(`Phím tắt ${parsed.shortcut} đang thuộc ${owner.label} nên chưa gán.`);else library.setShortcut(saved.id,parsed.shortcut);}
      clearError();presetNote.textContent=`Đã nhập profile ${saved.label}.${notes.length?` ${notes.join(' ')}`:''}`;
      return true;
    }catch(problem){showPresetError(problem);return false;}
  };
  listen(importButton,'click',()=>{onNavigate();importFile.click?.();});
  listen(importFile,'change',async()=>{const file=importFile.files?.[0];importFile.value='';if(!file)return;
    if(file.size>256*1024){showPresetError(new Error('File profile quá lớn (tối đa 256 KB).'));return;}importProfileText(await file.text());});
  listen(pasteButton,'click',()=>{onNavigate();pasteBox.hidden=!pasteBox.hidden;pasteButton.setAttribute('aria-expanded',String(!pasteBox.hidden));if(!pasteBox.hidden)pasteText.focus?.();});
  listen(pasteImport,'click',()=>{onNavigate();if(importProfileText(pasteText.value))pasteText.value='';});
  listen(aiButton,'click',async()=>{onNavigate();
    let current=null;try{if(model.view().complete)current=exportRtProfile({...presetFromDraft(capability,session.draft),label:'Current'},capability);}catch{}
    const guide=rtProfileAiGuide(capability,current);
    try{await globalThis.navigator.clipboard.writeText(guide);presetNote.textContent='Đã chép. Dán vào AI, mô tả game, rồi dán JSON trả về vào “Dán JSON”.';}
    catch{pasteBox.hidden=false;pasteButton.setAttribute('aria-expanded','true');pasteText.value=guide;pasteText.select?.();presetNote.textContent='Không tự chép được — chép (Ctrl+C) từ ô bên dưới.';}
  });
  const downloadProfile=preset=>{
    const data=exportRtProfile(preset,capability),name=`${preset.label.replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'')||'profile'}.a80rt-rt.json`;
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=name;link.click?.();setTimeout(()=>URL.revokeObjectURL(url),1000);
    presetNote.textContent=`Đã xuất ${name}.`;return data;
  };
  let dynamic=[],capturing=null,confirmDelete=null,confirmTimer=null;
  const dlisten=(el,type,fn)=>{el.addEventListener(type,fn);dynamic.push(()=>el.removeEventListener(type,fn));};
  const showPresetError=problem=>{error.textContent=problem.message;error.hidden=false;};
  const choosePreset=preset=>{onNavigate();
    if(!preset.id){presetNote.textContent='Đặt tên rồi bấm Lưu để giữ cấu hình này thành profile.';presetName.focus?.();return;}
    try{if(!presetsEnabled())throw new Error('Đọc cấu hình trước và chờ thao tác đang chạy xong.');
      session.transaction(presetEdits(capability,preset));onEdit(session.diff());clearError();
      presetNote.textContent=`Đã đưa ${preset.label} vào bản nháp.`;refresh();
    }catch(problem){showPresetError(problem);}
  };
  const stopCapture=()=>{capturing=null;};
  // Bấm nút phím tắt rồi bấm tổ hợp mới. Esc để hủy, Backspace/Delete để bỏ phím tắt.
  const captureKeys=(preset,button)=>event=>{
    if(capturing!==preset.id)return;
    event.preventDefault?.();event.stopPropagation?.();
    if(event.key==='Escape'){stopCapture();renderPresets();return;}
    if(event.key==='Backspace'||event.key==='Delete'){stopCapture();try{library.setShortcut(preset.id,null);clearError();presetNote.textContent=`Đã bỏ phím tắt của ${preset.label}.`;}catch(problem){showPresetError(problem);renderPresets();}return;}
    const keys=shortcutFromEvent(event);
    if(!keys){if(!['Control','Alt','Shift','Meta'].includes(event.key))button.textContent='Cần Ctrl/Alt/Win + chữ, số hoặc F1–F24';return;}
    const owner=library.list().find(item=>item.shortcut===keys&&item.id!==preset.id);
    stopCapture();
    try{library.setShortcut(preset.id,keys);clearError();presetNote.textContent=`Đã gán ${keys} → ${preset.label}${owner?` (bỏ khỏi ${owner.label})`:''}.`;}
    catch(problem){showPresetError(problem);renderPresets();}
  };
  function renderPresets(){
    for(const remove of dynamic)remove();dynamic=[];presetButtons.clear();
    const all=[{id:null,label:'Tùy chỉnh',description:'Cấu hình hiện tại không trùng profile nào.'},...library.list()];
    presetBar.replaceChildren(...all.map(preset=>{
      const kind=preset.group==='game'?' preset-game':preset.group==='user'?' preset-user':'';
      const item=make('button',preset.shortcut?`${preset.label} · ${preset.shortcut}`:preset.label,`preset-button${kind}`);item.type='button';item.id=`core-preset-${preset.id??'custom'}`;
      item.title=`${preset.description}${preset.shortcut?` Phím tắt ${preset.shortcut}.`:''}`;presetButtons.set(preset.id,item);dlisten(item,'click',()=>choosePreset(preset));return item;
    }));
    const rows=library.list().map(preset=>{
      const row=make('div',null,'preset-row'),name=make('span',preset.label,'preset-row-name'),kind=make('span',preset.group==='user'?'Của bạn':preset.group==='game'?'Gợi ý của app':'Của hãng','preset-row-kind');
      const keys=make('button',capturing===preset.id?'Bấm tổ hợp phím… (Esc hủy)':preset.shortcut??'Gán phím tắt','preset-tool preset-keys');keys.type='button';keys.id=`core-preset-keys-${preset.id}`;
      keys.title='Nhấn tổ hợp mới · Esc hủy · Backspace xóa';
      dlisten(keys,'click',()=>{onNavigate();capturing=capturing===preset.id?null:preset.id;renderPresets();});
      dlisten(keys,'keydown',captureKeys(preset,keys));dlisten(keys,'blur',()=>{if(capturing===preset.id){stopCapture();renderPresets();}});
      const drop=make('button',confirmDelete===preset.id?'Bấm lần nữa để xóa':'Xóa','preset-tool preset-delete');drop.type='button';drop.id=`core-preset-delete-${preset.id}`;
      drop.title=preset.builtin?'Ẩn (khôi phục được)':'Xóa hẳn';if(confirmDelete!==preset.id){withIcon(drop,'trash',{iconOnly:true});drop.setAttribute('aria-label',`Xóa profile ${preset.label}`);}else drop.setAttribute('aria-label',`Bấm lần nữa để xóa profile ${preset.label}`);
      dlisten(drop,'click',()=>{onNavigate();clearTimeout(confirmTimer);
        if(confirmDelete!==preset.id){confirmDelete=preset.id;confirmTimer=setTimeout(()=>{confirmDelete=null;if(!destroyed)renderPresets();},3000);renderPresets();return;}
        confirmDelete=null;try{const token=library.remove(preset.id);presetNote.textContent=`Đã xóa profile ${preset.label}.`;offerUndo(token);}catch(problem){showPresetError(problem);}
      });
      const out=make('button','Xuất','preset-tool');out.type='button';out.id=`core-preset-export-${preset.id}`;out.title='Tải file JSON';withIcon(out,'download',{iconOnly:true});out.setAttribute('aria-label',`Xuất profile ${preset.label}`);
      dlisten(out,'click',()=>{onNavigate();downloadProfile(preset);});
      row.append(name,kind,keys,out,drop);return row;
    });
    const hidden=library.hiddenCount(),restore=make('button',`Khôi phục profile cài sẵn đã xóa (${hidden})`,'preset-tool');restore.type='button';restore.id='core-preset-restore';withIcon(restore,'history');restore.hidden=!hidden;
    dlisten(restore,'click',()=>{onNavigate();try{library.restoreDefaults();clearError();presetNote.textContent='Đã khôi phục profile cài sẵn.';}catch(problem){showPresetError(problem);}});
    presetManage.replaceChildren(make('p','Lưu trên máy này · phím tắt chạy cả trong game','editor-hint'),ioTools,pasteBox,...rows,restore);
    if(capturing)document.getElementById?.(`core-preset-keys-${capturing}`)?.focus?.();
    if(!destroyed)syncPresetState();
  }
  function syncPresetState(){
    const view=model.view(),presetActive=session?.draft&&capability?matchingPreset(capability,session.draft,library.list()):null,canPreset=view.complete&&!session?.applying&&!isBusy();
    for(const [id,item]of presetButtons){item.setAttribute('aria-pressed',String(view.complete&&id===presetActive));item.disabled=!canPreset;}
    presetSaveButton.disabled=!view.complete;presetName.disabled=!view.complete;
  }
  listen(presetManageButton,'click',()=>{onNavigate();presetManage.hidden=!presetManage.hidden;presetManageButton.setAttribute('aria-expanded',String(!presetManage.hidden));});
  const savePreset=()=>{onNavigate();
    try{if(!model.view().complete)throw new Error('Đọc đủ cấu hình trước khi lưu profile.');
      const saved=library.save(presetName.value,presetFromDraft(capability,session.draft));presetName.value='';clearError();
      presetNote.textContent=`Đã lưu profile ${saved.label}.`;
    }catch(problem){showPresetError(problem);}
  };
  listen(presetSaveButton,'click',savePreset);
  listen(presetUndo,'click',()=>{onNavigate();const token=undoToken;offerUndo(null);if(!token)return;try{library.undoRemove(token);clearError();presetNote.textContent='Đã hoàn tác xóa profile.';}catch(problem){showPresetError(problem);offerUndo(token);}});
  listen(presetName,'keydown',event=>{if(event.key==='Enter'){event.preventDefault?.();savePreset();}});
  const unsubscribe=library.subscribe(()=>{if(!destroyed)renderPresets();});listeners.push(()=>{unsubscribe();for(const remove of dynamic)remove();dynamic=[];clearTimeout(confirmTimer);clearTimeout(undoTimer);});
  renderPresets();
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
  const presetNoteRow=make('div',null,'preset-note-row');presetNoteRow.append(presetNote,presetUndo);
  rtPanel.append(presetBar,presetSave,presetManage,presetNoteRow,visual);
  if(capability?.fields.rt.switchId){
    const switchInput=field(rtPanel,'switchId','Loại switch · ID từng phím','select');option(switchInput,'','—');
    for(const id of capability.limits.switchIds)option(switchInput,id,`${id} · ${capability.limits.switchLabels[id]} · ${capability.limits.switchTravelMm[id]} mm`);
    listen(switchInput,'change',()=>{if(switchInput.value!=='')commit('rt','switchId',Number(switchInput.value));});
    rtPanel.append(make('p','Đổi loại switch xong cần hiệu chuẩn bằng công cụ hãng.','editor-hint'));
  }else rtPanel.append(make('p',capability?.transport==='dongle'?'Đầu thu: không đổi được loại switch.':'Model này: giữ nguyên loại switch và cờ RT.','editor-hint'));
  for(const [key,label]of [['actuationMm','Điểm nhận (mm)'],['pressMm','Ngưỡng nhấn RT (mm)'],['releaseMm','Ngưỡng nhả RT (mm)']]){
    const input=field(rtPanel,key,label);input.step='0.01';input.min=key==='actuationMm'?'0.01':'0';
    const range=make('input');range.type='range';range.setAttribute('aria-label',`${label} · thanh trượt`);range.step=input.step;range.min=input.min;controls.get(key).wrap.append(range);controls.get(key).range=range;
    listen(input,'change',()=>commit('rt',key,input.value.trim()===''?NaN:Number(input.value)));listen(range,'input',()=>commit('rt',key,Number(range.value)));
  }
  for(const [key,label]of [['whole','RT trên toàn hành trình']].filter(([key])=>capability?.fields.rt[key])){
    const input=field(rtPanel,key,label,'checkbox');listen(input,'change',()=>commit('rt',key,input.checked));
  }
  if(capability?.fields.rt.whole)rtPanel.append(make('p','Bật: RT hoạt động suốt hành trình. Tắt: chỉ sau điểm nhận.','editor-hint'));
  rtPanel.append(make('p','Vùng chết: xem Thiết lập & bảo trì.','editor-hint'));
  const bindingPanel=panels.get('binding'),layer=field(bindingPanel,'layer','Lớp chỉnh sửa','select');option(layer,'base','Mặc định');option(layer,'fn','Fn');
  listen(layer,'change',()=>{model.setLayer(layer.value);onLayerChange(layer.value);refresh();});
  const binding=field(bindingPanel,'binding','Gán cho các phím đã chọn','select'),bindingNote=make('p',null,'editor-hint');bindingPanel.append(bindingNote);
  const options=capability?bindingOptions(capability):[];option(binding,'','—');for(const [index,item]of options.entries())option(binding,index,item.label);
  listen(binding,'change',()=>{if(binding.value!=='')commit('binding','binding',options[Number(binding.value)].value);});

  // Bộ chọn gán phím theo nhóm, giống driver hãng: tab Phím / Modifier / Media / Chuột / Chức năng,
  // lưới nút tên ngắn, tìm kiếm trên mọi nhóm (tiếng Việt và tiếng Anh). Ô select gốc vẫn giữ
  // (ẩn) làm đường dự phòng; cả hai cùng đi qua commit() như trước.
  binding.hidden=true;controls.get('binding').wrap.hidden=true;
  const picker=make('div',null,'binding-picker');picker.id='core-binding-picker';
  const pickerTop=make('div',null,'binding-picker-top'),bindingCurrent=make('p',null,'binding-current'),bindingSearch=make('input',null,'binding-search'),bindingEmpty=make('button','Bỏ gán (Trống)','preset-tool');
  bindingCurrent.id='core-binding-current';bindingSearch.type='search';bindingSearch.id='core-binding-search';bindingSearch.placeholder='Tìm phím hoặc chức năng (vd. F5, Mute, Bluetooth)';bindingSearch.setAttribute('aria-label','Tìm gán phím');bindingSearch.autocomplete='off';
  bindingEmpty.type='button';bindingEmpty.id='core-binding-empty';withIcon(bindingEmpty,'close');
  const bindingTabs=make('div',null,'binding-tabs'),bindingGrid=make('div',null,'binding-grid');bindingTabs.setAttribute('role','tablist');bindingTabs.setAttribute('aria-label','Nhóm gán phím');bindingGrid.id='core-binding-grid';bindingGrid.setAttribute('role','tabpanel');bindingGrid.setAttribute('aria-label','Phím có thể gán');
  pickerTop.append(bindingCurrent,bindingSearch,bindingEmpty);picker.append(pickerTop,bindingTabs,bindingGrid);bindingPanel.append(picker);
  const BINDING_GROUPS=[['key','Phím'],['modifier','Modifier'],['media','Media'],['mouse','Chuột'],['function','Chức năng']];
  const groupOf=item=>item.value.type==='keyboard'?(item.value.usage?'key':'modifier'):item.value.type;
  const shortOf=item=>item.label.replace(/^(Phím|Modifier|Media|Chức năng) · /,'');
  const haystack=options.map(item=>[item.label,shortOf(item),translate(item.label),translate(shortOf(item))].join(' ').toLowerCase());
  const emptyIndex=options.findIndex(item=>item.value.type==='empty');
  let bindingGroup='key',bindingSlotsSeen=null,pickerListeners=[];
  const bindingTabButtons=new Map();
  for(const [id,label]of BINDING_GROUPS){
    const tab=make('button',label,'binding-tab');tab.type='button';tab.id=`core-binding-tab-${id}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','core-binding-grid');bindingTabs.append(tab);bindingTabButtons.set(id,tab);
    listen(tab,'click',()=>{onNavigate();bindingGroup=id;bindingSearch.value='';renderBindingPicker();});
  }
  // Mũi tên trái/phải, Home/End chuyển nhóm như tablist chuẩn (WAI-ARIA APG).
  listen(bindingTabs,'keydown',event=>{
    const ids=BINDING_GROUPS.map(([id])=>id),current=Math.max(0,ids.indexOf(bindingGroup));
    const next={ArrowRight:(current+1)%ids.length,ArrowLeft:(current-1+ids.length)%ids.length,Home:0,End:ids.length-1}[event.key];
    if(next===undefined)return;event.preventDefault();onNavigate();bindingGroup=ids[next];bindingSearch.value='';renderBindingPicker();bindingTabButtons.get(bindingGroup)?.focus?.();
  });
  listen(bindingSearch,'input',()=>renderBindingPicker());
  listen(bindingEmpty,'click',()=>{onNavigate();if(emptyIndex>=0)commit('binding','binding',options[emptyIndex].value);});
  function renderBindingPicker(){
    for(const remove of pickerListeners)remove();pickerListeners=[];
    const view=model.view(),index=options.findIndex(item=>same(item.value,bindingValue(view.binding.value))),query=String(bindingSearch.value??'').trim().toLowerCase();
    const slotsKey=view.slots.join(',')+'|'+view.layer;
    if(slotsKey!==bindingSlotsSeen){bindingSlotsSeen=slotsKey;if(index>=0&&index!==emptyIndex&&!query)bindingGroup=groupOf(options[index]);}
    const items=options.map((item,i)=>({item,i})).filter(({item,i})=>i!==emptyIndex&&(query?haystack[i].includes(query):groupOf(item)===bindingGroup));
    const buttons=items.map(({item,i})=>{
      const button=make('button',shortOf(item),'binding-option');button.type='button';button.id=`core-binding-option-${i}`;button.title=item.label;
      button.setAttribute('aria-pressed',String(i===index));button.disabled=binding.disabled;
      const handler=()=>{onNavigate();commit('binding','binding',item.value);};button.addEventListener('click',handler);pickerListeners.push(()=>button.removeEventListener('click',handler));
      return button;
    });
    bindingGrid.replaceChildren(...(buttons.length?buttons:[make('p','Không có kết quả.','editor-hint')]));
    for(const [id,tab]of bindingTabButtons){tab.setAttribute('aria-selected',String(!query&&id===bindingGroup));tab.tabIndex=id===bindingGroup?0:-1;tab.disabled=binding.disabled;}
    bindingSearch.disabled=binding.disabled;bindingEmpty.disabled=binding.disabled;bindingEmpty.setAttribute('aria-pressed',String(index===emptyIndex));
    const soleKey=view.slots.length===1?KEYS.find(key=>key.slot===view.slots[0]):null,fallback=view.layer==='fn'&&index===emptyIndex&&soleKey?fnKeyCap(view.binding.value,soleKey,capability):null;
    bindingCurrent.textContent=fallback?.factory?`Đang gán: Trống · firmware dùng mặc định ${fallback.full.slice(0,-FACTORY_SUFFIX.length)}`:view.binding.mixed?'Đang gán: giá trị khác nhau giữa các phím đã chọn':index>=0?`Đang gán: ${options[index].label}`:view.binding.value?`Đang gán: ${view.binding.value.type} (mã ${view.binding.value.typeCode}) · giữ nguyên`:'Đang gán: —';
  }
  listeners.push(()=>{for(const remove of pickerListeners)remove();pickerListeners=[];});
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
  rgbPanel.append(make('p','Màu từng phím cần hiệu ứng 128.','editor-hint'));
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
    syncPresetState();
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
    renderBindingPicker();
    bindingNote.textContent=view.bindingLocked?'Fn F1–F12 bị khóa.':'';
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
