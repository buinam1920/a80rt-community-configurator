import {LAYOUT,KEYS} from './layout.js';
import {A80Reader,VENDOR,DEVICE_FILTERS,describeDevice,transportName,decodeKey,hex,bytesHex} from './protocol.js';
import {identifyDevice,readPlan} from './device/capabilities.js';
import {ConfigSession} from './config/session.js';
import {mountCoreEditors} from './ui/core-editors.js';
import {mountAdvancedEditors} from './ui/advanced-editors.js';
import {mountDeviceSettings} from './ui/device-settings.js';
import {createProfile,parseProfile,exportProfile,restoreProfile,previewProfile,loadProfile,createIndexedDBStorage,saveProfile,listProfiles,duplicateProfile,deleteProfile,saveRecovery,readRecovery} from './config/profiles.js';
const SAMPLE_CAPABILITY=identifyDevice({vendorId:VENDOR,productId:0x80a2,productName:'A80RT'});
const BLOCK_NAMES={device:'Thông tin thiết bị',settings:'Thiết lập chung',keymap:'Gán phím',lighting:'Thiết lập đèn',colors:'Màu từng phím',macro:'Macro',fn:'Lớp Fn',rt:'Rapid Trigger',dks:'DKS'};
const FULL_BLOCKS=readPlan(SAMPLE_CAPABILITY).map(block=>({...block,name:BLOCK_NAMES[block.id]}));
let editors=null,mountedSession=undefined,mountedCapability=undefined;
const $=id=>document.getElementById(id);
const state={reader:null,snapshot:null,selected:34,selectedSlots:[34],multi:false,session:null,capability:null,applying:false,maintaining:false,applyAbort:null,layer:'base',reading:false,connecting:false,activeBlock:null,progress:0,totalPackets:0};
const buttons=new Map();
const profileStorage=createIndexedDBStorage();
let profileItems=[],profileRecovery=null,profilePending=null,profileBusy=false,profileLibrary=null,profileRefresh=0,recoveryTimer,recoveryQueue=Promise.resolve();
const supported=!!navigator.hid&&window.isSecureContext;
let runtimeHidBlocked=false;
const time=value=>new Date(value).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function message(text,error=false){$('message').hidden=!text;$('message').textContent=text;$('message').classList.toggle('error',error);}
function clearMessage(){message('');}
function setText(id,text){$(id).textContent=text;}
function mode(){return state.snapshot?.source??'empty';}
function describeSource(){if(mode()==='demo')return 'Dữ liệu mẫu';if(mode()==='import')return 'Bản đã lưu';if(mode()==='device')return state.reader?'Bàn phím thật':Object.keys(state.snapshot.blocks).length?'Bản đọc trước':'Thông tin thiết bị';return 'Chưa có dữ liệu';}
function deviceSnapshot(device,interfaceInfo=null){return {schema:'a80rt-reader/v1',appVersion:'0.3.0-preview',source:'device',createdAt:new Date().toISOString(),complete:false,device:{productName:device.productName,vendorId:device.vendorId,productId:device.productId},descriptor:describeDevice(device),interface:interfaceInfo?{...interfaceInfo}:null,blocks:{},packets:[],totalPackets:0};}
function makeKeyboard(){
  for(const row of LAYOUT){
    const container=document.createElement('div');container.className='key-row';
    for(const key of row){
      const button=document.createElement('button');button.type='button';button.className='key';button.style.setProperty('--width',key.width);
      button.setAttribute('aria-label',`Phím ${key.label}, vị trí ${key.slot}`);button.setAttribute('aria-pressed','false');
      const label=document.createElement('span');label.textContent=key.label;button.append(label);
      const value=document.createElement('small');value.textContent='';button.append(value);
      button.addEventListener('click',event=>{
        state.selected=key.slot;
        if(state.multi||event.ctrlKey||event.metaKey||event.shiftKey)state.selectedSlots=state.selectedSlots.includes(key.slot)?state.selectedSlots.filter(slot=>slot!==key.slot):[...state.selectedSlots,key.slot];
        else state.selectedSlots=[key.slot];
        renderSelection();editors?.setSelection(state.selectedSlots);
      });
      buttons.set(key.slot,{button,value});container.append(button);
    }
    $('keyboard').append(container);
  }
}
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
function renderSelection(){
  const blocks=state.session?.draft??state.snapshot?.blocks??{};
  const selected=KEYS.find(key=>key.slot===state.selected),decoded=decodeKey(blocks,state.selected),rt=decoded.rt;
  for(const key of KEYS){
    const {button,value}=buttons.get(key.slot);const item=decodeKey(blocks,key.slot),chosen=state.selectedSlots.includes(key.slot);
    button.classList.toggle('selected',chosen);button.classList.toggle('has-data',!!item.rt);button.setAttribute('aria-pressed',String(chosen));
    value.textContent=item.rt?.actuationMm!=null?item.rt.actuationMm.toFixed(2):'';
    const rgb=blocks.colors?.slice(key.slot*4+1,key.slot*4+4);button.classList.toggle('has-color',!!rgb);if(rgb?.length===3)button.style.setProperty('--key-rgb',`rgb(${Array.from(rgb).join(',')})`);
    button.title=`${key.label} · vị trí ${key.slot}${item.rt?.actuationMm!=null?` · ${item.rt.actuationMm.toFixed(2)} mm`:''}`;
  }
  $('layer-base').setAttribute('aria-pressed',String(state.layer==='base'));$('layer-fn').setAttribute('aria-pressed',String(state.layer==='fn'));
  setText('selected-slot',`#${String(state.selected).padStart(3,'0')}`);setText('selected-key-name',selected.label);
  setText('key-layer',state.layer==='fn'?'Fn':'Mặc định');
  const mm=rt?.actuationMm;
  $('key-actuation').replaceChildren(document.createTextNode(mm!=null?mm.toFixed(2)+' ':'— '));const unit=document.createElement('small');unit.textContent='mm';$('key-actuation').append(unit);
  $('actuation-stat').replaceChildren(document.createTextNode(mm!=null?mm.toFixed(2)+' ':'— '));const statUnit=document.createElement('em');statUnit.textContent='mm';$('actuation-stat').append(statUnit);
  setText('actuation-note',`Phím ${selected.label} · ${rt?'giải mã từ cấu hình':'chưa có dữ liệu'}`);
  const percent=mm!=null?Math.min(100,Math.max(0,mm/3.4*100)):0;
  $('travel-fill').style.width=`${percent}%`;$('travel-marker').style.left=`${percent}%`;$('travel-marker').style.display=mm!=null?'block':'none';
  setText('key-state',!rt?'Đọc cấu hình để xem thông số thực.':mm==null?'Giá trị gốc là 0; chưa xác định ý nghĩa, được giữ nguyên.':mode()==='demo'?'Thông số minh họa, chưa đọc từ thiết bị.':'Điểm nhận được giải mã từ cấu hình; không phải hành trình nhấn trực tiếp.');
  setText('key-switch',rt?String(rt.switchId):'—');setText('key-flags',rt?`0x${rt.flags.toString(16).toUpperCase().padStart(2,'0')}`:'—');
  const mapping=state.layer==='fn'?decoded.fn:decoded.keymap;
  setText('key-mapping',mapping?bytesHex(mapping):'—');
  setText('key-rt-raw',rt?bytesHex(rt.raw):'Chưa có dữ liệu');setText('key-map-raw',mapping?bytesHex(mapping):'Chưa có dữ liệu');
  setText('key-thresholds',rt?`${rt.pressRaw} / ${rt.releaseRaw}`:'—');
  setText('selection-count',`${state.selectedSlots.length} phím đã chọn`);
  editors?.setLayer(state.layer);
}
function renderLog(){
  const packets=state.snapshot?.packets??[];
  setText('packet-count',`${state.snapshot?.totalPackets??0} gói`);
  setText('log',packets.length?packets.slice(-80).map(p=>`${p.at}  ${p.direction==='out'?'TX →':'RX ←'}  ${bytesHex(p.bytes)}`).join('\n'):'Nhật ký xuất hiện khi bắt đầu đọc cấu hình.');
}
function render(){
  const connected=!!state.reader,source=mode(),hasData=!!state.snapshot&&Object.keys(state.snapshot.blocks).length>0;
  const responding=connected&&state.reader.getState().hasResponse;
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
  ]:[['Kết nối','USB / 2.4 GHz'],['Trạng thái',source==='demo'?'Dữ liệu mẫu':hasData?'Bản đã lưu':'Đang chờ']];
  $('device-meta').replaceChildren();for(const [label,value]of fields){const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;$('device-meta').append(dt,dd);}
  $('connection-pill').className=`pill${connected?' connected':source==='demo'?' sample':''}`;
  $('connection-pill').replaceChildren(document.createElement('i'),document.createTextNode(connected?(responding?'Đã nhận phản hồi':'Chờ phản hồi'):source==='demo'?'Dữ liệu mẫu':'Chưa kết nối'));
  setText('source-stat',describeSource());setText('source-note',state.snapshot?`${state.snapshot.complete?'Đủ 9 nhóm':hasData?'Bản đọc chưa đủ':'Chưa đọc cấu hình'} · ${time(state.snapshot.createdAt)}`:'Sẵn sàng kết nối');
  const count=Object.keys(state.snapshot?.blocks??{}).length;$('blocks-stat').replaceChildren(document.createTextNode(`${count} `));const total=document.createElement('em');total.textContent='/ 9';$('blocks-stat').append(total);
  setText('blocks-note',state.reading?`Đang đọc · ${Math.round(state.progress)}%`:hasData?'Dữ liệu có thể xuất thành JSON':'Thông tin, phím, Fn, RT và đèn');
  setText('next-title',state.connecting?'Đang mở kết nối…':connected?(responding?'Bàn phím đã phản hồi':'Đã mở kết nối · chờ phản hồi'):source==='demo'?'Khám phá bằng dữ liệu mẫu':'Bắt đầu với bàn phím của bạn');
  setText('next-copy',connected?`${transportName(device)} · Chọn “Đọc cấu hình” để lấy thông số hiện tại.`:source==='demo'?'Chọn từng phím để xem thông số minh họa, hoặc kết nối bàn phím thật.':'Cắm cáp USB hoặc đầu thu 2.4 GHz, bật bàn phím và đóng tab driver hãng.');
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
async function connect(){
  if(!supported||state.connecting||state.reading)return;
  clearMessage();state.connecting=true;render();let reader;
  try{
    const devices=await navigator.hid.requestDevice({filters:DEVICE_FILTERS.map(filter=>({...filter}))});
    if(!devices.length){message('Chưa chọn thiết bị. Với kết nối 2.4 GHz, chọn “A80RT U Dongle”; nếu danh sách trống, bật bàn phím ở chế độ 2.4 GHz rồi thử cắm lại đầu thu.');return;}
    state.session=null;state.capability=null;state.snapshot=deviceSnapshot(devices[0]);
    let lastError;
    for(const device of devices){try{reader=new A80Reader(device,{onPacket:(direction,bytes)=>{if(state.reader===reader)addPacket(direction,bytes);}});break;}catch(error){lastError=error;}}
    if(!reader)throw lastError??new Error('Không tìm thấy giao diện cấu hình A80RT. Thử cắm lại đầu thu 2.4 GHz hoặc cáp USB.');
    state.snapshot=deviceSnapshot(reader.device,reader.interface);
    await reader.open();state.reader=reader;
    try{state.capability=identifyDevice(reader.device);}catch{state.capability=null;}state.progress=0;state.snapshot.session=reader.getState();
    message(`Đã mở kết nối qua ${transportName(reader.device).toLocaleLowerCase('vi-VN')}; chưa có phản hồi cấu hình. Chọn “Đọc cấu hình” để lấy dữ liệu.`);
  }catch(error){if(reader)await reader.close().catch(()=>{});message(error.name==='NotAllowedError'?'Trình duyệt chưa cấp quyền kết nối. Hãy mở trang trực tiếp trong Chrome/Edge rồi thử lại.':`Kết nối chưa thành công: ${error.message}`,true);}
  finally{state.connecting=false;render();}
}
async function disconnect(){
  await editors?.cancelCalibration();
  const reader=state.reader;state.reader=null;state.reading=false;state.activeBlock=null;state.applyAbort?.abort();
  if(reader)await reader.close().catch(()=>{});
  render();
}
async function read(){
  if(!state.reader||state.reading||state.applying||state.maintaining)return;
  if(!state.capability){message('Danh tính model chưa khớp hoàn toàn; chưa thể đọc snapshot chỉnh sửa.',true);return;}
  const reader=state.reader;
  const sessionId=reader.getState().sessionId;
  const snapshot=deviceSnapshot(reader.device,reader.interface);snapshot.session=reader.getState();state.snapshot=snapshot;state.session=null;
  const ownsRead=()=>state.reader===reader&&state.snapshot===snapshot;
  const current=()=>ownsRead()&&reader.getState().sessionId===sessionId;
  state.reading=true;state.progress=0;clearMessage();render();
  try{
    const captured=await reader.readConfiguration(state.capability,{onProgress:progress=>{if(!current())return;state.activeBlock=progress.block;state.progress=100*progress.completed/progress.total;render();}});
    if(current()){state.session=new ConfigSession(captured,state.capability);snapshot.blocks=captured.blocks;snapshot.complete=true;message(reader.transport.getWriteState().qualified?'Đã đọc đủ 9 nhóm cấu hình. Chỉnh bản nháp rồi bấm Áp dụng để gửi và đọc lại xác minh.':'Đã đọc đủ 9 nhóm cấu hình. Có thể chỉnh bản nháp; model hoặc firmware này chưa được mở ghi.');}
  }catch(error){if(ownsRead())message(error.name==='AbortError'?'Đã dừng đọc. Chưa có snapshot hoàn chỉnh để chỉnh sửa.':`Đọc chưa hoàn tất: ${error.message}`,error.name!=='AbortError');}
  finally{if(ownsRead()){snapshot.session=reader.getState();state.reading=false;state.activeBlock=null;render();}}
}
function sample(){
  if(state.reader||state.reading||state.applying)return;
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
  state.snapshot={schema:'a80rt-reader/v1',source:'demo',createdAt:new Date().toISOString(),complete:true,device:{...capability.identity,productName:'A80RT · mẫu minh họa'},blocks,packets:[],totalPackets:0};
  clearMessage();render();
}
function renderEditors(){
  const capability=state.capability??SAMPLE_CAPABILITY;
  if(mountedSession===state.session&&mountedCapability===capability)return;
  editors?.destroy();mountedSession=state.session;mountedCapability=capability;
  const context={session:state.session,capability,selectedSlots:state.selectedSlots,isBusy:()=>state.reading||state.connecting||state.applying||state.maintaining||!!state.session?.invalidated,onNavigate:()=>editors?.cancelCalibration(),onEdit:()=>{clearProfilePreview();renderSelection();renderDraft();scheduleRecovery();}};
  const core=mountCoreEditors($('core-editors'),{...context,onLayerChange:layer=>{state.layer=layer;renderSelection();}});
  const advanced=mountAdvancedEditors($('advanced-editors'),context);
  const settings=mountDeviceSettings($('device-settings'),{...context,modelConfirmed:!!state.capability,transport:state.capability?state.reader?.transport:undefined,onNavigate:()=>advanced.stopRecording(),onInvalidate:()=>{if(state.session===context.session&&state.snapshot)state.snapshot.complete=false;},onReload:()=>read(),onBusyChange:value=>{if(mountedSession!==context.session)return;state.maintaining=value;if(value)advanced.stopRecording();render();editors?.refresh();}});
  editors={setSelection(slots){core.setSelection(slots);advanced.setSelection(slots);},setLayer(layer){core.setLayer(layer);advanced.setLayer(layer);},refresh(){core.refresh();advanced.refresh();settings.refresh();},stopRecording:()=>advanced.stopRecording(),cancelCalibration:()=>settings.cancelCalibration(),destroy(){core.destroy();advanced.destroy();settings.destroy();}};
  editors.setLayer(state.layer);
}
function draftReason(){
  if(!state.session)return mode()==='import'?'Bản JSON cũ chỉ để xem. Đọc đủ cấu hình từ thiết bị để chỉnh sửa.':'Đọc đủ 9 nhóm cấu hình để chỉnh sửa.';
  if(state.session.invalidated)return state.session.invalidReason;
  if(mode()==='demo')return 'Dữ liệu mẫu · bản nháp cục bộ, không gửi thiết bị.';
  if(!state.reader)return 'Đã ngắt kết nối · đọc lại snapshot sau khi kết nối để ghi.';
  if(state.session.snapshot.provenance.sessionId!==state.reader.getState().sessionId)return 'Phiên kết nối đã đổi · cần đọc lại snapshot.';
  const qualification=state.reader.transport.getWriteState();
  if(!qualification.qualified)return `Chưa thể ghi: ${qualification.reason??'chưa có xác minh ACK ghi từ thiết bị thật.'}`;
  return 'Áp dụng sẽ gửi bản nháp và đọc lại để xác minh.';
}
function renderDraft(){
  const count=state.session?.diff().length??0,busy=state.reading||state.connecting||state.applying||state.maintaining||!!state.session?.invalidated;
  setText('draft-count',`${count} thay đổi trong bản nháp`);setText('apply-reason',draftReason());
  $('revert-button').disabled=!state.session||!count||busy;
  $('apply-button').disabled=!state.session||!count||busy||mode()!=='device'||!state.reader||!state.reader.transport.getWriteState().qualified||state.session.snapshot.provenance.sessionId!==state.reader.getState().sessionId;
}
async function applyDraft(){
  if($('apply-button').disabled)return;
  const reader=state.reader,session=state.session,abort=new AbortController();state.applyAbort=abort;state.applying=true;render();
  const pending=session.apply(reader.transport,{signal:abort.signal,onProgress:progress=>{if(state.reader===reader&&state.session===session)message(`Đang ${progress.phase==='readback'?'đọc lại xác minh':'gửi bản nháp'}${progress.block?` · ${BLOCK_NAMES[progress.block]}`:''}…`);}});
  editors?.refresh();
  let result;try{result=await pending;}catch(error){result={status:'failed',error:error.message};}
  if(state.reader===reader&&state.session===session){
    if(result.status==='verified'){state.snapshot.blocks=session.snapshot.blocks;message('Đã áp dụng và đọc lại khớp các trường đã sửa. Chưa xác minh lưu qua lần kết nối lại.');}
    else message(`${result.status==='unconfirmed'?'Đã gửi một phần, chưa xác nhận':'Chưa áp dụng'}: ${result.error}`,true);
  }
  state.applying=false;if(state.applyAbort===abort)state.applyAbort=null;editors?.refresh();render();
}
function exportData(){
  if(!state.snapshot)return;
  const snapshot={...state.snapshot,blocks:Object.fromEntries(Object.entries(state.session?.draft??state.snapshot.blocks).map(([id,bytes])=>[id,Array.from(bytes)])),notes:{hardwareVerified:false,interpretation:'actuationRaw/100 => mm; zero is left unspecified; press/release are raw values',protocolReference:'https://leobog.driveall.cn/static/js/app.3086f769.js'}};
  const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`a80rt-${mode()==='demo'?'DEMO':mode()==='import'?'saved':'read'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function profileStatus(text,error=false){setText('profile-status',text);$('profile-status').classList.toggle('error',error);}
function libraryCapability(){return [SAMPLE_CAPABILITY,identifyDevice({vendorId:VENDOR,productId:0x80a1,productName:'A80RT U'}),identifyDevice({vendorId:VENDOR,productId:0xfefc,productName:'A80RT U Dongle'})].find(cap=>cap.model===$('profile-model').value)??SAMPLE_CAPABILITY;}
function selectedProfile(){return profileItems.find(p=>p.id===$('profile-list').value);}
function profileBlocked(){return profileBusy||state.reading||state.connecting||state.applying||state.maintaining||!!state.session?.invalidated;}
function clearProfilePreview(){profilePending=null;$('profile-preview').hidden=true;renderProfiles();}
function renderProfiles(){
 const busy=profileBlocked(),selected=selectedProfile();
 if(profilePending?.session!==state.session){profilePending=null;$('profile-preview').hidden=true;}
 for(const id of ['profile-model','profile-list','profile-name','profile-import'])$(id).disabled=busy;
 for(const id of ['profile-rename','profile-duplicate','profile-delete','profile-open'])$(id).disabled=busy||!selected;
 $('profile-save').disabled=busy||!state.session;$('profile-export').disabled=busy||(!state.session&&!selected&&!profilePending);
 $('profile-recover').disabled=busy||!profileRecovery;$('profile-confirm').disabled=busy||!profilePending||profilePending.profile.readOnly===true;$('profile-cancel').disabled=busy||!profilePending;
 const model=state.capability?.model;
 if(model&&profileLibrary!==model){profileLibrary=model;$('profile-model').value=model;void refreshProfiles();}
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
 profilePending={profile,session,draft:session?JSON.stringify(session.draft):null};
 $('profile-preview').textContent=profile.readOnly?'JSON v1 · chỉ xem, không tạo hồ sơ đầy đủ.\n'+JSON.stringify(profile.blocks,null,2):session?`${profile.name} · ${profile.source==='sample'?'Dữ liệu mẫu':'Bản đã lưu'} · ${changes.length} thay đổi so với bản nháp hiện tại\n`+changes.map(change=>`${change.block} · ${change.path}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join('\n'):`${profile.name} · Bản đã lưu · ${profile.identity.productName}\nMở 9 vùng cấu hình trong phiên ngoại tuyến. Không có quyền ghi thiết bị.`;
 $('profile-preview').hidden=false;profileStatus(profile.readOnly?'Bản cũ chỉ để xem.':session?'Đã xem trước. Xác nhận để đưa các trường được hỗ trợ vào bản nháp.':'Xác nhận để mở hồ sơ ngoại tuyến.');renderProfiles();
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
  recoveryQueue=recoveryQueue.catch(()=>{}).then(()=>saveRecovery(profile,profileStorage)).then(()=>{if(state.session===session){profileRecovery=profile;profileStatus('Đã giữ bản nháp để phục hồi sau tải lại.');renderProfiles();}}).catch(error=>{if(state.session===session)profileStatus(`Chưa lưu phục hồi; bản nháp vẫn còn: ${error.message}`,true);});
 },350);
}
function downloadProfile(profile){const blob=new Blob([exportProfile(profile)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${profile.identity?.model??'a80rt'}-profile.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importConfigurationProfile(event){
 const file=event.target.files[0];event.target.value='';if(!file)return;
 await profileAction(async()=>{clearProfilePreview();if(file.size>2*1024*1024)throw new Error('Tệp lớn hơn giới hạn 2 MB.');const text=await file.text(),input=JSON.parse(text),cap=state.capability??(input.schema==='a80rt-profile/v2'?identifyDevice(input.identity):libraryCapability());const profile=parseProfile(text,cap);stageProfile(profile);});
}
async function importData(event){
  const file=event.target.files[0];event.target.value='';if(!file||state.reader||state.reading)return;
  try{
    if(file.size>2*1024*1024)throw new Error('Tệp lớn hơn giới hạn 2 MB.');
    const input=JSON.parse(await file.text());
    if(input.schema!=='a80rt-reader/v1'||!input.blocks||!input.device||!['device','demo','import'].includes(input.source))throw new Error('Chỉ mở bản JSON xuất từ A80RT Reader.');
    const blocks={};for(const block of FULL_BLOCKS){const bytes=input.blocks[block.id];if(bytes===undefined)continue;if(!Array.isArray(bytes)||bytes.length!==block.length||bytes.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error(`Nhóm ${block.name} không hợp lệ.`);blocks[block.id]=bytes;}
    if(!Object.keys(blocks).length)throw new Error('Tệp chưa có nhóm cấu hình nào.');
    if(typeof input.device.productName!=='string'||input.device.productName.length>100||!Number.isInteger(input.device.vendorId)||!Number.isInteger(input.device.productId)||Number.isNaN(Date.parse(input.createdAt)))throw new Error('Thông tin thiết bị hoặc thời gian không hợp lệ.');
    state.session=null;state.capability=null;state.snapshot={schema:input.schema,source:input.source==='demo'?'demo':'import',originalSource:input.originalSource??input.source,createdAt:input.createdAt,device:input.device,blocks,complete:Object.keys(blocks).length===FULL_BLOCKS.length,packets:[],totalPackets:0};
    clearMessage();render();message('Đã mở bản đã lưu. Dữ liệu này không được đọc trực tiếp từ bàn phím trong phiên hiện tại.');
  }catch(error){message(`Không thể mở bản đã lưu: ${error.message}`,true);}
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
$('revert-button').addEventListener('click',()=>{state.session?.revert();clearProfilePreview();editors?.refresh();clearMessage();renderSelection();renderDraft();scheduleRecovery();});
$('apply-button').addEventListener('click',applyDraft);
$('sample-button').addEventListener('click',sample);
$('exit-sample').addEventListener('click',()=>{state.snapshot=null;state.session=null;state.capability=null;clearMessage();render();});
$('export-button').addEventListener('click',exportData);
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',importData);
$('layer-base').addEventListener('click',()=>{state.layer='base';renderSelection();});
$('layer-fn').addEventListener('click',()=>{state.layer='fn';renderSelection();});
$('diagnostics').addEventListener('toggle',renderLog);
$('profiles-panel').addEventListener('focusin',()=>editors?.stopRecording());
$('profiles-panel').addEventListener('pointerdown',()=>editors?.stopRecording());
$('profile-model').addEventListener('change',()=>{profileLibrary=state.capability?.model??$('profile-model').value;clearProfilePreview();void refreshProfiles();});
$('profile-list').addEventListener('change',()=>{clearProfilePreview();const p=selectedProfile();if(p)$('profile-name').value=p.name;renderProfiles();});
$('profile-import').addEventListener('click',()=>{editors?.stopRecording();$('profile-file').click();});
$('profile-file').addEventListener('change',importConfigurationProfile);
$('profile-save').addEventListener('click',()=>profileAction(async()=>{const p=createProfile(state.session,$('profile-name').value),id=await saveProfile(p,profileStorage);await refreshProfiles(id);profileStatus('Đã lưu hồ sơ cục bộ.');}));
$('profile-rename').addEventListener('click',()=>profileAction(async()=>{const p=selectedProfile();if(!p)return;const id=await saveProfile({...p,name:$('profile-name').value},profileStorage);await refreshProfiles(id);profileStatus('Đã đổi tên hồ sơ.');}));
$('profile-duplicate').addEventListener('click',()=>profileAction(async()=>{const p=selectedProfile();if(!p)return;const id=await saveProfile(duplicateProfile(p,`${$('profile-name').value} · bản sao`),profileStorage);await refreshProfiles(id);profileStatus('Đã nhân bản hồ sơ.');}));
$('profile-delete').addEventListener('click',()=>profileAction(async()=>{const p=selectedProfile();if(!p)return;await deleteProfile(p.id,p.identity,profileStorage);clearProfilePreview();await refreshProfiles();profileStatus('Đã xóa hồ sơ khỏi trình duyệt. Bản nháp hiện tại vẫn còn.');}));
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
navigator.hid?.addEventListener('disconnect',async event=>{if(event.device===state.reader?.device){const reader=state.reader;state.reader=null;state.reading=false;state.activeBlock=null;state.applyAbort?.abort();render();message('Bàn phím đã ngắt kết nối. Kiểm tra cáp USB rồi kết nối lại.',true);await editors?.cancelCalibration();await reader.close().catch(()=>{});}});
makeKeyboard();checkBrowser();render();void refreshProfiles();
