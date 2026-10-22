import {buildReadPacket,parseReply,selectInterface,hex,DONGLE_PRODUCT} from '../protocol.js';

const stopped=()=>new DOMException('Đã dừng đọc.','AbortError');

// Read-only transport. The manufacturer retries the identical read after 3 s.
export class A80Transport {
  constructor(device,{onTrace=()=>{},timeoutMs=3000}={}) {
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Thời gian chờ không hợp lệ.');
    this.device=device;this.interface=selectInterface(device);this.onTrace=onTrace;this.timeoutMs=timeoutMs;
    this._opened=false;this._hasResponse=false;this._sessionId=0;this._tail=Promise.resolve();this._pending=null;
  }
  getState(){return {opened:this._opened&&this.device.opened,hasResponse:this._hasResponse,sessionId:this._sessionId};}
  _trace(type,details={}){this.onTrace({type,sessionId:this._sessionId,at:Date.now(),...details});}
  async open(){
    if(this._closing)await this._closing;
    if(this._opened&&this.device.opened)return;
    if(this._opening)return this._opening;
    const sessionId=++this._sessionId;
    this._opening=(async()=>{
      if(!this.device.opened)await this.device.open();
      if(sessionId!==this._sessionId)throw stopped();
      this._hasResponse=false;
      this._listener=event=>{
        if(sessionId!==this._sessionId||!this._opened||event.reportId!==this.interface.reportId)return;
        const bytes=new Uint8Array(event.data.buffer,event.data.byteOffset,event.data.byteLength).slice();
        this._trace('rx',{bytes});
        const pending=this._pending;
        if(!pending||pending.sessionId!==sessionId)return;
        try{
          const reply=parseReply(bytes,pending.command,pending.offset,pending.length);
          if(reply){this._hasResponse=true;pending.finish(null,reply);}
        }catch(error){pending.finish(error);}
      };
      this.device.addEventListener('inputreport',this._listener);this._opened=true;this._trace('opened');
    })();
    try{await this._opening;}finally{this._opening=null;}
  }
  async close(){
    if(this._closing)return this._closing;
    ++this._sessionId;this._opened=false;this._hasResponse=false;
    if(this._listener)this.device.removeEventListener('inputreport',this._listener);
    this._listener=null;this._pending?.finish(stopped());this._tail=Promise.resolve();
    this._closing=(async()=>{
      if(this._opening)await this._opening.catch(()=>{});
      if(this.device.opened)await this.device.close();
      this._trace('closed');
    })();
    try{await this._closing;}finally{this._closing=null;}
  }
  readBlock(command,length,{signal}={}){
    // Validate before queueing; never issue write, reset, or guessed wake opcodes.
    if(!Number.isInteger(length)||length<1||length>65536)return Promise.reject(new Error('Phạm vi đọc không hợp lệ.'));
    try{buildReadPacket(command,0,Math.min(length,this.interface.packetSize-8),this.interface.packetSize);}
    catch(error){return Promise.reject(error);}
    const sessionId=this._sessionId;
    const run=async()=>{
      if(signal?.aborted||sessionId!==this._sessionId)throw stopped();
      if(!this.getState().opened)throw new Error('Thiết bị chưa mở kết nối.');
      const data=new Uint8Array(length),capacity=this.interface.packetSize-8;
      for(let offset=0;offset<length;offset+=capacity){
        if(signal?.aborted||sessionId!==this._sessionId)throw stopped();
        const count=Math.min(capacity,length-offset);
        const reply=await this.exchange(command,offset,count,offset+count===length,signal,sessionId);
        data.set(reply,offset);
      }
      return data;
    };
    const result=this._tail.then(run);this._tail=result.catch(()=>{});
    if(!signal)return result;
    return new Promise((resolve,reject)=>{
      const cancel=()=>reject(stopped());
      if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
      result.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
    });
  }
  exchange(command,offset,length,last,signal,sessionId=this._sessionId){
    if(signal?.aborted||sessionId!==this._sessionId)return Promise.reject(stopped());
    if(!this.getState().opened)return Promise.reject(new Error('Thiết bị chưa mở kết nối.'));
    if(this._pending)return Promise.reject(new Error('Một yêu cầu đọc đang chạy.'));
    const packet=buildReadPacket(command,offset,length,this.interface.packetSize,last);
    return new Promise((resolve,reject)=>{
      let timer,settled=false,attempt=0;
      const finish=(error,value)=>{
        if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        if(this._pending===pending)this._pending=null;
        error?reject(error):resolve(value);
      };
      const cancel=()=>finish(stopped());
      const pending={command,offset,length,sessionId,finish};this._pending=pending;
      const send=()=>{
        if(settled)return;
        if(signal?.aborted||sessionId!==this._sessionId){cancel();return;}
        attempt++;this._trace('tx',{bytes:packet.slice(),command,offset,length,attempt});
        // Arm before sending: inputreport may fire before sendReport resolves.
        timer=setTimeout(()=>{
          if(attempt<2){this._trace('retry',{command,offset,attempt});send();return;}
          this._trace('timeout',{command,offset,attempt});
          finish(new Error(`Bàn phím chưa trả lời lệnh ${hex(command)} tại vị trí ${offset}. ${this.device.productId===DONGLE_PRODUCT?'Kiểm tra bàn phím đang bật ở chế độ 2.4 GHz, đánh thức bàn phím và đóng tab driver hãng rồi thử lại.':'Đóng tab driver hãng rồi thử cắm lại cáp USB.'}`));
        },this.timeoutMs);
        Promise.resolve().then(()=>{
          if(settled||sessionId!==this._sessionId||signal?.aborted)return;
          return this.device.sendReport(this.interface.reportId,packet);
        }).catch(error=>finish(error));
      };
      signal?.addEventListener('abort',cancel,{once:true});send();
    });
  }
}
