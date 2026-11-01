"""A80RT Configurator chạy local: phục vụ thư mục dist + phím tắt toàn cục Windows.

Không cần thư viện ngoài (chỉ thư viện chuẩn Python: http.server, ctypes, winsound).

- Phục vụ app tại http://localhost:8787/ (luôn kèm Cache-Control: no-cache để
  trình duyệt không giữ bản cũ sau khi cập nhật).
- Đăng ký phím tắt toàn cục bằng RegisterHotKey, chạy được cả khi đang ở trong
  game. Mặc định Ctrl+Alt+1 (LoL) và Ctrl+Alt+2 (Apex); cửa sổ app gửi danh sách
  phím tắt người dùng gán qua /hotkeys/bindings.
- Khi bấm: phát tiếng "đã nhận" và gửi sự kiện cho ĐÚNG MỘT cửa sổ app qua SSE
  (/hotkeys/events): cửa sổ đã kết nối + đọc bàn phím và dùng gần nhất, kèm mã sự
  kiện để chỉ nhận một kết quả. App tự đổi profile, ghi bàn phím qua WebHID với đúng luồng
  preflight/đọc lại xác minh, rồi báo kết quả về /hotkeys/result để phát tiếng
  thành công hoặc lỗi.
- Chương trình này KHÔNG tự ghi USB và không đọc dữ liệu cấu hình; mọi thao tác
  thiết bị vẫn do app trong trình duyệt thực hiện.
"""
import argparse
import ctypes
import functools
import http.server
import itertools
import json
import os
import queue
import re
import secrets
import sys
import threading
import urllib.parse

# Danh sách phím tắt hiện hành: (preset, nhãn, chuỗi phím). App thay bằng /hotkeys/bindings.
bindings = [('lol', 'LoL', 'Ctrl+Alt+1'), ('apex', 'Apex', 'Ctrl+Alt+2')]
bindings_lock = threading.Lock()
hotkey_ids = {}  # id RegisterHotKey -> (preset, nhãn)
failed = []
hotkey_thread_id = None
rebind_done = threading.Event()
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN, MOD_NOREPEAT, WM_HOTKEY = 0x1, 0x2, 0x4, 0x8, 0x4000, 0x0312
WM_APP_REBIND = 0x8001
MOD_NAMES = {'Ctrl': MOD_CONTROL, 'Alt': MOD_ALT, 'Shift': MOD_SHIFT, 'Win': MOD_WIN}
KEY_RE = re.compile(r'^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$')
MAX_BINDINGS = 20


def parse_keys(keys):
    """'Ctrl+Alt+K' -> (modifiers, mã phím ảo) hoặc None nếu không hợp lệ."""
    if not isinstance(keys, str):
        return None
    parts = keys.split('+')
    key, mods = parts[-1], 0
    for part in parts[:-1]:
        if part not in MOD_NAMES:
            return None
        mods |= MOD_NAMES[part]
    if not KEY_RE.match(key) or not mods & (MOD_CONTROL | MOD_ALT | MOD_WIN):
        return None
    vk = ord(key) if len(key) == 1 else 0x6F + int(key[1:])
    return mods, vk


def clean_bindings(items):
    result = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        preset, label, keys = item.get('preset'), item.get('label'), item.get('keys')
        if not isinstance(preset, str) or not preset or len(preset) > 40 or parse_keys(keys) is None:
            continue
        label = label[:40] if isinstance(label, str) and label else preset
        result.append((preset, label, keys))
        if len(result) >= MAX_BINDINGS:
            break
    return result


def register_all(user32):
    """Gọi trên luồng phím tắt: bỏ đăng ký cũ rồi đăng ký danh sách hiện hành."""
    for hotkey_id in list(hotkey_ids):
        user32.UnregisterHotKey(None, hotkey_id)
    hotkey_ids.clear()
    registered.clear()
    failed.clear()
    with bindings_lock:
        current = list(bindings)
    for index, (preset, label, keys) in enumerate(current, start=1):
        mods, vk = parse_keys(keys)
        if user32.RegisterHotKey(None, index, mods | MOD_NOREPEAT, vk):
            hotkey_ids[index] = (preset, label)
            registered.append(keys)
            print(f'[phím tắt] {keys} → {label}', flush=True)
        else:
            failed.append(keys)
            print(f'[phím tắt] Không đăng ký được {keys} (chương trình khác đang dùng).', flush=True)
