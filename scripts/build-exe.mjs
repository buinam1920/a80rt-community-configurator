// Build A80RT-Configurator.exe (single-file standalone Windows executable).
// Embeds all files in dist/ into the .exe via .NET embedded resources and compiles with csc.exe.
// Run: node scripts/build-exe.mjs
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const distDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// 1. Generate multi-size .ico from existing PNG icons (PNG-in-ICO format, Windows Vista+)
function makeIco() {
  const png192 = fs.readFileSync(path.join(distDir, 'icons', 'icon-192.png'));
  const png512 = fs.readFileSync(path.join(distDir, 'icons', 'icon-512.png'));
  const images = [
    {w: 192, h: 192, data: png192},
    {w: 0, h: 0, data: png512}, // 0 means 256+ in ICO header
  ];
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, idx) => {
    const base = 6 + idx * 16;
    header[base] = img.w;
    header[base + 1] = img.h;
    header[base + 2] = 0;
    header[base + 3] = 0;
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(img.data.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, ...images.map(i => i.data)]);
}

// 2. Pack all dist/ files into a compact binary bundle
function packAssets() {
  const files = fs.readdirSync(distDir, {recursive: true})
    .map(f => f.replaceAll('\\', '/'))
    .filter(f => fs.statSync(path.join(distDir, f)).isFile())
    .sort();
  const entries = [];
  const chunks = [];
  for (const rel of files) {
    const raw = fs.readFileSync(path.join(distDir, rel));
    const compressed = deflateRawSync(raw, {level: 9});
    const keyBuf = Buffer.from('/' + rel, 'utf8');
    const hdr = Buffer.alloc(10);
    hdr.writeUInt16LE(keyBuf.length, 0);
    hdr.writeUInt32LE(raw.length, 2);
    hdr.writeUInt32LE(compressed.length, 6);
    chunks.push(hdr, keyBuf, compressed);
    entries.push(`/${rel} (${raw.length}B)`);
  }
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(files.length, 0);
  return {bundle: Buffer.concat([countBuf, ...chunks]), count: files.length};
}

const buildDir = path.join(root, '.build-exe');
const nativeDir = path.join(root, 'scripts', 'native');
const webview2Dir = path.join(root, 'vendor', 'webview2');
fs.mkdirSync(buildDir, {recursive: true});

const icoPath = path.join(buildDir, 'app.ico');
const bundlePath = path.join(buildDir, 'assets.bin');
const csPath = path.join(buildDir, 'A80RTConfigurator.cs');
const exePath = path.resolve(root, process.env.A80RT_BUILD_OUTPUT || 'A80RT-Configurator.exe');

fs.writeFileSync(icoPath, makeIco());
const {bundle, count} = packAssets();
fs.writeFileSync(bundlePath, bundle);

