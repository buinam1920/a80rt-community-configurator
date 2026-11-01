import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/a80rt_local.py',import.meta.url));
const python=['python','python3','py'].find(cmd=>spawnSync(cmd,['--version']).status===0);
const port=18000+Math.floor(Math.random()*2000);
let base=`http://127.0.0.1:${port}`,origin=`http://localhost:${port}`;

function request(path,{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request(base+path,{method,headers:{...headers,'Content-Length':Buffer.byteLength(body??'')}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));});
    req.on('error',reject);if(body)req.write(body);req.end();
  });
}
async function waitReady(){for(let i=0;i<50;i++){try{return await request('/hotkeys/config');}catch{await new Promise(r=>setTimeout(r,100));}}throw new Error('server did not start');}

test('local bridge serves the app, guards writes by origin and relays hotkeys over SSE',{skip:!python&&'python not available'},async t=>{
  const child=spawn(python,['-I',script,'--port',String(port),'--no-hotkeys','--no-sound','--test-trigger'],{stdio:'ignore'});
  t.after(()=>child.kill());process.once('exit',()=>child.kill());
  const config=await waitReady();
  assert.equal(config.status,200);
  assert.deepEqual(JSON.parse(config.body).hotkeys.map(h=>[h.preset,h.keys]),[['lol','Ctrl+Alt+1'],['apex','Ctrl+Alt+2']]);
  const index=await request('/');assert.equal(index.status,200);assert.match(index.body,/A80RT Configurator/);assert.equal(index.headers['cache-control'],'no-cache');
  // Other sites/processes cannot post results or triggers without the app origin.
  assert.equal((await request('/hotkeys/result',{method:'POST',body:'{}'})).status,403);
  assert.equal((await request('/hotkeys/test-trigger',{method:'POST',headers:{Origin:'https://evil.example'},body:'{"preset":"lol"}'})).status,403);
  assert.equal((await request('/hotkeys/result',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"status":"verified","label":"LoL"}'})).status,200);
  assert.equal((await request('/hotkeys/nope',{method:'POST',headers:{Origin:origin}})).status,404);
  // A connected app window receives the preset chosen by the hotkey.
  const received=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('no SSE event within 5s')),5000);
    const req=http.get(base+'/hotkeys/events',res=>{
      assert.match(res.headers['content-type'],/text\/event-stream/);let buffer='';
      res.on('data',chunk=>{buffer+=chunk;
        if(buffer.includes(': connected'))request('/hotkeys/test-trigger',{method:'POST',headers:{Origin:origin},body:'{"preset":"apex"}'}).catch(reject);
        const match=buffer.match(/data: (.*)\n\n/);if(match){clearTimeout(timer);req.destroy();resolve(JSON.parse(match[1]));}});
    });req.on('error',error=>{if(error.code!=='ECONNRESET')reject(error);});
  });
  const event=await received;
  assert.equal(event.preset,'apex');assert.match(event.event,/^[0-9a-f]+-\d+$/);
});

// Opens one simulated app window (SSE client) and collects the events it receives.
function openWindow(client){
  const events=[];let req;
  const opened=new Promise((resolve,reject)=>{
    req=http.get(`${base}/hotkeys/events?client=${client}`,res=>{let buffer='';
      res.on('data',chunk=>{buffer+=chunk;if(buffer.includes(': connected'))resolve();
        let match;while((match=buffer.match(/data: (.*)\n\n/))){events.push(JSON.parse(match[1]));buffer=buffer.slice(match.index+match[0].length);}});
    });req.on('error',error=>{if(error.code!=='ECONNRESET')reject(error);});
  });
  return {events,opened,close:()=>req.destroy()};
}
const post=(path,body)=>request(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>({status:r.status,body:JSON.parse(r.body)}));
const settle=ms=>new Promise(r=>setTimeout(r,ms));

test('each hotkey press goes to exactly one app window and only its first result counts',{skip:!python&&'python not available'},async t=>{
  const port2=port+1,child=spawn(python,['-I',script,'--port',String(port2),'--no-hotkeys','--no-sound','--test-trigger'],{stdio:'ignore'});
  t.after(()=>child.kill());process.once('exit',()=>child.kill());
  const realBase=base;base=`http://127.0.0.1:${port2}`;origin=`http://localhost:${port2}`;
  t.after(()=>{base=realBase;origin=`http://localhost:${port}`;});
  await waitReady();
  const a=openWindow('windowAAAA'),b=openWindow('windowBBBB');t.after(()=>{a.close();b.close();});
  await Promise.all([a.opened,b.opened]);
  // A is connected+read; B opened later (more recent) but has no keyboard session.
  assert.deepEqual((await post('/hotkeys/state',{client:'windowAAAA',ready:true})).body,{known:true});
  assert.deepEqual((await post('/hotkeys/state',{client:'windowBBBB',ready:false,active:true})).body,{known:true});
  const first=(await post('/hotkeys/test-trigger',{preset:'lol'})).body;
  assert.equal(first.listeners,2);await settle(300);
  assert.deepEqual(a.events,[{preset:'lol',event:first.event}],'ready window handles the press');
  assert.deepEqual(b.events,[],'other windows never see it');
  // Only the window that received the event can resolve it, and only once.
  assert.equal((await post('/hotkeys/result',{client:'windowBBBB',event:first.event,status:'error'})).body.ignored,true);
  assert.equal((await post('/hotkeys/result',{client:'windowAAAA',event:first.event,status:'verified'})).body.ok,true);
  assert.equal((await post('/hotkeys/result',{client:'windowAAAA',event:first.event,status:'verified'})).body.ignored,true);
  assert.equal((await post('/hotkeys/result',{client:'windowAAAA',status:'verified'})).body.ignored,true,'results without an event id are ignored');
  // Once B is also ready and was used most recently, the next press goes to B only.
  await post('/hotkeys/state',{client:'windowBBBB',ready:true,active:true});
  const second=(await post('/hotkeys/test-trigger',{preset:'apex'})).body;await settle(300);
  assert.equal(a.events.length,1);assert.deepEqual(b.events,[{preset:'apex',event:second.event}]);
  assert.notEqual(first.event,second.event);
  // Unknown windows and malformed ids are rejected without crashing the bridge.
  assert.deepEqual((await post('/hotkeys/state',{client:['x'],ready:true})).body,{known:false});
  assert.equal((await post('/hotkeys/result',{client:'windowBBBB',event:{x:1},status:'ok'})).body.ignored,true);
});

