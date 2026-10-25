import {identifyDevice} from '../device/capabilities.js';
import {A80Transport} from '../device/transport.js';
import {decodeBlock} from '../config/codecs.js';

const calibrations=new WeakMap();
const result=(status,requiresReload,reason,extra={})=>({status,requiresReload,reason,...extra});
const complete=(snapshot,id,capability)=>snapshot?.coverage?.[id]?.complete===true&&snapshot.coverage[id].receivedBytes===capability.blocks[id].length&&snapshot.coverage[id].expectedBytes===capability.blocks[id].length&&snapshot.blocks?.[id]?.length===capability.blocks[id].length;
const FIELDS=[
 {id:'polling',label:'Tần số phản hồi',options:[{value:3,label:'1.000 Hz'},{value:5,label:'4.000 Hz'},{value:6,label:'8.000 Hz'}]},
 {id:'sleep',label:'Tắt đèn khi không sử dụng (phút)',min:0,max:30,hint:'0: luôn bật đèn · 1–30 phút. Đây là thời gian tắt đèn, chưa xác minh chế độ ngủ sâu.'},
 {id:'stability',label:'Ổn định tín hiệu',options:[{value:0,label:'Tắt'},{value:1,label:'Bật'}]},
 {id:'autoCalibration',label:'Hiệu chuẩn thích ứng (Beta)',options:[{value:0,label:'Tắt'},{value:1,label:'Bật'}],hint:'Hiệu chuẩn động trong lúc sử dụng; khác với phiên hiệu chuẩn thủ công.'},
 {id:'topDeadZone',label:'Vùng chết phía trên · toàn bàn phím (mm)',min:0,max:0.5,step:0.01,scale:100,hint:'Top Dead Zone · 0,00–0,50 mm, bước 0,01 mm. Không phụ thuộc vùng phím đang chọn.'},
 {id:'bottomDeadZone',label:'Vùng chết phía dưới · toàn bàn phím (mm)',min:0,max:0.5,step:0.01,scale:100,hint:'Bottom Dead Zone · 0,00–0,50 mm. Số 0 được giữ nguyên; không suy ra trạng thái bật/tắt riêng.'},
];

export function settingsView(capability,snapshot){
 if(identifyDevice(capability.identity)!==capability)throw new Error('Unknown model capability.');
 const matches=snapshot&&identifyDevice(snapshot.identity)===capability;
 const fields=matches&&complete(snapshot,'settings',capability)?decodeBlock('settings',snapshot.blocks.settings,capability).fields:{};
 const info={version:null,battery:null,axialModel:null};
 if(matches&&snapshot.provenance?.source==='device'&&complete(snapshot,'device',capability)){
   const actual=decodeBlock('device',snapshot.blocks.device,capability).fields;
   Object.assign(info,{version:actual.version===null?null:actual.version.toFixed(2),battery:actual.battery,axialModel:actual.axialModel});
 }
 return {fields:FIELDS.filter(field=>capability.settings[field.id]).map(field=>({...structuredClone(field),value:fields[field.id]??null})),info,actions:{manualCalibration:{supported:capability.maintenance.manualCalibration,qualified:false},reset:{supported:true,scope:'Toàn bộ thiết lập thiết bị',qualified:false},firmware:{supported:true,status:capability.firmware.status,directFlash:false,officialUrl:capability.firmware.officialUrl,model:capability.name}}};
}