RESULT_TIMEOUT = 45  # giây chờ cửa sổ app báo kết quả trước khi kêu tiếng lỗi
CLIENT_RE = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
RUN_ID = secrets.token_hex(4)  # đổi mỗi lần chạy để app không nhầm mã sự kiện cũ

# Mỗi cửa sổ app là một client: {'queue', 'ready', 'active'}. Mỗi lần bấm phím chỉ gửi
# tới MỘT client (ưu tiên cửa sổ đã sẵn sàng ghi, rồi cửa sổ dùng gần nhất) để hai
# tab/PWA không cùng ghi bàn phím hoặc phát tiếng lỗi xen tiếng thành công.
listeners = {}
listeners_lock = threading.Lock()
pending = {}  # mã sự kiện -> client id đang được chờ kết quả
event_seq = itertools.count(1)
activity_seq = itertools.count(1)
registered = []
options = None


def beep(kind):
    """Tiếng báo ngắn; chạy ở luồng riêng để không chặn phím tắt."""
    if options.no_sound or os.name != 'nt':
        return
    import winsound
    tones = {
        'press': [(990, 70)],
        'ok': [(880, 90), (1320, 140)],
        'info': [(1100, 120)],
        'error': [(330, 260), (260, 320)],
    }.get(kind, [])
    threading.Thread(target=lambda: [winsound.Beep(f, d) for f, d in tones], daemon=True).start()


def pick_target_locked():
    """Chọn đúng một cửa sổ: sẵn sàng ghi trước, trong đó cửa sổ dùng gần nhất.

    Gọi khi đang giữ listeners_lock."""
    if not listeners:
        return None
    return max(listeners, key=lambda k: (listeners[k]['ready'], listeners[k]['active']))


def expire(event_id, label):
    with listeners_lock:
        if pending.pop(event_id, None) is None:
            return
    print(f'[phím tắt] {label}: cửa sổ app không báo kết quả sau {RESULT_TIMEOUT} giây.', flush=True)
    beep('error')


def dispatch(preset, label):
    with listeners_lock:
        cid = pick_target_locked()
        if cid is not None:
            ready = sum(1 for c in listeners.values() if c['ready'])
            total = len(listeners)
            event_id = f'{RUN_ID}-{next(event_seq)}'
            pending[event_id] = cid
            listeners[cid]['queue'].put(json.dumps({'preset': preset, 'event': event_id}))
    if cid is None:
        print(f'[phím tắt] {label}: chưa có cửa sổ app nào đang mở; mở app và đọc bàn phím trước.', flush=True)
        beep('error')
        return None
    beep('press')
    note = '' if total == 1 else f' (1/{total} cửa sổ, {ready} sẵn sàng ghi)'
    print(f'[phím tắt] {label}: gửi tới cửa sổ app {cid[:8]}{note}.', flush=True)
    timer = threading.Timer(RESULT_TIMEOUT, expire, (event_id, label))
    timer.daemon = True
    timer.start()
    return event_id


def hotkey_loop():
    global hotkey_thread_id
    if os.name != 'nt':
        print('[phím tắt] Chỉ hỗ trợ Windows.', flush=True)
        return
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    register_all(user32)
    hotkey_thread_id = ctypes.windll.kernel32.GetCurrentThreadId()
    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        if msg.message == WM_APP_REBIND:
            register_all(user32)
            rebind_done.set()
        elif msg.message == WM_HOTKEY and msg.wParam in hotkey_ids:
            preset, label = hotkey_ids[msg.wParam]
            dispatch(preset, label)


def apply_bindings(items):
    global bindings
    with bindings_lock:
        bindings = items
    if hotkey_thread_id is None:
        return
    rebind_done.clear()
    if ctypes.windll.user32.PostThreadMessageW(hotkey_thread_id, WM_APP_REBIND, 0, 0):
        rebind_done.wait(2)


