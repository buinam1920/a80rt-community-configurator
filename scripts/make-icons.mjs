// Vẽ icon của app từ logo "Arrow-A" (viewBox 24, cùng path với index.html), không cần thư viện ngoài.
// Chạy: node scripts/make-icons.mjs  → ghi icon PWA vào dist/icons/.
// build-exe.mjs dùng iconPng() để đóng thêm các cỡ nhỏ (16–64 px) vào file .ico, để Windows
// không phải tự thu nhỏ từ 192 px (thu nhỏ làm mất mũi tên ở thanh tác vụ và khay hệ thống).
import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

// Logo luôn giữ màu thương hiệu (xanh chanh), không theo màu nhấn người dùng chọn.
const BG=[0xc3,0xf5,0x6b],FG=[0x19,0x27,0x0a];
const OUTER=[[11.1,3],[12.9,3],[21.4,20.8],[2.6,20.8]];
const HOLE=[[12,10],[15.9,15.2],[13.4,15.2],[13.4,20.8],[10.6,20.8],[10.6,15.2],[8.1,15.2]];
// Cỡ nhỏ: chữ A chiếm nhiều ô hơn và mũi tên to, thân dày hơn để còn thấy ở 16–24 px.
const HOLE_SMALL=[[12,8.6],[17,15],[13.9,15],[13.9,20.8],[10.1,20.8],[10.1,15],[7,15]];

const inside=(poly,x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
const inRounded=(x,y,size,r)=>{const cx=Math.min(Math.max(x,r),size-r),cy=Math.min(Math.max(y,r),size-r);return (x-cx)**2+(y-cy)**2<=r*r;};
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};

// size: cạnh ảnh (px). maskable: nền tràn hết (vùng an toàn của PWA), không bo góc.
export function iconPng(size,{maskable=false}={}){
  const small=size<=32;
  // Tỉ lệ chữ/ô: 26/39 như thanh bên; cỡ nhỏ lấy 0.8 để nét không quá mảnh.
  const ratio=maskable?0.56:small?0.8:26/39,K=size*ratio/24,O=(size-24*K)/2,fit=pts=>pts.map(([x,y])=>[O+x*K,O+y*K]);
  // Hạ chữ xuống nửa khoảng trống trên/dưới của path (y 3–20.8) để cân giữa ô.
  const dy=(24-(3+20.8))/2*K,outer=fit(OUTER).map(([x,y])=>[x,y+dy]),hole=fit(small?HOLE_SMALL:HOLE).map(([x,y])=>[x,y+dy]);
  const radius=size*(small?0.22:0.25),S=small?8:4,raw=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;
    for(let x=0;x<size;x++){let bg=0,fg=0;
      for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){
        const u=x+(sx+.5)/S,v=y+(sy+.5)/S;
        if(!(maskable||inRounded(u,v,size,radius)))continue;
        if(inside(outer,u,v)&&!inside(hole,u,v))fg++;else bg++;}
      const n=S*S,a=(bg+fg)/n,o=y*(size*4+1)+1+x*4;
      for(let k=0;k<3;k++)raw[o+k]=bg+fg?Math.round((BG[k]*bg+FG[k]*fg)/(bg+fg)):0;
      raw[o+3]=Math.round(a*255);}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const dir=new URL('../dist/icons/',import.meta.url);
  for(const size of [192,512])writeFileSync(new URL(`icon-${size}.png`,dir),iconPng(size));
  writeFileSync(new URL('icon-maskable-512.png',dir),iconPng(512,{maskable:true}));
  console.log('icons written');
}
