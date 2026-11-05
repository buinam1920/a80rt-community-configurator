import {readPlan} from '../device/capabilities.js';
import {decodeBlock} from './codecs.js';
import {KEYS} from '../layout.js';

// RT presets. All distance values are stored in millimetres.
//
// "vendor" group: LEOBOG driver for A80RT / A80RT U / Dongle, bundle
// static/js/app.3086f769.js (SHA256 924907c8...), customInfo:x.getDefault().
// Source units: triggerVal uses 0.1 mm (getUpdateAction: action_point=triggerVal/10);
// dowValue/releaseValue use 0.01 mm (getSenRt writes downstroke/upstroke directly).
// `rest` applies to every key; `keys` overrides slots (W34 A49 S50 D51 Ctrl80 Space83).
// Only Office calls handleZone(defaValue), so only that preset resets dead zones to 0/0.
//
// "game" group: app-suggested profiles, not manufacturer data. These are starting
// points that users can adjust like any other draft.
//
// The manufacturer driver also rewrites switch IDs and clears bottom/rtMode bits.
// This app preserves those fields because no qualified editor exists for this model.
const SLOT={Esc:0,1:17,2:18,3:19,4:20,5:21,6:22,Tab:32,Q:33,W:34,E:35,R:36,T:37,Caps:48,A:49,S:50,D:51,F:52,G:53,
  LShift:64,Z:65,X:66,C:67,V:68,B:69,LCtrl:80,LAlt:82,Space:83};
const at=(names,actuationMm,rtMm=0,whole=false)=>names.map(name=>({slot:SLOT[name],actuationMm,pressMm:rtMm,releaseMm:rtMm,whole}));
const vendorFrame=actuationMm=>({actuationMm,pressMm:0,releaseMm:0,whole:false});

export const RT_PRESETS=Object.freeze([
  {id:'office',group:'vendor',label:'Office',description:'All keys 2.0 mm, Space 3.0 mm, RT off; reset top/bottom dead zones to 0.',
    rest:vendorFrame(2),keys:at(['Space'],3),deadZone:{top:0,bottom:0}},
  {id:'beginner',group:'vendor',label:'Beginner',description:'All keys 1.5 mm, Space 3.0 mm; W A S D and left Ctrl 1.0 mm with 0.56 mm RT.',
    rest:vendorFrame(1.5),keys:[...at(['Space'],3),...at(['W','A','S','D','LCtrl'],1,0.56)]},
  {id:'game',group:'vendor',label:'Gaming',description:'All keys 1.5 mm, Space 3.0 mm; W A S D and left Ctrl 0.5 mm with 0.16 mm whole-travel RT.',
    rest:vendorFrame(1.5),keys:[...at(['Space'],3),...at(['W','A','S','D','LCtrl'],0.5,0.16,true)]},
  // LoL: prioritize avoiding accidental skill activation while resting on keys.
  // RT stays off; QWER/DF use slightly shallower actuation for skill activation.
  {id:'lol',group:'game',label:'LoL',shortcut:'Ctrl+Alt+1',description:'All keys 1.5 mm. Q W E R, D F 1.0 mm; 1–6, B, Tab 1.4 mm; Space 1.8 mm. RT off to reduce accidental activation.',
    rest:vendorFrame(1.5),keys:[...at(['Q','W','E','R','D','F'],1),...at(['1','2','3','4','5','6','B','Tab'],1.4),...at(['Space'],1.8)]},
  // Apex: shallow WASD with whole-travel RT targets quick movement changes.
  // Jump/crouch/sprint are moderately sensitive; skill keys stay deeper to reduce mistakes.
  {id:'apex',group:'game',label:'Apex',shortcut:'Ctrl+Alt+2',description:'W A S D 0.4 mm with 0.15 mm whole-travel RT. Space 0.8 mm, left Ctrl/C 0.6 mm with 0.2 mm RT, Shift 0.8 mm. Q Z E R G Tab 1.2 mm; remaining keys 1.5 mm.',
    rest:vendorFrame(1.5),keys:[...at(['W','A','S','D'],0.4,0.15,true),...at(['Space','LShift'],0.8),...at(['LCtrl','C'],0.6,0.2),...at(['Q','Z','E','R','G','Tab'],1.2)]},
].map(preset=>Object.freeze(preset)));

