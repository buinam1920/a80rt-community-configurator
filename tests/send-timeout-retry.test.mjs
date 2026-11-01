import test from 'node:test';
import assert from 'node:assert/strict';
import {A80Transport} from '../dist/device/transport.js';

// Wired-style device answering reads; sendReport can be told to fail like the native
// shim does when Windows keeps a HID write pending for more than 3 seconds.
class Device extends EventTarget {
  vendorId=0x0c45;productId=0x80a1;productName='A80RT U';opened=false;sent=0;failures=[];
  collections=[{usagePage:0xff68,usage:0x61,inputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}],outputReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];
  async open(){this.opened=true;} async close(){this.opened=false;}
  async sendReport(reportId,packet){
    this.sent++;const failure=this.failures.shift();if(failure)throw failure;
    const reply=new Uint8Array(64);reply.set([0x55,packet[1],packet[2],packet[3],packet[4],0,packet[6],0]);reply.fill(7,8,8+packet[2]);
    queueMicrotask(()=>{const event=new Event('inputreport');event.reportId=0;event.data=new DataView(reply.buffer);this.dispatchEvent(event);});
  }
}
const timeout=()=>Object.assign(new Error('Gửi report HID quá thời gian.'),{name:'NetworkError'});

test('a read whose send times out is retried once and succeeds',async()=>{
  const device=new Device(),transport=new A80Transport(device,{timeoutMs:200});await transport.open();
  device.failures.push(timeout());
  const bytes=await transport.readBlock(0x11,32);
  assert.equal(bytes.length,32);assert.equal(device.sent,2,'one retry');
  await transport.close();
});

test('two timed-out sends end with the usual guidance instead of the raw native error',async()=>{
  const device=new Device(),transport=new A80Transport(device,{timeoutMs:200});await transport.open();
  device.failures.push(timeout(),timeout());
  await assert.rejects(transport.readBlock(0x11,32),/Bàn phím chưa trả lời lệnh 0x0011.*cáp USB/);
  assert.equal(device.sent,2,'no more than one retry');
  await transport.close();
});

test('other send errors are not retried',async()=>{
  const device=new Device(),transport=new A80Transport(device,{timeoutMs:200});await transport.open();
  device.failures.push(Object.assign(new Error('Thiết bị đã đóng.'),{name:'NetworkError'}));
  await assert.rejects(transport.readBlock(0x11,32),/Thiết bị đã đóng/);
  assert.equal(device.sent,1);
  await transport.close();
});
