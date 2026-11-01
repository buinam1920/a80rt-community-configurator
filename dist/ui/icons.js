// Bộ icon nét đơn (24×24, stroke 2), vẽ riêng cho app theo các quy ước quen thuộc.
// Dùng cho nút: icon + chữ ngắn, hoặc chỉ icon (luôn kèm aria-label và title).
export const ICONS={
  plug:'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  unplug:'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4M3 3l18 18',
  download:'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload:'M12 15V3M7 8l5-5 5 5M4 21h16',
  check:'M4 12l5 5L20 6',
  undo:'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  trash:'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  close:'M6 6l12 12M18 6L6 18',
  external:'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  search:'M10 4a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM20 20l-5.5-5.5',
  copy:'M9 9h11v11H9zM5 15V4h11',
  save:'M5 3h11l4 4v14H5zM8 3v6h8M8 21v-7h8v7',
  pencil:'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  history:'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2',
  stop:'M7 7h10v10H7z',
  bell:'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  keyboard:'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  plus:'M12 5v14M5 12h14',
  record:'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z',
  keys:'M4 7h16v10H4zM8 11h.01M12 11h.01M16 11h.01M8 14h8',
};
const NS='http://www.w3.org/2000/svg';
// Tạo <svg> cho một icon; trả về null nếu môi trường không có SVG (test không có DOM thật).
export function icon(name,className='i'){
  const doc=globalThis.document;
  if(!ICONS[name]||typeof doc?.createElementNS!=='function')return null;
  const svg=doc.createElementNS(NS,'svg'),path=doc.createElementNS(NS,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('class',className);
  path.setAttribute('d',ICONS[name]);svg.append(path);return svg;
}
// Gắn icon vào nút. iconOnly: ẩn chữ, chuyển chữ thành aria-label + title (tooltip).
export function withIcon(button,name,{iconOnly=false}={}){
  const svg=icon(name);if(!svg)return button;
  if(iconOnly){const label=button.textContent;button.setAttribute('aria-label',label);if(!button.title)button.title=label;button.textContent='';button.classList?.add?.('icon-only');}
  button.prepend?.(svg);return button;
}
