// Service worker chỉ giữ bản giao diện tĩnh để app đã cài mở được khi server
// local tắt. Không chạm WebHID, IndexedDB, hồ sơ hay dữ liệu cấu hình.
// Luôn ưu tiên mạng: khi server chạy, app luôn lấy đúng file mới nhất; chỉ khi
// không kết nối được mới dùng bộ đệm của đúng phiên bản này (không trộn bản).
// Bộ đệm offline nạp thẳng từ server (cache:'reload'), không lấy bản HTTP cũ.
const VERSION='0.4.0-beta.10',CACHE=`a80rt-app-${VERSION}`,V=`?v=${VERSION}`;
const MODULES=['app.js','layout.js','protocol.js','device/capabilities.js','device/transport.js','config/session.js','config/codecs.js','config/macros.js','config/advanced.js','config/profiles.js','config/presets.js','i18n.js','i18n-en.js','ui/core-editors.js','ui/advanced-editors.js','ui/device-settings.js'];
const ASSETS=['./','./index.html',`./styles.css${V}`,...MODULES.map(file=>`./${file}${V}`),'./manifest.json','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('a80rt-app-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);
  // /hotkeys/ là kênh trực tiếp tới chương trình nền local (SSE), không qua bộ đệm.
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/hotkeys/'))return;
  // no-cache: luôn hỏi lại server (304 nếu không đổi), không dùng bản HTTP cũ.
  event.respondWith(fetch(request,{cache:'no-cache'}).catch(async()=>{
    const cache=await caches.open(CACHE);
    return (await cache.match(request))??(request.mode==='navigate'?await cache.match('./'):undefined)??Response.error();
  }));
});