// One reservation spans begin → explicit end/cancel, so Apply cannot interleave.
// Cleanup deliberately ignores the cancelled UI signal.101 may SAVE, never undo.
export async function runDeviceAction(action,context){
 const request=typeof action==='string'?{type:action}:action;
 const {transport,capability,session,signal,onProgress=()=>{},onInvalidate=()=>{}}=context;
 if(!request||typeof request.type!=='string')throw new Error('Device action required.');
 if(identifyDevice(capability?.identity)!==capability)throw new Error('Unknown model capability.');
 const type=request.type;
 if(type==='firmware'||type==='flash'){
   if(request.model!==capability.model)return result('rejected',false,'Model firmware không khớp model đang chọn.');
   if(type==='flash'||request.image!==undefined)return result('unsupported',false,'Chưa hỗ trợ flash trực tiếp: chưa xác minh ảnh firmware, model và luồng nạp.');
   const opened=context.openOfficial?.(capability.firmware.officialUrl);
   return opened?result('external-opened',false,`Đã mở web hãng. Chọn đúng ${capability.name} và kiểm tra kết nối trước khi dùng công cụ hãng; ứng dụng chưa thực hiện flash.`):result('failed',false,'Trình duyệt chưa mở được web hãng. Cho phép mở tab rồi thử lại.');
 }
 if(!(transport instanceof A80Transport)||identifyDevice(transport.device)!==capability)throw new Error('Maintenance requires the matching live device transport.');
 if(type==='endCalibration'||type==='cancelCalibration'){
   const current=calibrations.get(transport);
   if(!current)return result('idle',false,'Không có phiên hiệu chuẩn đang chạy.');
   current.finish(type);return current.done;
 }
 if(!['beginCalibration','reset'].includes(type))throw new Error('Unknown maintenance action.');
 const gate=transport.getMaintenanceState(type);
 if(!gate.ready)return result('unsupported',false,gate.reason);
 if(type==='beginCalibration'&&!transport.getMaintenanceState('endCalibration').ready)return result('unsupported',false,'Chưa xác minh lệnh kết thúc hiệu chuẩn; không thể bắt đầu.');
 if(signal?.aborted)return result('cancelled',false,'Đã hủy trước khi gửi.');
 if(type==='reset'&&request.confirmed!==true)return result('confirmation-required',false,'Khôi phục toàn bộ thiết lập thiết bị, gồm gán phím, RT, macro, đèn và thiết lập chung; cần xác nhận riêng.');
 const invalidate=()=>{session?.invalidate('Snapshot đã hết hiệu lực sau thao tác bảo trì; đọc lại cấu hình.');onInvalidate();};
 if(type==='reset')return transport.withTransaction(async io=>{
   invalidate();onProgress({phase:'reset'});
   try{await io.sendMaintenance('reset',{signal});return result('unconfirmed',true,'Đã gửi yêu cầu khôi phục toàn bộ thiết lập. Chưa xác nhận kết quả; đọc lại cấu hình.');}
   catch(error){return result('unconfirmed',true,`Khôi phục chưa được xác nhận: ${error.message}. Cần đọc lại cấu hình.`);}
 });
 if(calibrations.has(transport))throw new Error('Một phiên hiệu chuẩn đang chạy.');
 let ready,finish;const started=new Promise(resolve=>ready=resolve),ending=new Promise(resolve=>finish=resolve);
 const current={finish,done:null};calibrations.set(transport,current);
 const cancel=()=>finish('cancelCalibration');signal?.addEventListener('abort',cancel,{once:true});
 const stopOnDisconnect=transport.onSessionEnd(cancel);
 current.done=transport.withTransaction(async io=>{
   let attempted=false,error;
   try{
     invalidate();onProgress({phase:'starting'});attempted=true;
     await io.sendMaintenance('beginCalibration',{signal});
     onProgress({phase:'active'});ready(result('active',true,'Đang hiệu chuẩn. Kết thúc hoặc hủy sẽ gửi lệnh kết thúc/lưu; không hoàn tác kết quả đã hiệu chuẩn.'));
     await ending;
   }catch(caught){error=caught;}
   finally{
     if(attempted)try{await io.sendMaintenance('endCalibration');}catch(caught){error=caught;}
   }
   return result('unconfirmed',attempted,error?`Chưa xác nhận kết thúc hiệu chuẩn: ${error.message}. Có thể đã lưu dữ liệu; cần đọc lại hoặc kết nối lại.`:'Đã gửi kết thúc/lưu hiệu chuẩn; không hoàn tác kết quả. Cần đọc lại để kiểm tra, chưa xác nhận hoàn tất.');
 }).then(value=>{ready(value);onProgress({phase:'ended',result:value});return value;},error=>{ready(Promise.reject(error));throw error;}).finally(()=>{signal?.removeEventListener('abort',cancel);stopOnDisconnect();calibrations.delete(transport);});
 // Keep the final outcome observable even if a caller only awaited begin.
 current.done.catch(()=>{});
 return started;
}