export const presetById=id=>{const preset=RT_PRESETS.find(item=>item.id===id)??presetLibrary.find(id);if(!preset)throw new Error(`Unknown preset: ${id}`);return preset;};
const targetFor=(preset,slot)=>{const {actuationMm,pressMm,releaseMm,whole}=preset.keys.find(entry=>entry.slot===slot)??preset.rest;return {actuationMm,pressMm,releaseMm,whole};};

// Return edit groups for one transaction, including only model-editable fields.
export function presetEdits(capability,id){
  const preset=typeof id==='object'&&id?id:presetById(id),fields=capability.fields.rt,rt=[];
  for(const slot of capability.slots)for(const [field,value]of Object.entries(targetFor(preset,slot)))if(fields[field]===true)rt.push({slot,field,value});
  const groups={rt};
  if(preset.deadZone){const settings=[];
    if(capability.settings.topDeadZone)settings.push({field:'topDeadZone',value:preset.deadZone.top});
    if(capability.settings.bottomDeadZone)settings.push({field:'bottomDeadZone',value:preset.deadZone.bottom});
    if(settings.length)groups.settings=settings;}
  return groups;
}

// Return the preset matching the draft, or null for a custom configuration.
export function matchingPreset(capability,blocks,presets=presetLibrary.list()){
  if(!blocks?.rt||!readPlan(capability).some(block=>block.id==='rt'))return null;
  const records=decodeBlock('rt',blocks.rt,capability).records,settings=blocks.settings?decodeBlock('settings',blocks.settings,capability).fields:null;
  const near=(a,b)=>Math.abs(a-b)<1e-9;
  return presets.find(preset=>capability.slots.every(slot=>{const target=targetFor(preset,slot),record=records[slot];
      return record&&near(record.actuationMm,target.actuationMm)&&near(record.pressMm,target.pressMm)&&near(record.releaseMm,target.releaseMm)&&(!capability.fields.rt.whole||record.whole===target.whole);})
    &&(!preset.deadZone||!settings||(settings.topDeadZone===preset.deadZone.top&&settings.bottomDeadZone===preset.deadZone.bottom)))?.id??null;
}

// ---------- Thư viện profile RT: cài sẵn + profile người dùng + phím tắt ----------
// Lưu cục bộ (localStorage) trên máy này. Profile người dùng chỉ gồm Rapid Trigger
// (điểm nhận, RT nhấn/nhả, cả hành trình) của mọi phím và vùng chết trên/dưới; áp dụng
// vẫn đi qua bản nháp, preflight, chặn Fn và đọc lại xác minh như mọi thay đổi khác.
// Profile cài sẵn "xóa" là ẩn đi, khôi phục được.
const STORE_KEY='a80rt-rt-presets';
const DEFAULT_SHORTCUTS=Object.freeze({lol:'Ctrl+Alt+1',apex:'Ctrl+Alt+2'});
export const MAX_PRESET_LABEL=32,MAX_USER_PRESETS=24;
const KEY_RE=/^(?:[A-Z]|[0-9]|F(?:[1-9]|1\d|2[0-4]))$/;
const MOD_ORDER=['Ctrl','Alt','Shift','Win'];