const exe=process.env.A80RT_TEST_EXE || fileURLToPath(new URL('../A80RT-Configurator.exe',import.meta.url));
test('standalone A80RT-Configurator.exe serves embedded assets and dispatches single-window hotkeys without external files',{skip:process.platform!=='win32'},async t=>{
  const port3=port+2,child=spawn(exe,['--port',String(port3),'--no-hotkeys','--no-sound','--test-trigger'],{stdio:'ignore'});
  t.after(()=>child.kill());process.once('exit',()=>child.kill());
  const realBase=base;base=`http://127.0.0.1:${port3}`;origin=`http://localhost:${port3}`;
  t.after(()=>{base=realBase;origin=`http://localhost:${port}`;});
  const config=await waitReady();assert.equal(config.status,200);
  const index=await request('/');assert.equal(index.status,200);assert.match(index.body,/A80RT Configurator/);assert.equal(index.headers['cache-control'],'no-cache');
  const appJs=await request('/app.js?v=0.3.9');assert.equal(appJs.status,200);assert.match(appJs.headers['content-type'],/javascript/);
  const a=openWindow('exeWinAAAA'),b=openWindow('exeWinBBBB');t.after(()=>{a.close();b.close();});
  await Promise.all([a.opened,b.opened]);
  assert.deepEqual((await post('/hotkeys/state',{client:'exeWinAAAA',ready:true})).body,{known:true});
  assert.deepEqual((await post('/hotkeys/state',{client:'exeWinBBBB',ready:false,active:true})).body,{known:true});
  const first=(await post('/hotkeys/test-trigger',{preset:'lol'})).body;
  assert.equal(first.listeners,2);await settle(300);
  assert.deepEqual(a.events,[{preset:'lol',event:first.event}]);
  assert.deepEqual(b.events,[]);
  assert.equal((await post('/hotkeys/result',{client:'exeWinBBBB',event:first.event,status:'error'})).body.ignored,true);
  assert.equal((await post('/hotkeys/result',{client:'exeWinAAAA',event:first.event,status:'verified'})).body.ok,true);
  assert.equal((await post('/hotkeys/result',{client:'exeWinAAAA',event:first.event,status:'verified'})).body.ignored,true);
});

// The app window sends the user's profile shortcuts; the host replaces its list,
// rejects other origins and malformed keys, and dispatches the new preset ids.
async function checkBindings(t){
  assert.equal((await request('/hotkeys/bindings',{method:'POST',headers:{Origin:'https://evil.example'},body:'{"bindings":[]}'})).status,403);
  assert.equal((await post('/hotkeys/bindings',{nope:1})).status,400);
  const set=await post('/hotkeys/bindings',{bindings:[{preset:'u-abcd1234',label:'Valorant',keys:'Ctrl+Alt+V'},{preset:'bad',label:'x',keys:'V'},{preset:'apex',label:'Apex',keys:'Ctrl+Shift+F5'}]});
  assert.equal(set.status,200);assert.equal(set.body.bindable,true);
  assert.deepEqual(set.body.hotkeys.map(h=>[h.preset,h.label,h.keys]),[['u-abcd1234','Valorant','Ctrl+Alt+V'],['apex','Apex','Ctrl+Shift+F5']]);
  assert.deepEqual(JSON.parse((await request('/hotkeys/config')).body).hotkeys,set.body.hotkeys);
  assert.equal((await post('/hotkeys/test-trigger',{preset:'lol'})).status,400,'an unbound preset is no longer dispatched');
  const win=openWindow('bindWinAAAA');t.after(()=>win.close());await win.opened;
  const fired=(await post('/hotkeys/test-trigger',{preset:'u-abcd1234'})).body;await settle(300);
  assert.deepEqual(win.events,[{preset:'u-abcd1234',event:fired.event}]);
}
test('python bridge accepts user hotkey bindings from the app',{skip:!python&&'python not available'},async t=>{
  const port4=port+3,child=spawn(python,['-I',script,'--port',String(port4),'--no-hotkeys','--no-sound','--test-trigger'],{stdio:'ignore'});
  t.after(()=>child.kill());process.once('exit',()=>child.kill());
  const realBase=base;base=`http://127.0.0.1:${port4}`;origin=`http://localhost:${port4}`;t.after(()=>{base=realBase;origin=`http://localhost:${port}`;});
  await waitReady();await checkBindings(t);
});
test('standalone exe accepts user hotkey bindings from the app',{skip:process.platform!=='win32'},async t=>{
  const port5=port+4,child=spawn(exe,['--port',String(port5),'--no-hotkeys','--no-sound','--test-trigger'],{stdio:'ignore'});
  t.after(()=>child.kill());process.once('exit',()=>child.kill());
  const realBase=base;base=`http://127.0.0.1:${port5}`;origin=`http://localhost:${port5}`;t.after(()=>{base=realBase;origin=`http://localhost:${port}`;});
  await waitReady();await checkBindings(t);
});
