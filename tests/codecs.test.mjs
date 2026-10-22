import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {identifyDevice,readPlan} from '../dist/device/capabilities.js';
import {decodeBlock,patchBlock} from '../dist/config/codecs.js';
const cap=()=>identifyDevice({vendorId:0x0c45,productId:0xfefc,productName:'A80RT U Dongle'});
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic/config-blocks.json',import.meta.url)));
const raw=id=>Uint8Array.from(fixture.blocks[id]);
const diff=(a,b)=>Array.from(a.keys()).filter(i=>a[i]!==b[i]);

test('RT W slot34 threshold80 is0.8mm;1.2mm patch owns only LE16 threshold bytes',()=>{
  const bytes=raw('rt'),original=bytes.slice();
  assert.equal(decodeBlock('rt',bytes,cap()).records[34].actuationMm,0.8);
  const result=patchBlock('rt',bytes,[{slot:34,field:'actuationMm',value:1.2}],cap());
  assert.equal(result.bytes[34*8+2],120);
  assert.equal(result.bytes[34*8+3],0);
  assert.deepEqual(diff(bytes,result.bytes),[34*8+2]);
  assert.deepEqual(result.changes,[{offset:274,before:80,after:120}]);
  assert.deepEqual(bytes,original);
  assert.notEqual(result.bytes,bytes);
});

test('all source blocks round-trip exact bytes; no defaults for raw zero',()=>{
  for(const {id} of readPlan(cap())){
    const bytes=raw(id),decoded=decodeBlock(id,bytes,cap());
    assert.deepEqual(decoded.bytes,bytes,id);
    assert.deepEqual(patchBlock(id,bytes,[],cap()).bytes,bytes,id);
    assert.notEqual(decoded.bytes,bytes);
  }
  const zeros=new Uint8Array(1024),decoded=decodeBlock('rt',zeros,cap());
  assert.equal(decoded.records[34].actuationMm,0);
  assert.equal(decoded.records[34].switchId,0);
  const led=decodeBlock('lighting',new Uint8Array(16),cap());
  assert.equal(led.fields.brightness,0);
  assert.equal(led.fields.speed,0);
});

test('physical slot addressing retains Backspace92, PgDn108, reserved flag bits and unused records',()=>{
  const bytes=raw('rt');
  const result=patchBlock('rt',bytes,[{slot:92,field:'whole',value:true},{slot:108,field:'releaseMm',value:0.12}],cap());
  assert.equal(result.bytes[92*8+1],bytes[92*8+1]|1);
  assert.equal(result.bytes[92*8+1]&248,bytes[92*8+1]&248);
  assert.deepEqual(diff(bytes,result.bytes),[737,870]);
  assert.deepEqual(result.bytes.slice(126*8),bytes.slice(126*8));
});

test('capability validation rejects hidden polling and unsupported fields by name',()=>{
  for(const [id,edit,pattern] of [
    ['settings',{field:'polling',value:6},/polling/],
    ['rt',{slot:34,field:'magicMode',value:7},/magicMode/],
    ['rt',{slot:15,field:'actuationMm',value:1},/slot/],
    ['rt',{slot:34,field:'actuationMm',value:3.41},/actuationMm/],
    ['rt',{slot:34,field:'pressMm',value:0.001},/pressMm/],
    ['lighting',{field:'brightness',value:6},/brightness/],
    ['settings',{field:'osMode',value:1},/osMode/],
    ['macro',{field:'capacity',value:4096},/capacity/],
    ['keymap',{slot:34,field:'binding',value:{type:'function',code:23}},/function/],
  ])assert.throws(()=>patchBlock(id,raw(id),[edit],cap()),pattern);
  for(const invalid of [new Uint8Array(8),[1,NaN],Array(1024).fill(256)])assert.throws(()=>decodeBlock('rt',invalid,cap()),/raw|length/);
  assert.throws(()=>patchBlock('rt',raw('rt'),[{slot:34,field:'whole',value:1}],cap()),/whole/);
  assert.throws(()=>patchBlock('settings',raw('settings'),[{field:'stability',value:2}],cap()),/stability/);
});