// Chuẩn hóa "ctrl + alt + k" thành "Ctrl+Alt+K". Bắt buộc có Ctrl, Alt hoặc Win để phím
// tắt toàn cục không nuốt phím gõ thường trong game.
export function normalizeShortcut(text){
  if(typeof text!=='string')throw new Error('Phím tắt không hợp lệ.');
  const parts=text.split('+').map(part=>part.trim()).filter(Boolean);
  const key=(parts.pop()??'').toUpperCase(),mods=new Set();
  for(const part of parts){
    const lower=part.toLowerCase(),mod=MOD_ORDER.find(name=>name.toLowerCase()===lower||(name==='Ctrl'&&lower==='control'));
    if(!mod)throw new Error(`Phím bổ trợ không hỗ trợ: ${part}`);mods.add(mod);
  }
  if(!KEY_RE.test(key))throw new Error('Phím chính cần là chữ A–Z, số 0–9 hoặc F1–F24.');
  if(!mods.has('Ctrl')&&!mods.has('Alt')&&!mods.has('Win'))throw new Error('Phím tắt cần có Ctrl, Alt hoặc Win để không trùng phím gõ thường.');
  return [...MOD_ORDER.filter(mod=>mods.has(mod)),key].join('+');
}
// Tổ hợp từ một KeyboardEvent, hoặc null khi chưa có phím chính hay thiếu phím bổ trợ.
export function shortcutFromEvent(event){
  const code=event?.code??'';let key=null;
  if(/^Key[A-Z]$/.test(code))key=code.slice(3);
  else if(/^Digit\d$/.test(code))key=code.slice(5);
  else if(/^F([1-9]|1\d|2[0-4])$/.test(code))key=code;
  if(!key)return null;
  const mods=[event.ctrlKey&&'Ctrl',event.altKey&&'Alt',event.shiftKey&&'Shift',event.metaKey&&'Win'].filter(Boolean);
  try{return normalizeShortcut([...mods,key].join('+'));}catch{return null;}
}

// Chụp Rapid Trigger (và vùng chết) hiện tại của bản nháp thành một profile.
export function presetFromDraft(capability,blocks,{id='u-draft',label='Profile'}={}){
  if(!blocks?.rt)throw new Error('Chưa có dữ liệu Rapid Trigger để lưu.');
  const records=decodeBlock('rt',blocks.rt,capability).records,keys=[];
  for(const slot of capability.slots){
    const record=records[slot];if(!record)throw new Error(`Thiếu dữ liệu phím ở vị trí ${slot}.`);
    keys.push({slot,actuationMm:record.actuationMm,pressMm:record.pressMm,releaseMm:record.releaseMm,whole:record.whole===true});
  }
  const first=keys[0]??{actuationMm:1.5,pressMm:0,releaseMm:0,whole:false};
  const preset={id,group:'user',label,rest:{actuationMm:first.actuationMm,pressMm:first.pressMm,releaseMm:first.releaseMm,whole:first.whole},keys};
  if(blocks.settings&&capability.settings.topDeadZone&&capability.settings.bottomDeadZone){
    const fields=decodeBlock('settings',blocks.settings,capability).fields;preset.deadZone={top:fields.topDeadZone,bottom:fields.bottomDeadZone};
  }
  return preset;
}
const mmOk=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=3.4;
const frameOf=entry=>entry&&mmOk(entry.actuationMm)&&mmOk(entry.pressMm)&&mmOk(entry.releaseMm)
  ?{actuationMm:entry.actuationMm,pressMm:entry.pressMm,releaseMm:entry.releaseMm,whole:entry.whole===true}:null;
function validUserPreset(item){
  if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^u-[a-z0-9]{4,24}$/.test(item.id))return null;
  const label=typeof item.label==='string'?item.label.trim().slice(0,MAX_PRESET_LABEL):'';if(!label)return null;
  const rest=frameOf(item.rest);if(!rest||!Array.isArray(item.keys)||item.keys.length>256)return null;
  const keys=[];
  for(const entry of item.keys){const value=frameOf(entry);if(!value||!Number.isInteger(entry.slot)||entry.slot<0||entry.slot>255)return null;keys.push({slot:entry.slot,...value});}
  const preset={id:item.id,group:'user',label,rest,keys,savedAt:typeof item.savedAt==='string'?item.savedAt:null};
  if(item.deadZone&&Number.isInteger(item.deadZone.top)&&Number.isInteger(item.deadZone.bottom))preset.deadZone={top:item.deadZone.top,bottom:item.deadZone.bottom};
  return preset;
}
function describeUser(preset){
  const values=[...new Set(preset.keys.map(entry=>entry.actuationMm))].sort((a,b)=>a-b),rt=preset.keys.filter(entry=>entry.pressMm>0||entry.releaseMm>0).length;
  const range=!values.length?'—':values.length===1?`${values[0].toFixed(2)} mm`:`${values[0].toFixed(2)}–${values.at(-1).toFixed(2)} mm`;
  return `Profile của bạn: điểm nhận ${range}, ${rt} phím bật RT${preset.deadZone?`, vùng chết ${preset.deadZone.top}/${preset.deadZone.bottom}`:''}.`;
}