def hotkey_config():
    with bindings_lock:
        current = list(bindings)
    return {
        'hotkeys': [{'preset': p, 'label': l, 'keys': k} for p, l, k in current],
        'registered': list(registered), 'failed': list(failed),
        'sound': not options.no_sound, 'bindable': True,
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        if options.verbose:
            super().log_message(fmt, *args)

    def _json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self):
        origin = self.headers.get('Origin')
        allowed = {f'http://localhost:{options.port}', f'http://127.0.0.1:{options.port}'}
        return origin in allowed

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/hotkeys/config':
            return self._json(200, hotkey_config())
        if path == '/hotkeys/events':
            return self._events()
        return super().do_GET()

    def _events(self):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        cid = (query.get('client') or [''])[0]
        if not CLIENT_RE.match(cid):
            cid = secrets.token_hex(8)
        client = {'queue': queue.Queue(), 'ready': False, 'active': next(activity_seq)}
        # Đăng ký trước khi gửi header: app báo trạng thái ngay trong onopen.
        with listeners_lock:
            old = listeners.get(cid)
            if old is not None:  # EventSource nối lại: giữ trạng thái, bỏ kết nối cũ
                client['ready'] = old['ready']
                old['queue'].put(None)
            listeners[cid] = client
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            self.wfile.write(b': connected\n\n')
            self.wfile.flush()
            while True:
                try:
                    data = client['queue'].get(timeout=15)
                    if data is None:
                        break
                    self.wfile.write(f'data: {data}\n\n'.encode('utf-8'))
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            lost = []
            with listeners_lock:
                if listeners.get(cid) is client:
                    del listeners[cid]
                    lost = [e for e, owner in pending.items() if owner == cid]
                    for e in lost:
                        del pending[e]
            if lost:  # cửa sổ đóng/tải lại khi đang xử lý phím tắt: báo lỗi ngay
                print(f'[phím tắt] cửa sổ app {cid[:8]} đóng trước khi báo kết quả.', flush=True)
                beep('error')

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        if path not in ('/hotkeys/result', '/hotkeys/state', '/hotkeys/test-trigger', '/hotkeys/bindings'):
            return self._json(404, {'error': 'not found'})
        if not self._same_origin():
            return self._json(403, {'error': 'origin'})
        length = min(int(self.headers.get('Content-Length') or 0), 8192)
        try:
            data = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return self._json(400, {'error': 'json'})
        if not isinstance(data, dict):
            return self._json(400, {'error': 'json'})
        if path == '/hotkeys/test-trigger':
            if not options.test_trigger:
                return self._json(404, {'error': 'not found'})
            with bindings_lock:
                match = next((v for v in bindings if v[0] == data.get('preset')), None)
            if not match:
                return self._json(400, {'error': 'preset'})
            event_id = dispatch(match[0], match[1])
            with listeners_lock:
                count = len(listeners)
            return self._json(200, {'listeners': count, 'event': event_id})
        if path == '/hotkeys/bindings':
            if not isinstance(data.get('bindings'), list):
                return self._json(400, {'error': 'bindings'})
            apply_bindings(clean_bindings(data['bindings']))
            return self._json(200, hotkey_config())
        if path == '/hotkeys/state':
            with listeners_lock:
                cid = data.get('client')
                client = listeners.get(cid) if isinstance(cid, str) else None
                if client is None:
                    return self._json(200, {'known': False})
                client['ready'] = bool(data.get('ready'))
                if data.get('active'):
                    client['active'] = next(activity_seq)
            return self._json(200, {'known': True})
        # Chỉ nhận đúng một kết quả cho sự kiện đang chờ, từ đúng cửa sổ đã nhận sự kiện đó.
        event_id = data.get('event')
        with listeners_lock:
            accepted = isinstance(event_id, str) and pending.get(event_id) == data.get('client')
            if accepted:
                del pending[event_id]
        if not accepted:
            return self._json(200, {'ok': False, 'ignored': True})
        status = data.get('status')
        beep({'verified': 'ok', 'already': 'ok', 'staged': 'info'}.get(status, 'error'))
        print(f"[kết quả] {data.get('label', '?')}: {status} {data.get('message', '')}".rstrip(), flush=True)
        return self._json(200, {'ok': True})


def main():
    global options
    # Tiếng Việt không được làm crash khi console/pipe dùng mã trang cũ (cp1252...).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    parser =argparse.ArgumentParser(description='A80RT Configurator chạy local')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--no-hotkeys', action='store_true')
    parser.add_argument('--no-sound', action='store_true')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--test-trigger', action='store_true', help=argparse.SUPPRESS)
    options = parser.parse_args()
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist'))
    if not options.no_hotkeys:
        threading.Thread(target=hotkey_loop, daemon=True).start()
    handler = functools.partial(Handler, directory=root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', options.port), handler)
    server.daemon_threads = True
    print(f'A80RT Configurator: http://localhost:{options.port}/  (Ctrl+C hoặc đóng cửa sổ để tắt)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