test('wired settings and lighting patch only named bytes; zeros and reserved markers survive',()=>{
  const wired=identifyDevice({vendorId:0x0c45,productId:0x80a1,productName:'A80RT U'});
  const settings=raw('settings'),led=raw('lighting');
  assert.deepEqual(diff(settings,patchBlock('settings',settings,[{field:'polling',value:6}],wired).bytes),[5]);
  const result=patchBlock('lighting',led,[{field:'red',value:201},{field:'brightness',value:4}],cap());
  assert.deepEqual(diff(led,result.bytes),[1,9]);
  for(const i of [4,13,14,15])assert.equal(result.bytes[i],led[i]);
});

test('Dongle sleep duration uses source minutes1..30 and zero disables it',()=>{
  const bytes=raw('settings');
  for(const minutes of [0,1,30])assert.equal(patchBlock('settings',bytes,[{field:'sleep',value:minutes}],cap()).bytes[3],minutes);
  for(const minutes of [-1,31,0.5])assert.throws(()=>patchBlock('settings',bytes,[{field:'sleep',value:minutes}],cap()),/sleep/);
});

test('RGB preserves marker and neighbors; key remap preserves fourth byte and Fn independence',()=>{
  const colors=raw('colors');
  const rgb=patchBlock('colors',colors,[{slot:34,field:'rgb',value:{red:1,green:2,blue:3}}],cap());
  assert.deepEqual(diff(colors,rgb.bytes),[137,138,139]);
  assert.equal(rgb.bytes[136],colors[136]);
  const keys=raw('keymap');
  const binding=patchBlock('keymap',keys,[{slot:92,field:'binding',value:{type:'keyboard',usage:26}}],cap());
  assert.deepEqual(Array.from(binding.bytes.slice(368,372)),[2,0,26,keys[371]]);
  assert.equal(decodeBlock('keymap',binding.bytes,cap()).records[92].binding.usage,26);
  assert.deepEqual(raw('fn'),Uint8Array.from(fixture.blocks.fn));
  assert.throws(()=>patchBlock('keymap',keys,[{slot:34,field:'binding',value:{type:'keyboard',usage:26,modifier:2}}],cap()),/modifier/);
});

test('switch travel limits apply to completed patch; no mutation on late validation failure',()=>{
  const bytes=raw('rt'),before=bytes.slice();
  assert.throws(()=>patchBlock('rt',bytes,[{slot:34,field:'switchId',value:2},{slot:34,field:'actuationMm',value:3.4}],cap()),/actuationMm/);
  assert.deepEqual(bytes,before);
  assert.deepEqual(patchBlock('rt',bytes,[{slot:34,field:'switchId',value:2},{slot:34,field:'actuationMm',value:3.3}],cap()).bytes.slice(272,276),Uint8Array.of(2,168,74,1));
});

test('Fn layer handles keyboard modifiers, mouse wheel, media and verified function codes',()=>{
  for(const [value,expected] of [
    [{type:'keyboard',modifier:225},[2,225,0]],
    [{type:'mouse',mouseCode:3,code:255},[1,3,255]],
    [{type:'media',usage:404},[3,148,1]],
    [{type:'function',code:22},[13,0,0,22]],
  ]){
    const bytes=raw('fn'),result=patchBlock('fn',bytes,[{slot:34,field:'binding',value}],cap());
    assert.deepEqual(Array.from(result.bytes.slice(136,136+expected.length)),expected);
    assert.equal(decodeBlock('fn',result.bytes,cap()).records[34].binding.type,value.type);
    assert.ok(diff(bytes,result.bytes).every(i=>i>=136&&i<=139));
  }
  for(const value of [{type:'keyboard',usage:255},{type:'keyboard',modifier:1},{type:'media',usage:65535},{type:'mouse',mouseCode:3,code:8},{type:'__proto__'}]){
    assert.throws(()=>patchBlock('fn',raw('fn'),[{slot:34,field:'binding',value}],cap()),/binding/);
  }
});

test('unknown RT switch or invalid untouched distance does not block a known flag edit',()=>{
  const bytes=raw('rt');bytes[272]=240;bytes[274]=255;bytes[275]=255;
  const result=patchBlock('rt',bytes,[{slot:34,field:'bottom',value:true}],cap());
  assert.deepEqual(diff(bytes,result.bytes),[273]);
  assert.equal(result.bytes[272],240);
  assert.throws(()=>patchBlock('rt',bytes,[{slot:34,field:'pressMm',value:0.1}],cap()),/switchId/);
});