const STORAGE_ERROR='Không lưu được vào bộ nhớ của app (bị chặn hoặc đã đầy). Chưa có thay đổi nào được lưu.';
export function createPresetLibrary(storage=null){
  const empty=()=>({hidden:[],custom:[],shortcuts:{...DEFAULT_SHORTCUTS}});
  const parse=raw=>{
    const parsed=raw?JSON.parse(raw):null;
    if(!parsed||typeof parsed!=='object')return empty();
    const hidden=Array.isArray(parsed.hidden)?parsed.hidden.filter(id=>RT_PRESETS.some(preset=>preset.id===id)):[];
    const custom=Array.isArray(parsed.custom)?parsed.custom.map(validUserPreset).filter(Boolean).slice(0,MAX_USER_PRESETS):[];
    const shortcuts={};
    if(parsed.shortcuts&&typeof parsed.shortcuts==='object')for(const [id,keys]of Object.entries(parsed.shortcuts)){
      try{const value=normalizeShortcut(keys);if(!Object.values(shortcuts).includes(value))shortcuts[id]=value;}catch{}
    }
    return {hidden,custom,shortcuts};
  };
  let data=empty(),lastRaw,notifiedRaw;const listeners=new Set();
  // Nhiều cửa sổ dùng chung localStorage: đọc lại bản đã lưu trước mỗi lần đọc/ghi để
  // không ghi đè profile mà cửa sổ khác vừa lưu bằng dữ liệu cũ trong bộ nhớ.
  const sync=()=>{
    try{const raw=storage?.getItem?.(STORE_KEY)??null;if(raw===lastRaw)return false;lastRaw=raw;data=parse(raw);return true;}catch{return false;}
  };
  sync();notifiedRaw=lastRaw;
  const known=id=>RT_PRESETS.some(preset=>preset.id===id)||data.custom.some(preset=>preset.id===id);
  // Mọi thay đổi chạy trong commit(): không có bộ nhớ (localStorage bị chặn) hoặc ghi
  // thất bại (vd. đầy dung lượng) thì
  // hoàn nguyên dữ liệu trong phiên và báo lỗi, không báo lưu thành công giả.
  const commit=mutate=>{
    const previous=JSON.stringify(data),result=mutate();
    for(const id of Object.keys(data.shortcuts))if(!known(id)||data.hidden.includes(id))delete data.shortcuts[id];
    try{if(typeof storage?.setItem!=='function')throw new Error('no storage');const raw=JSON.stringify(data);storage.setItem(STORE_KEY,raw);lastRaw=raw;notifiedRaw=raw;}
    catch{data=JSON.parse(previous);throw new Error(STORAGE_ERROR);}
    for(const listener of [...listeners]){try{listener();}catch{}}
    return result;
  };
  const decorate=(preset,builtin)=>({...preset,builtin,shortcut:data.shortcuts[preset.id]??null,description:builtin?preset.description:describeUser(preset)});
  const library={
    list(){sync();return [...RT_PRESETS.filter(preset=>!data.hidden.includes(preset.id)).map(preset=>decorate(preset,true)),...data.custom.map(preset=>decorate(preset,false))];},
    find(id){
      sync();const builtin=RT_PRESETS.find(preset=>preset.id===id);if(builtin)return decorate(builtin,true);
      const custom=data.custom.find(preset=>preset.id===id);return custom?decorate(custom,false):null;
    },
    hiddenCount(){sync();return data.hidden.length;},
    // Gọi khi cửa sổ khác đổi thư viện (sự kiện storage): nạp lại và báo cho giao diện.
    // So với bản đã báo (không phải bản đã đọc): list() có thể đã nạp thay đổi trước khi sự kiện tới.
    refresh(){sync();if(lastRaw===notifiedRaw)return;notifiedRaw=lastRaw;for(const listener of [...listeners]){try{listener();}catch{}}},
    // Tên chưa dùng cho profile nhập từ file: trùng thì thêm " (2)", " (3)"… để nhập không
    // bao giờ âm thầm thay thế profile đang có.
    uniqueLabel(label){
      sync();const base=typeof label==='string'?label.trim().replace(/\s+/g,' ').slice(0,MAX_PRESET_LABEL):'';
      const taken=name=>data.custom.some(item=>item.label.toLowerCase()===name.toLowerCase())||RT_PRESETS.some(item=>!data.hidden.includes(item.id)&&item.label.toLowerCase()===name.toLowerCase());
      if(!base||!taken(base))return base;
      for(let index=2;index<100;index++){const suffix=` (${index})`,name=base.slice(0,MAX_PRESET_LABEL-suffix.length).trimEnd()+suffix;if(!taken(name))return name;}
      return base;
    },
    // Lưu bản chụp thành profile mới; trùng tên với profile của bạn thì ghi đè (giữ phím tắt).
    save(label,preset){
      sync();const name=typeof label==='string'?label.trim().replace(/\s+/g,' '):'';
      if(!name)throw new Error('Nhập tên profile trước khi lưu.');
      if(name.length>MAX_PRESET_LABEL)throw new Error(`Tên profile tối đa ${MAX_PRESET_LABEL} ký tự.`);
      if(RT_PRESETS.some(item=>item.label.toLowerCase()===name.toLowerCase()&&!data.hidden.includes(item.id)))throw new Error(`“${name}” trùng tên profile cài sẵn; chọn tên khác.`);
      const existing=data.custom.find(item=>item.label.toLowerCase()===name.toLowerCase());
      if(!existing&&data.custom.length>=MAX_USER_PRESETS)throw new Error(`Tối đa ${MAX_USER_PRESETS} profile; xóa bớt rồi lưu lại.`);
      const id=existing?.id??`u-${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
      const stored=validUserPreset({...preset,id,label:name,savedAt:new Date().toISOString()});
      if(!stored)throw new Error('Dữ liệu profile không hợp lệ.');
      commit(()=>{if(existing)data.custom[data.custom.indexOf(existing)]=stored;else data.custom.push(stored);});
      return library.find(id);
    },
    // Trả về một "vé" để hoàn tác ngay sau khi xóa (khôi phục cả vị trí và phím tắt).
    remove(id){
      sync();const token={id,shortcut:data.shortcuts[id]??null,builtin:RT_PRESETS.some(preset=>preset.id===id)};
      if(!token.builtin&&!data.custom.some(preset=>preset.id===id))throw new Error('Không tìm thấy profile.');
      return commit(()=>{
        if(token.builtin){if(!data.hidden.includes(id))data.hidden.push(id);}
        else{const index=data.custom.findIndex(preset=>preset.id===id);token.index=index;token.preset=data.custom.splice(index,1)[0];}
        delete data.shortcuts[id];return token;
      });
    },
    undoRemove(token){
      if(!token)return;sync();
      if(!token.builtin&&token.preset&&!data.custom.some(preset=>preset.id===token.id)&&data.custom.length>=MAX_USER_PRESETS)
        throw new Error(`Đã đủ ${MAX_USER_PRESETS} profile nên không hoàn tác được; xóa bớt một profile rồi lưu lại.`);
      commit(()=>{
        if(token.builtin)data.hidden=data.hidden.filter(id=>id!==token.id);
        else if(token.preset&&!data.custom.some(preset=>preset.id===token.id))data.custom.splice(Math.min(token.index??data.custom.length,data.custom.length),0,token.preset);
        if(token.shortcut&&!Object.values(data.shortcuts).includes(token.shortcut))data.shortcuts[token.id]=token.shortcut;
      });
    },
    restoreDefaults(){
      sync();commit(()=>{
        data.hidden=[];
        for(const [id,keys]of Object.entries(DEFAULT_SHORTCUTS))if(!data.shortcuts[id]&&!Object.values(data.shortcuts).includes(keys))data.shortcuts[id]=keys;
      });
    },
    // Gán phím tắt (null để bỏ). Tổ hợp đang thuộc profile khác được chuyển sang profile này.
    setShortcut(id,keys){
      sync();if(!known(id)||data.hidden.includes(id))throw new Error('Không tìm thấy profile.');
      if(keys==null||keys==='')return commit(()=>{delete data.shortcuts[id];return null;});
      const value=normalizeShortcut(keys);
      return commit(()=>{
        for(const [other,current]of Object.entries(data.shortcuts))if(current===value&&other!==id)delete data.shortcuts[other];
        data.shortcuts[id]=value;return value;
      });
    },
    bindings(){return library.list().filter(preset=>preset.shortcut).map(preset=>({preset:preset.id,label:preset.label,keys:preset.shortcut}));},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
  };
  return library;
}
const defaultStorage=(()=>{try{return globalThis.localStorage??null;}catch{return null;}})();
export const presetLibrary=createPresetLibrary(defaultStorage);

// ---------- File profile RT: định dạng dễ đọc cho người và AI ----------
// Một profile = giá trị mặc định cho mọi phím + các phím khác mặc định, theo mm.
// Tên phím là tên trên sơ đồ (Shift/Ctrl trái-phải tách thành LShift/RShift, LCtrl/RCtrl);
// nhận thêm tên gọi khác thông dụng. Nhập file chỉ tạo profile trong thư viện cục bộ;
// ghi bàn phím vẫn phải qua bản nháp, preflight và đọc lại xác minh như mọi thay đổi.
export const RT_PROFILE_SCHEMA='a80rt-rt-profile/v1';
const KEY_ALIASES={Esc:['Escape'],Ins:['Insert'],Prt:['PrintScreen','Print','PrtSc'],'`':['Grave','Backquote','Tilde','~'],'−':['-'],'=':['Equal','Equals','Plus'],
  Backspace:['BS'],Del:['Delete'],Tab:[],'[':['BracketLeft','LeftBracket'],']':['BracketRight','RightBracket'],'\\':['Backslash'],PgUp:['PageUp'],Caps:['CapsLock'],
  ';':['Semicolon'],"'":['Quote','Apostrophe'],Enter:['Return'],PgDn:['PageDown'],',':['Comma'],'.':['Period','Dot'],'/':['Slash'],'↑':['ArrowUp'],End:[],
  Win:['LWin','Windows','Meta','Super'],Alt:['LAlt'],Space:['Spacebar'],Fn:[],'←':['ArrowLeft'],'↓':['ArrowDown'],'→':['ArrowRight']};
// Phím có ký tự Unicode dùng tên ASCII làm tên chuẩn (dễ gõ, AI ít nhầm); ký tự gốc vẫn được nhận.
const ASCII_NAMES={'−':'Minus','↑':'Up','↓':'Down','←':'Left','→':'Right'};
// Tên chuẩn cho từng vị trí, theo thứ tự sơ đồ.
export function rtKeyNames(){
  const seen={},names=[];
  for(const key of KEYS){
    let name=ASCII_NAMES[key.label]??key.label;
    if(name==='Shift'||name==='Ctrl'){seen[name]=(seen[name]??0)+1;name=(seen[name]===1?'L':'R')+name;}
    names.push({name,slot:key.slot,aliases:[...(KEY_ALIASES[key.label]??[]),...(ASCII_NAMES[key.label]?[key.label]:[]),...(key.label!==name?(seen[key.label]===1?[key.label,`Left${key.label}`,`Left ${key.label}`]:[`Right${key.label}`,`Right ${key.label}`]):[])]});
  }
  return names;
}
const KEY_INDEX=(()=>{const map=new Map();for(const entry of rtKeyNames())for(const alias of [entry.name,...entry.aliases]){const k=alias.toLowerCase();if(!map.has(k))map.set(k,entry.slot);}
  for(const key of KEYS)if(/^[A-Z0-9]$/.test(key.label)){map.set(`key${key.label.toLowerCase()}`,key.slot);if(/\d/.test(key.label))map.set(`digit${key.label}`,key.slot);}
  return map;})();
const slotForName=name=>{if(typeof name!=='string')return undefined;const m=/^slot\s*:?\s*(\d+)$/i.exec(name.trim());if(m)return Number(m[1]);return KEY_INDEX.get(name.trim().toLowerCase());};
const round2=value=>Math.round(value*100)/100;

// Đọc file (chuỗi JSON hoặc object). Trả về {label, preset, shortcut, warnings} hoặc ném lỗi rõ ràng.
export function parseRtProfile(input,capability){
  let data=input;
  if(typeof input==='string'){
    const text=input.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    try{data=JSON.parse(text);}catch{throw new Error('Không đọc được JSON. Dán đúng nội dung file profile (bắt đầu bằng { và kết thúc bằng }).');}
  }
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('File profile phải là một object JSON.');
  if(data.schema!==RT_PROFILE_SCHEMA)throw new Error(`Thiếu hoặc sai "schema": cần "${RT_PROFILE_SCHEMA}".`);
  const label=typeof data.name==='string'?data.name.trim().replace(/\s+/g,' '):'';
  if(!label)throw new Error('Thiếu "name" (tên profile).');
  const maxMm=Math.min(...Object.values(capability?.limits.switchTravelMm??{0:3.4}));
  const warnings=[];
  const frame=(value,where,base)=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${where}: cần một object như {"actuation":1.5}.`);
    for(const key of Object.keys(value))if(!['actuation','rtPress','rtRelease','wholeTravel'].includes(key))warnings.push(`${where}: bỏ qua trường lạ "${key}".`);
    const mm=(field,min)=>{const raw=value[field]??base?.[field];if(raw===undefined)return undefined;
      if(typeof raw!=='number'||!Number.isFinite(raw))throw new Error(`${where}.${field}: cần một số (mm).`);
      const v=round2(raw);if(v<min||v>maxMm)throw new Error(`${where}.${field} = ${raw}: cần trong khoảng ${min}–${maxMm} mm.`);return v;};
    const actuation=mm('actuation',0),rtPress=mm('rtPress',0),rtRelease=mm('rtRelease',0);
    if(value.wholeTravel!==undefined&&typeof value.wholeTravel!=='boolean')throw new Error(`${where}.wholeTravel: cần true hoặc false.`);
    return {actuationMm:actuation??1.5,pressMm:rtPress??0,releaseMm:rtRelease??0,whole:(value.wholeTravel??base?.wholeTravel)===true};
  };
  const defaults=data.default??{actuation:1.5};
  const rest=frame(defaults,'default');
  const keys=[],used=new Set();
  if(data.keys!==undefined&&(typeof data.keys!=='object'||Array.isArray(data.keys)))throw new Error('"keys" phải là object, ví dụ {"W":{"actuation":0.4}}.');
  for(const [name,value]of Object.entries(data.keys??{})){
    const slot=slotForName(name);
    if(slot===undefined||!capability.slots.includes(slot))throw new Error(`Không biết phím "${name}". Dùng tên như W, Space, LShift, LCtrl, F1, Esc.`);
    if(used.has(slot))throw new Error(`Phím "${name}" bị khai báo hai lần.`);used.add(slot);
    keys.push({slot,...frame(value,`keys.${name}`,defaults)});
  }
  const preset={id:'u-import',group:'user',label,rest,keys};
  if(data.deadZone!==undefined){
    const zone=data.deadZone;if(!zone||typeof zone!=='object')throw new Error('"deadZone" cần dạng {"top":0.1,"bottom":0.1} (mm).');
    const raw=(field)=>{const v=zone[field];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>0.5)throw new Error(`deadZone.${field}: cần số từ 0 đến 0.5 mm.`);return Math.round(v*100);};
    preset.deadZone={top:raw('top'),bottom:raw('bottom')};
  }
  let shortcut=null;
  if(data.shortcut!=null&&data.shortcut!==''){try{shortcut=normalizeShortcut(data.shortcut);}catch(problem){warnings.push(`Bỏ qua phím tắt: ${problem.message}`);}}
  return {label,preset,shortcut,warnings};
}

// Xuất profile (cài sẵn hoặc của bạn) ra object gọn: mặc định + các phím khác mặc định.
export function exportRtProfile(preset,capability){
  const names=rtKeyNames(),pick=frame=>({actuation:frame.actuationMm,rtPress:frame.pressMm,rtRelease:frame.releaseMm,wholeTravel:frame.whole===true});
  const rest=preset.rest,keys={};
  for(const {name,slot}of names){
    if(!capability.slots.includes(slot))continue;
    const target=preset.keys.find(entry=>entry.slot===slot)??rest;
    if(target.actuationMm!==rest.actuationMm||target.pressMm!==rest.pressMm||target.releaseMm!==rest.releaseMm||(target.whole===true)!==(rest.whole===true))keys[name]=pick(target);
  }
  const out={schema:RT_PROFILE_SCHEMA,name:preset.label,default:pick(rest),keys};
  if(preset.deadZone)out.deadZone={top:preset.deadZone.top/100,bottom:preset.deadZone.bottom/100};
  if(preset.shortcut)out.shortcut=preset.shortcut;
  return out;
}

// Hướng dẫn chép cho AI: định dạng, tên phím, giới hạn và một ví dụ. Viết bằng tiếng Anh
// để mọi AI hiểu; trả lời là một khối JSON dán thẳng vào app.
export function rtProfileAiGuide(capability,current=null){
  const maxMm=Math.min(...Object.values(capability?.limits.switchTravelMm??{0:3.4}));
  const example={schema:RT_PROFILE_SCHEMA,name:'Valorant',shortcut:'Ctrl+Alt+3',default:{actuation:1.5,rtPress:0,rtRelease:0,wholeTravel:false},
    keys:{W:{actuation:0.5,rtPress:0.15,rtRelease:0.15,wholeTravel:true},A:{actuation:0.5,rtPress:0.15,rtRelease:0.15,wholeTravel:true},S:{actuation:0.5,rtPress:0.15,rtRelease:0.15,wholeTravel:true},D:{actuation:0.5,rtPress:0.15,rtRelease:0.15,wholeTravel:true},LCtrl:{actuation:0.8},Space:{actuation:1.0}},
    deadZone:{top:0.05,bottom:0.1}};
  return [
    'You are helping me create a Rapid Trigger profile for my LEOBOG A80RT magnetic (Hall effect) keyboard.',
    'Reply with ONE JSON object only (no prose), in exactly this format:',
    '',JSON.stringify(example,null,2),'',
    'Rules:',
    `- "schema" must be "${RT_PROFILE_SCHEMA}". "name": up to 32 characters.`,
    `- All distances are millimetres with at most 2 decimals. actuation: 0.01–${maxMm} (lower = more sensitive). rtPress / rtRelease: 0–${maxMm}; 0 turns Rapid Trigger off for that key.`,
    '- wholeTravel: true keeps Rapid Trigger active over the whole key travel; false activates it only after the actuation point.',
    '- "default" applies to every key; list in "keys" only keys that differ. Unlisted fields of a key inherit "default".',
    '- deadZone (optional): top/bottom dead zones for the whole keyboard, 0–0.5 mm.',
    '- shortcut (optional): Ctrl, Alt or Win plus A–Z, 0–9 or F1–F24, e.g. "Ctrl+Alt+3".',
    '- Avoid actuation below ~0.3 mm on keys you rest your fingers on, or they trigger by accident.',
    '',`Key names: ${rtKeyNames().filter(entry=>capability.slots.includes(entry.slot)).map(entry=>entry.name).join(' ')}`,
    ...(current?['','My current profile, for reference:',JSON.stringify(current,null,2)]:[]),
    '','What I want: <describe your game, play style and keys here>',
  ].join('\n');
}
