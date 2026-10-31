import {readPlan} from '../device/capabilities.js';
import {decodeBlock} from './codecs.js';

// Chế độ RT cài sẵn. Mọi giá trị lưu theo mm.
//
// Nhóm "vendor": driver LEOBOG cho A80RT / A80RT U / Dongle, bundle
// static/js/app.3086f769.js (SHA256 924907c8…), customInfo:x.getDefault().
// Đơn vị nguồn: triggerVal 0,1 mm (getUpdateAction: action_point=triggerVal/10),
// dowValue/releaseValue 0,01 mm (getSenRt ghi thẳng downstroke/upstroke).
// `rest` áp cho mọi phím, `keys` ghi đè theo slot (W34 A49 S50 D51 Ctrl80 Space83).
// Chỉ "Văn phòng" gọi handleZone(defaValue) nên chỉ chế độ đó đặt vùng chết 0/0.
//
// Nhóm "game": profile do app đề xuất (không phải dữ liệu hãng), chỉ là điểm
// khởi đầu; người dùng chỉnh tiếp như mọi bản nháp.
//
// Driver hãng còn ghi lại switch ID và xóa bit bottom/rtMode; app giữ nguyên các
// trường đó vì chưa có bộ chỉnh được chứng minh cho model này.
const SLOT={Esc:0,1:17,2:18,3:19,4:20,5:21,6:22,Tab:32,Q:33,W:34,E:35,R:36,T:37,Caps:48,A:49,S:50,D:51,F:52,G:53,
  LShift:64,Z:65,X:66,C:67,V:68,B:69,LCtrl:80,LAlt:82,Space:83};
const at=(names,actuationMm,rtMm=0,whole=false)=>names.map(name=>({slot:SLOT[name],actuationMm,pressMm:rtMm,releaseMm:rtMm,whole}));
const vendorFrame=actuationMm=>({actuationMm,pressMm:0,releaseMm:0,whole:false});

export const RT_PRESETS=Object.freeze([
  {id:'office',group:'vendor',label:'Văn phòng',description:'Mọi phím 2,0 mm, Space 3,0 mm, tắt RT; vùng chết trên/dưới về 0.',
    rest:vendorFrame(2),keys:at(['Space'],3),deadZone:{top:0,bottom:0}},
  {id:'beginner',group:'vendor',label:'Người mới',description:'Mọi phím 1,5 mm, Space 3,0 mm; W A S D và Ctrl trái 1,0 mm với RT 0,56 mm.',
    rest:vendorFrame(1.5),keys:[...at(['Space'],3),...at(['W','A','S','D','LCtrl'],1,0.56)]},
  {id:'game',group:'vendor',label:'Chơi game',description:'Mọi phím 1,5 mm, Space 3,0 mm; W A S D và Ctrl trái 0,5 mm, RT 0,16 mm, bật RT toàn hành trình.',
    rest:vendorFrame(1.5),keys:[...at(['Space'],3),...at(['W','A','S','D','LCtrl'],0.5,0.16,true)]},
  // LoL: ưu tiên chống bấm nhầm khi đặt tay sẵn trên phím kỹ năng; RT tắt vì
  // MOBA không cần nhả-bấm lại liên tục. QWER/DF nhạy hơn một chút để tung chiêu.
  {id:'lol',group:'game',label:'LoL',shortcut:'Ctrl+Alt+1',description:'Mọi phím 1,5 mm. Q W E R, D F 1,0 mm; 1–6, B, Tab 1,4 mm; Space 1,8 mm. Tắt RT để tránh kích hoạt nhầm.',
    rest:vendorFrame(1.5),keys:[...at(['Q','W','E','R','D','F'],1),...at(['1','2','3','4','5','6','B','Tab'],1.4),...at(['Space'],1.8)]},
  // Apex: di chuyển cần dừng/đổi hướng tức thì, nên W A S D nông và RT toàn
  // hành trình; nhảy/ngồi/chạy nhạy vừa; phím kỹ năng giữ sâu hơn để tránh nhầm.
  {id:'apex',group:'game',label:'Apex',shortcut:'Ctrl+Alt+2',description:'W A S D 0,4 mm, RT 0,15 mm, RT toàn hành trình. Space 0,8 mm, Ctrl trái/C 0,6 mm RT 0,2 mm, Shift 0,8 mm. Q Z E R G Tab 1,2 mm; còn lại 1,5 mm.',
    rest:vendorFrame(1.5),keys:[...at(['W','A','S','D'],0.4,0.15,true),...at(['Space','LShift'],0.8),...at(['LCtrl','C'],0.6,0.2),...at(['Q','Z','E','R','G','Tab'],1.2)]},
].map(preset=>Object.freeze(preset)));

export const presetById=id=>{const preset=RT_PRESETS.find(item=>item.id===id);if(!preset)throw new Error(`Chế độ cài sẵn không tồn tại: ${id}`);return preset;};
const targetFor=(preset,slot)=>{const {actuationMm,pressMm,releaseMm,whole}=preset.keys.find(entry=>entry.slot===slot)??preset.rest;return {actuationMm,pressMm,releaseMm,whole};};

// Trả về nhóm sửa cho một transaction duy nhất; chỉ chứa trường model cho sửa.
export function presetEdits(capability,id){
  const preset=presetById(id),fields=capability.fields.rt,rt=[];
  for(const slot of capability.slots)for(const [field,value]of Object.entries(targetFor(preset,slot)))if(fields[field]===true)rt.push({slot,field,value});
  const groups={rt};
  if(preset.deadZone){const settings=[];
    if(capability.settings.topDeadZone)settings.push({field:'topDeadZone',value:preset.deadZone.top});
    if(capability.settings.bottomDeadZone)settings.push({field:'bottomDeadZone',value:preset.deadZone.bottom});
    if(settings.length)groups.settings=settings;}
  return groups;
}

// Chế độ đang khớp bản nháp, hoặc null nếu là cấu hình tùy chỉnh.
export function matchingPreset(capability,blocks){
  if(!blocks?.rt||!readPlan(capability).some(block=>block.id==='rt'))return null;
  const records=decodeBlock('rt',blocks.rt,capability).records,settings=blocks.settings?decodeBlock('settings',blocks.settings,capability).fields:null;
  const near=(a,b)=>Math.abs(a-b)<1e-9;
  return RT_PRESETS.find(preset=>capability.slots.every(slot=>{const target=targetFor(preset,slot),record=records[slot];
      return record&&near(record.actuationMm,target.actuationMm)&&near(record.pressMm,target.pressMm)&&near(record.releaseMm,target.releaseMm)&&(!capability.fields.rt.whole||record.whole===target.whole);})
    &&(!preset.deadZone||!settings||(settings.topDeadZone===preset.deadZone.top&&settings.bottomDeadZone===preset.deadZone.bottom)))?.id??null;
}
