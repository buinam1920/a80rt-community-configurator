import {LAYOUT,KEYS} from './layout.js';
import {A80Reader,VENDOR,DEVICE_FILTERS,describeDevice,transportName,decodeKey,hex,bytesHex} from './protocol.js';
import {identifyDevice,readPlan} from './device/capabilities.js';
import {ConfigSession} from './config/session.js';
import {mountCoreEditors,fnKeyCap} from './ui/core-editors.js';
import {decodeBlock} from './config/codecs.js';
import {mountAdvancedEditors} from './ui/advanced-editors.js';
import {mountDeviceSettings} from './ui/device-settings.js';
import {presetEdits,presetLibrary,shortcutFromEvent} from './config/presets.js';
import {localize} from './i18n.js';
import {icon,withIcon} from './ui/icons.js';
import {createProfile,parseProfile,exportProfile,restoreProfile,previewProfile,profileSkippedFields,loadProfile,createIndexedDBStorage,saveProfile,listProfiles,duplicateProfile,deleteProfile,saveRecovery,readRecovery} from './config/profiles.js';
const SAMPLE_CAPABILITY=identifyDevice({vendorId:VENDOR,productId:0x80a1,productName:'A80RT U'});
const BLOCK_NAMES={device:'Thông tin thiết bị',settings:'Thiết lập chung',keymap:'Gán phím',lighting:'Thiết lập đèn',colors:'Màu từng phím',macro:'Macro',fn:'Lớp Fn',rt:'Rapid Trigger',dks:'DKS'};
const FULL_BLOCKS=readPlan(SAMPLE_CAPABILITY).map(block=>({...block,name:BLOCK_NAMES[block.id]}));
let editors=null,mountedSession=undefined,mountedCapability=undefined;
const $=id=>document.getElementById(id);
const state={reader:null,snapshot:null,selected:34,selectedSlots:[34],multi:false,session:null,capability:null,applying:false,maintaining:false,applyAbort:null,layer:'base',reading:false,connecting:false,activeBlock:null,progress:0,totalPackets:0};
const buttons=new Map();
const profileStorage=createIndexedDBStorage();
let profileItems=[],profileRecovery=null,profilePending=null,profileBusy=false,profileSession=null,profileRefresh=0,recoveryTimer,recoveryQueue=Promise.resolve();
// Imports may finish in any order. Any newer intent to edit/open a context
// revokes old file reads, including their error messages and profile previews.
let importGeneration=0;
const invalidateImports=()=>++importGeneration;
const currentImport=generation=>generation===importGeneration&&!state.reading&&!state.connecting&&!state.applying&&!state.maintaining;
const supported=!!navigator.hid&&window.isSecureContext;
let runtimeHidBlocked=false;
const time=value=>new Date(value).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
let barNote=null,barNoteUntil=0,barNoteTimer=null;
function message(text,error=false){$('message').hidden=!text;$('message').textContent=text;$('message').classList.toggle('error',error);
  if(state.applying&&text){barNote={text,error};barNoteUntil=Date.now()+8000;clearTimeout(barNoteTimer);barNoteTimer=setTimeout(()=>renderDraft(),8100);barNoteTimer?.unref?.();renderDraft();}}
function clearMessage(){message('');}
let revertUndo=null,revertUndoTimer=null;
function setText(id,text){const el=$(id),svg=el.firstElementChild?.tagName?.toLowerCase?.()==='svg'?el.firstElementChild:null;el.textContent=text;if(svg)el.prepend(svg);}
// Icon theo quy ước cho các nút tĩnh; nút chỉ có icon vẫn giữ aria-label và tooltip.
const STATIC_ICONS={'connect-button':'plug','disconnect-button':'unplug','read-button':'download','cancel-button':'stop','revert-button':'undo','revert-undo':'undo','apply-button':'check',
  'notify-enable':'bell','profile-save':'save','profile-rename':'pencil','profile-duplicate':'copy','profile-delete':'trash','profile-open':'eye','profile-import':'upload',
  'profile-export':'download','profile-recover':'history','profile-undo':'undo','profile-confirm':'check','profile-cancel':'close','import-button':'upload','export-button':'download'};
