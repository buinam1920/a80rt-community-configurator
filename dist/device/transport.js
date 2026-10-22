import {buildReadPacket,parseReply,selectInterface,hex,DONGLE_PRODUCT} from '../protocol.js';
import {identifyDevice} from './capabilities.js';

const stopped=()=>new DOMException('Đã dừng đọc.','AbortError');

// Reads retry once. Writes never retry and require an internal measured ACK
// policy; there is currently no qualified production policy.
export class A80Transport {
  constructor(device,{onTrace=()=>{},timeoutMs=3000}={}) {
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Thời gian chờ không hợp lệ.');
    this.device=device;this.interface=selectInterface(device);this.onTrace=onTrace;this.timeoutMs=timeoutMs;
    this._opened=false;this._hasResponse=false;this._sessionId=0;this._writeEpoch=0;this._tail=Promise.resolve();this._pending=null;
  }
  getState(){return {opened:this._opened&&this.device.opened,deviceOpened:this.device.opened,linkLost:!!this._linkLost,hasResponse:this._hasResponse,sessionId:this._sessionId,writeEpoch:this._writeEpoch};}
  _trace(type,details={}){this.onTrace({type,sessionId:this._sessionId,at:Date.now(),...details});}
  async open(){
    if(this._closing)await this._closing;
    if(this._opened&&this.device.opened)return;
    if(this._opening)return this._opening;
    const sessionId=++this._sessionId;
    this._opening=(async()=>{
      if(!this.device.opened)await this.device.open();
      if(sessionId!==this._sessionId)throw stopped();
      this._hasResponse=false;this._linkLost=false;
      this._listener=event=>{
        if(sessionId!==this._sessionId||!this._opened||event.reportId!==this.interface.reportId)return;
        const bytes=new Uint8Array(event.data.buffer,event.data.byteOffset,event.data.byteLength).slice();
        this._trace('rx',{bytes});
        // Native probe retained only55 FC04 0000. Source routes FC/4 to
        // link loss; the USB receiver can remain enumerated and opened.
        if(bytes.length>=5&&bytes[0]===0x55&&bytes[1]===0xfc&&bytes[2]===4){
          this._linkLost=true;this._opened=false;this._hasResponse=false;++this._sessionId;
          this.device.removeEventListener('inputreport',this._listener);this._listener=null;
          this._pending?.finish(new Error('Đầu thu báo mất liên kết với bàn phím. Đánh thức bàn phím ở chế độ 2.4 GHz rồi kết nối và đọc lại.'));
          this._tail=Promise.resolve();this._trace('link-lost',{header:bytes.slice(0,5)});return;
        }
        const pending=this._pending;
        if(!pending||pending.sessionId!==sessionId)return;
        try{
          const reply=pending.parse ? pending.parse(bytes) : parseReply(bytes,pending.command,pending.offset,pending.length);
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
  // Add a model-specific measured policy here only after preserving capture
  // evidence and tests. Synthetic test subclasses do not qualify hardware.
  _getWriteQualification(){return null;}
  getWriteState(){
    const policy=this._getWriteQualification(),qualified=!!policy&&typeof policy.parseAck==='function'&&typeof policy.evidence==='string';
    return {qualified,ready:qualified&&this.getState().opened&&this._hasResponse,evidence:qualified?policy.evidence:null};
  }
  writeBlock(command,bytes,{signal}={}){
    try{
      const capability=identifyDevice(this.device);
      const block=Object.values(capability.blocks).find(block=>block.writeCommand===command);
      if(!block)throw new Error('Unknown write command/opcode.');
      const data=this._writeBytes(bytes);
      if(data.length!==block.length)throw new Error(`Write length requires exactly ${block.length} complete bytes.`);
      return this._queueWrite(command,data,signal);
    }catch(error){return Promise.reject(error);}
  }
  sendControl(command,payload,{signal}={}){
    try{
      identifyDevice(this.device);
      if(command!==0)throw new Error('Unknown control command/opcode.');
      const data=this._writeBytes(payload);
      if(data.length!==4||data.some(byte=>byte!==0))throw new Error('Only the source post-write four-zero payload is supported.');
      return this._queueWrite(command,data,signal,true);
    }catch(error){return Promise.reject(error);}
  }
  _writeBytes(bytes){
    if(!(bytes instanceof Uint8Array)&&!Array.isArray(bytes))throw new Error('Write payload must contain complete bytes.');
    if(Array.from(bytes).some(byte=>!Number.isInteger(byte)||byte<0||byte>255))throw new Error('Invalid write payload byte.');
    return Uint8Array.from(bytes);
  }
  _queueWrite(command,data,signal,control=false){
    const policy=this._getWriteQualification();
    if(!this.getWriteState().qualified)return Promise.reject(new Error('Write ACK qualification is unavailable for this device.'));
    const sessionId=this._sessionId,capacity=this.interface.packetSize-8;
    const progress={command,sentChunks:0,acknowledgedChunks:0,sentBytes:0,totalBytes:data.length};
    const run=async()=>{
      try{
        for(let offset=0;offset<data.length;offset+=capacity){
          if(signal?.aborted||sessionId!==this._sessionId)throw stopped();
          if(!this.getState().opened)throw new Error('Thiết bị chưa mở kết nối.');
          const count=Math.min(capacity,data.length-offset),last=offset+count===data.length;
          // Config counts own only captured bytes, never source-wrapper padding.
          // Control0 separately mirrors sendReportSuper's first-chunk count.
          const length=control?capacity:count,packet=new Uint8Array(this.interface.packetSize);
          packet.set([0xaa,command,length,offset&255,offset>>>8,0,last?1:0,0]);packet.set(data.slice(offset,offset+count),8);
          await this._writeExchange(packet,{command,offset,length,sessionId,signal,policy,progress,count});
          progress.acknowledgedChunks++;
        }
        return {...progress};
      }catch(error){error.writeProgress={...progress};throw error;}
    };
    const result=this._tail.then(run);this._tail=result.catch(()=>{});
    if(!signal)return result;
    return new Promise((resolve,reject)=>{
      const cancel=()=>{const error=stopped();error.writeProgress={...progress};reject(error);};
      if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
      result.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
    });
  }
  _writeExchange(packet,{command,offset,length,sessionId,signal,policy,progress,count}){
    if(this._pending)return Promise.reject(new Error('Một yêu cầu đang chạy.'));
    return new Promise((resolve,reject)=>{
      let settled=false,timer,sendComplete=false,ack=null;
      const finish=(error,value)=>{
        if(settled)return;
        if(!error&&!sendComplete){ack=value;return;}
        settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
        if(this._pending===pending)this._pending=null;
        error?reject(error):resolve(value);
      };
      const cancel=()=>finish(stopped());
      const pending={command,offset,length,sessionId,finish,parse:bytes=>policy.parseAck(bytes,{command,offset,length})};
      this._pending=pending;signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>finish(new Error(`Write ACK timeout for ${hex(command)} at ${offset}; no retry was sent.`)),this.timeoutMs);
      Promise.resolve().then(()=>{
        if(settled)return;
        if(signal?.aborted||sessionId!==this._sessionId){cancel();return;}
        this._trace('tx',{bytes:packet.slice(),command,offset,length,attempt:1,operation:'write'});
        if(settled)return;
        if(signal?.aborted||sessionId!==this._sessionId){cancel();return;}
        if(offset===0)++this._writeEpoch;
        progress.sentChunks++;progress.sentBytes+=count;
        return this.device.sendReport(this.interface.reportId,packet);
      }).then(()=>{sendComplete=true;if(ack)finish(null,ack);},error=>finish(error));
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
