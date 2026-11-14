// Giao diện tùy chỉnh: ảnh nền (ảnh, GIF, video) và màu nhấn của app.
// Chỉ đổi cách app hiển thị trên máy này; không chạm bàn phím, bản nháp hay hồ sơ.
// Thiết lập nằm trong localStorage, tệp nền nằm trong IndexedDB (cùng nguồn localhost:8787
// nên dùng chung giữa bản .exe và `npm start`).
// Chữ hiển thị viết bằng tiếng Việt; lớp i18n (dist/i18n.js) tự dịch khi chọn EN.
import {icon,withIcon} from './icons.js';

const STORAGE_KEY='a80rt-theme',DB_NAME='a80rt-theme',STORE='media',MEDIA_KEY='background';
const DEFAULTS=Object.freeze({accent:'#c3f56b',scrim:60,blur:0,panel:88,paused:false,focus:'center'});
const FOCUS=new Set(['center','top','bottom','left','right']);
const LIMITS={image:15*1024*1024,video:40*1024*1024};
const VIDEO_TYPES=new Set(['video/mp4','video/webm']);
// Ảnh tĩnh lớn được thu nhỏ để nhẹ bộ nhớ; GIF/WebP giữ nguyên để không mất chuyển động.
const SHRINK_TYPES=new Set(['image/jpeg','image/png','image/bmp','image/avif']),SHRINK_OVER=3*1024*1024,MAX_EDGE=2560;
export const SWATCHES=[
  ['#c3f56b','Xanh chanh'],['#ff8fc7','Hồng anh đào'],['#7cc8ff','Xanh trời'],['#b69cff','Tím oải hương'],
  ['#5ef0c4','Xanh bạc hà'],['#ffd65c','Vàng nắng'],['#ffad5c','Cam'],['#ff6b81','Đỏ san hô'],
];

const $=id=>document.getElementById(id);
const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.round(n))):fallback;};
const isHex=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);

export function normalizeSettings(raw){
  const src=raw&&typeof raw==='object'?raw:{};
  return {
    accent:isHex(src.accent)?src.accent.toLowerCase():DEFAULTS.accent,
    scrim:clamp(src.scrim,0,90,DEFAULTS.scrim),blur:clamp(src.blur,0,20,DEFAULTS.blur),panel:clamp(src.panel,60,100,DEFAULTS.panel),
    paused:src.paused===true,focus:FOCUS.has(src.focus)?src.focus:DEFAULTS.focus,
  };
}

// ----- Màu -----
const rgbOf=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const toHex=rgb=>'#'+rgb.map(v=>Math.round(Math.min(255,Math.max(0,v))).toString(16).padStart(2,'0')).join('');
function luminance(hex){const [r,g,b]=rgbOf(hex).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;}
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
// Chữ trên nền màu nhấn: tối nếu màu sáng, trắng nếu màu tối, chọn theo độ tương phản.
export function inkFor(accent){
  const [r,g,b]=rgbOf(accent),dark=toHex([r*.13,g*.13,b*.13]);
  return contrast(accent,dark)>=contrast(accent,'#ffffff')?dark:'#ffffff';
}
function rgbToHsl([r,g,b]){
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
  if(max===min)return [0,0,l];
  const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);
  const h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;
  return [h*60,s,l];
}
function hslToRgb(h,s,l){
  const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));
  return [f(0)*255,f(8)*255,f(4)*255];
}
// Màu nổi bật nhất của ảnh (ưu tiên màu tươi), đưa về độ sáng đọc được trên nền tối.
export function dominantAccent(pixels){
  const bins=new Array(24).fill(null).map(()=>({w:0,h:0,s:0}));
  for(let i=0;i<pixels.length;i+=4){
    if(pixels[i+3]<128)continue;
    const [h,s,l]=rgbToHsl([pixels[i],pixels[i+1],pixels[i+2]]);
    const weight=s*s*(1-Math.abs(l-.55)*1.6);if(weight<=0.02)continue;
    const bin=bins[Math.floor(h/15)%24];bin.w+=weight;bin.h+=h*weight;bin.s+=s*weight;
  }
  const best=bins.reduce((a,b)=>b.w>a.w?b:a);
  if(best.w<0.5)return null;
  const hue=best.h/best.w,sat=Math.min(.95,Math.max(.55,best.s/best.w));
  return toHex(hslToRgb(hue,sat,.7));
}

// ----- Lưu trữ -----
function loadSettings(){try{return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)??'null'));}catch{return normalizeSettings(null);}}
function saveSettings(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));}catch{}}
function openDb(){
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB unavailable'));return;}
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function dbRun(mode,work){
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),req=work(tx.objectStore(STORE));tx.oncomplete=()=>resolve(req?.result);tx.onerror=tx.onabort=()=>reject(tx.error);});}
  finally{db.close();}
}
const loadMedia=()=>dbRun('readonly',store=>store.get(MEDIA_KEY)).catch(()=>null);
const storeMedia=media=>dbRun('readwrite',store=>store.put(media,MEDIA_KEY));
const deleteMedia=()=>dbRun('readwrite',store=>store.delete(MEDIA_KEY)).catch(()=>{});

