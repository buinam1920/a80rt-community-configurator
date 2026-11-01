import {EXACT,PATTERNS} from './i18n-en.js';

// Lớp hiển thị song ngữ. Giao diện gốc (và mọi logic, test) vẫn là tiếng Việt;
// lớp này chỉ thay chữ đã hiển thị bằng bản tiếng Anh khi người dùng chọn EN.
// Không đổi giá trị input/option value, không chạm dữ liệu cấu hình hay USB.
// Đổi ngôn ngữ không tải lại trang, nên bản nháp/timeline đang mở được giữ nguyên.
const STORAGE_KEY='a80rt-lang';
const ATTRS=['title','placeholder','aria-label'];
const SKIP_TAGS=new Set(['SCRIPT','STYLE','PRE','CODE','TEXTAREA']);
const sourceText=new WeakMap(),writtenText=new WeakMap();
const sourceAttr=new WeakMap(),writtenAttr=new WeakMap();
let lang='vi',observer=null;

export function translate(text){
  if(typeof text!=='string')return text;
  const trimmed=text.trim();if(!trimmed)return text;
  let out=EXACT[trimmed];
  if(out===undefined)for(const [pattern,replacement]of PATTERNS){if(pattern.test(trimmed)){out=trimmed.replace(pattern,replacement);break;}}
  if(out===undefined)return text;
  return text.slice(0,text.length-text.trimStart().length)+out+text.slice(text.trimEnd().length);
}
export const currentLang=()=>lang;
// Chuỗi không nằm trong DOM (thông báo Windows…): dịch theo ngôn ngữ hiện tại.
export const localize=text=>lang==='en'?translate(text):text;

function skipped(node){
  for(let el=node.nodeType===1?node:node.parentElement;el;el=el.parentElement)
    if(SKIP_TAGS.has(el.tagName)||el.getAttribute?.('data-i18n')==='off')return true;
  return false;
}
function updateText(node){
  if(skipped(node))return;
  const current=node.data;
  // Chữ mới do app ghi (không phải bản dịch của lớp này) trở thành nguồn tiếng Việt.
  if(!sourceText.has(node)||current!==writtenText.get(node))sourceText.set(node,current);
  const next=lang==='en'?translate(sourceText.get(node)):sourceText.get(node);
  writtenText.set(node,next);if(next!==current)node.data=next;
}
function updateAttr(el,name){
  // Thuộc tính (placeholder, title…) của chính ô nhập vẫn dịch; chỉ bỏ qua khi nằm trong vùng không dịch.
  if(!el.hasAttribute?.(name)||el.getAttribute?.('data-i18n')==='off'||(el.parentElement&&skipped(el.parentElement)))return;
  const current=el.getAttribute(name);
  let sources=sourceAttr.get(el),written=writtenAttr.get(el);
  if(!sources){sources=new Map();written=new Map();sourceAttr.set(el,sources);writtenAttr.set(el,written);}
  if(!sources.has(name)||current!==written.get(name))sources.set(name,current);
  const next=lang==='en'?translate(sources.get(name)):sources.get(name);
  written.set(name,next);if(next!==current)el.setAttribute(name,next);
}
function walk(root){
  if(root.nodeType===3){updateText(root);return;}
  if(root.nodeType!==1)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  for(let node=root;node;node=walker.nextNode()){
    if(node.nodeType===3)updateText(node);
    else for(const name of ATTRS)updateAttr(node,name);
  }
}
function renderSwitch(){
  for(const button of document.querySelectorAll('[data-lang]'))button.setAttribute('aria-pressed',String(button.dataset.lang===lang));
}
export function setLang(next){
  if(next!=='vi'&&next!=='en')return;
  lang=next;
  try{localStorage.setItem(STORAGE_KEY,next);}catch{}
  document.documentElement.lang=next;
  walk(document.documentElement);observer?.takeRecords();renderSwitch();
}

// Không có DOM thật (Node test, công cụ cũ): bỏ qua hoàn toàn.
if(typeof document!=='undefined'&&document.documentElement&&typeof MutationObserver!=='undefined'&&typeof NodeFilter!=='undefined'){
  let stored=null;try{stored=localStorage.getItem(STORAGE_KEY);}catch{}
  lang=stored==='vi'||stored==='en'?stored:String(navigator.language||'vi').toLowerCase().startsWith('vi')?'vi':'en';
  observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='characterData')updateText(record.target);
      else if(record.type==='attributes')updateAttr(record.target,record.attributeName);
      else for(const node of record.addedNodes)walk(node);
    }
    observer.takeRecords();// bỏ các thay đổi do chính lớp dịch vừa ghi
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-lang]');if(button)setLang(button.dataset.lang);});
  setLang(lang);
}
