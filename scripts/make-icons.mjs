// Vẽ icon PWA từ logo SVG của app (viewBox 64), không cần thư viện ngoài.
// Chạy: node scripts/make-icons.mjs
import {writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
// Logo "Arrow-A" (viewBox 24, cùng path với index.html), đặt giữa ô 64 với tỉ lệ 26/39 như thanh bên.
const K=64*26/39/24,O=(64-24*K)/2,fit=pts=>pts.map(([x,y])=>[O+x*K,O+y*K]);
const outer=fit([[11.1,3],[12.9,3],[21.4,20.8],[2.6,20.8]]),hole=fit([[12,10],[15.9,15.2],[13.4,15.2],[13.4,20.8],[10.6,20.8],[10.6,15.2],[8.1,15.2]]);
const BG=[0xc3,0xf5,0x6b],FG=[0x19,0x27,0x0a];
const inside=(poly,x,y)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
const inRounded=(x,y,r)=>{const cx=Math.min(Math.max(x,r),64-r),cy=Math.min(Math.max(y,r),64-r);return (x-cx)**2+(y-cy)**2<=r*r;};
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};
function png(size,{maskable}){
  const S=4,raw=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;
    for(let x=0;x<size;x++){let bg=0,fg=0;
      for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){
        const u=(x+(sx+.5)/S)*64/size,v=(y+(sy+.5)/S)*64/size;
        if(!(maskable||inRounded(u,v,16)))continue;
        if(inside(outer,u,v)&&!inside(hole,u,v))fg++;else bg++;}
      const n=S*S,a=(bg+fg)/n,o=y*(size*4+1)+1+x*4;
      for(let k=0;k<3;k++)raw[o+k]=bg+fg?Math.round((BG[k]*bg+FG[k]*fg)/(bg+fg)):0;
      raw[o+3]=Math.round(a*255);}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const dir=new URL('../dist/icons/',import.meta.url);
for(const size of [192,512])writeFileSync(new URL(`icon-${size}.png`,dir),png(size,{maskable:false}));
writeFileSync(new URL('icon-maskable-512.png',dir),png(512,{maskable:true}));
console.log('icons written');
