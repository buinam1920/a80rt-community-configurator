import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('release import map resolves every cyclic module edge to one versioned identity while Node imports stay canonical',async()=>{
  const root=fileURLToPath(new URL('../dist/',import.meta.url)),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const mapText=html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(mapText,'a complete release import map must precede entry execution');
  const map=JSON.parse(mapText[1]).imports,base=new URL('https://example.test/prefix/'),release=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;
  const mappings=new Map(Object.entries(map).map(([key,value])=>[new URL(key,base).href,new URL(value,base).href]));
  const files=fs.readdirSync(root,{recursive:true}).filter(file=>file.endsWith('.js')).map(file=>file.replaceAll('\\','/'));
  const targets=new Set();
  for(const file of files){
    const canonical=new URL(file,base).href,target=mappings.get(canonical);assert.ok(target,`cache coverage: ${file}`);assert.equal(target,`${canonical}?v=${release}`);targets.add(target);
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const match of source.matchAll(/\b(?:from\s*|import\s*[(]?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)){
      const specifier=match[1];assert.ok(!specifier.includes('?'),'Node source imports stay unversioned');
      const dependency=new URL(specifier,target).href;
      assert.equal(mappings.get(dependency),`${dependency}?v=${release}`,`${file} -> ${specifier}`);
    }
  }
  assert.equal(targets.size,files.length);assert.equal(mappings.size,files.length);
  assert.equal(html.match(/<script type="module" src="([^"]+)"/)[1],`./app.js?v=${release}`);
  assert.equal(html.match(/<link rel="stylesheet" href="([^"]+)"/)[1],`./styles.css?v=${release}`);
  assert.ok(html.indexOf('type="importmap"')<html.indexOf('type="module"'));
  const protocol=await import('../dist/protocol.js'),transport=await import('../dist/device/transport.js'),session=await import('../dist/config/session.js');
  assert.equal(protocol.A80Transport,transport.A80Transport);assert.equal(protocol.ConfigSession,session.ConfigSession);
});