test('byte whitelist holds for every physical RT slot and every possible reserved flag byte',()=>{
  const capability=cap();
  for(const slot of capability.slots){
    const bytes=new Uint8Array(1024);bytes[slot*8]=1;
    for(let flags=0;flags<256;flags++){
      bytes[slot*8+1]=flags;
      const result=patchBlock('rt',bytes,[{slot,field:'rtMode',value:!(flags&4)}],capability);
      assert.deepEqual(diff(bytes,result.bytes),[slot*8+1]);
      assert.equal(result.bytes[slot*8+1],flags^4);
      assert.equal(bytes[slot*8+1],flags);
    }
  }
});

test('rejects sparse/incomplete byte arrays and unknown edit properties without mutation',()=>{
  const bytes=raw('lighting'),copy=bytes.slice();
  assert.throws(()=>patchBlock('lighting',bytes,[{field:'red',value:1},{field:'blue',value:-1}],cap()),/blue/);
  assert.deepEqual(bytes,copy);
  assert.throws(()=>decodeBlock('rt',new Array(1024),cap()),/raw/);
  assert.throws(()=>patchBlock('lighting',bytes,[{field:'red',value:1,offset:14}],cap()),/offset/);
  assert.throws(()=>patchBlock('lighting',bytes,[{field:'red',value:1,slot:34}],cap()),/slot/);
  const view=new DataView(Uint8Array.from([255,...bytes,255]).buffer,1,16);
  assert.deepEqual(decodeBlock('lighting',view,cap()).bytes,bytes);
  assert.deepEqual(patchBlock('lighting',bytes,[{field:'red',value:bytes[1]}],cap()).changes,[]);
});

test('facts reference bounded independent source fixtures; synthetic data is explicitly separate',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('./fixtures/source/a80rt-manufacturer.json',import.meta.url)));
  const facts=JSON.parse(fs.readFileSync(new URL('../dist/device/protocol-facts.json',import.meta.url)));
  assert.equal(source.hardwareCapture,false);assert.equal(fixture.hardwareCapture,false);
  for(const s of source.snippets){assert.ok(s.offset>=0,s.id);assert.ok(s.length>0&&s.length<15000,s.id);assert.equal(s.text.length,s.length);assert.equal(crypto.createHash('sha256').update(s.text).digest('hex'),s.sha256);}
  const byId=Object.fromEntries(source.snippets.map(s=>[s.id,s.text]));
  assert.match(byId['rt-encode'],/RTlist\[8\*e\[a\]\.value\+2\]=10\*i/);
  assert.match(byId['macro-encode'],/new Array\(400\)/);
  assert.match(byId['macro-encode'],/\?144:16/);
  assert.match(byId['layout'],/value:92/);
  assert.match(byId['layout'],/value:108/);
  assert.match(byId['function-table'],/value:22,type:1/);
  assert.match(byId['dks-encode'],/o\[5\]=this.modeType.list\[0\].value/);
  assert.match(byId['macro-timestamps'],/Math.floor\(e.timeStamp\)/);
  assert.match(byId['sleep-slider'],/min:1,max:d.maxTime/);
  assert.match(byId['sleep-slider'],/e.value\)\+\"min\"/);
  const capability=cap();
  const values=text=>[...new Set([...text.matchAll(/value:(\d+)/g)].map(match=>+match[1]))];
  assert.deepEqual(capability.limits.keyboardUsages,[0,...values(byId['keyboard-tables']).filter(value=>value<224).sort((a,b)=>a-b)]);
  assert.deepEqual(capability.limits.modifierUsages,[0,...values(byId['modifier-table']).sort((a,b)=>a-b)]);
  assert.deepEqual(capability.limits.mediaUsages,[...byId['special-key-table'].matchAll(/value:(\d+),medium:1/g)].map(match=>+match[1]));
  assert.deepEqual(capability.limits.functionCodes,values(byId['function-table']));
  for(const {id,command,length} of readPlan(cap()))assert.deepEqual([command,length],[facts.blocks[id].command,facts.blocks[id].length]);
});