// ----- Trạng thái + hiển thị -----
let settings=loadSettings(),media=null,mediaUrl=null,stillUrl=null,stillFor=null;
const reducedMotion=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
const motionStopped=()=>settings.paused||!!reducedMotion?.matches;
const isVideo=item=>VIDEO_TYPES.has(item?.type);

function applyVars(){
  const root=document.documentElement.style;
  root.setProperty('--accent',settings.accent);root.setProperty('--accent-ink',inkFor(settings.accent));
  root.setProperty('--bg-scrim',`${settings.scrim}%`);root.setProperty('--bg-blur',`${settings.blur}px`);root.setProperty('--panel-alpha',`${settings.panel}%`);
  document.documentElement.dataset.bgFocus=settings.focus;
  syncLogo();
}
// Logo theo màu nhấn: biểu tượng tab trình duyệt ngay tại đây; cửa sổ, thanh tác vụ và khay
// hệ thống do bản .exe tự vẽ lại khi nhận màu (POST /hotkeys/accent; bản trình duyệt bỏ qua).
export const LOGO_PATH='M11.1 3h1.8l8.5 17.8H2.6ZM12 10 15.9 15.2H13.4v5.6h-2.8v-5.6H8.1Z';
export function faviconSvg(accent){
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-6 -6 36 36'><rect x='-6' y='-6' width='36' height='36' rx='9' fill='${accent}'/><path fill='${inkFor(accent)}' fill-rule='evenodd' d='${LOGO_PATH}'/></svg>`;
}
let logoFor=null,nativeFor=null,nativeTimer=0;
function syncLogo(){
  if(logoFor===settings.accent)return;
  logoFor=settings.accent;
  const href='data:image/svg+xml,'+encodeURIComponent(faviconSvg(settings.accent));
  for(const link of document.querySelectorAll('link[rel="icon"]')){link.href=href;link.removeAttribute('type');link.removeAttribute('sizes');}
  // Kéo bảng chọn màu bắn nhiều sự kiện; chỉ gửi màu cuối cùng.
  clearTimeout(nativeTimer);
  nativeTimer=setTimeout(()=>{
    const accent=settings.accent;if(nativeFor===accent)return;
    fetch('./hotkeys/accent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accent})}).then(r=>{if(r.ok)nativeFor=accent;}).catch(()=>{});
  },400);
}
function loadImage(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('decode'));img.src=url;});}
function loadVideo(url){return new Promise((resolve,reject)=>{const v=document.createElement('video');v.muted=true;v.preload='auto';v.onloadeddata=()=>resolve(v);v.onerror=()=>reject(new Error('decode'));v.src=url;});}
function canvasOf(source,width,height,maxEdge){
  const scale=Math.min(1,maxEdge/Math.max(width,height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);return canvas;
}
const canvasBlob=(canvas,type='image/webp',quality=.9)=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));
// Khung hình đầu của GIF: dùng khi người dùng dừng ảnh động hoặc hệ thống bật giảm chuyển động.
async function stillFrame(){
  if(stillUrl&&stillFor===media)return stillUrl;
  const img=await loadImage(mediaUrl),blob=await canvasBlob(canvasOf(img,img.naturalWidth,img.naturalHeight,MAX_EDGE),'image/png');
  if(stillUrl)URL.revokeObjectURL(stillUrl);
  stillUrl=URL.createObjectURL(blob);stillFor=media;return stillUrl;
}
async function renderBackground(){
  let layer=$('app-bg');
  if(!media){layer?.remove();document.documentElement.classList.remove('has-bg');return;}
  if(!layer){layer=document.createElement('div');layer.id='app-bg';layer.setAttribute('aria-hidden','true');document.body.prepend(layer);}
  document.documentElement.classList.add('has-bg');
  if(isVideo(media)){
    let video=layer.querySelector('video');
    if(!video||video.dataset.src!==mediaUrl){video=document.createElement('video');Object.assign(video,{muted:true,loop:true,playsInline:true,autoplay:!motionStopped()});video.dataset.src=mediaUrl;video.src=mediaUrl;layer.replaceChildren(video);}
    if(motionStopped()||document.hidden)video.pause();else video.play().catch(()=>{});
    return;
  }
  let img=layer.querySelector('img');if(!img){img=document.createElement('img');img.alt='';img.decoding='async';layer.replaceChildren(img);}
  const animated=media.type==='image/gif'||media.type==='image/webp';
  const url=animated&&motionStopped()?await stillFrame().catch(()=>mediaUrl):mediaUrl;
  if(img.getAttribute('src')!==url)img.src=url;
}
function setMedia(next){
  if(mediaUrl)URL.revokeObjectURL(mediaUrl);
  media=next;mediaUrl=next?URL.createObjectURL(next.blob):null;
  if(stillUrl){URL.revokeObjectURL(stillUrl);stillUrl=null;stillFor=null;}
}