const csSource = `// Auto-generated standalone executable for A80RT Configurator ${pkg.version}
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("A80RT Configurator")]
[assembly: AssemblyDescription("Leobog A80RT / A80RT U Configurator + Global Hotkeys")]
[assembly: AssemblyProduct("A80RT Configurator")]
[assembly: AssemblyVersion("${pkg.version.split("-")[0]}.0")]
[assembly: AssemblyFileVersion("${pkg.version.split("-")[0]}.0")]

namespace A80RT {
    internal sealed class ClientState {
        public readonly BlockingCollectionQueue Queue = new BlockingCollectionQueue();
        public bool Ready;
        public long Active;
    }

    internal sealed class BlockingCollectionQueue {
        private readonly Queue<string> _q = new Queue<string>();
        private readonly object _lock = new object();
        public void Put(string item) {
            lock (_lock) { _q.Enqueue(item); Monitor.PulseAll(_lock); }
        }
        public bool TryTake(int timeoutMs, out string item) {
            lock (_lock) {
                if (_q.Count == 0) Monitor.Wait(_lock, timeoutMs);
                if (_q.Count > 0) { item = _q.Dequeue(); return true; }
                item = ""; return false;
            }
        }
    }

    internal sealed class HotkeyWindow : NativeWindow, IDisposable {
        private const int WM_HOTKEY = 0x0312;
        private const uint MOD_ALT = 0x0001;
        private const uint MOD_CONTROL = 0x0002;
        private const uint MOD_NOREPEAT = 0x4000;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        public readonly List<string> Registered = new List<string>();
        private readonly Action<int> _onHotkey;

        public HotkeyWindow(Action<int> onHotkey, bool registerHotkeys) {
            _onHotkey = onHotkey;
            CreateHandle(new CreateParams());
            if (!registerHotkeys) return;
            if (RegisterHotKey(Handle, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x31))
                Registered.Add("Ctrl+Alt+1");
            if (RegisterHotKey(Handle, 2, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x32))
                Registered.Add("Ctrl+Alt+2");
        }

        protected override void WndProc(ref Message m) {
            if (m.Msg == WM_HOTKEY) {
                int id = m.WParam.ToInt32();
                _onHotkey(id);
            }
            base.WndProc(ref m);
        }

        public void Dispose() {
            try { UnregisterHotKey(Handle, 1); } catch {}
            try { UnregisterHotKey(Handle, 2); } catch {}
            try { DestroyHandle(); } catch {}
        }
    }

    internal static class Program {
        private static readonly Dictionary<string, byte[]> Assets = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<string, ClientState> Listeners = new Dictionary<string, ClientState>();
        private static readonly Dictionary<string, string> Pending = new Dictionary<string, string>();
        private static readonly object LockObj = new object();
        private static readonly Regex ClientRe = new Regex("^[A-Za-z0-9_-]{8,64}$");
        private static readonly string RunId = Guid.NewGuid().ToString("N").Substring(0, 8);
        private static long _eventSeq = 0;
        private static long _activitySeq = 0;
        private static int _port = 8787;
        private static bool _sound = true;
        private static bool _testTrigger = false;
        private static HotkeyWindow _hotkeyWin;
        private static NotifyIcon _tray;
        private static bool _forceBrowser;
        private static Control _invoker;
        private static Icon _appIcon;

        public static void TrayHint(string text) {
            try { if (_tray != null) _tray.ShowBalloonTip(3500, "A80RT Configurator", text, ToolTipIcon.Info); } catch {}
        }
        // Pin bàn phím do cửa sổ app báo qua /hotkeys/state (byte 17 khối 0x10, chỉ khi đầu thu).
        private static int _battery = -1;
        private static long _batteryTicks = 0;
        private static int _batteryShown = -2;
        private static int _batteryWarned = 101;
        private static Icon _baseIcon;
        private static IntPtr _batteryHicon = IntPtr.Zero;
        private const string BaseTrayText = "A80RT Configurator (Ctrl+Alt+1 LoL · Ctrl+Alt+2 Apex)";
        [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);

        [STAThread]
        private static int Main(string[] args) {
            bool noHotkeys = false;
            bool noBrowser = false;
            string selfTestOut = null;
            EmbeddedAssemblies.Install();
            for (int i = 0; i < args.Length; i++) {
                string a = args[i];
                if (a == "--browser") { _forceBrowser = true; continue; }
                if (a == "--user-data" && i + 1 < args.Length) { NativeShell.UserDataFolder = args[++i]; continue; }
                if (a == "--remote-debugging" && i + 1 < args.Length) { int dbg; if (int.TryParse(args[++i], out dbg)) NativeShell.RemoteDebuggingPort = dbg; continue; }
                if (a == "--hid-selftest" && i + 1 < args.Length) { selfTestOut = args[++i]; continue; }
                if (a == "--port" && i + 1 < args.Length) int.TryParse(args[++i], out _port);
                else if (a == "--no-hotkeys") noHotkeys = true;
                else if (a == "--no-sound") _sound = false;
                else if (a == "--no-browser") noBrowser = true;
                else if (a == "--create-shortcut") { CreateDesktopShortcut(false); return 0; }
                else if (a == "--test-trigger") { _testTrigger = true; noBrowser = true; }
            }

            if (selfTestOut != null) {
                using (var w = new StreamWriter(selfTestOut, false, new UTF8Encoding(false))) {
                    Console.SetOut(w);
                    try { return HidSelfTest.Run(); } catch (Exception ex) { Console.WriteLine("error: " + ex); return 1; }
                }
            }
            string mutexName = "Local\\\\A80RTConfigurator_" + _port;
            string showEventName = "Local\\\\A80RTConfigurator_show_" + _port;
            bool createdNew;
            using (Mutex mutex = new Mutex(true, mutexName, out createdNew)) {
                if (!createdNew && !_testTrigger) {
                    // Another instance owns the keyboard: ask it to show its window.
                    try {
                        EventWaitHandle show;
                        if (EventWaitHandle.TryOpenExisting(showEventName, out show)) { show.Set(); show.Dispose(); return 0; }
                    } catch {}
                    OpenBrowserWindow("http://localhost:" + _port + "/");
                    return 0;
                }

                LoadEmbeddedAssets();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                _hotkeyWin = new HotkeyWindow(id => {
                    if (id == 1) Dispatch("lol", "LoL");
                    else if (id == 2) Dispatch("apex", "Apex");
                }, !noHotkeys);

                TcpListener server = new TcpListener(IPAddress.Loopback, _port);
                try {
                    server.Start();
                } catch (Exception ex) {
                    if (!_testTrigger) {
                        OpenBrowserWindow("http://localhost:" + _port + "/");
                        return 0;
                    }
                    Console.Error.WriteLine(ex.Message);
                    return 1;
                }

                Thread acceptThread = new Thread(() => AcceptLoop(server)) { IsBackground = true };
                acceptThread.Start();

                string url = "http://localhost:" + _port + "/";
                if (!_testTrigger) {
                    SetupTray(url);
                    _invoker = new Control();
                    IntPtr invokerHandle = _invoker.Handle;
                    var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, showEventName);
                    new Thread(() => {
                        while (showEvent.WaitOne()) {
                            try { _invoker.BeginInvoke((MethodInvoker)delegate { OpenAppWindow(url); }); } catch {}
                        }
                    }) { IsBackground = true }.Start();
                    if (!noBrowser) OpenAppWindow(url);
                }

                Application.Run();
                try { server.Stop(); } catch {}
                if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
                if (_hotkeyWin != null) _hotkeyWin.Dispose();
                return 0;
            }
        }

        private static void CreateDesktopShortcut(bool notify) {
            try {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnkPath = Path.Combine(desktop, "A80RT Configurator.lnk");
                string exePath = Application.ExecutablePath;
                string workDir = Path.GetDirectoryName(exePath) ?? desktop;
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                Type scType = shortcut.GetType();
                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { exePath });
                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { exePath + ",0" });
                scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "A80RT Configurator (Ctrl+Alt+1 LoL · Ctrl+Alt+2 Apex)" });
                scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                if (notify && _tray != null) {
                    _tray.ShowBalloonTip(2000, "A80RT Configurator", "Đã tạo lối tắt trên màn hình Desktop.", ToolTipIcon.Info);
                }
            } catch {}
        }

        private static void SetupTray(string url) {
            Icon ico;
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico")) {
                ico = s != null ? new Icon(s) : SystemIcons.Application;
            }
            _baseIcon = ico;
            _appIcon = ico;
            ContextMenuStrip menu = new ContextMenuStrip();
            var titleItem = new ToolStripMenuItem("A80RT Configurator ${pkg.version}") { Enabled = false };
            var hkStatus = _hotkeyWin.Registered.Count > 0
                ? "Phím tắt: " + string.Join(", ", _hotkeyWin.Registered.ToArray())
                : "Phím tắt toàn cục: Đang bị chiếm";
            var hkItem = new ToolStripMenuItem(hkStatus) { Enabled = false };
            var openItem = new ToolStripMenuItem("Mở cửa sổ cấu hình", null, (s, e) => OpenAppWindow(url));
            var soundItem = new ToolStripMenuItem("Tiếng báo khi bấm phím tắt") { Checked = _sound, CheckOnClick = true };
            soundItem.CheckedChanged += (s, e) => _sound = soundItem.Checked;
            var shortcutItem = new ToolStripMenuItem("Tạo lối tắt ngoài Desktop", null, (s, e) => CreateDesktopShortcut(true));
            var exitItem = new ToolStripMenuItem("Thoát hoàn toàn", null, (s, e) => { NativeShell.ExitRequested(); Application.Exit(); });

            menu.Items.Add(titleItem);
            menu.Items.Add(hkItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(openItem);
            menu.Items.Add(soundItem);
            menu.Items.Add(shortcutItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            _tray = new NotifyIcon {
                Icon = ico,
                Text = BaseTrayText,
                ContextMenuStrip = menu,
                Visible = true
            };
            _tray.DoubleClick += (s, e) => OpenAppWindow(url);
            // Timer chạy trên luồng giao diện: đổi icon khay an toàn, không cần Invoke.
            var batteryTimer = new System.Windows.Forms.Timer { Interval = 2000 };
            batteryTimer.Tick += (s, e) => RefreshBatteryTray();
            batteryTimer.Start();
        }

        private static void RefreshBatteryTray() {
            if (_tray == null) return;
            int b = Thread.VolatileRead(ref _battery);
            long ticks = Interlocked.Read(ref _batteryTicks);
            // Không có báo cáo mới trong 2 phút (đóng cửa sổ app, rút đầu thu): bỏ số pin cũ.
            if (b >= 0 && (ticks == 0 || DateTime.UtcNow.Ticks - ticks > TimeSpan.FromMinutes(2).Ticks)) b = -1;
            if (b == _batteryShown) return;
            _batteryShown = b;
            IntPtr old = _batteryHicon;
            if (b < 0) {
                _tray.Icon = _baseIcon;
                _tray.Text = BaseTrayText;
                _batteryHicon = IntPtr.Zero;
            } else {
                _batteryHicon = DrawBatteryIcon(b);
                _tray.Icon = Icon.FromHandle(_batteryHicon);
                _tray.Text = "A80RT · Pin " + b + "% · Ctrl+Alt+1 LoL · Ctrl+Alt+2 Apex";
                if (b <= 10 && _batteryWarned > 10) { _batteryWarned = 10; ShowLowBattery(b); }
                else if (b <= 20 && _batteryWarned > 20) { _batteryWarned = 20; ShowLowBattery(b); }
                if (b > 25) _batteryWarned = 101;
            }
            if (old != IntPtr.Zero) DestroyIcon(old);
        }

        private static void ShowLowBattery(int b) {
            try { _tray.ShowBalloonTip(4000, "A80RT · Pin yếu", "Pin bàn phím còn " + b + "%. Cắm sạc sớm để không mất kết nối khi đang chơi.", ToolTipIcon.Warning); } catch {}
        }

        // Icon khay 32x32: nền màu theo mức pin, số phần trăm ở giữa.
        private static IntPtr DrawBatteryIcon(int b) {
            using (Bitmap bmp = new Bitmap(32, 32))
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                g.Clear(Color.Transparent);
                Color fill = b <= 20 ? Color.FromArgb(229, 72, 77) : b <= 50 ? Color.FromArgb(240, 163, 94) : Color.FromArgb(70, 167, 88);
                using (SolidBrush brush = new SolidBrush(fill)) g.FillRectangle(brush, 0, 0, 32, 32);
                string text = b >= 100 ? "99" : b.ToString();
                using (Font font = new Font("Segoe UI", 15f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (StringFormat format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                    g.DrawString(text, font, Brushes.White, new RectangleF(0, 1, 32, 32), format);
                return bmp.GetHicon();
            }
        }

        private static int ExtractJsonInt(string json, string key) {
            Match m = Regex.Match(json, "\\"" + Regex.Escape(key) + "\\"\\\\s*:\\\\s*(-?\\\\d{1,4})");
            int value;
            return m.Success && int.TryParse(m.Groups[1].Value, out value) ? value : int.MinValue;
        }

        // Standalone window (WebView2 + native HID). Falls back to a browser app
        // window when WebView2 is unavailable or --browser was given.
        private static void OpenAppWindow(string url) {
            if (!_forceBrowser && NativeShell.Show(url, _appIcon)) return;
            if (!_forceBrowser && NativeShell.LastError != null) TrayHint("Không mở được cửa sổ riêng (" + NativeShell.LastError + "); dùng trình duyệt thay thế.");
            OpenBrowserWindow(url);
        }

        private static void OpenBrowserWindow(string url) {
            string[] candidates = new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string browser in candidates) {
                if (File.Exists(browser)) {
                    try {
                        Process.Start(new ProcessStartInfo {
                            FileName = browser,
                            Arguments = "--app=" + url,
                            UseShellExecute = false
                        });
                        return;
                    } catch {}
                }
            }
            try { Process.Start(url); } catch {}
        }

        private static void LoadEmbeddedAssets() {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("assets.bin")) {
                if (s == null) return;
                using (BinaryReader br = new BinaryReader(s, Encoding.UTF8)) {
                    uint count = br.ReadUInt32();
                    for (uint i = 0; i < count; i++) {
                        ushort keyLen = br.ReadUInt16();
                        int rawLen = (int)br.ReadUInt32();
                        int compLen = (int)br.ReadUInt32();
                        string key = Encoding.UTF8.GetString(br.ReadBytes(keyLen));
                        byte[] comp = br.ReadBytes(compLen);
                        byte[] raw = new byte[rawLen];
                        using (MemoryStream ms = new MemoryStream(comp))
                        using (DeflateStream ds = new DeflateStream(ms, CompressionMode.Decompress)) {
                            int read = 0;
                            while (read < rawLen) {
                                int n = ds.Read(raw, read, rawLen - read);
                                if (n <= 0) break;
                                read += n;
                            }
                        }
                        Assets[key] = raw;
                    }
                }
            }
        }

        private static void Beep(string kind) {
            if (!_sound) return;
            ThreadPool.QueueUserWorkItem(_ => {
                try {
                    if (kind == "press") { Console.Beep(990, 70); }
                    else if (kind == "ok") { Console.Beep(880, 90); Console.Beep(1320, 140); }
                    else if (kind == "info") { Console.Beep(1100, 120); }
                    else if (kind == "error") { Console.Beep(330, 260); Console.Beep(260, 320); }
                } catch {}
            });
        }

        private static string PickTargetLocked() {
            string best = null;
            bool bestReady = false;
            long bestActive = -1;
            foreach (var kv in Listeners) {
                bool r = kv.Value.Ready;
                long a = kv.Value.Active;
                if (best == null || (r && !bestReady) || (r == bestReady && a > bestActive)) {
                    best = kv.Key; bestReady = r; bestActive = a;
                }
            }
            return best;
        }

        private static string Dispatch(string preset, string label) {
            string cid;
            string eventId = null;
            lock (LockObj) {
                cid = PickTargetLocked();
                if (cid != null) {
                    eventId = RunId + "-" + Interlocked.Increment(ref _eventSeq);
                    Pending[eventId] = cid;
                    Listeners[cid].Queue.Put("{\\"preset\\":\\"" + preset + "\\",\\"event\\":\\"" + eventId + "\\"}");
                }
            }
            if (cid == null) {
                Beep("error");
                if (_tray != null) {
                    try { _tray.ShowBalloonTip(2500, "A80RT · " + label, "Chưa có cửa sổ cấu hình nào đang mở. Bấm đúp icon khay hệ thống để mở.", ToolTipIcon.Warning); } catch {}
                }
                return null;
            }
            Beep("press");
            string capturedEvent = eventId;
            System.Threading.Timer timer = null;
            timer = new System.Threading.Timer(_ => {
                if (timer != null) timer.Dispose();
                bool expired = false;
                lock (LockObj) {
                    if (Pending.Remove(capturedEvent)) expired = true;
                }
                if (expired) Beep("error");
            }, null, 45000, Timeout.Infinite);
            return eventId;
        }

        private static void AcceptLoop(TcpListener server) {
            while (true) {
                try {
                    TcpClient client = server.AcceptTcpClient();
                    Thread t = new Thread(() => HandleConnection(client)) { IsBackground = true };
                    t.Start();
                } catch { break; }
            }
        }

        private static void HandleConnection(TcpClient tcp) {
            using (tcp)
            using (NetworkStream ns = tcp.GetStream()) {
                try {
                    string requestLine = ReadLine(ns);
                    if (string.IsNullOrEmpty(requestLine)) return;
                    string[] parts = requestLine.Split(' ');
                    if (parts.Length < 2) return;
                    string method = parts[0];
                    string rawUrl = parts[1];
                    string path = rawUrl;
                    string query = "";
                    int qIdx = rawUrl.IndexOf('?');
                    if (qIdx >= 0) {
                        path = rawUrl.Substring(0, qIdx);
                        query = rawUrl.Substring(qIdx + 1);
                    }

                    Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    string line;
                    while (!string.IsNullOrEmpty(line = ReadLine(ns))) {
                        int cIdx = line.IndexOf(':');
                        if (cIdx > 0) headers[line.Substring(0, cIdx).Trim()] = line.Substring(cIdx + 1).Trim();
                    }

                    if (method == "GET") {
                        if (path == "/hotkeys/config") {
                            StringBuilder regJson = new StringBuilder("[");
                            for (int i = 0; i < _hotkeyWin.Registered.Count; i++) {
                                if (i > 0) regJson.Append(",");
                                regJson.Append("\\"").Append(_hotkeyWin.Registered[i]).Append("\\"");
                            }
                            regJson.Append("]");
                            string body = "{\\"hotkeys\\":[{\\"preset\\":\\"lol\\",\\"label\\":\\"LoL\\",\\"keys\\":\\"Ctrl+Alt+1\\"},{\\"preset\\":\\"apex\\",\\"label\\":\\"Apex\\",\\"keys\\":\\"Ctrl+Alt+2\\"}],\\"registered\\":" + regJson + ",\\"sound\\":" + (_sound ? "true" : "false") + "}";
                            WriteJson(ns, 200, body);
                            return;
                        }
                        if (path == "/hotkeys/events") {
                            HandleEvents(ns, query);
                            return;
                        }
                        ServeAsset(ns, path, false);
                        return;
                    }
                    if (method == "HEAD") {
                        ServeAsset(ns, path, true);
                        return;
                    }

                    if (method == "POST") {
                        int contentLen = 0;
                        string lenStr;
                        if (headers.TryGetValue("Content-Length", out lenStr)) int.TryParse(lenStr, out contentLen);
                        contentLen = Math.Min(Math.Max(contentLen, 0), 4096);
                        byte[] bodyBytes = new byte[contentLen];
                        int read = 0;
                        while (read < contentLen) {
                            int n = ns.Read(bodyBytes, read, contentLen - read);
                            if (n <= 0) break;
                            read += n;
                        }
                        string bodyText = Encoding.UTF8.GetString(bodyBytes, 0, read);

                        if (path != "/hotkeys/result" && path != "/hotkeys/state" && path != "/hotkeys/test-trigger") {
                            WriteJson(ns, 404, "{\\"error\\":\\"not found\\"}");
                            return;
                        }
                        string origin;
                        headers.TryGetValue("Origin", out origin);
                        if (origin != "http://localhost:" + _port && origin != "http://127.0.0.1:" + _port) {
                            WriteJson(ns, 403, "{\\"error\\":\\"origin\\"}");
                            return;
                        }
                        string trimmed = bodyText.Trim();
                        if (trimmed.Length > 0 && (!trimmed.StartsWith("{") || !trimmed.EndsWith("}"))) {
                            WriteJson(ns, 400, "{\\"error\\":\\"json\\"}");
                            return;
                        }

                        if (path == "/hotkeys/test-trigger") {
                            if (!_testTrigger) { WriteJson(ns, 404, "{\\"error\\":\\"not found\\"}"); return; }
                            string preset = ExtractJsonString(trimmed, "preset");
                            if (preset != "lol" && preset != "apex") { WriteJson(ns, 400, "{\\"error\\":\\"preset\\"}"); return; }
                            string evId = Dispatch(preset, preset == "lol" ? "LoL" : "Apex");
                            int count;
                            lock (LockObj) count = Listeners.Count;
                            string evJson = evId == null ? "null" : ("\\"" + evId + "\\"");
                            WriteJson(ns, 200, "{\\"listeners\\":" + count + ",\\"event\\":" + evJson + "}");
                            return;
                        }

                        if (path == "/hotkeys/state") {
                            int battery = ExtractJsonInt(trimmed, "battery");
                            if (battery >= -1 && battery <= 100) {
                                Interlocked.Exchange(ref _battery, battery);
                                Interlocked.Exchange(ref _batteryTicks, DateTime.UtcNow.Ticks);
                            }
                            string cid = ExtractJsonString(trimmed, "client");
                            bool ready = ExtractJsonBool(trimmed, "ready");
                            bool active = ExtractJsonBool(trimmed, "active");
                            lock (LockObj) {
                                ClientState cs;
                                if (cid == null || !Listeners.TryGetValue(cid, out cs)) {
                                    WriteJson(ns, 200, "{\\"known\\":false}");
                                    return;
                                }
                                cs.Ready = ready;
                                if (active) cs.Active = Interlocked.Increment(ref _activitySeq);
                            }
                            WriteJson(ns, 200, "{\\"known\\":true}");
                            return;
                        }

                        // /hotkeys/result
                        string rClient = ExtractJsonString(trimmed, "client");
                        string rEvent = ExtractJsonString(trimmed, "event");
                        bool accepted = false;
                        lock (LockObj) {
                            string owner;
                            if (rEvent != null && rClient != null && Pending.TryGetValue(rEvent, out owner) && owner == rClient) {
                                Pending.Remove(rEvent);
                                accepted = true;
                            }
                        }
                        if (!accepted) {
                            WriteJson(ns, 200, "{\\"ok\\":false,\\"ignored\\":true}");
                            return;
                        }
                        string status = ExtractJsonString(trimmed, "status") ?? "";
                        if (status == "verified" || status == "already") Beep("ok");
                        else if (status == "staged") Beep("info");
                        else Beep("error");
                        WriteJson(ns, 200, "{\\"ok\\":true}");
                        return;
                    }
                } catch {}
            }
        }

        private static void HandleEvents(NetworkStream ns, string query) {
            string cid = "";
            foreach (string part in query.Split('&')) {
                if (part.StartsWith("client=")) {
                    cid = Uri.UnescapeDataString(part.Substring(7));
                    break;
                }
            }
            if (!ClientRe.IsMatch(cid)) cid = Guid.NewGuid().ToString("N").Substring(0, 16);

            ClientState state = new ClientState { Ready = false, Active = Interlocked.Increment(ref _activitySeq) };
            lock (LockObj) {
                ClientState old;
                if (Listeners.TryGetValue(cid, out old)) {
                    state.Ready = old.Ready;
                    old.Queue.Put(null);
                }
                Listeners[cid] = state;
            }
            try {
                byte[] hdr = Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\\r\\nContent-Type: text/event-stream; charset=utf-8\\r\\nCache-Control: no-cache\\r\\nConnection: keep-alive\\r\\n\\r\\n: connected\\n\\n");
                ns.Write(hdr, 0, hdr.Length);
                ns.Flush();
                while (true) {
                    string data;
                    if (state.Queue.TryTake(15000, out data)) {
                        if (data == null) break;
                        byte[] msg = Encoding.UTF8.GetBytes("data: " + data + "\\n\\n");
                        ns.Write(msg, 0, msg.Length);
                    } else {
                        byte[] ping = Encoding.UTF8.GetBytes(": ping\\n\\n");
                        ns.Write(ping, 0, ping.Length);
                    }
                    ns.Flush();
                }
            } catch {}
            finally {
                bool hadPending = false;
                lock (LockObj) {
                    ClientState cur;
                    if (Listeners.TryGetValue(cid, out cur) && ReferenceEquals(cur, state)) {
                        Listeners.Remove(cid);
                        List<string> toRemove = new List<string>();
                        foreach (var kv in Pending) if (kv.Value == cid) toRemove.Add(kv.Key);
                        foreach (string k in toRemove) { Pending.Remove(k); hadPending = true; }
                    }
                }
                if (hadPending) Beep("error");
            }
        }

        private static void ServeAsset(NetworkStream ns, string path, bool headOnly) {
            if (path == "/") path = "/index.html";
            byte[] data;
            if (!Assets.TryGetValue(path, out data)) {
                WriteJson(ns, 404, "{\\"error\\":\\"not found\\"}");
                return;
            }
            string mime = "application/octet-stream";
            if (path.EndsWith(".html")) mime = "text/html; charset=utf-8";
            else if (path.EndsWith(".js")) mime = "text/javascript; charset=utf-8";
            else if (path.EndsWith(".css")) mime = "text/css; charset=utf-8";
            else if (path.EndsWith(".json")) mime = "application/json; charset=utf-8";
            else if (path.EndsWith(".png")) mime = "image/png";
            else if (path.EndsWith(".svg")) mime = "image/svg+xml";

            string hdr = "HTTP/1.1 200 OK\\r\\nContent-Type: " + mime + "\\r\\nCache-Control: no-cache\\r\\nContent-Length: " + data.Length + "\\r\\nConnection: close\\r\\n\\r\\n";
            byte[] hdrBytes = Encoding.UTF8.GetBytes(hdr);
            ns.Write(hdrBytes, 0, hdrBytes.Length);
            if (!headOnly) ns.Write(data, 0, data.Length);
            ns.Flush();
        }

        private static void WriteJson(NetworkStream ns, int status, string json) {
            string reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : "Not Found";
            byte[] body = Encoding.UTF8.GetBytes(json);
            string hdr = "HTTP/1.1 " + status + " " + reason + "\\r\\nContent-Type: application/json; charset=utf-8\\r\\nCache-Control: no-cache\\r\\nContent-Length: " + body.Length + "\\r\\nConnection: close\\r\\n\\r\\n";
            byte[] hdrBytes = Encoding.UTF8.GetBytes(hdr);
            ns.Write(hdrBytes, 0, hdrBytes.Length);
            ns.Write(body, 0, body.Length);
            ns.Flush();
        }

        private static string ReadLine(NetworkStream ns) {
            List<byte> bytes = new List<byte>();
            while (bytes.Count < 8192) {
                int b = ns.ReadByte();
                if (b < 0) break;
                if (b == '\\n') break;
                if (b != '\\r') bytes.Add((byte)b);
            }
            return Encoding.UTF8.GetString(bytes.ToArray());
        }

        private static string ExtractJsonString(string json, string key) {
            Match m = Regex.Match(json, "\\"" + Regex.Escape(key) + "\\"\\\\s*:\\\\s*\\"((?:\\\\\\\\.|[^\\"\\\\\\\\])*)\\"");
            return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
        }

        private static bool ExtractJsonBool(string json, string key) {
            Match m = Regex.Match(json, "\\"" + Regex.Escape(key) + "\\"\\\\s*:\\\\s*(true|false)");
            return m.Success && m.Groups[1].Value == "true";
        }
    }
}
`;

