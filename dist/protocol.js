export const VENDOR = 0x0c45;
export const DONGLE_PRODUCT = 0xfefc;
export const PRODUCTS = [0x80a1,0x80a2,DONGLE_PRODUCT];
// The receiver exposes a separate vendor collection from the wired keyboard.
export const DEVICE_FILTERS = Object.freeze([
  {vendorId:VENDOR,productId:0x80a1,usagePage:0xff68,usage:0x61},
  {vendorId:VENDOR,productId:0x80a2,usagePage:0xff68,usage:0x61},
  {vendorId:VENDOR,productId:DONGLE_PRODUCT,usagePage:0xff80,usage:1},
]);
export const transportName = device => device.productId===DONGLE_PRODUCT?'Đầu thu 2.4 GHz':'Cáp USB';
export const USAGE_PAGES = [0xff68,0xff80,0xff60];
export const READ_BLOCKS = Object.freeze([
  {id:'device',name:'Thông tin thiết bị',command:0x10,length:32},
  {id:'settings',name:'Thiết lập chung',command:0x11,length:32},
  {id:'keymap',name:'Gán phím',command:0x12,length:512},
  {id:'lighting',name:'Thiết lập đèn',command:0x13,length:16},
  {id:'fn',name:'Lớp Fn',command:0x16,length:512},
  {id:'rt',name:'Rapid Trigger',command:0x17,length:1024},
]);
const ALLOWED = new Set(READ_BLOCKS.map(b=>b.command));
export const hex = value => `0x${value.toString(16).toUpperCase().padStart(4,'0')}`;
export const bytesHex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(' ');
export function buildReadPacket(command,offset,length,packetSize,last=false) {
  if (!ALLOWED.has(command)) throw new Error('Chỉ cho phép lệnh đọc cấu hình.');
  if (![32,64].includes(packetSize)) throw new Error('Chưa hỗ trợ kích thước gói của giao diện này.');
  if (!Number.isInteger(offset)||offset<0||offset>65535||!Number.isInteger(length)||length<1||length>packetSize-8) throw new Error('Phạm vi đọc không hợp lệ.');
  const bytes=new Uint8Array(packetSize);
  bytes.set([0xaa,command,length,offset&255,offset>>>8,0,last?1:0,0]);
  return bytes;
}
export function parseReply(data,command,offset,requested) {
  const bytes = data instanceof DataView ? new Uint8Array(data.buffer,data.byteOffset,data.byteLength) : new Uint8Array(data);
  if (bytes.length<8 || bytes[0]!==0x55 || bytes[1]!==command) return null;
  const position=bytes[3]|(bytes[4]<<8);
  if (position!==offset) return null;
  const count=bytes[2];
  if (count!==requested || bytes.length<8+count) throw new Error(`Phản hồi thiếu dữ liệu tại vị trí ${offset} (${count}/${requested} byte).`);
  return bytes.slice(8,8+count);
}
export function selectInterface(device) {
  if(device.vendorId!==VENDOR||!PRODUCTS.includes(device.productId)||!device.productName?.replace(/[^a-z0-9]/gi,'').toLowerCase().includes('a80rt')) throw new Error('Thiết bị được chọn chưa được xác định là A80RT.');
  const choices=[];
  function visit(collection) {
    if(USAGE_PAGES.includes(collection.usagePage)) {
      for(const report of collection.outputReports??[]) {
        const bitSize=(report.items??[]).reduce((sum,item)=>sum+item.reportSize*item.reportCount,0);
        if(report.reportId===0&&[256,512].includes(bitSize)) choices.push({usagePage:collection.usagePage,usage:collection.usage,reportId:0,packetSize:bitSize/8});
      }
    }
    for(const child of collection.children??[]) visit(child);
  }
  for(const collection of device.collections??[]) visit(collection);
  choices.sort((a,b)=>USAGE_PAGES.indexOf(a.usagePage)-USAGE_PAGES.indexOf(b.usagePage));
  if(!choices.length) throw new Error('Không thấy giao diện cấu hình 32/64 byte phù hợp. Hãy cắm cáp USB và chọn giao diện A80RT khác.');
  return choices[0];
}
export function describeDevice(device) {
  function reportSummary(report) {
    return {reportId:report.reportId,bytes:(report.items??[]).reduce((sum,item)=>sum+item.reportSize*item.reportCount,0)/8};
  }
  function collectionSummary(collection) {
    return {usagePage:collection.usagePage,usage:collection.usage,inputReports:(collection.inputReports??[]).map(reportSummary),outputReports:(collection.outputReports??[]).map(reportSummary),featureReports:(collection.featureReports??[]).map(reportSummary),children:(collection.children??[]).map(collectionSummary)};
  }
  return {productName:device.productName,vendorId:device.vendorId,productId:device.productId,transport:transportName(device),collections:(device.collections??[]).map(collectionSummary)};
}
export function decodeKey(blocks,slot) {
  const rt=blocks.rt, keymap=blocks.keymap, fn=blocks.fn;
  const r=slot*8,k=slot*4;
  const word=(a,p)=>a[p]|(a[p+1]<<8);
  const result={slot,rt:null,keymap:null,fn:null};
  if(rt&&rt.length>=r+8) {
    const threshold=word(rt,r+2);
    result.rt={switchId:rt[r],flags:rt[r+1],actuationRaw:threshold,actuationMm:threshold===0?null:threshold/100,pressRaw:word(rt,r+4),releaseRaw:word(rt,r+6),raw:rt.slice(r,r+8)};
  }
  if(keymap&&keymap.length>=k+4) result.keymap=keymap.slice(k,k+4);
  if(fn&&fn.length>=k+4) result.fn=fn.slice(k,k+4);
  return result;
}
export class A80Reader {
  constructor(device,{onPacket=()=>{},timeout=2500}={}) {
    this.device=device; this.interface=selectInterface(device);this.onPacket=onPacket;this.timeout=timeout;this.active=false;this.abort=null;
  }
  async open(){if(!this.device.opened) await this.device.open();}
  cancel(){this.abort?.abort();}
  async close(){this.cancel();if(this.device.opened)await this.device.close();}
  exchange(command,offset,length,last,signal) {
    const packet=buildReadPacket(command,offset,length,this.interface.packetSize,last);
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);this.device.removeEventListener('inputreport',receive);signal.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
      const cancel=()=>finish(new DOMException('Đã dừng đọc.','AbortError'));
      const receive=event=>{
        if(event.reportId!==0)return;
        this.onPacket('in',new Uint8Array(event.data.buffer,event.data.byteOffset,event.data.byteLength));
        try{const reply=parseReply(event.data,command,offset,length);if(reply)finish(null,reply);}catch(error){finish(error);}
      };
      const timer=setTimeout(()=>finish(new Error(`Bàn phím chưa trả lời lệnh ${hex(command)} tại vị trí ${offset}. ${this.device.productId===DONGLE_PRODUCT?'Kiểm tra bàn phím đang bật ở chế độ 2.4 GHz, đánh thức bàn phím và đóng tab driver hãng rồi thử lại.':'Đóng tab driver hãng rồi thử cắm lại cáp USB.'}`)),this.timeout);
      if(signal.aborted){cancel();return;}
      signal.addEventListener('abort',cancel,{once:true});
      this.device.addEventListener('inputreport',receive);
      this.onPacket('out',packet);
      Promise.resolve().then(()=>{if(signal.aborted)throw new DOMException('Đã dừng đọc.','AbortError');return this.device.sendReport(0,packet);}).catch(error=>finish(error));
    });
  }
  async readAll(onProgress=()=>{},onBlock=()=>{}) {
    if(this.active) throw new Error('Một lượt đọc đang chạy.');
    if(!this.device.opened)throw new Error('Thiết bị chưa mở kết nối.');
    this.active=true; this.abort=new AbortController();
    const signal=this.abort.signal, result={};let completed=0;
    const total=READ_BLOCKS.reduce((sum,b)=>sum+b.length,0);
    try {
      for(const block of READ_BLOCKS){
        const data=new Uint8Array(block.length),capacity=this.interface.packetSize-8;
        for(let offset=0;offset<block.length;offset+=capacity){
          if(signal.aborted)throw new DOMException('Đã dừng đọc.','AbortError');
          const length=Math.min(capacity,block.length-offset);
          const reply=await this.exchange(block.command,offset,length,offset+length===block.length,signal);
          data.set(reply,offset);completed+=length;onProgress({completed,total,block:block.id,name:block.name});
        }
        result[block.id]=Array.from(data);onBlock(block.id,result[block.id]);
      }
      return result;
    }finally{this.active=false;this.abort=null;}
  }
}
