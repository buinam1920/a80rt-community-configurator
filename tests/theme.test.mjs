import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeSettings,inkFor,dominantAccent,SWATCHES,LOGO_PATH,faviconSvg} from '../dist/ui/theme.js';

test('theme settings are clamped and fall back to defaults',()=>{
  assert.deepEqual(normalizeSettings(null),{accent:'#c3f56b',scrim:60,blur:0,panel:88,paused:false,focus:'center'});
  assert.deepEqual(normalizeSettings({accent:'#FF8FC7',scrim:200,blur:-4,panel:10,paused:'yes',focus:'sideways'}),{accent:'#ff8fc7',scrim:90,blur:0,panel:60,paused:false,focus:'center'});
  assert.equal(normalizeSettings({accent:'red'}).accent,'#c3f56b','only #rrggbb is accepted');
  assert.equal(normalizeSettings({scrim:'35.6',focus:'top',paused:true}).scrim,36);
});

test('text on the accent keeps readable contrast for light and dark accents',()=>{
  const lum=hex=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
  const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
  for(const [color]of SWATCHES)assert.ok(ratio(color,inkFor(color))>=4.5,color);
  assert.equal(inkFor('#2a1a6e'),'#ffffff','dark accents get white text');
});

test('the picked accent follows the most vivid color, not the dark background',()=>{
  const pixels=[];
  for(let i=0;i<80;i++)pixels.push(18,20,30,255);// dark navy background
  for(let i=0;i<20;i++)pixels.push(250,120,190,255);// pink highlights
  const accent=dominantAccent(new Uint8ClampedArray(pixels));
  const [r,g,b]=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16));
  assert.ok(r>b&&b>g,`pink-ish accent, got ${accent}`);
  assert.equal(dominantAccent(new Uint8ClampedArray([128,128,128,255,30,30,30,255])),null,'grey images keep the current accent');
});

test('accent-derived colors in the stylesheet come from --accent tokens',()=>{
  // Token defaults (--accent:…, --accent-ink:…) are the one place a literal belongs.
  const css=fs.readFileSync(new URL('../dist/styles.css',import.meta.url),'utf8').replace(/--accent(-ink)?:#[0-9a-f]{6}/gi,'');
  for(const hex of ['#d5ff8c','#19270a','#252f23','#36472c','#8ebc44','#a2c97b'])assert.ok(!css.toLowerCase().includes(hex),hex);
  assert.match(css,/--accent-soft:color-mix\(in srgb,var\(--accent\)/);
});

test('the logo follows the accent: tab icon colours and one shared shape',()=>{
  const svg=faviconSvg('#7cc8ff');
  assert.match(svg,/fill='#7cc8ff'/);assert.match(svg,new RegExp(`fill='${inkFor('#7cc8ff')}'`));
  const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.ok(html.includes(`d="${LOGO_PATH}"`),'sidebar logo uses the same path');
  const native=fs.readFileSync(new URL('../scripts/native/NativeShell.cs',import.meta.url),'utf8');
  assert.match(native,/Outer = \{ 11\.1f, 3f, 12\.9f, 3f, 21\.4f, 20\.8f, 2\.6f, 20\.8f \}/,'exe draws the same outline');
});

test('the exe and the Python bridge both accept the accent colour',()=>{
  const exe=fs.readFileSync(new URL('../scripts/build-exe.mjs',import.meta.url),'utf8'),py=fs.readFileSync(new URL('../scripts/a80rt_local.py',import.meta.url),'utf8');
  assert.match(exe,/path == "\/hotkeys\/accent"/);assert.match(exe,/AccentIcon\.LoadSaved\(\)/);
  assert.match(py,/'\/hotkeys\/accent'/);
});

test('Start with Windows is a toggle in the exe only, off until the user ticks it',()=>{
  const exe=fs.readFileSync(new URL('../scripts/build-exe.mjs',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const py=fs.readFileSync(new URL('../scripts/a80rt_local.py',import.meta.url),'utf8');
  assert.match(html,/<label id="autostart-row"[^>]*hidden>/,'hidden until the exe reports the setting');
  assert.match(exe,/body\["autostart"\] = AutoStartEnabled\(\)/);
  assert.match(exe,/path == "\/hotkeys\/autostart"/);
  assert.doesNotMatch(exe,/SetAutoStart\(true\)/,'nothing turns startup on by itself');
  assert.ok(!py.includes("'autostart'"),'the browser bridge never offers the toggle');
  assert.match(app,/typeof hotkeyBridge\?\.autostart==='boolean'/);
});