fs.writeFileSync(csPath, csSource, 'utf8');

const cscCandidates = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
];
const csc = cscCandidates.find(p => fs.existsSync(p));
if (!csc) throw new Error('csc.exe (.NET Framework 4) not found');

const res = spawnSync(csc, [
  '/nologo',
  '/optimize+',
  '/target:winexe',
  `/out:${exePath}`,
  `/win32icon:${icoPath}`,
  `/resource:${bundlePath},assets.bin`,
  `/resource:${icoPath},app.ico`,
  `/resource:${path.join(nativeDir, 'hid-shim.js')},hid-shim.js`,
  `/resource:${path.join(webview2Dir, 'Microsoft.Web.WebView2.Core.dll')},Microsoft.Web.WebView2.Core.dll`,
  `/resource:${path.join(webview2Dir, 'Microsoft.Web.WebView2.WinForms.dll')},Microsoft.Web.WebView2.WinForms.dll`,
  `/resource:${path.join(webview2Dir, 'WebView2Loader.x64.dll')},WebView2Loader.x64.dll`,
  `/resource:${path.join(webview2Dir, 'WebView2Loader.x86.dll')},WebView2Loader.x86.dll`,
  `/reference:${path.join(webview2Dir, 'Microsoft.Web.WebView2.Core.dll')}`,
  `/reference:${path.join(webview2Dir, 'Microsoft.Web.WebView2.WinForms.dll')}`,
  '/reference:System.Web.Extensions.dll',
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  csPath,
  path.join(nativeDir, 'NativeShell.cs'),
], {encoding: 'utf8'});

fs.rmSync(buildDir, {recursive: true, force: true});

if (res.status !== 0) {
  console.error(res.stdout, res.stderr);
  process.exit(res.status || 1);
}

const sizeKB = (fs.statSync(exePath).size / 1024).toFixed(1);
console.log(`Built ${exePath} (${sizeKB} KB, ${count} embedded web assets)`);
