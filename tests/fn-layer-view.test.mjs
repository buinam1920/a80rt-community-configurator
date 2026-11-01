import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyDevice} from '../dist/device/capabilities.js';
import {decodeBlock} from '../dist/config/codecs.js';
import {KEYS} from '../dist/layout.js';
import {fnKeyCap} from '../dist/ui/core-editors.js';

const cap=identifyDevice({vendorId:0x0c45,productId:0x80a1,productName:'A80RT U'});
// Manufacturer default Fn layer as read from an A80RT U (firmware 1.37), a few keys only.
const DEFAULT_FN={Esc:[13,0,0,1],F1:[3,35,2,0],F2:[3,138,1,0],F3:[13,0,0,18],F8:[3,205,0,0],'1':[13,0,0,2],'`':[13,0,0,5],
  Tab:[13,0,0,12],Q:[13,0,0,10],W:[13,0,0,8],R:[13,0,0,58],U:[2,0,70,0],I:[2,0,71,0],Del:[2,0,74,0],B:[13,0,0,7],Win:[13,0,0,22],
  '↑':[13,0,0,13],'→':[13,0,0,15],Fn:[2,0,175,0],A:[2,0,4,0],Alt:[2,4,0,0],Ctrl:[2,1,0,0]};
const fnBlock=()=>{const bytes=new Uint8Array(512);for(const [label,value]of Object.entries(DEFAULT_FN)){const key=KEYS.find(k=>k.label===label);bytes.set(value,key.slot*4);}return bytes;};

test('Fn layer key caps name functions and media like the manufacturer driver',()=>{
  const records=decodeBlock('fn',fnBlock(),cap).records;
  const capFor=label=>{const key=KEYS.find(k=>k.label===label);return fnKeyCap(records[key.slot].binding,key,cap);};
  const expect={Esc:['Reset gốc','Khôi phục cài đặt gốc',true],F1:['Home','Trang chủ',true],F2:['Email','Email',true],F3:['Alt+Tab','ALT + TAB',true],
    F8:['Play / Pause','Phát / Tạm dừng',true],'1':['BT 1','Bluetooth 1',true],'`':['Nối lại','Kết nối lại không dây',true],Tab:['Màu đèn','Đổi màu đèn',true],
    Q:['Android','ANDROID',true],W:['WIN','WIN',true],B:['Xem pin','Xem pin',true],Win:['Khóa Win','Khóa Win',true],'↑':['Sáng +','Tăng độ sáng',true],'→':['Tốc độ +','Tăng tốc độ đèn',true]};
  for(const [label,[short,full,special]]of Object.entries(expect)){const value=capFor(label);assert.deepEqual([value.short,value.full,value.special],[short,full,special],label);}
  assert.deepEqual(capFor('U'),{short:'Print',full:'Print',special:false,remapped:true},'Fn+U sends PrintScreen');
  assert.equal(capFor('I').short,'Scroll');assert.equal(capFor('Del').short,'Home');
  assert.equal(capFor('A').remapped,false,'a key that sends itself is not marked');assert.equal(capFor('Alt').short,'Alt');assert.equal(capFor('Alt').remapped,false);
  assert.equal(capFor('Ctrl').remapped,false);assert.equal(capFor('Fn').short,'Fn');
  assert.deepEqual(capFor('R'),{short:'R',full:'R',special:false},'unknown function codes keep the key label');
  assert.equal(fnKeyCap(undefined,KEYS[0],cap),null);
});

test('mouse, macro and empty Fn bindings get readable labels',()=>{
  const key=KEYS.find(k=>k.label==='J');
  assert.deepEqual(fnKeyCap({type:'empty'},key,cap),{short:'J',full:'Trống',special:false,empty:true},'an empty Fn slot keeps the key label, dimmed');
  assert.equal(fnKeyCap({type:'macro',index:0},key,cap).short,'Macro');
  assert.equal(fnKeyCap({type:'mouse',mouseCode:1,code:1},key,cap).short,'Chuột');
  assert.equal(fnKeyCap({type:'keyboard',usage:6,modifier:1},key,cap).short,'Ctrl+C');
});