export function mountDeviceSettings(root,context){
 const {session,capability,transport}=context,doc=context.document??globalThis.document,win=context.window??globalThis.window;
 const modelLabel=context.modelConfirmed===false?'Chưa xác định model':capability.name;
 const listeners=[],inputs=new Map(),dirty=new Set(),panels=new Map(),tabs=new Map();let active='general',busy=false,calibrating=false,destroyed=false,cancelling=null;
 const make=(tag,text,cls)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 const listen=(target,type,fn)=>{if(!target?.addEventListener)return;target.addEventListener(type,fn);listeners.push(()=>target.removeEventListener(type,fn));};
 const element=(tag,id,text,cls)=>{const el=make(tag,text,cls);el.id=id;return el;};
 const heading=make('div',undefined,'editor-heading');heading.append(make('h2','Thiết lập & bảo trì'),make('p',modelLabel));
 const tabbar=make('div',undefined,'editor-tabs');tabbar.setAttribute('role','tablist');tabbar.setAttribute('aria-label','Thiết lập thiết bị');
 const status=element('p','settings-status','Thay đổi thiết lập được thêm vào bản nháp; chỉ gửi khi bấm Áp dụng.','editor-hint');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const view=()=>settingsView(capability,session?.snapshot);
 const editable=()=>!!session&&!session.invalidated&&!session.applying&&!busy&&!context.isBusy?.()&&Object.keys(capability.blocks).every(id=>complete(session.snapshot,id,capability));
 const setBusy=value=>{busy=value;if(!value)calibrating=false;context.onBusyChange?.(value);refresh();};
 const show=value=>{if(!destroyed){status.textContent=value;refresh();}};
 const button=(parent,id,label,handler)=>{const el=element('button',id,label,'button quiet small');el.type='button';listen(el,'click',()=>{if(!el.disabled)return handler();});parent.append(el);return el;};
 for(const [id,label]of [['general','Thiết lập'],['maintenance','Hiệu chuẩn & khôi phục'],['firmware','Firmware']]){
   const panel=element('div',`settings-panel-${id}`,undefined,'settings-panel');panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`settings-tab-${id}`);panels.set(id,panel);
   const tab=button(tabbar,`settings-tab-${id}`,label,async()=>{context.onNavigate?.();if(active===id)return;active=id;refresh();await cancelCalibration();});tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);tabs.set(id,tab);
 }
 const general=panels.get('general'),grid=make('div',undefined,'editor-panel');general.append(grid);
 for(const field of view().fields){
   const wrapper=make('div',undefined,'editor-field'),label=make('label',field.label),input=element(field.options?'select':'input',`settings-${field.id}`);label.htmlFor=input.id;wrapper.append(label,input);grid.append(wrapper);inputs.set(field.id,input);
   if(field.options)for(const option of field.options){const el=make('option',option.label);el.value=String(option.value);input.append(el);}
   else{input.type='number';input.min=String(field.min);input.max=String(field.max);input.step=String(field.step??1);}
   if(field.hint)wrapper.append(make('small',field.hint,'editor-hint'));
   listen(input,'change',()=>{dirty.add(field.id);try{if(!editable())throw new Error('Đọc lại snapshot đầy đủ trước khi sửa thiết lập.');const scaled=input.value.trim()===''?NaN:Number(input.value)*(field.scale??1);const value=Math.abs(scaled-Math.round(scaled))<1e-8?Math.round(scaled):scaled;session.edit('settings',[{field:field.id,value}]);dirty.delete(field.id);context.onEdit?.();show('Đã thêm thiết lập vào bản nháp. Bấm Áp dụng để gửi và đọc lại xác minh.');}catch(error){show(`Chưa thêm vào bản nháp: ${error.message}`);}});
 }
 general.append(make('p','Các trường hệ điều hành và cách đánh thức chưa có mã giá trị/model được xác minh; dữ liệu gốc được giữ nguyên.','editor-hint'));
 const maintenance=panels.get('maintenance'),maintenanceReason=element('p','settings-maintenance-reason',undefined,'editor-hint');maintenance.append(maintenanceReason);
 maintenance.append(make('h3','Hiệu chuẩn thủ công'),make('p',capability.maintenance.manualCalibration?'Giữ kết nối trong suốt phiên. Kết thúc và hủy đều gửi thao tác kết thúc/lưu; kết quả đã hiệu chuẩn có thể được lưu và không được hoàn tác.':'Driver hãng ẩn hiệu chuẩn thủ công cho model đầu thu này. Dùng hướng dẫn chính thức đúng model.','editor-hint'));
 const calibrationActions=make('div',undefined,'actions');maintenance.append(calibrationActions);
 const runContext=()=>({...context,onProgress:event=>{context.onProgress?.(event);if(event.phase==='ended'){show(event.result.reason);setBusy(false);}else show(event.phase==='active'?'Đang hiệu chuẩn; chưa xác nhận kết quả.':'Đang gửi thao tác bảo trì…');}});
 const begin=button(calibrationActions,'settings-calibration-begin','Bắt đầu hiệu chuẩn',async()=>{
   calibrating=true;setBusy(true);try{const value=await runDeviceAction('beginCalibration',runContext());show(value.reason);if(value.status!=='active')setBusy(false);}catch(error){show(error.message);setBusy(false);}
 });
 const end=button(calibrationActions,'settings-calibration-end','Kết thúc / lưu',()=>cancelCalibration('endCalibration'));
 const cancel=button(calibrationActions,'settings-calibration-cancel','Hủy và kết thúc',()=>cancelCalibration());
 maintenance.append(make('h3','Khôi phục toàn bộ thiết bị'),make('p','Phạm vi yêu cầu của hãng: toàn bộ thiết lập thiết bị, gồm gán phím, RT, macro, đèn và thiết lập chung. Thao tác riêng, không nằm trong Áp dụng bản nháp. Cần đọc lại sau yêu cầu để kiểm tra.','editor-hint'));
 const confirmLabel=make('label',undefined,'settings-confirm'),confirm=element('input','settings-reset-confirm');confirm.type='checkbox';confirmLabel.append(confirm,make('span','Tôi hiểu phạm vi khôi phục toàn bộ thiết bị.'));maintenance.append(confirmLabel);listen(confirm,'change',refresh);
 const reset=button(maintenance,'settings-reset','Khôi phục toàn bộ thiết bị',async()=>{
   setBusy(true);try{const value=await runDeviceAction({type:'reset',confirmed:confirm.checked},runContext());show(value.reason);setBusy(false);if(value.requiresReload)await context.onReload?.();}catch(error){show(error.message);setBusy(false);}
 });
 const firmware=panels.get('firmware'),info=element('p','settings-device-info',undefined,'settings-info');firmware.append(info,make('h3','Cập nhật qua công cụ hãng'),make('p',`${context.modelConfirmed===false?'Kết nối thiết bị có model được nhận diện trước khi chọn firmware.':`Chọn đúng ${capability.name} tại web LEOBOG.`} Với đầu thu, kiểm tra hướng dẫn riêng cho đầu thu và bàn phím trước khi chọn ảnh firmware. Phiên bản mới nhất và ảnh firmware chưa được xác minh ở đây. Flash trực tiếp trong ứng dụng: chưa hỗ trợ.`,'editor-hint'));
 const official=button(firmware,'settings-official','Mở web driver LEOBOG ↗',async()=>{try{const value=await runDeviceAction({type:'firmware',model:capability.model},{...context,openOfficial:context.openOfficial??(url=>{const opened=win?.open?.(url,'_blank');if(opened)opened.opener=null;return opened;})});show(value.reason);}catch(error){show(error.message);}});
 firmware.append(make('p','Tab công cụ hãng hoạt động bên ngoài ứng dụng. Đóng kết nối ở đây trước khi kết nối thiết bị bên công cụ hãng. Mở trang không xác nhận đã cập nhật firmware.','editor-hint'));
 root.replaceChildren(heading,tabbar,...panels.values(),status);
 function refresh(){
   if(destroyed)return;const current=view(),canEdit=editable();
   for(const field of current.fields){const input=inputs.get(field.id);input.disabled=!canEdit;if(!dirty.has(field.id)){
     const value=session?.draft?.settings?decodeBlock('settings',session.draft.settings,capability).fields[field.id]:field.value;
     if(field.options&&value!==null&&!field.options.some(option=>option.value===value)&&!input._unknownValue){const option=make('option',`Giá trị gốc chưa nhận diện (${value})`);option.value=String(value);input.append(option);input._unknownValue=true;}
     input.value=value===null?'':String(value/(field.scale??1));
   }}
   for(const [id,tab]of tabs){tab.setAttribute('aria-selected',String(active===id));panels.get(id).hidden=active!==id;}
   const live=!!transport&&session?.snapshot.provenance.source==='device',externalBusy=!!context.isBusy?.(),gate=transport?.getMaintenanceState('beginCalibration'),resetGate=transport?.getMaintenanceState('reset');
   maintenanceReason.textContent=session?.invalidated?session.invalidReason:!live?'Đọc snapshot đầy đủ từ thiết bị thật trước khi bảo trì. Chưa có xác minh ACK bảo trì từ thiết bị thật.':gate?.reason??'Thao tác bảo trì giữ riêng phiên giao tiếp; cần đọc lại khi kết thúc.';
   begin.hidden=!capability.maintenance.manualCalibration;begin.disabled=!live||!canEdit||!gate?.ready;end.disabled=cancel.disabled=!calibrating;confirm.disabled=busy||externalBusy||!live||!resetGate?.ready;reset.disabled=!live||!canEdit||!resetGate?.ready||!confirm.checked;
   official.disabled=busy||externalBusy||context.modelConfirmed===false;
   const actual=session?.invalidated?{version:null,battery:null}:current.info;
   info.textContent=`${modelLabel} · Firmware trong bản đọc: ${actual.version??'Chưa có dữ liệu thực hợp lệ'} · Pin trong bản đọc: ${actual.battery===null?'Chưa có dữ liệu thực hợp lệ':`${actual.battery}%`}`;
 }
 async function cancelCalibration(type='cancelCalibration'){
   if(cancelling)return cancelling;if(!calibrating||!transport)return result('idle',false,'Không có phiên hiệu chuẩn.');
   cancelling=(async()=>{try{const value=await runDeviceAction(type,runContext());show(value.reason);return value;}catch(error){show(error.message);return result('unconfirmed',true,error.message);}finally{setBusy(false);cancelling=null;}})();return cancelling;
 }
 listen(doc,'visibilitychange',()=>{if(doc.hidden)cancelCalibration();});listen(win,'pagehide',()=>cancelCalibration());
 listen(root,'focusin',()=>context.onNavigate?.());
 listen(doc,'click',event=>{const tab=event.target?.closest?.('[role="tab"]');if(tab&&![...tabs.values()].includes(tab))cancelCalibration();});
 refresh();return {refresh,cancelCalibration,async destroy(){if(destroyed)return;destroyed=true;for(const off of listeners)off();root.replaceChildren();await cancelCalibration();}};
}
