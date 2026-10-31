import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;

test('installable manifest points at existing icons and stays inside the app scope',()=>{
  const html=read('index.html'),manifest=JSON.parse(read('manifest.json'));
  assert.ok(html.includes('<link rel="manifest" href="./manifest.json">'));
  assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
  for(const size of ['192x192','512x512'])assert.ok(manifest.icons.some(icon=>icon.sizes===size&&icon.purpose==='any'),size);
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
  for(const icon of manifest.icons){
    const bytes=fs.readFileSync(path.join(root,icon.src));
    assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10],icon.src);
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes,icon.src);
  }
});

test('service worker precaches exactly the release asset set of this version',()=>{
  const sw=read('service-worker.js'),html=read('index.html');
  assert.equal(sw.match(/const VERSION='([^']+)'/)[1],release);
  const modules=JSON.parse(sw.match(/const MODULES=(\[[^\]]*\])/)[1].replaceAll("'",'"'));
  const map=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.deepEqual(modules.map(file=>`./${file}`).sort(),Object.keys(map).sort(),'offline cache must cover every import-map module');
  for(const [key,value]of Object.entries(map))assert.equal(value,`${key}?v=${release}`);
  for(const file of modules)assert.ok(fs.existsSync(path.join(root,file)),file);
  for(const literal of ['./manifest.json','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./index.html'])assert.ok(sw.includes(`'${literal}'`),literal);
  assert.ok(sw.includes('`./styles.css${V}`'));
});

test('service worker is network-first, same-origin GET only, and never touches device or profile storage',()=>{
  const sw=read('service-worker.js');
  assert.match(sw,/respondWith\(fetch\(request,\{cache:'no-cache'\}\)\.catch/);
  assert.match(sw,/new Request\(url,\{cache:'reload'\}\)/);
  assert.match(sw,/request\.method!=='GET'/);
  assert.match(sw,/origin!==self\.location\.origin/);
  assert.doesNotMatch(sw,/cache\.put|indexedDB|navigator\.hid|postMessage/);
  const app=read('app.js');
  assert.match(app,/navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)/);
  assert.match(app,/'serviceWorker' in navigator&&window\.isSecureContext/);
});