// ----- Bảng điều khiển -----
let statusTimer=0;
function status(text,kind=''){
  const el=$('theme-status');if(!el)return;
  el.textContent=text;el.dataset.kind=kind;clearTimeout(statusTimer);
  if(text&&kind!=='error')statusTimer=setTimeout(()=>{el.textContent='';},4000);
}
function formatSize(bytes){return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;}
function renderControls(){
  if(!$('theme-dialog'))return;
  for(const [id,key,unit]of [['theme-scrim','scrim','%'],['theme-blur','blur',' px'],['theme-panel','panel','%']]){
    $(id).value=String(settings[key]);$(`${id}-value`).textContent=`${settings[key]}${unit}`;
  }
  $('theme-paused').checked=settings.paused;$('theme-focus').value=settings.focus;$('theme-accent').value=settings.accent;
  for(const button of document.querySelectorAll('#theme-swatches [data-color]'))button.setAttribute('aria-pressed',String(button.dataset.color===settings.accent));
  const preview=$('theme-preview'),has=!!media;
  $('theme-clear').disabled=!has;$('theme-from-image').disabled=!has;
  for(const id of ['theme-scrim','theme-blur','theme-panel','theme-focus','theme-paused'])$(id).disabled=!has;
  $('theme-paused').closest('.theme-check').hidden=!(isVideo(media)||media?.type==='image/gif'||media?.type==='image/webp');
  const name=$('theme-media-name');
  if(!has){preview.replaceChildren();preview.dataset.empty='true';name.textContent='Chưa có ảnh nền';return;}
  preview.dataset.empty='false';
  name.textContent=`${media.name||'Ảnh nền'} · ${formatSize(media.blob.size)}`;
  const current=preview.firstElementChild;
  if(current?.dataset?.src!==mediaUrl){
    const el=document.createElement(isVideo(media)?'video':'img');
    if(isVideo(media))Object.assign(el,{muted:true,loop:true,playsInline:true,autoplay:true});else el.alt='';
    el.dataset.src=mediaUrl;el.src=mediaUrl;preview.replaceChildren(el);
  }
}
function commit(patch){settings=normalizeSettings({...settings,...patch});saveSettings();applyVars();renderControls();void renderBackground();}

async function prepareFile(file){
  const type=(file.type||'').toLowerCase();
  const video=VIDEO_TYPES.has(type);
  if(!video&&!type.startsWith('image/'))throw new Error('Chỉ nhận ảnh (JPG, PNG, WebP, GIF…) hoặc video MP4/WebM.');
  const limit=video?LIMITS.video:LIMITS.image;
  if(file.size>limit&&!(SHRINK_TYPES.has(type)))throw new Error(video?'Video quá lớn: tối đa 40 MB.':'Ảnh quá lớn: tối đa 15 MB.');
  const url=URL.createObjectURL(file);
  try{
    if(video){await loadVideo(url);return {blob:file,type,name:file.name};}
    const img=await loadImage(url);
    if(SHRINK_TYPES.has(type)&&(file.size>SHRINK_OVER||Math.max(img.naturalWidth,img.naturalHeight)>MAX_EDGE)){
      const blob=await canvasBlob(canvasOf(img,img.naturalWidth,img.naturalHeight,MAX_EDGE));
      if(!blob||blob.size>limit)throw new Error('Ảnh quá lớn: tối đa 15 MB.');
      return {blob,type:blob.type||'image/webp',name:file.name};
    }
    return {blob:file,type,name:file.name};
  }catch(error){
    if(error.message==='decode')throw new Error('Không mở được tệp này. Thử ảnh hoặc video khác.');
    throw error;
  }finally{URL.revokeObjectURL(url);}
}
async function useFile(file){
  status('Đang xử lý tệp…');
  try{
    const next=await prepareFile(file);
    try{await storeMedia(next);}catch{throw new Error('Không lưu được ảnh nền (bộ nhớ trình duyệt đầy?).');}
    setMedia(next);renderControls();await renderBackground();status('Đã đặt ảnh nền.','success');
  }catch(error){status(error.message,'error');}
}
async function accentFromImage(){
  if(!media)return;
  try{
    let source,width,height;
    if(isVideo(media)){source=$('app-bg')?.querySelector('video')??await loadVideo(mediaUrl);width=source.videoWidth;height=source.videoHeight;}
    else{source=await loadImage(mediaUrl);width=source.naturalWidth;height=source.naturalHeight;}
    const canvas=canvasOf(source,width,height,64),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const accent=dominantAccent(pixels);
    if(!accent){status('Ảnh gần như không có màu tươi; giữ màu nhấn hiện tại.');return;}
    commit({accent});status('Đã lấy màu nhấn từ ảnh nền.','success');
  }catch{status('Không đọc được màu từ ảnh này.','error');}
}
const blobToDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
async function exportTheme(){
  const data={schema:'a80rt-theme/v1',...settings,media:media?{type:media.type,name:media.name,dataUrl:await blobToDataUrl(media.blob)}:null};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='a80rt-theme.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Đã xuất giao diện.','success');
}
async function importTheme(file){
  try{
    const data=JSON.parse(await file.text());
    if(data?.schema!=='a80rt-theme/v1')throw new Error('Tệp này không phải giao diện A80RT.');
    let next=null;
    if(data.media){
      if(typeof data.media.dataUrl!=='string'||!/^data:(image\/[\w.+-]+|video\/(mp4|webm));base64,/.test(data.media.dataUrl))throw new Error('Ảnh nền trong tệp không hợp lệ.');
      const blob=await (await fetch(data.media.dataUrl)).blob();
      next=await prepareFile(new File([blob],String(data.media.name||'background').slice(0,120),{type:blob.type}));
    }
    if(next){try{await storeMedia(next);}catch{throw new Error('Không lưu được ảnh nền (bộ nhớ trình duyệt đầy?).');}}else await deleteMedia();
    setMedia(next);settings=normalizeSettings(data);saveSettings();applyVars();renderControls();await renderBackground();
    status('Đã nhập giao diện.','success');
  }catch(error){status(error instanceof SyntaxError?'Tệp JSON bị lỗi.':error.message,'error');}
}
async function resetTheme(){
  await deleteMedia();setMedia(null);settings=normalizeSettings(null);saveSettings();applyVars();renderControls();await renderBackground();
  status('Đã về giao diện mặc định.','success');
}

