import {readPlan} from '../device/capabilities.js';
import {decodeBlock} from './codecs.js';

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

export const presetById=id=>{const preset=RT_PRESETS.find(item=>item.id===id);if(!preset)throw new Error(`Unknown preset: ${id}`);return preset;};
const targetFor=(preset,slot)=>{const {actuationMm,pressMm,releaseMm,whole}=preset.keys.find(entry=>entry.slot===slot)??preset.rest;return {actuationMm,pressMm,releaseMm,whole};};

// Return edit groups for one transaction, including only model-editable fields.
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

// Return the preset matching the draft, or null for a custom configuration.
export function matchingPreset(capability,blocks){
  if(!blocks?.rt||!readPlan(capability).some(block=>block.id==='rt'))return null;
  const records=decodeBlock('rt',blocks.rt,capability).records,settings=blocks.settings?decodeBlock('settings',blocks.settings,capability).fields:null;
  const near=(a,b)=>Math.abs(a-b)<1e-9;
  return RT_PRESETS.find(preset=>capability.slots.every(slot=>{const target=targetFor(preset,slot),record=records[slot];
      return record&&near(record.actuationMm,target.actuationMm)&&near(record.pressMm,target.pressMm)&&near(record.releaseMm,target.releaseMm)&&(!capability.fields.rt.whole||record.whole===target.whole);})
    &&(!preset.deadZone||!settings||(settings.topDeadZone===preset.deadZone.top&&settings.bottomDeadZone===preset.deadZone.bottom)))?.id??null;
}