function decorateStatic(){
  for(const [id,name]of Object.entries(STATIC_ICONS))if($(id))withIcon($(id),name);
  if($('exit-sample'))withIcon($('exit-sample'),'close',{iconOnly:true});
  for(const el of document.querySelectorAll?.('[data-icon]')??[]){const svg=icon(el.dataset.icon);if(svg)el.replaceChildren(svg);}
  for(const el of document.querySelectorAll?.('[data-icon-after]')??[]){const svg=icon(el.dataset.iconAfter,'i i-after');if(svg)el.append(svg);}
}
function mode(){return state.snapshot?.source??'empty';}
function describeSource(){if(mode()==='demo')return 'Dữ liệu mẫu';if(mode()==='import')return 'Bản đã lưu';if(mode()==='device')return state.reader?'Bàn phím thật':Object.keys(state.snapshot.blocks).length?'Bản đọc trước':'Thông tin thiết bị';return 'Chưa có dữ liệu';}
function deviceSnapshot(device,interfaceInfo=null){return {schema:'a80rt-reader/v1',appVersion:'0.4.0-beta.14',source:'device',createdAt:new Date().toISOString(),complete:false,device:{productName:device.productName,vendorId:device.vendorId,productId:device.productId},descriptor:describeDevice(device),interface:interfaceInfo?{...interfaceInfo}:null,blocks:{},packets:[],totalPackets:0};}
function makeKeyboard(){
  for(const row of LAYOUT){
    const container=document.createElement('div');container.className='key-row';
    for(const key of row){
      const button=document.createElement('button');button.type='button';button.className='key';button.style.setProperty('--width',key.width);button.tabIndex=key.slot===state.selected?0:-1;if(button.dataset)button.dataset.slot=String(key.slot);
      button.setAttribute('aria-label',`Phím ${key.label}, vị trí ${key.slot}`);button.setAttribute('aria-pressed','false');
      const label=document.createElement('span');label.textContent=key.label;button.append(label);
      const value=document.createElement('small');value.textContent='';const rtLine=document.createElement('small');rtLine.className='key-rt';button.append(value,rtLine);
      button.addEventListener('click',event=>{
        state.selected=key.slot;
        if(state.multi||event.ctrlKey||event.metaKey||event.shiftKey)state.selectedSlots=state.selectedSlots.includes(key.slot)?state.selectedSlots.filter(slot=>slot!==key.slot):[...state.selectedSlots,key.slot];
        else state.selectedSlots=[key.slot];
        renderSelection();editors?.setSelection(state.selectedSlots);
      });
      buttons.set(key.slot,{button,value,rtLine,label});container.append(button);
    }
    $('keyboard').append(container);
  }
}
const NAV_KEYS=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
function moveKeyFocus(event){
  if(!NAV_KEYS.includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;
  const rows=[...$('keyboard').children].map(row=>[...row.children]);let r=-1,c=-1;
  rows.forEach((row,i)=>{const j=row.indexOf(event.target);if(j>=0){r=i;c=j;}});if(r<0)return;
  event.preventDefault();let next=null;
  if(event.key==='ArrowLeft')next=rows[r][c-1];else if(event.key==='ArrowRight')next=rows[r][c+1];
  else if(event.key==='Home')next=rows[r][0];else if(event.key==='End')next=rows[r].at(-1);
  else{const target=rows[r+(event.key==='ArrowUp'?-1:1)];if(!target)return;const box=event.target.getBoundingClientRect(),mid=box.left+box.width/2;
    next=target.reduce((best,el)=>{const b=el.getBoundingClientRect(),d=Math.abs(b.left+b.width/2-mid);return d<best.d?{el,d}:best;},{el:null,d:Infinity}).el;}
  if(!next||next===event.target)return;
  for(const row of rows)for(const el of row)el.tabIndex=-1;next.tabIndex=0;next.focus();
  if(event.shiftKey){const slot=Number(next.dataset.slot);state.selected=slot;if(!state.selectedSlots.includes(slot))state.selectedSlots=[...state.selectedSlots,slot];renderSelection();editors?.setSelection(state.selectedSlots);}
}
$('keyboard').addEventListener('keydown',moveKeyFocus);
function renderBlocks(){
  $('block-list').replaceChildren();
  for(const [index,block] of FULL_BLOCKS.entries()){
    const ready=!!state.snapshot?.blocks[block.id],active=state.activeBlock===block.id&&state.reading;
    const item=document.createElement('div');item.className=`block${ready?' ready':''}${active?' active':''}`;
    const icon=document.createElement('span');icon.className='block-icon';icon.textContent=ready?'✓':String(index+1).padStart(2,'0');
    const copy=document.createElement('div');const name=document.createElement('strong');name.textContent=block.name;
    const size=document.createElement('small');size.textContent=`${block.length} BYTE · ${hex(block.command)}`;copy.append(name,size);
    const status=document.createElement('span');status.className='block-status';status.textContent=ready?(mode()==='demo'?'Mẫu':'Đã có'):active?'Đang đọc':'Chờ đọc';
    item.append(icon,copy,status);$('block-list').append(item);
  }
}
// Điểm nhận raw0: driver hãng hiển thị currentTrip/10 (1,2 mm). App hiện giống hãng
// nhưng đánh dấu là mặc định, vì hành vi vật lý của raw0 chưa được đo.
function keyTravel(rt){
  const fallback=(state.capability??SAMPLE_CAPABILITY).limits.vendorDefaultActuationMm;
  if(!rt)return {mm:null,isDefault:false,press:0,release:0};
  return {mm:rt.actuationMm??fallback,isDefault:rt.actuationMm==null,press:rt.pressRaw/100,release:rt.releaseRaw/100};
}
const mmText=value=>value.toFixed(2).replace(/0$/,'');
function renderSelection(){
  const blocks=state.session?.draft??state.snapshot?.blocks??{};
  const selected=KEYS.find(key=>key.slot===state.selected),decoded=decodeKey(blocks,state.selected),rt=decoded.rt;
  // Lớp Fn: nhãn phím là chức năng mà Fn + phím đó thực hiện (giống driver hãng).
  const fnView=state.layer==='fn',fnCapability=state.capability??SAMPLE_CAPABILITY;
  let fnRecords=null;if(fnView&&blocks.fn){try{fnRecords=decodeBlock('fn',blocks.fn,fnCapability).records;}catch{fnRecords=null;}}
  $('keyboard')?.classList?.toggle('fn-layer',fnView);let factoryShown=false;
  for(const key of KEYS){
    const {button,value,rtLine,label}=buttons.get(key.slot);
    const cap=fnRecords?fnKeyCap(fnRecords[key.slot]?.binding,key,fnCapability):null;
    label.textContent=cap?cap.short:key.label;button.classList.toggle('fn-special',!!cap?.special);button.classList.toggle('fn-remapped',!!cap?.remapped);button.classList.toggle('fn-empty',!!cap?.empty);button.classList.toggle('fn-factory',!!cap?.factory);factoryShown||=!!cap?.factory;
    if(cap)button.title=`Fn + ${key.label}: ${cap.full}`;
    button.setAttribute('aria-label',cap?`Phím ${key.label}, Fn: ${cap.full}`:`Phím ${key.label}, vị trí ${key.slot}`);const item=decodeKey(blocks,key.slot),chosen=state.selectedSlots.includes(key.slot),travel=keyTravel(item.rt);
    button.classList.toggle('selected',chosen);button.classList.toggle('has-data',!!item.rt);button.setAttribute('aria-pressed',String(chosen));if(document.activeElement?.parentElement?.parentElement!==$('keyboard'))button.tabIndex=key.slot===state.selected?0:-1;
    value.textContent=travel.mm!=null?mmText(travel.mm):'';value.classList.toggle('is-default',travel.isDefault);
    if(fnView){value.textContent='';}
    const rtOn=!fnView&&(travel.press>0||travel.release>0);rtLine.textContent=!rtOn?'':travel.press===travel.release?`↕${mmText(travel.press)}`:`${mmText(travel.press)}/${mmText(travel.release)}`;button.classList.toggle('has-rt',rtOn);
    const rgb=blocks.colors?.slice(key.slot*4+1,key.slot*4+4);button.classList.toggle('has-color',!!rgb);if(rgb?.length===3)button.style.setProperty('--key-rgb',`rgb(${Array.from(rgb).join(',')})`);
    if(!cap)button.title=`${key.label} · vị trí ${key.slot}${travel.mm!=null?` · điểm nhận ${travel.mm.toFixed(2)} mm${travel.isDefault?' (mặc định hãng)':''}`:''}${rtOn?` · RT nhấn ${travel.press.toFixed(2)} / nhả ${travel.release.toFixed(2)} mm`:''}`;
  }
  $('layer-base').setAttribute('aria-pressed',String(state.layer==='base'));$('layer-fn').setAttribute('aria-pressed',String(state.layer==='fn'));
  setText('selected-slot',`#${String(state.selected).padStart(3,'0')}`);setText('selected-key-name',selected.label);
  setText('key-layer',state.layer==='fn'?'Fn':'Mặc định');
  const selectedTravel=keyTravel(rt),mm=selectedTravel.mm;
  $('key-actuation').replaceChildren(document.createTextNode(mm!=null?mm.toFixed(2)+' ':'— '));const unit=document.createElement('small');unit.textContent='mm';$('key-actuation').append(unit);
  $('actuation-stat').replaceChildren(document.createTextNode(mm!=null?mm.toFixed(2)+' ':'— '));const statUnit=document.createElement('em');statUnit.textContent='mm';$('actuation-stat').append(statUnit);
  setText('actuation-note',`Phím ${selected.label} · ${!rt?'chưa có dữ liệu':selectedTravel.isDefault?'mặc định hãng (giá trị gốc 0)':'giải mã từ cấu hình'}`);
  const percent=mm!=null?Math.min(100,Math.max(0,mm/3.4*100)):0;
  $('travel-fill').style.width=`${percent}%`;$('travel-marker').style.left=`${percent}%`;$('travel-marker').style.display=mm!=null?'block':'none';
  setText('key-state',!rt?'Đọc cấu hình để xem thông số thực.':selectedTravel.isDefault?'Mặc định hãng (1,2 mm).':mode()==='demo'?'Thông số minh họa, chưa đọc từ thiết bị.':'Đọc từ cấu hình.');
  setText('key-switch',rt?String(rt.switchId):'—');setText('key-flags',rt?`0x${rt.flags.toString(16).toUpperCase().padStart(2,'0')}`:'—');
  const mapping=state.layer==='fn'?decoded.fn:decoded.keymap;
  if($('fn-factory-hint'))$('fn-factory-hint').hidden=!factoryShown;
  const selectedFn=fnRecords&&selected?fnKeyCap(fnRecords[state.selected]?.binding,selected,fnCapability):null;
  setText('key-mapping',mapping?`${bytesHex(mapping)}${selectedFn?` · ${selectedFn.full}`:''}`:'—');
  setText('key-rt-raw',rt?bytesHex(rt.raw):'Chưa có dữ liệu');setText('key-map-raw',mapping?bytesHex(mapping):'Chưa có dữ liệu');
  setText('key-thresholds',rt?(selectedTravel.press||selectedTravel.release?`${selectedTravel.press.toFixed(2)} / ${selectedTravel.release.toFixed(2)} mm`:'Tắt'):'—');
  setText('selection-count',`${state.selectedSlots.length} phím đã chọn`);
  editors?.setLayer(state.layer);
}
function renderLog(){
  const packets=state.snapshot?.packets??[];
  setText('packet-count',`${state.snapshot?.totalPackets??0} gói`);
  setText('log',packets.length?packets.slice(-80).map(p=>`${p.at}  ${p.direction==='out'?'TX →':'RX ←'}  ${bytesHex(p.bytes)}`).join('\n'):'Trống.');
}
function render(){
  reportHotkeyState();
  const connected=!!state.reader,source=mode(),hasData=!!state.snapshot&&Object.keys(state.snapshot.blocks).length>0;
  const responding=connected&&state.reader.getState().hasResponse;
  for(const id of ['core-editors','draft-bar','keyboard'])$(id)?.setAttribute?.('aria-busy',String(state.reading||state.applying||state.connecting||state.maintaining));$('connect-strip')?.classList?.toggle('is-compact',connected&&hasData&&!state.reading);
  const busy=state.reading||state.connecting||state.applying||state.maintaining;
  $('connect-button').hidden=connected;$('connect-button').disabled=!supported||runtimeHidBlocked||busy;
  $('disconnect-button').hidden=!connected;$('disconnect-button').disabled=busy;
  $('read-button').hidden=state.reading;$('read-button').disabled=!connected||busy;
  $('cancel-button').hidden=!state.reading;$('cancel-button').disabled=false;
  $('sample-button').disabled=busy||connected;$('import-button').disabled=busy||connected;
  $('export-button').disabled=(!hasData&&!state.snapshot?.descriptor&&!(state.snapshot?.totalPackets>0))||busy;$('exit-sample').disabled=busy;
  $('sample-notice').hidden=source!=='demo';
  $('progress-wrap').hidden=!state.reading;$('progress-bar').style.width=`${state.progress}%`;
  const device=connected?state.reader.device:state.snapshot?.device;
  setText('device-name',device?.productName??'Chưa kết nối');
  setText('device-sub',source==='demo'?'DỮ LIỆU MẪU · MINH HỌA':connected?transportName(device).toLocaleUpperCase('vi-VN'):source==='import'?'BẢN ĐỌC TỪ TỆP JSON':'LEOBOG A80RT / A80RT U');
  const fields=connected?[
    ['Kết nối',transportName(device)],['VID / PID',`${hex(device.vendorId)} / ${hex(device.productId)}`],['Gói tin',`${state.reader.interface.packetSize} byte`],['Trạng thái',responding?'Đã nhận phản hồi':'Đã mở · chưa có phản hồi'],
    ...(isReceiver()?[['Pin',state.battery==null?'Đọc cấu hình để xem':`${state.battery}%`]]:[]),
  ]:[['Kết nối','USB / 2.4 GHz'],['Trạng thái',source==='demo'?'Dữ liệu mẫu':hasData?'Bản đã lưu':'Đang chờ']];
  $('device-meta').replaceChildren();for(const [label,value]of fields){const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;$('device-meta').append(dt,dd);}
  $('connection-pill').className=`pill${connected?' connected':source==='demo'?' sample':''}`;
  $('connection-pill').replaceChildren(document.createElement('i'),document.createTextNode(connected?(responding?'Đã nhận phản hồi':'Chờ phản hồi'):source==='demo'?'Dữ liệu mẫu':'Chưa kết nối'));
  setText('source-stat',describeSource());setText('source-note',state.snapshot?`${state.snapshot.complete?'Đủ 9 nhóm':hasData?'Bản đọc chưa đủ':'Chưa đọc cấu hình'} · ${time(state.snapshot.createdAt)}`:'Sẵn sàng kết nối');
  const count=Object.keys(state.snapshot?.blocks??{}).length;$('blocks-stat').replaceChildren(document.createTextNode(`${count} `));const total=document.createElement('em');total.textContent='/ 9';$('blocks-stat').append(total);
  setText('blocks-note',state.reading?`Đang đọc · ${Math.round(state.progress)}%`:hasData?'Xuất được JSON':'Thông tin, phím, Fn, RT và đèn');
  setText('next-title',state.connecting?'Đang mở kết nối…':connected?(responding?'Bàn phím đã phản hồi':'Đã mở kết nối · chờ phản hồi'):source==='demo'?'Khám phá bằng dữ liệu mẫu':'Bắt đầu');
  setText('next-copy',connected?`${transportName(device)} · bấm Đọc cấu hình`:source==='demo'?'Chọn phím để xem thông số mẫu.':'Cắm cáp USB hoặc đầu thu 2.4 GHz. Đóng driver hãng.');
  setText('keyboard-caption',source==='empty'||(!hasData&&source==='device')?'Chưa đọc dữ liệu từ bàn phím':source==='demo'?'Mẫu minh họa · không phải dữ liệu thiết bị':state.reading?'Đang nhận cấu hình…':`${describeSource()} · ${state.snapshot.complete?'đã đọc đủ':'còn thiếu nhóm dữ liệu'}`);
  setText('read-label',state.reading?`Đang đọc · ${FULL_BLOCKS.find(b=>b.id===state.activeBlock)?.name??'cấu hình'}`:'Đọc cấu hình hiện tại');
  setText('read-detail',state.reading?`${Math.round(state.progress)}% · có thể dừng bất cứ lúc nào`:'9 nhóm cấu hình · xử lý trong trình duyệt');
  renderBlocks();renderSelection();renderLog();renderEditors();renderDraft();renderProfiles();
}
function addPacket(direction,bytes){
  const snapshot=state.snapshot;if(!snapshot||snapshot.source!=='device')return;
  snapshot.totalPackets++;snapshot.packets.push({direction,at:time(Date.now()),bytes:Array.from(bytes).slice(0,128)});
  if(snapshot.packets.length>500)snapshot.packets.shift();
  if($('diagnostics').open)renderLog();
}
// Chỉ một cửa sổ app được giữ bàn phím: hai cửa sổ cùng đọc sẽ lẫn gói trả lời.
let releaseDeviceLock=null;
function acquireDeviceLock(){
  if(releaseDeviceLock||!navigator.locks?.request)return Promise.resolve(true);
  return new Promise(resolve=>{navigator.locks.request('a80rt-keyboard',{ifAvailable:true},lock=>{
    if(!lock){resolve(false);return;}resolve(true);return new Promise(release=>{releaseDeviceLock=release;});
  }).catch(()=>resolve(true));});
}
function dropDeviceLock(){releaseDeviceLock?.();releaseDeviceLock=null;}
// Cáp trước đầu thu: qua cáp ghi được mọi nhóm đã đo.
const devicePriority=device=>device.productId===0x80a1?0:device.productId===0xfefc?1:2;
async function connect(permitted=null){
  if(!supported||state.connecting||state.reading)return;
  invalidateImports();
  clearMessage();state.connecting=true;render();let reader;
  try{
    if(!await acquireDeviceLock()){message('Cửa sổ A80RT khác đang dùng bàn phím.',true);return;}
    const devices=Array.isArray(permitted)?permitted:await navigator.hid.requestDevice({filters:DEVICE_FILTERS.map(filter=>({...filter}))});
    devices.sort((a,b)=>devicePriority(a)-devicePriority(b));
    if(!devices.length){dropDeviceLock();message('Chưa chọn thiết bị. Đầu thu: chọn “A80RT U Dongle”.');return;}
    state.session=null;state.capability=null;state.snapshot=deviceSnapshot(devices[0]);
    let lastError;
    for(const device of devices){try{reader=new A80Reader(device,{onPacket:(direction,bytes)=>{if(state.reader===reader)addPacket(direction,bytes);}});break;}catch(error){lastError=error;}}
    if(!reader)throw lastError??new Error('Không tìm thấy giao diện cấu hình A80RT. Thử cắm lại đầu thu 2.4 GHz hoặc cáp USB.');
    state.snapshot=deviceSnapshot(reader.device,reader.interface);
    await reader.open();state.reader=reader;
    reader.transport.onSessionEnd(()=>{if(state.reader===reader&&reader.getState().linkLost)void onLinkLost(reader);});
    try{state.capability=identifyDevice(reader.device);}catch{state.capability=null;}state.progress=0;state.snapshot.session=reader.getState();
    message(`Đã kết nối qua ${transportName(reader.device).toLocaleLowerCase('vi-VN')}. Bấm Đọc cấu hình.`);
  }catch(error){if(reader)await reader.close().catch(()=>{});if(!state.reader)dropDeviceLock();message(error.name==='NotAllowedError'?'Trình duyệt chưa cấp quyền kết nối. Hãy mở trang trực tiếp trong Chrome/Edge rồi thử lại.':`Kết nối chưa thành công: ${error.message}`,true);}
  finally{state.connecting=false;render();}
}
async function disconnect(){
  invalidateImports();
  await editors?.cancelCalibration();
  const reader=state.reader;state.reader=null;state.reading=false;state.activeBlock=null;state.applyAbort?.abort();
  if(reader)await reader.close().catch(()=>{});
  dropDeviceLock();setBattery(null);autoConnectPaused=true;clearTimeout(relinkTimer);relinkTimer=null;
  render();
}
async function read(){
  if(!state.reader||state.reading||state.applying||state.maintaining)return;
  if(!state.capability){message('Danh tính model chưa khớp hoàn toàn; chưa thể đọc snapshot chỉnh sửa.',true);return;}
  invalidateImports();
  const reader=state.reader;
  const sessionId=reader.getState().sessionId;
  const snapshot=deviceSnapshot(reader.device,reader.interface);snapshot.session=reader.getState();state.snapshot=snapshot;state.session=null;
  const ownsRead=()=>state.reader===reader&&state.snapshot===snapshot;
  const current=()=>ownsRead()&&reader.getState().sessionId===sessionId;
  state.reading=true;state.progress=0;clearMessage();render();
  try{
    const captured=await reader.readConfiguration(state.capability,{onProgress:progress=>{if(!current())return;state.activeBlock=progress.block;state.progress=100*progress.completed/progress.total;render();}});
    if(current()){state.session=new ConfigSession(captured,state.capability);snapshot.blocks=captured.blocks;snapshot.complete=true;relinkDelay=0;if(isReceiver())setBattery(batteryOf(captured.blocks.device));message(reader.transport.getWriteState().qualified?'Đã đọc đủ 9 nhóm. Chỉnh rồi bấm Áp dụng.':'Đã đọc đủ 9 nhóm. Model/firmware này chưa ghi được.');}
  }catch(error){if(ownsRead())message(error.name==='AbortError'?'Đã dừng đọc. Chưa có snapshot hoàn chỉnh để chỉnh sửa.':`Đọc chưa hoàn tất: ${error.message}`,error.name!=='AbortError');}
  finally{if(ownsRead()){snapshot.session=reader.getState();state.reading=false;state.activeBlock=null;render();}}
}
function sample(){
  if(state.reader||state.reading||state.applying||state.connecting||state.maintaining)return;
  invalidateImports();
  const capability=SAMPLE_CAPABILITY;
  const blocks=Object.fromEntries(readPlan(capability).map(b=>[b.id,new Uint8Array(b.length)]));
  for(const key of KEYS){
    const point=key.label==='W'?80:key.label==='A'?120:180;
    blocks.rt.set([1,key.label==='W'?1:0,point&255,point>>>8,20,0,20,0],key.slot*8);
    blocks.keymap.set([2,key.usage>=224?key.usage:0,key.usage<224?key.usage:0,0],key.slot*4);
    blocks.colors.set([key.slot,195,245,107],key.slot*4);
  }
  blocks.lighting.set([128,195,245,107,0,40,70,120,0,3,3,0]);
  const coverage=Object.fromEntries(readPlan(capability).map(({id,length})=>[id,{complete:true,expectedBytes:length,receivedBytes:length}]));
  state.capability=capability;
  state.session=new ConfigSession({identity:capability.identity,blocks,coverage,provenance:{source:'sample'}},capability);
  state.snapshot={schema:'a80rt-reader/v1',source:'demo',createdAt:new Date().toISOString(),complete:true,device:{...capability.identity,productName:'A80RT U · mẫu minh họa'},blocks,packets:[],totalPackets:0};
  clearMessage();render();
}
function renderEditors(){
  const capability=state.capability??SAMPLE_CAPABILITY;
  if(mountedSession===state.session&&mountedCapability===capability)return;
  editors?.destroy();mountedSession=state.session;mountedCapability=capability;
  const context={session:state.session,capability,selectedSlots:state.selectedSlots,isBusy:()=>state.reading||state.connecting||state.applying||state.maintaining||!!state.session?.invalidated,onNavigate:()=>{invalidateImports();editors?.stopRecording();editors?.cancelCalibration();},onEdit:()=>{clearProfilePreview();renderSelection();renderDraft();scheduleRecovery();}};
  const core=mountCoreEditors($('core-editors'),{...context,onLayerChange:layer=>{state.layer=layer;renderSelection();}});
  const advanced=mountAdvancedEditors($('advanced-editors'),context);
  const settings=mountDeviceSettings($('device-settings'),{...context,modelConfirmed:!!state.capability,transport:state.capability?state.reader?.transport:undefined,onNavigate:()=>{invalidateImports();advanced.stopRecording();},onInvalidate:()=>{invalidateImports();if(state.session===context.session&&state.snapshot)state.snapshot.complete=false;},onReload:()=>read(),onBusyChange:value=>{if(mountedSession!==context.session)return;state.maintaining=value;if(value){invalidateImports();advanced.stopRecording();}render();editors?.refresh();}});
  editors={setSelection(slots){core.setSelection(slots);advanced.setSelection(slots);},setLayer(layer){core.setLayer(layer);advanced.setLayer(layer);},refresh(){core.refresh();advanced.refresh();settings.refresh();},stopRecording:()=>advanced.stopRecording(),cancelCalibration:()=>settings.cancelCalibration(),destroy(){core.destroy();advanced.destroy();settings.destroy();}};
  editors.setLayer(state.layer);
}
function draftWriteState(){
  const transport=state.reader?.transport;if(!transport)return null;
  for(const id of new Set(state.session?.diff().map(change=>change.block)??[])){
    const qualification=transport.getWriteState(state.capability.blocks[id].writeCommand);
    if(!qualification.ready)return qualification;
  }
  return transport.getWriteState();
}
function draftReason(){
  if(!state.session)return mode()==='import'?'Bản JSON cũ chỉ để xem. Đọc đủ cấu hình từ thiết bị để chỉnh sửa.':'Đọc đủ 9 nhóm cấu hình để chỉnh sửa.';
  if(state.session.invalidated)return state.session.invalidReason;
  if(mode()==='demo')return 'Dữ liệu mẫu · không gửi thiết bị';
  if(!state.reader)return 'Đã ngắt kết nối · kết nối và đọc lại để ghi';
  if(state.session.snapshot.provenance.sessionId!==state.reader.getState().sessionId)return 'Kết nối đã đổi · đọc lại cấu hình';
  const qualification=draftWriteState();
  if(!qualification.qualified)return `Chưa thể ghi: ${qualification.reason??'chưa có xác minh ACK ghi từ thiết bị thật.'}`;
  return 'Áp dụng: gửi rồi đọc lại xác minh';
}
function renderDraft(){
  const count=state.session?.diff().length??0,busy=state.reading||state.connecting||state.applying||state.maintaining||!!state.session?.invalidated;
  const noting=!!barNote&&(state.applying||Date.now()<barNoteUntil);
  setText('draft-count',`${count} thay đổi trong bản nháp`);setText('apply-reason',noting?barNote.text:draftReason());
  $('apply-reason')?.classList?.toggle('error',noting&&barNote.error);if(revertUndo&&(revertUndo.session!==state.session||count>0||busy))offerRevertUndo(null);
  $('draft-bar')?.classList?.toggle('is-active',count>0||state.applying||noting||!!revertUndo);
  $('revert-button').disabled=!state.session||!count||busy;
  $('apply-button').disabled=!state.session||!count||busy||mode()!=='device'||!state.reader||!draftWriteState().ready||state.session.snapshot.provenance.sessionId!==state.reader.getState().sessionId;
}
async function applyDraft(){
  if($('apply-button').disabled)return;
  invalidateImports();
  const reader=state.reader,session=state.session,abort=new AbortController();state.applyAbort=abort;state.applying=true;render();
  const pending=session.apply(reader.transport,{signal:abort.signal,onProgress:progress=>{if(state.reader===reader&&state.session===session)message(`Đang ${progress.phase==='readback'?'đọc lại xác minh':'gửi bản nháp'}${progress.block?` · ${BLOCK_NAMES[progress.block]}`:''}…`);}});
  editors?.refresh();
  let result;try{result=await pending;}catch(error){result={status:'failed',error:error.message};}
  if(state.reader===reader&&state.session===session){
    if(result.status==='verified'){state.snapshot.blocks=session.snapshot.blocks;message('✓ Đã áp dụng · đọc lại khớp');}
    else {
      if(result.status==='unconfirmed')state.snapshot.complete=false;
      message(`${result.status==='unconfirmed'?'Đã gửi một phần, chưa xác nhận':'Chưa áp dụng'}: ${result.error}${session.invalidated?` ${session.invalidReason}`:''}`,true);
    }
  }
  state.applying=false;if(state.applyAbort===abort)state.applyAbort=null;editors?.refresh();render();
  return result;
}
function exportData(){
  if(!state.snapshot)return;
  const snapshot={...state.snapshot,blocks:Object.fromEntries(Object.entries(state.session?.draft??state.snapshot.blocks).map(([id,bytes])=>[id,Array.from(bytes)])),notes:{hardwareVerified:false,interpretation:'actuationRaw/100 => mm; zero is left unspecified; press/release are raw values',protocolReference:'https://leobog.driveall.cn/static/js/app.3086f769.js'}};
  const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`a80rt-${mode()==='demo'?'DEMO':mode()==='import'?'saved':'read'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function profileStatus(text,error=false){setText('profile-status',text);$('profile-status').classList.toggle('error',error);}
function libraryCapability(){return [SAMPLE_CAPABILITY,identifyDevice({vendorId:VENDOR,productId:0x80a2,productName:'A80RT'}),identifyDevice({vendorId:VENDOR,productId:0xfefc,productName:'A80RT U Dongle'})].find(cap=>cap.model===$('profile-model').value)??SAMPLE_CAPABILITY;}
function selectedProfile(){return profileItems.find(p=>p.id===$('profile-list').value);}
function profileBlocked(){return profileBusy||state.reading||state.connecting||state.applying||state.maintaining||!!state.session?.invalidated;}
function clearProfilePreview(){invalidateImports();profilePending=null;$('profile-preview').hidden=true;renderProfiles();}
function renderProfiles(){
 const busy=profileBlocked(),selected=selectedProfile();
 if(profilePending?.session!==state.session){profilePending=null;$('profile-preview').hidden=true;}
 for(const id of ['profile-model','profile-list','profile-name','profile-import'])$(id).disabled=busy;
 for(const id of ['profile-rename','profile-duplicate','profile-delete','profile-open'])$(id).disabled=busy||!selected;
 $('profile-save').disabled=busy||!state.session;$('profile-export').disabled=busy||(!state.session&&!selected&&!profilePending);
 $('profile-recover').disabled=busy||!profileRecovery;$('profile-confirm').disabled=busy||!profilePending||profilePending.profile.readOnly===true;$('profile-cancel').disabled=busy||!profilePending;
 const model=state.capability?.model;
 if(profileSession!==state.session){profileSession=state.session;if(model){$('profile-model').value=model;void refreshProfiles();}}
}
async function refreshProfiles(selectId){
 const request=++profileRefresh,cap=libraryCapability();
 try{
  const [items,recovery]=await Promise.all([listProfiles(cap.identity,profileStorage),readRecovery(cap.identity,profileStorage)]);
  if(request!==profileRefresh)return;profileItems=items;profileRecovery=recovery;
  const select=$('profile-list'),previous=selectId??select.value;select.replaceChildren();
  const option=document.createElement('option');option.value='';option.textContent=items.length?'Chọn hồ sơ…':'Chưa có hồ sơ';select.append(option);
  for(const p of items){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name} · ${p.source==='sample'?'Mẫu':p.source==='device'?'Bản lưu từ thiết bị':'Đã lưu'}`;select.append(option);}
  select.value=items.some(p=>p.id===previous)?previous:'';renderProfiles();
 }catch(error){if(request===profileRefresh){profileStatus(`Không đọc được kho cục bộ: ${error.message}`,true);renderProfiles();}}
}
async function profileAction(action){
 if(profileBlocked())return;editors?.stopRecording();profileBusy=true;renderProfiles();
 try{await action();}catch(error){profileStatus(`Chưa hoàn tất: ${error.message}`,true);}finally{profileBusy=false;renderProfiles();}
}
function stageProfile(profile){
 const session=state.session,changes=profile.readOnly?[]:session?previewProfile(profile,session):[];
 invalidateImports();
 profilePending={profile,session,draft:session?JSON.stringify(session.draft):null};
 $('profile-preview').textContent=profile.readOnly?'JSON v1 · chỉ xem, không tạo hồ sơ đầy đủ.\n'+JSON.stringify(profile.blocks,null,2):session?`${profile.name} · ${profile.source==='sample'?'Dữ liệu mẫu':'Bản đã lưu'} · ${changes.length} thay đổi so với bản nháp hiện tại\n`+changes.map(change=>`${change.block} · ${change.path}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join('\n'):`${profile.name} · Bản đã lưu · ${profile.identity.productName}\nMở 9 vùng cấu hình trong phiên ngoại tuyến. Không có quyền ghi thiết bị.`;
 $('profile-preview').hidden=false;profileStatus(profile.readOnly?'Bản cũ chỉ để xem.':session?'Xem trước xong · bấm Đưa vào bản nháp.':'Xác nhận để mở hồ sơ ngoại tuyến.');renderProfiles();
 if(session&&!profile.readOnly){const skipped=profileSkippedFields(profile,session);if(skipped.length)$('profile-preview').textContent+=`\nBỏ qua ${skipped.length} trường chưa được hỗ trợ cho model này; giữ giá trị hiện tại:\n`+skipped.map(({block,path})=>`${block} · ${path}`).join('\n');}
}
function installOfflineProfile(profile){
 state.session=restoreProfile(profile);state.capability=identifyDevice(profile.identity);
 state.snapshot={schema:'a80rt-reader/v1',source:'import',createdAt:new Date().toISOString(),complete:true,device:{...profile.identity},blocks:state.session.draft,packets:[],totalPackets:0};render();
}
function scheduleRecovery(){
 clearTimeout(recoveryTimer);const session=state.session;if(!session||session.invalidated)return;
 if(!globalThis.indexedDB){profileStatus('Chưa lưu phục hồi: trình duyệt không hỗ trợ IndexedDB. Bản nháp vẫn còn.',true);return;}
 recoveryTimer=setTimeout(()=>{
  if(state.session!==session||session.invalidated||session.applying)return;
  let profile;try{profile=createProfile(session,$('profile-name').value||'Phiên gần nhất');}catch(error){profileStatus(`Chưa lưu phục hồi: ${error.message}`,true);return;}
  recoveryQueue=recoveryQueue.catch(()=>{}).then(()=>saveRecovery(profile,profileStorage)).then(()=>{if(state.session===session&&identifyDevice(profile.identity)===libraryCapability()){profileRecovery=profile;profileStatus('Đã giữ bản nháp để phục hồi sau tải lại.');renderProfiles();}}).catch(error=>{if(state.session===session&&identifyDevice(profile.identity)===libraryCapability())profileStatus(`Chưa lưu phục hồi; bản nháp vẫn còn: ${error.message}`,true);});
 },350);
}
function downloadProfile(profile){const blob=new Blob([exportProfile(profile)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${profile.identity?.model??'a80rt'}-profile.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importConfigurationProfile(event){
 const file=event.target.files[0];event.target.value='';if(!file)return;
 await profileAction(async()=>{
  clearProfilePreview();const generation=importGeneration;
  try{
   if(file.size>2*1024*1024)throw new Error('Tệp lớn hơn giới hạn 2 MB.');
   const text=await file.text();if(!currentImport(generation))return;
   const input=JSON.parse(text),cap=state.capability??(input.schema==='a80rt-profile/v2'?identifyDevice(input.identity):libraryCapability());
   const profile=parseProfile(text,cap);stageProfile(profile);
  }catch(error){if(currentImport(generation))throw error;}
 });
}
async function importData(event){
  const file=event.target.files[0];event.target.value='';if(!file||state.reader||state.reading||state.connecting||state.applying||state.maintaining)return;
  const generation=invalidateImports();
  try{
    if(file.size>2*1024*1024)throw new Error('Tệp lớn hơn giới hạn 2 MB.');
    const text=await file.text();if(!currentImport(generation)||state.reader)return;
    const input=JSON.parse(text);
    if(input.schema!=='a80rt-reader/v1'||!input.blocks||!input.device||!['device','demo','import'].includes(input.source))throw new Error('Chỉ mở bản JSON xuất từ A80RT Reader.');
    const blocks={};for(const block of FULL_BLOCKS){const bytes=input.blocks[block.id];if(bytes===undefined)continue;if(!Array.isArray(bytes)||bytes.length!==block.length||bytes.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error(`Nhóm ${block.name} không hợp lệ.`);blocks[block.id]=bytes;}
    if(!Object.keys(blocks).length)throw new Error('Tệp chưa có nhóm cấu hình nào.');
    if(typeof input.device.productName!=='string'||input.device.productName.length>100||!Number.isInteger(input.device.vendorId)||!Number.isInteger(input.device.productId)||Number.isNaN(Date.parse(input.createdAt)))throw new Error('Thông tin thiết bị hoặc thời gian không hợp lệ.');
    state.session=null;state.capability=null;state.snapshot={schema:input.schema,source:input.source==='demo'?'demo':'import',originalSource:input.originalSource??input.source,createdAt:input.createdAt,device:input.device,blocks,complete:Object.keys(blocks).length===FULL_BLOCKS.length,packets:[],totalPackets:0};
    clearProfilePreview();
    clearMessage();render();message('Đã mở bản đã lưu (không phải từ bàn phím).');
  }catch(error){if(currentImport(generation))message(`Không thể mở bản đã lưu: ${error.message}`,true);}
}
function checkBrowser(){
  let text='';
  if(!window.isSecureContext)text='Kết nối USB cần HTTPS hoặc localhost. Hãy mở bản được triển khai qua HTTPS.';
  else if(!navigator.hid)text='Để kết nối bàn phím, mở trang này trực tiếp bằng Chrome hoặc Edge trên máy tính. Bạn vẫn có thể xem dữ liệu mẫu tại đây.';
  else if((document.permissionsPolicy??document.featurePolicy)?.allowsFeature&&!((document.permissionsPolicy??document.featurePolicy).allowsFeature('hid'))){runtimeHidBlocked=true;text='Khung xem hiện tại chưa cho phép kết nối USB. Mở trang này trong tab Chrome hoặc Edge riêng để kết nối bàn phím.';}
  if(text){$('browser-notice').hidden=false;$('browser-notice').textContent=text;}
}
$('connect-button').addEventListener('click',connect);
$('disconnect-button').addEventListener('click',async()=>{await disconnect();message('Đã ngắt kết nối. Bản đọc gần nhất vẫn được giữ trong trang.');});
$('read-button').addEventListener('click',read);
$('cancel-button').addEventListener('click',()=>state.reader?.cancel());
$('selection-multi').addEventListener('change',event=>{state.multi=event.target.checked;});
$('select-all').addEventListener('click',()=>{state.selectedSlots=KEYS.map(key=>key.slot);renderSelection();editors?.setSelection(state.selectedSlots);});
$('clear-selection').addEventListener('click',()=>{state.selectedSlots=[];renderSelection();editors?.setSelection([]);});
// Hoàn tác bỏ cả bản nháp bằng một lần bấm; giữ 10 giây để "Lấy lại bản nháp" nếu bấm nhầm.
function offerRevertUndo(value){
  revertUndo=value;clearTimeout(revertUndoTimer);const button=$('revert-undo');if(button)button.hidden=!value;
  if(value){revertUndoTimer=setTimeout(()=>{offerRevertUndo(null);renderDraft();},10000);revertUndoTimer?.unref?.();}
}
$('revert-undo')?.addEventListener('click',()=>{
  const value=revertUndo;offerRevertUndo(null);if(!value||value.session!==state.session)return renderDraft();
  try{state.session.restore(value.point);editors?.refresh();clearMessage();renderSelection();renderDraft();scheduleRecovery();toast('Đã lấy lại bản nháp.','success');}
  catch(problem){message(problem.message,true);renderDraft();}
});
$('revert-button').addEventListener('click',()=>{const session=state.session,point=session&&session.diff().length?session.checkpoint():null;state.session?.revert();if(point)offerRevertUndo({session,point});clearProfilePreview();editors?.refresh();clearMessage();renderSelection();renderDraft();scheduleRecovery();});
$('apply-button').addEventListener('click',applyDraft);
$('sample-button').addEventListener('click',sample);
$('exit-sample').addEventListener('click',()=>{invalidateImports();state.snapshot=null;state.session=null;state.capability=null;clearMessage();render();});
$('export-button').addEventListener('click',exportData);
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',importData);
$('layer-base').addEventListener('click',()=>{state.layer='base';renderSelection();});
$('layer-fn').addEventListener('click',()=>{state.layer='fn';renderSelection();});
$('diagnostics').addEventListener('toggle',renderLog);
$('profiles-panel').addEventListener('focusin',()=>editors?.stopRecording());
$('profiles-panel').addEventListener('pointerdown',()=>editors?.stopRecording());
$('profile-model').addEventListener('change',()=>{profileRecovery=null;clearProfilePreview();void refreshProfiles();});
$('profile-list').addEventListener('change',()=>{disarmProfileDelete();clearProfilePreview();const p=selectedProfile();if(p)$('profile-name').value=p.name;renderProfiles();});
$('profile-import').addEventListener('click',()=>{editors?.stopRecording();$('profile-file').click();});
$('profile-file').addEventListener('change',importConfigurationProfile);
$('profile-save').addEventListener('click',()=>profileAction(async()=>{const p=createProfile(state.session,$('profile-name').value),id=await saveProfile(p,profileStorage);await refreshProfiles(id);profileStatus('Đã lưu hồ sơ cục bộ.');}));
$('profile-rename').addEventListener('click',()=>profileAction(async()=>{const p=selectedProfile();if(!p)return;const id=await saveProfile({...p,name:$('profile-name').value},profileStorage);await refreshProfiles(id);profileStatus('Đã đổi tên hồ sơ.');}));
$('profile-duplicate').addEventListener('click',()=>profileAction(async()=>{const p=selectedProfile();if(!p)return;const id=await saveProfile(duplicateProfile(p,`${$('profile-name').value} · bản sao`),profileStorage);await refreshProfiles(id);profileStatus('Đã nhân bản hồ sơ.');}));
let profileDeleteArmed=null,profileDeleteTimer=null,profileUndo=null,profileUndoTimer=null;
const DELETE_LABEL='Xóa đã chọn';
function disarmProfileDelete(){profileDeleteArmed=null;clearTimeout(profileDeleteTimer);setText('profile-delete',DELETE_LABEL);}
function offerProfileUndo(profile){profileUndo=profile;$('profile-undo').hidden=!profile;clearTimeout(profileUndoTimer);if(profile){profileUndoTimer=setTimeout(()=>offerProfileUndo(null),10000);profileUndoTimer?.unref?.();}}
$('profile-undo').addEventListener('click',()=>profileAction(async()=>{const p=profileUndo;if(!p)return;offerProfileUndo(null);const id=await saveProfile(p,profileStorage);await refreshProfiles(id);profileStatus(`Đã khôi phục hồ sơ “${p.name}”.`);}));
$('profile-delete').addEventListener('click',()=>profileAction(async()=>{const p=selectedProfile();if(!p)return;
  if(profileDeleteArmed!==p.id){profileDeleteArmed=p.id;setText('profile-delete','Bấm lần nữa để xóa');clearTimeout(profileDeleteTimer);profileDeleteTimer=setTimeout(disarmProfileDelete,3000);profileDeleteTimer?.unref?.();return;}
  disarmProfileDelete();await deleteProfile(p.id,p.identity,profileStorage);offerProfileUndo(p);clearProfilePreview();await refreshProfiles();profileStatus('Đã xóa hồ sơ khỏi trình duyệt. Bản nháp hiện tại vẫn còn.');}));
$('profile-open').addEventListener('click',()=>profileAction(()=>{const p=selectedProfile();if(p)stageProfile(p);}));
$('profile-recover').addEventListener('click',()=>profileAction(()=>{if(profileRecovery)stageProfile(profileRecovery);}));
$('profile-export').addEventListener('click',()=>profileAction(()=>downloadProfile(profilePending?.profile??selectedProfile()??createProfile(state.session,$('profile-name').value))));
$('profile-cancel').addEventListener('click',()=>{clearProfilePreview();profileStatus('Đã đóng xem trước; bản nháp được giữ nguyên.');});
$('profile-confirm').addEventListener('click',()=>profileAction(()=>{
 const pending=profilePending;if(!pending||pending.profile.readOnly)return;
 if(pending.session!==state.session||pending.draft!==(state.session?JSON.stringify(state.session.draft):null))throw new Error('Bản nháp đã đổi; hãy xem trước lại.');
 if(state.session)loadProfile(pending.profile,state.session);else{if(state.reader)throw new Error('Đọc đủ cấu hình thiết bị trước khi đưa hồ sơ vào bản nháp.');installOfflineProfile(pending.profile);}
 clearProfilePreview();editors?.refresh();renderSelection();renderDraft();scheduleRecovery();profileStatus('Đã đưa vào bản nháp cục bộ. Chưa gửi thiết bị.');
}));
navigator.hid?.addEventListener('disconnect',async event=>{if(event.device===state.reader?.device||event.device?.productId===0xfefc){clearTimeout(relinkTimer);relinkTimer=null;}if(event.device===state.reader?.device){invalidateImports();const reader=state.reader;state.reader=null;dropDeviceLock();setBattery(null);state.reading=false;state.activeBlock=null;state.applyAbort?.abort();render();message('Bàn phím đã ngắt kết nối. Kiểm tra cáp USB rồi kết nối lại.',true);await editors?.cancelCalibration();await reader.close().catch(()=>{});}});
// Thông báo cho phím tắt profile: toast trong app + thông báo Windows (nếu đã cho
// phép). Âm thanh do chương trình nền a80rt_local.py phát khi dùng phím tắt toàn cục.
let toastTimer;
function toast(text,kind='info'){
  let el=$('toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.append(el);}
  el.textContent=text;if(el.dataset)el.dataset.kind=kind;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},kind==='error'?7000:4000);
}
function systemNotify(text,kind){
  if(typeof Notification==='undefined'||Notification.permission!=='granted')return;
  try{new Notification(localize(kind==='error'?'A80RT · Lỗi đổi profile':'A80RT'),{body:localize(text),tag:'a80rt-profile',silent:true,icon:'./icons/icon-192.png'});}catch{}
}
// Phím tắt chuyển profile game. Ctrl+Alt+1/2 trong app; khi chạy start.cmd,
// a80rt_local.py đăng ký cùng tổ hợp này toàn cục nên dùng được cả trong game.
// Chỉ tự Áp dụng khi bản nháp trước đó trống, để không gửi kèm thay đổi khác
// người dùng chưa duyệt; vẫn đi qua preflight, chặn Fn và đọc lại xác minh.
let presetSwitching=false,hotkeyBridge=null,hotkeyReadySent=null,hotkeyBatterySent=null;
// Mỗi cửa sổ app là một client của chương trình nền; nó chỉ gửi mỗi lần bấm phím cho MỘT cửa sổ
// (ưu tiên cửa sổ sẵn sàng ghi, rồi cửa sổ được dùng gần nhất) kèm mã sự kiện để chống xử lý trùng.
const hotkeyClient=globalThis.crypto?.randomUUID?.()??`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,12)}`;
const hotkeyHandled=new Set();
function hotkeyReady(){const session=state.session;return mode()==='device'&&!!state.reader&&!!session&&!session.invalidated;}
function reportHotkeyState(active=false){
  if(!hotkeyBridge||typeof fetch==='undefined')return;
  const ready=hotkeyReady(),battery=state.battery??-1;if(!active&&ready===hotkeyReadySent&&battery===hotkeyBatterySent)return;hotkeyReadySent=ready;hotkeyBatterySent=battery;
  fetch('./hotkeys/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client:hotkeyClient,ready,active,battery})})
    .then(response=>response.json()).then(body=>{if(!body?.known)hotkeyReadySent=null;}).catch(()=>{hotkeyReadySent=null;});
}
async function switchPreset(preset,{global=false,event=null}={}){
  const finish=(status,text,kind)=>{
    toast(text,kind);if(global||document.hidden||!document.hasFocus?.())systemNotify(text,kind);
    if(global)fetch('./hotkeys/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client:hotkeyClient,event,preset:preset.id,label:preset.label,status,message:localize(text)})}).catch(()=>{});
    return status;
  };
  if(presetSwitching)return finish('busy',`Đang đổi profile, bỏ qua ${preset.label}.`,'warning');
  const session=state.session;
  if(!session)return finish('error',`Chưa có cấu hình. Kết nối và đọc bàn phím trước khi chuyển sang ${preset.label}.`,'error');
  if(state.reading||state.connecting||state.applying||state.maintaining||session.invalidated)return finish('error','Đang có giao dịch hoặc phiên cần đọc lại; chưa chuyển profile.','error');
  presetSwitching=true;
  try{
    const hadChanges=session.diff().length>0;
    editors?.stopRecording();invalidateImports();
    session.transaction(presetEdits(state.capability??SAMPLE_CAPABILITY,preset));
    clearProfilePreview();editors?.refresh();renderSelection();renderDraft();scheduleRecovery();
    const pending=session.diff().length;
    if(mode()!=='device'||!state.reader)return finish('staged',`Đã chuyển sang ${preset.label} trong bản nháp (${mode()==='demo'?'dữ liệu mẫu':'ngoại tuyến'}, không ghi bàn phím).`,'info');
    if(!pending)return finish('already',`Bàn phím đã ở profile ${preset.label}.`,'success');
    if(hadChanges)return finish('staged',`Đã đưa ${preset.label} vào bản nháp. Bản nháp có thay đổi khác nên chưa tự ghi; kiểm tra rồi bấm Áp dụng.`,'warning');
    if($('apply-button').disabled)return finish('error',`Đã đưa ${preset.label} vào bản nháp nhưng thiết bị chưa đủ điều kiện ghi; xem thông báo trên trang.`,'error');
    toast(`Đang ghi profile ${preset.label} xuống bàn phím…`);
    const result=await applyDraft();
    if(result?.status==='verified')return finish('verified',`✓ Đã chuyển sang profile ${preset.label}. Bàn phím đã đọc lại khớp.`,'success');
    return finish('error',`Chưa chuyển được sang ${preset.label}: ${result?.error??'xem thông báo trên trang'}`,'error');
  }catch(error){return finish('error',`Không chuyển được sang ${preset.label}: ${error.message}`,'error');}
  finally{presetSwitching=false;}
}
window.addEventListener?.('keydown',event=>{
  if(event.repeat||event.defaultPrevented)return;
  const keys=shortcutFromEvent(event);if(!keys)return;
  const preset=presetLibrary.list().find(item=>item.shortcut===keys);
  if(!preset)return;event.preventDefault();void switchPreset(preset);
});
// Phím tắt do người dùng gán: gửi danh sách cho chương trình nền để đăng ký toàn cục.
// Mọi cửa sổ app cùng đọc một thư viện nên gửi lại danh sách giống nhau là vô hại.
let bindingsSent=null;
async function syncHotkeyBindings(){
  if(!hotkeyBridge?.bindable||typeof fetch==='undefined')return;
  const bindings=presetLibrary.bindings().slice(0,20),body=JSON.stringify({bindings});
  if(body===bindingsSent)return;bindingsSent=body;
  try{
    const response=await fetch('./hotkeys/bindings',{method:'POST',headers:{'Content-Type':'application/json'},body});
    const result=await response.json();if(!response.ok)throw new Error(result?.error??response.status);
    hotkeyBridge.registered=Array.isArray(result.registered)?result.registered:[];hotkeyBridge.failed=Array.isArray(result.failed)?result.failed:[];
    if(hotkeyBridge.failed.length)toast(`Không đăng ký được phím tắt toàn cục ${hotkeyBridge.failed.join(', ')}: chương trình khác đang dùng. Chọn tổ hợp khác.`,'warning');
  }catch{bindingsSent=null;}
  renderHotkeyStatus();
}
presetLibrary.subscribe(()=>{renderHotkeyStatus();void syncHotkeyBindings();});
// Cửa sổ khác của app đổi thư viện profile: nạp lại để không ghi đè bằng dữ liệu cũ.
globalThis.addEventListener?.('storage',event=>{if(event.key===null||event.key==='a80rt-rt-presets')presetLibrary.refresh();});
function renderHotkeyStatus(){
  const box=$('hotkey-status');if(!box)return;
  const keys=presetLibrary.list().filter(item=>item.shortcut).map(item=>`${item.shortcut} → ${item.label}`).join(' · ')||'—';
  const text=$('hotkey-status-text'),button=$('notify-enable');
  text.textContent=hotkeyBridge?.registered?.length?`Phím tắt: ${keys}`
    :hotkeyBridge?`Phím tắt (chỉ trong app): ${keys}`
    :`Phím tắt (chỉ trong app): ${keys}`;
  const canAsk=typeof Notification!=='undefined'&&Notification.permission==='default';
  // The exe shows hotkey results in the tray (bridge reports tray:true); the browser-settings hint does not apply there.
  if(!hotkeyBridge?.tray&&typeof Notification!=='undefined'&&Notification.permission==='denied')text.append(' ',document.createTextNode('Thông báo Windows đang bị chặn trong cài đặt trang của trình duyệt; vẫn có tiếng báo và thông báo trong app.'));// nút chữ riêng để i18n dịch được
  button.hidden=!canAsk;box.hidden=false;
}
async function connectHotkeyBridge(){
  if(typeof EventSource==='undefined'||typeof fetch==='undefined')return renderHotkeyStatus();
  try{
    const response=await fetch('./hotkeys/config',{cache:'no-store'});
    if(!response.ok)return renderHotkeyStatus();
    hotkeyBridge=await response.json();renderHotkeyStatus();void syncHotkeyBindings();
    const events=new EventSource(`./hotkeys/events?client=${encodeURIComponent(hotkeyClient)}`);
    // Mỗi lần (nối lại) kết nối, chương trình nền có thể đã khởi động lại: báo lại trạng thái.
    events.onopen=()=>{hotkeyReadySent=null;reportHotkeyState(!document.hidden&&!!document.hasFocus?.());};
    events.onmessage=event=>{
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(typeof data?.event!=='string'||hotkeyHandled.has(data.event))return;
      hotkeyHandled.add(data.event);if(hotkeyHandled.size>64)hotkeyHandled.delete(hotkeyHandled.values().next().value);
      const preset=presetLibrary.find(data.preset);if(preset)void switchPreset(preset,{global:true,event:data.event});
    };
    window.addEventListener?.('focus',()=>reportHotkeyState(true));
    document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)reportHotkeyState(true);});
  }catch{renderHotkeyStatus();}
}
$('notify-enable')?.addEventListener('click',async()=>{try{await Notification.requestPermission();}catch{}renderHotkeyStatus();});
// ---------- Pin (chỉ khi không dây) ----------
// Driver hãng: Electricity = byte 17 của khối thông tin (0x10), đọc lại 5 giây/lần
// khi packLen==32. App đọc lại 30 giây/lần, chỉ lệnh đọc, bỏ qua khi đang bận.
const BASE_TITLE=document.title;
const isReceiver=()=>state.reader?.device?.productId===0xfefc;
function batteryOf(bytes){const value=bytes?.[17];return Number.isInteger(value)&&value<=100?value:null;}
let batteryWarned=101;
function setBattery(value){
  syncBatteryPolling();
  const previous=state.battery??null;state.battery=value;
  const chip=$('battery-chip'),fill=chip?.querySelector?.('i'),label=chip?.querySelector?.('b');
  if(chip){chip.hidden=value==null;if(value!=null){if(chip.dataset)chip.dataset.level=value<=20?'low':value<=50?'mid':'ok';if(fill)fill.style.width=`${value}%`;if(label)label.textContent=`${value}%`;chip.title=`Pin bàn phím ${value}% (đầu thu 2.4 GHz)`;}}
  document.title=value==null?BASE_TITLE:`🔋${value}% · ${BASE_TITLE}`;
  try{if(value==null)navigator.clearAppBadge?.();else navigator.setAppBadge?.(value);}catch{}
  if(value!=null){
    for(const threshold of [20,10])if(value<=threshold&&batteryWarned>threshold){batteryWarned=threshold;const text=`Pin còn ${value}% · cắm sạc sớm`;toast(text,'warning');systemNotify(text,'warning');}
    if(value>25)batteryWarned=101;
  }
  if(previous!==value){reportHotkeyState();render();}
}
let batteryPolling=false,batteryTimer=null;
// Chỉ chạy khi đang nối qua đầu thu; dừng khi ngắt để không giữ tài nguyên vô ích.
function syncBatteryPolling(){
  const want=!!state.reader&&isReceiver();
  if(want&&!batteryTimer){batteryTimer=setInterval(pollBattery,30000);batteryTimer?.unref?.();}
  else if(!want&&batteryTimer){clearInterval(batteryTimer);batteryTimer=null;}
}
async function pollBattery(){
  const reader=state.reader;
  if(batteryPolling||!reader||!isReceiver()||!state.session||state.reading||state.connecting||state.applying||state.maintaining||presetSwitching)return;
  batteryPolling=true;
  try{const bytes=await reader.transport.readBlock(0x10,32);if(state.reader===reader)setBattery(batteryOf(bytes));}
  catch{/* bàn phím ngủ hoặc mất sóng: thử lại lần sau */}
  finally{batteryPolling=false;}
}
// ---------- Tự kết nối ----------
// Thiết bị đã cho phép một lần được trình duyệt nhớ: mở và đọc (chỉ đọc) mà không
// cần hộp chọn. Không tự kết nối khi bản nháp có thay đổi (kể cả phiên chưa xác nhận sau
// một lần ghi lỗi), vì kết nối mới bỏ bản nháp. Người dùng tự quyết định bấm Kết nối.
let autoConnectPaused=false;
// Điều kiện được tự kết nối; kiểm lại sau mỗi await vì người dùng có thể mở dữ liệu mẫu,
// sửa bản nháp hoặc tự bấm Kết nối trong lúc chờ danh sách thiết bị.
const autoConnectBlocked=()=>!supported||autoConnectPaused||state.reader||state.connecting||state.reading||state.applying||state.maintaining;
async function autoConnect(reason){
  if(autoConnectBlocked())return;
  if(state.session&&state.session.diff().length){
    if(reason==='plug')toast('Đã thấy bàn phím. Bản nháp chưa áp dụng nên chưa tự kết nối.','warning');
    else if(reason==='relink')message('Bản nháp còn thay đổi nên app không tự kết nối lại. Bấm Kết nối khi sẵn sàng; kết nối mới sẽ bỏ bản nháp.',true);
    return 'draft';
  }
  if(mode()==='demo')return;
  let devices=[];try{devices=(await navigator.hid.getDevices()).filter(device=>DEVICE_FILTERS.some(filter=>filter.vendorId===device.vendorId&&filter.productId===device.productId));}catch{return;}
  // Quyền WebHID cấp riêng cho từng thiết bị: cáp (A80RT U) và đầu thu (A80RT U Dongle)
  // là hai thiết bị khác nhau, mỗi cái cần được chọn một lần trong hộp chọn.
  if(!devices.length){if(reason==='start'&&!state.snapshot)message('Bấm Kết nối, chọn “A80RT U” (cáp) hoặc “A80RT U Dongle” (đầu thu). Lần sau app tự kết nối.');return;}
  if(autoConnectBlocked()||mode()==='demo'||(state.session&&state.session.diff().length))return;
  await connect(devices);
  if(state.reader&&state.capability&&!state.session)await read();
}
// ---------- Mất liên lạc qua đầu thu ----------
// Đầu thu vẫn cắm (Windows không báo ngắt) nhưng báo 55 FC 04: bàn phím ngủ, tắt hoặc
// mất ghép. Transport đã đóng phiên; bỏ reader cũ để tự kết nối lại được, giữ bản nháp.
// Thử lại thưa dần (3→30 s), chỉ gửi lệnh đọc; không bao giờ tự phát lại một lần Áp dụng.
let relinkTimer=null,relinkDelay=0;
async function onLinkLost(reader){
  if(state.reader!==reader)return;
  invalidateImports();
  state.reader=null;state.reading=false;state.activeBlock=null;state.applyAbort?.abort();
  dropDeviceLock();setBattery(null);render();
  message('Đầu thu mất liên lạc với bàn phím. Bấm một phím để đánh thức — app tự kết nối lại.',true);
  await editors?.cancelCalibration();await reader.close().catch(()=>{});
  scheduleRelink();
}
function scheduleRelink(){
  clearTimeout(relinkTimer);
  relinkDelay=Math.min(relinkDelay?relinkDelay*2:3000,30000);
  relinkTimer=setTimeout(async()=>{
    relinkTimer=null;if(autoConnectPaused||state.reader)return;
    if(await autoConnect('relink')==='draft')return;
    if(!state.reader&&!autoConnectPaused&&!relinkTimer)scheduleRelink();
  },relinkDelay);
  relinkTimer?.unref?.();
}
navigator.hid?.addEventListener('connect',()=>{autoConnectPaused=false;setTimeout(()=>void autoConnect('plug'),800);});
decorateStatic();makeKeyboard();checkBrowser();render();void refreshProfiles();void connectHotkeyBridge();void autoConnect('start');
// Cho phép cài thành app (PWA). Service worker chỉ phục vụ file giao diện tĩnh.
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