function wire(){
  const dialog=$('theme-dialog'),open=$('theme-button');if(!dialog||!open)return;
  {const svg=icon('palette');if(svg)open.replaceChildren(svg);}
  for(const [id,name]of [['theme-pick','image'],['theme-clear','trash'],['theme-from-image','palette'],['theme-export','download'],['theme-import','upload'],['theme-reset','undo']])withIcon($(id),name);
  const close=$('theme-close');const svg=icon('close');if(svg)close.replaceChildren(svg);
  const swatches=$('theme-swatches');
  for(const [color,label]of SWATCHES){const b=document.createElement('button');b.type='button';b.className='theme-swatch';b.dataset.color=color;b.style.setProperty('--swatch',color);b.setAttribute('aria-label',label);b.title=label;b.addEventListener('click',()=>commit({accent:color}));swatches.append(b);}
  open.addEventListener('click',()=>{renderControls();status('');dialog.showModal();});
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  $('theme-pick').addEventListener('click',()=>$('theme-file').click());
  $('theme-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)void useFile(file);});
  $('theme-clear').addEventListener('click',async()=>{await deleteMedia();setMedia(null);renderControls();await renderBackground();status('Đã gỡ ảnh nền.','success');});
  for(const [id,key]of [['theme-scrim','scrim'],['theme-blur','blur'],['theme-panel','panel']])$(id).addEventListener('input',event=>commit({[key]:event.target.value}));
  $('theme-focus').addEventListener('change',event=>commit({focus:event.target.value}));
  $('theme-paused').addEventListener('change',event=>commit({paused:event.target.checked}));
  $('theme-accent').addEventListener('input',event=>commit({accent:event.target.value}));
  $('theme-from-image').addEventListener('click',()=>void accentFromImage());
  $('theme-export').addEventListener('click',()=>void exportTheme().catch(()=>status('Không xuất được giao diện.','error')));
  $('theme-import').addEventListener('click',()=>$('theme-import-file').click());
  $('theme-import-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importTheme(file);});
  $('theme-reset').addEventListener('click',()=>void resetTheme());
  reducedMotion?.addEventListener?.('change',()=>void renderBackground());
  // Ẩn cửa sổ thì dừng video nền cho nhẹ máy.
  document.addEventListener('visibilitychange',()=>{const video=$('app-bg')?.querySelector('video');if(!video)return;if(document.hidden||motionStopped())video.pause();else video.play().catch(()=>{});});
}

if(typeof document!=='undefined'&&typeof window!=='undefined'&&typeof indexedDB!=='undefined'){
  applyVars();wire();
  loadMedia().then(async stored=>{if(stored?.blob){setMedia(stored);await renderBackground();renderControls();}});
}
