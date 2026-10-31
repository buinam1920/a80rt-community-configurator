// Native HID bridge for the standalone window (WebView2).
// WebView2 has no WebHID device chooser, so the host (NativeShell.cs) talks to
// the keyboard through the Windows HID API and this script exposes the same
// navigator.hid surface the app already uses: getDevices/requestDevice,
// connect/disconnect events, HIDDevice.open/close/sendReport and 'inputreport'.
// Report bytes pass through unchanged (base64 over postMessage), so every
// measured protocol rule in the app (framing, ACK parsing, qualification,
// readback) is still enforced by the same JavaScript.
(function installNativeHid(global){
  const webview=global.chrome&&global.chrome.webview;
  if(!webview||global.__a80rtNativeHid)return;
  global.__a80rtNativeHid=true;

  const toBase64=bytes=>{let text='';for(let i=0;i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);return global.btoa(text);};
  const fromBase64=text=>{const raw=global.atob(text||''),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;};
  let sequence=0;const pending=new Map(),devices=new Map();
  function call(op,args){
    return new Promise((resolve,reject)=>{
      const id=++sequence;pending.set(id,{resolve,reject});
      webview.postMessage(JSON.stringify(Object.assign({id,op},args||{})));
    });
  }

  class NativeHIDDevice extends EventTarget{
    constructor(info){
      super();this._path=info.path;this.oninputreport=null;this._opened=false;
      this.vendorId=info.vendorId;this.productId=info.productId;this.productName=info.productName||'';
      this.collections=info.collections||[];
    }
    get opened(){return this._opened;}
    async open(){
      if(this._opened)return;
      await call('open',{path:this._path});this._opened=true;
    }
    async close(){
      if(!this._opened)return;
      this._opened=false;await call('close',{path:this._path});
    }
    async forget(){await this.close();}
    async sendReport(reportId,data){
      if(!this._opened)throw new DOMException('The device must be opened first.','InvalidStateError');
      const bytes=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
      await call('send',{path:this._path,reportId:reportId|0,data:toBase64(bytes)});
    }
    async sendFeatureReport(){throw new DOMException('Feature reports are not used by this app.','NotSupportedError');}
    async receiveFeatureReport(){throw new DOMException('Feature reports are not used by this app.','NotSupportedError');}
  }
  const deviceFor=info=>{
    let device=devices.get(info.path);
    if(!device){device=new NativeHIDDevice(info);devices.set(info.path,device);}
    return device;
  };
  const matches=(device,filter)=>
    (filter.vendorId===undefined||filter.vendorId===device.vendorId)&&
    (filter.productId===undefined||filter.productId===device.productId)&&
    (filter.usagePage===undefined&&filter.usage===undefined||device.collections.some(c=>
      (filter.usagePage===undefined||c.usagePage===filter.usagePage)&&(filter.usage===undefined||c.usage===filter.usage)));

  const hid=new EventTarget();hid.onconnect=null;hid.ondisconnect=null;
  hid.getDevices=async()=>(await call('list')).map(deviceFor);
  // No chooser in a native app: every connected A80RT configuration interface
  // that matches the app's own filters is returned, in host enumeration order.
  hid.requestDevice=async(options)=>{
    const filters=(options&&options.filters)||[];
    const list=await hid.getDevices();
    return filters.length?list.filter(device=>filters.some(filter=>matches(device,filter))):list;
  };

  webview.addEventListener('message',event=>{
    const message=typeof event.data==='string'?JSON.parse(event.data):event.data;
    if(!message||typeof message!=='object')return;
    if(message.kind==='reply'){
      const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);
      if(message.ok)entry.resolve(message.result);
      else entry.reject(new DOMException(message.error||'Native HID request failed.',message.name||'NetworkError'));
    }else if(message.kind==='input'){
      const device=devices.get(message.path);if(!device||!device._opened)return;
      const bytes=fromBase64(message.data),report=new Event('inputreport');
      report.device=device;report.reportId=message.reportId|0;report.data=new DataView(bytes.buffer);
      device.dispatchEvent(report);if(typeof device.oninputreport==='function')device.oninputreport(report);
    }else if(message.kind==='connect'){
      const device=deviceFor(message.device),change=new Event('connect');change.device=device;
      hid.dispatchEvent(change);if(typeof hid.onconnect==='function')hid.onconnect(change);
    }else if(message.kind==='disconnect'){
      const device=devices.get(message.path);if(!device)return;
      device._opened=false;devices.delete(message.path);
      const change=new Event('disconnect');change.device=device;
      hid.dispatchEvent(change);if(typeof hid.ondisconnect==='function')hid.ondisconnect(change);
    }
  });
  Object.defineProperty(global.Navigator.prototype,'hid',{configurable:true,enumerable:true,get(){return hid;}});
})(typeof window!=='undefined'?window:globalThis);
