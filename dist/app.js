import {LAYOUT,KEYS} from './layout.js';
import {A80Reader,READ_BLOCKS,VENDOR,PRODUCTS,decodeKey,hex,bytesHex} from './protocol.js';
const $=id=>document.getElementById(id);
const state={reader:null,snapshot:null,selected:34,layer:'base',reading:false,connecting:false,activeBlock:null,progress:0,totalPackets:0};
const buttons=new Map();
const supported=!!navigator.hid&&window.isSecureContext;
let runtimeHidBlocked=false;
const time=value=>new Date(value).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function message(text,error=false){$('message').hidden=!text;$('message').textContent=text;$('message').classList.toggle('error',error);}
function clearMessage(){message('');}
function setText(id,text){$(id).textContent=text;}
function mode(){return state.snapshot?.source??'empty';}
function describeSource(){if(mode()==='demo')return 'Dữ liệu mẫu';if(mode()==='import')return 'Bản đã lưu';if(mode()==='device')return state.reader?'Bàn phím thật':'Bản đọc trước';return 'Chưa có dữ liệu';}
function makeKeyboard(){
  for(const row of LAYOUT){
    const container=document.createElement('div');container.className='key-row';
    for(const key of row){
      const button=document.createElement('button');button.type='button';button.className='key';button.style.setProperty('--width',key.width);
      button.setAttribute('aria-label',`Phím ${key.label}, vị trí ${key.slot}`);button.setAttribute('aria-pressed','false');
      const label=document.createElement('span');label.textContent=key.label;button.append(label);
      const value=document.createElement('small');value.textContent='';button.append(value);
      button.addEventListener('click',()=>{state.selected=key.slot;renderSelection();});
      buttons.set(key.slot,{button,value});container.append(button);
    }
    $('keyboard').append(container);
  }
}
function renderBlocks(){
  $('block-list').replaceChildren();
  for(const [index,block] of READ_BLOCKS.entries()){
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
  const blocks=state.snapshot?.blocks??{};
  const selected=KEYS.find(key=>key.slot===state.selected),decoded=decodeKey(blocks,state.selected),rt=decoded.rt;
  for(const key of KEYS){
    const {button,value}=buttons.get(key.slot);const item=decodeKey(blocks,key.slot),chosen=key.slot===state.selected;
    button.classList.toggle('selected',chosen);button.classList.toggle('has-data',!!item.rt);button.setAttribute('aria-pressed',String(chosen));
    value.textContent=item.rt?.actuationMm!=null?item.rt.actuationMm.toFixed(2):'';
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
  setText('key-state',!rt?'Đọc cấu hình để xem thông số thực.':mm==null?'Giá trị 0: chưa xác định điểm nhận; có thể đang dùng mặc định của firmware.':mode()==='demo'?'Thông số minh họa, chưa đọc từ thiết bị.':'Điểm nhận được giải mã từ cấu hình; không phải hành trình nhấn trực tiếp.');
  setText('key-switch',rt?String(rt.switchId):'—');setText('key-flags',rt?`0x${rt.flags.toString(16).toUpperCase().padStart(2,'0')}`:'—');
  const mapping=state.layer==='fn'?decoded.fn:decoded.keymap;
  setText('key-mapping',mapping?bytesHex(mapping):'—');
  setText('key-rt-raw',rt?bytesHex(rt.raw):'Chưa có dữ liệu');setText('key-map-raw',mapping?bytesHex(mapping):'Chưa có dữ liệu');
  setText('key-thresholds',rt?`${rt.pressRaw} / ${rt.releaseRaw}`:'—');
}
function renderLog(){
  const packets=state.snapshot?.packets??[];
  setText('packet-count',`${state.snapshot?.totalPackets??0} gói`);
  setText('log',packets.length?packets.slice(-80).map(p=>`${p.at}  ${p.direction==='out'?'TX →':'RX ←'}  ${bytesHex(p.bytes)}`).join('\n'):'Nhật ký xuất hiện khi bắt đầu đọc cấu hình.');
}
function render(){
  const connected=!!state.reader,source=mode(),hasData=!!state.snapshot&&Object.keys(state.snapshot.blocks).length>0;
  const busy=state.reading||state.connecting;
  $('connect-button').hidden=connected;$('connect-button').disabled=!supported||runtimeHidBlocked||busy;
  $('disconnect-button').hidden=!connected;$('disconnect-button').disabled=busy;
  $('read-button').hidden=state.reading;$('read-button').disabled=!connected||busy;
  $('cancel-button').hidden=!state.reading;$('cancel-button').disabled=false;
  $('sample-button').disabled=busy||connected;$('import-button').disabled=busy||connected;
  $('export-button').disabled=(!hasData&&!(state.snapshot?.totalPackets>0))||busy;$('exit-sample').disabled=busy;
  $('sample-notice').hidden=source!=='demo';
  $('progress-wrap').hidden=!state.reading;$('progress-bar').style.width=`${state.progress}%`;
  const device=connected?state.reader.device:state.snapshot?.device;
  setText('device-name',device?.productName??'Chưa kết nối');
  setText('device-sub',source==='demo'?'DỮ LIỆU MẪU · MINH HỌA':connected?'GIAO DIỆN CẤU HÌNH USB':source==='import'?'BẢN ĐỌC TỪ TỆP JSON':'LEOBOG A80RT / A80RT U');
  const fields=connected?[
    ['VID / PID',`${hex(device.vendorId)} / ${hex(device.productId)}`],['Gói tin',`${state.reader.interface.packetSize} byte`],['Trạng thái','Đã kết nối'],
  ]:[['Kết nối','USB / WebHID'],['Trạng thái',source==='demo'?'Dữ liệu mẫu':hasData?'Bản đã lưu':'Đang chờ']];
  $('device-meta').replaceChildren();for(const [label,value]of fields){const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;$('device-meta').append(dt,dd);}
  $('connection-pill').className=`pill${connected?' connected':source==='demo'?' sample':''}`;
  $('connection-pill').replaceChildren(document.createElement('i'),document.createTextNode(connected?'Đã kết nối':source==='demo'?'Dữ liệu mẫu':'Chưa kết nối'));
  setText('source-stat',describeSource());setText('source-note',state.snapshot?`${state.snapshot.complete?'Đủ 6 nhóm':'Bản đọc chưa đủ'} · ${time(state.snapshot.createdAt)}`:'Sẵn sàng kết nối');
  const count=Object.keys(state.snapshot?.blocks??{}).length;$('blocks-stat').replaceChildren(document.createTextNode(`${count} `));const total=document.createElement('em');total.textContent='/ 6';$('blocks-stat').append(total);
  setText('blocks-note',state.reading?`Đang đọc · ${Math.round(state.progress)}%`:hasData?'Dữ liệu có thể xuất thành JSON':'Thông tin, phím, Fn, RT và đèn');
  setText('next-title',state.connecting?'Đang mở kết nối…':connected?'Bàn phím đã sẵn sàng':source==='demo'?'Khám phá bằng dữ liệu mẫu':'Bắt đầu với bàn phím của bạn');
  setText('next-copy',connected?'Chọn “Đọc cấu hình” để lấy thông số hiện tại.':source==='demo'?'Chọn từng phím để xem thông số minh họa, hoặc kết nối bàn phím thật.':'Cắm cáp USB, đóng tab driver hãng, rồi chọn kết nối.');
  setText('keyboard-caption',source==='empty'?'Chưa đọc dữ liệu từ bàn phím':source==='demo'?'Mẫu minh họa · không phải dữ liệu thiết bị':state.reading?'Đang nhận cấu hình…':`${describeSource()} · ${state.snapshot.complete?'đã đọc đủ':'còn thiếu nhóm dữ liệu'}`);
  setText('read-label',state.reading?`Đang đọc · ${READ_BLOCKS.find(b=>b.id===state.activeBlock)?.name??'cấu hình'}`:'Đọc cấu hình hiện tại');
  setText('read-detail',state.reading?`${Math.round(state.progress)}% · có thể dừng bất cứ lúc nào`:'6 nhóm thông số · xử lý tại thiết bị');
  renderBlocks();renderSelection();renderLog();
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
    const devices=await navigator.hid.requestDevice({filters:PRODUCTS.map(productId=>({vendorId:VENDOR,productId}))});
    if(!devices.length){message('Chưa chọn thiết bị. Bạn có thể thử kết nối lại.');return;}
    const candidates=devices.filter(d=>d.collections.some(c=>[0xff68,0xff80,0xff60].includes(c.usagePage)));
    let lastError;
    for(const device of candidates){try{reader=new A80Reader(device,{onPacket:addPacket});break;}catch(error){lastError=error;}}
    if(!reader)throw lastError??new Error('Không tìm thấy giao diện cấu hình A80RT. Thử cắm cáp USB và chọn lại thiết bị.');
    await reader.open();state.reader=reader;state.snapshot=null;state.progress=0;
    message('Đã kết nối. Chọn “Đọc cấu hình” để bắt đầu lấy dữ liệu.');
  }catch(error){if(reader)await reader.close().catch(()=>{});message(error.name==='NotAllowedError'?'Trình duyệt chưa cấp quyền kết nối. Hãy mở trang trực tiếp trong Chrome/Edge rồi thử lại.':`Kết nối chưa thành công: ${error.message}`,true);}
  finally{state.connecting=false;render();}
}
async function disconnect(){
  const reader=state.reader;state.reader=null;
  if(reader)await reader.close().catch(()=>{});
  render();
}
async function read(){
  if(!state.reader||state.reading)return;
  const reader=state.reader;
  state.snapshot={schema:'a80rt-reader/v1',source:'device',createdAt:new Date().toISOString(),complete:false,device:{productName:reader.device.productName,vendorId:reader.device.vendorId,productId:reader.device.productId},interface:{...reader.interface},blocks:{},packets:[],totalPackets:0};
  state.reading=true;state.progress=0;clearMessage();render();
  try{
    await reader.readAll(progress=>{state.activeBlock=progress.block;state.progress=100*progress.completed/progress.total;render();},(id,bytes)=>{state.snapshot.blocks[id]=bytes;render();});
    state.snapshot.complete=true;message('Đã đọc đủ 6 nhóm cấu hình. Bạn có thể chọn phím để xem thông số hoặc xuất JSON.');
  }catch(error){message(error.name==='AbortError'?'Đã dừng đọc. Các nhóm đã nhận đủ vẫn được giữ để xem và xuất JSON.':`Đọc chưa hoàn tất: ${error.message}`,error.name!=='AbortError');}
  finally{state.reading=false;state.activeBlock=null;render();}
}
function sample(){
  if(state.reader||state.reading)return;
  const blocks=Object.fromEntries(READ_BLOCKS.map(b=>[b.id,Array(b.length).fill(0)]));
  for(const key of KEYS){
    const point=['W','A','S','D'].includes(key.label)?80:key.label==='Space'?120:180;
    const offset=key.slot*8;blocks.rt.splice(offset,8,1,point===80?2:0,point&255,point>>>8,20,0,20,0);
    blocks.keymap.splice(key.slot*4,4,key.usage,0,0,0);
  }
  state.snapshot={schema:'a80rt-reader/v1',source:'demo',createdAt:new Date().toISOString(),complete:true,device:{productName:'A80RT · mẫu minh họa',vendorId:VENDOR,productId:0x80a2},blocks,packets:[],totalPackets:0};
  clearMessage();render();
}
function exportData(){
  if(!state.snapshot)return;
  const snapshot={...state.snapshot,notes:{hardwareVerified:false,interpretation:'actuationRaw/100 => mm; zero is left unspecified; press/release are raw values',protocolReference:'https://leobog.driveall.cn/static/js/app.3086f769.js'}};
  const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`a80rt-${mode()==='demo'?'DEMO':mode()==='import'?'saved':'read'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importData(event){
  const file=event.target.files[0];event.target.value='';if(!file||state.reader||state.reading)return;
  try{
    if(file.size>2*1024*1024)throw new Error('Tệp lớn hơn giới hạn 2 MB.');
    const input=JSON.parse(await file.text());
    if(input.schema!=='a80rt-reader/v1'||!input.blocks||!input.device||!['device','demo','import'].includes(input.source))throw new Error('Chỉ mở bản JSON xuất từ A80RT Reader.');
    const blocks={};for(const block of READ_BLOCKS){const bytes=input.blocks[block.id];if(bytes===undefined)continue;if(!Array.isArray(bytes)||bytes.length!==block.length||bytes.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error(`Nhóm ${block.name} không hợp lệ.`);blocks[block.id]=bytes;}
    if(!Object.keys(blocks).length)throw new Error('Tệp chưa có nhóm cấu hình nào.');
    if(typeof input.device.productName!=='string'||input.device.productName.length>100||!Number.isInteger(input.device.vendorId)||!Number.isInteger(input.device.productId)||Number.isNaN(Date.parse(input.createdAt)))throw new Error('Thông tin thiết bị hoặc thời gian không hợp lệ.');
    state.snapshot={schema:input.schema,source:input.source==='demo'?'demo':'import',originalSource:input.originalSource??input.source,createdAt:input.createdAt,device:input.device,blocks,complete:Object.keys(blocks).length===READ_BLOCKS.length,packets:[],totalPackets:0};
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
$('sample-button').addEventListener('click',sample);
$('exit-sample').addEventListener('click',()=>{state.snapshot=null;clearMessage();render();});
$('export-button').addEventListener('click',exportData);
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',importData);
$('layer-base').addEventListener('click',()=>{state.layer='base';renderSelection();});
$('layer-fn').addEventListener('click',()=>{state.layer='fn';renderSelection();});
$('diagnostics').addEventListener('toggle',renderLog);
navigator.hid?.addEventListener('disconnect',event=>{if(event.device===state.reader?.device){state.reader.cancel();state.reader=null;render();message('Bàn phím đã ngắt kết nối. Kiểm tra cáp USB rồi kết nối lại.',true);}});
makeKeyboard();checkBrowser();render();
