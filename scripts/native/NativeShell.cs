// Standalone window for A80RT Configurator: a WebView2 form plus a native
// Windows HID bridge, so the app runs without opening a browser.
//
// The web app keeps all protocol logic. This host only enumerates/opens the
// A80RT vendor collections and moves raw HID reports between the device and
// scripts/native/hid-shim.js. It never builds, alters or retries a report and
// never sends anything on its own: every byte written comes from the app's
// existing, measured transport code.
//
// C# 5 only (compiled by the .NET Framework 4 csc.exe).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace A80RT {
    // Loads the embedded WebView2 managed assemblies. Installed before any type
    // that references WebView2 is touched.
    internal static class EmbeddedAssemblies {
        private static bool _installed;
        public static void Install() {
            if (_installed) return;
            _installed = true;
            AppDomain.CurrentDomain.AssemblyResolve += (sender, args) => {
                string name = new AssemblyName(args.Name).Name;
                if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name + ".dll")) {
                    if (s == null) return null;
                    byte[] raw = new byte[s.Length];
                    int read = 0;
                    while (read < raw.Length) { int n = s.Read(raw, read, raw.Length - read); if (n <= 0) break; read += n; }
                    return Assembly.Load(raw);
                }
            };
        }
    }

    internal static class NativeShell {
        private static ShellForm _form;
        public static bool Available { get; private set; }
        public static string LastError { get; private set; }
        public static string UserDataFolder;
        public static int RemoteDebuggingPort; // test-only: inspect the page over DevTools
        // Called (UI thread) when WebView2 fails after the window was shown, e.g. an unwritable
        // user-data folder; the launcher falls back to the browser window.
        public static Action<string> InitFailed;
        private static bool _initFailed;

        // Returns false when WebView2 cannot be used (no runtime, load failure);
        // the caller then falls back to opening the browser.
        public static bool Show(string url, Icon icon) {
            try {
                if (_form != null && !_form.IsDisposed) { _form.Reveal(); return true; }
                if (_initFailed) return false;
                PrepareLoader();
                CoreWebView2Environment.GetAvailableBrowserVersionString();
                _form = new ShellForm(url, icon);
                _form.Show();
                Available = true;
                return true;
            } catch (Exception ex) {
                LastError = ex.GetType().Name + ": " + ex.Message;
                Available = false;
                return false;
            }
        }

        internal static void ReportInitFailure(ShellForm form, string url, Exception ex) {
            _initFailed = true;
            Available = false;
            LastError = ex.GetType().Name + ": " + ex.Message;
            if (_form == form) _form = null;
            try { form.AllowClose(); form.Close(); form.Dispose(); } catch {}
            Action<string> fallback = InitFailed;
            if (fallback != null) fallback(url);
            else MessageBox.Show("Không mở được cửa sổ ứng dụng: " + ex.Message, "A80RT Configurator", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        public static void ExitRequested() {
            if (_form != null && !_form.IsDisposed) _form.AllowClose();
        }

        private static void PrepareLoader() {
            string arch = Environment.Is64BitProcess ? "x64" : "x86";
            string version = Assembly.GetExecutingAssembly().GetName().Version.ToString();
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "A80RT-Configurator", "runtime", version + "-" + arch);
            Directory.CreateDirectory(dir);
            string target = Path.Combine(dir, "WebView2Loader.dll");
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("WebView2Loader." + arch + ".dll")) {
                if (s == null) throw new FileNotFoundException("Embedded WebView2Loader missing");
                byte[] raw = new byte[s.Length];
                int read = 0;
                while (read < raw.Length) { int n = s.Read(raw, read, raw.Length - read); if (n <= 0) break; read += n; }
                bool same = File.Exists(target) && new FileInfo(target).Length == raw.Length;
                if (!same) File.WriteAllBytes(target, raw);
            }
            CoreWebView2Environment.SetLoaderDllFolderPath(dir);
        }

        public static string ReadResourceText(string name) {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
                if (s == null) return "";
                using (StreamReader r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
            }
        }
    }

    internal sealed class ShellForm : Form {
        private const int WM_DEVICECHANGE = 0x0219;
        private readonly WebView2 _view;
        private readonly string _url;
        private readonly HidBridge _hid;
        private bool _allowClose;
        private bool _hintShown;
        private System.Windows.Forms.Timer _deviceDebounce;

        public ShellForm(string url, Icon icon) {
            _url = url;
            Text = "A80RT Configurator";
            if (icon != null) Icon = icon;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1440, 920);
            MinimumSize = new Size(960, 640);
            BackColor = Color.FromArgb(17, 21, 25);
            _view = new WebView2();
            _view.Dock = DockStyle.Fill;
            _view.DefaultBackgroundColor = Color.FromArgb(17, 21, 25);
            Controls.Add(_view);
            _hid = new HidBridge(this, Post);
            _deviceDebounce = new System.Windows.Forms.Timer();
            _deviceDebounce.Interval = 600;
            _deviceDebounce.Tick += (s, e) => { _deviceDebounce.Stop(); _hid.Rescan(); };
            Load += async (s, e) => {
                try {
                    string data = NativeShell.UserDataFolder ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "A80RT-Configurator", "WebView2");
                    CoreWebView2EnvironmentOptions options = null;
                    if (NativeShell.RemoteDebuggingPort > 0) options = new CoreWebView2EnvironmentOptions("--remote-debugging-port=" + NativeShell.RemoteDebuggingPort);
                    CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, data, options);
                    await _view.EnsureCoreWebView2Async(env);
                    CoreWebView2 core = _view.CoreWebView2;
                    core.Settings.IsStatusBarEnabled = false;
                    core.Settings.AreDefaultContextMenusEnabled = true;
                    await core.AddScriptToExecuteOnDocumentCreatedAsync(NativeShell.ReadResourceText("hid-shim.js"));
                    core.WebMessageReceived += (sender, args) => _hid.Handle(args.TryGetWebMessageAsString());
                    core.NewWindowRequested += (sender, args) => { args.Handled = true; OpenExternal(args.Uri); };
                    core.NavigationStarting += (sender, args) => {
                        if (!args.Uri.StartsWith(_url, StringComparison.OrdinalIgnoreCase)) { args.Cancel = true; OpenExternal(args.Uri); }
                    };
                    core.DocumentTitleChanged += (sender, args) => { Text = core.DocumentTitle.Length > 0 ? core.DocumentTitle : "A80RT Configurator"; };
                    core.Navigate(_url);
                } catch (Exception ex) {
                    NativeShell.ReportInitFailure(this, _url, ex);
                }
            };
        }

        private static void OpenExternal(string uri) {
            if (uri != null && (uri.StartsWith("https://") || uri.StartsWith("http://"))) {
                try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch {}
            }
        }

        private void Post(string json) {
            if (IsDisposed) return;
            try {
                BeginInvoke((MethodInvoker)delegate {
                    if (_view.CoreWebView2 != null) _view.CoreWebView2.PostWebMessageAsJson(json);
                });
            } catch (InvalidOperationException) {}
        }

        public void Reveal() {
            if (!Visible) Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        public void AllowClose() { _allowClose = true; }

        protected override void OnFormClosing(FormClosingEventArgs e) {
            // Closing the window keeps the app in the tray so hotkeys and the
            // battery icon keep working; "Thoát hoàn toàn" in the tray exits.
            if (!_allowClose && e.CloseReason == CloseReason.UserClosing) {
                e.Cancel = true;
                Hide();
                if (!_hintShown) { _hintShown = true; Program.TrayHint("A80RT vẫn chạy ở khay hệ thống để giữ phím tắt và hiển thị pin. Chuột phải icon → Thoát hoàn toàn để tắt."); }
                return;
            }
            _hid.CloseAll();
            base.OnFormClosing(e);
        }

        protected override void WndProc(ref Message m) {
            if (m.Msg == WM_DEVICECHANGE && _deviceDebounce != null) { _deviceDebounce.Stop(); _deviceDebounce.Start(); }
            base.WndProc(ref m);
        }
    }

    // Raw HID access for the A80RT vendor-defined collections only.
    internal sealed class HidBridge {
        private const ushort Vendor = 0x0C45;
        private static readonly ushort[] Products = { 0x80A1, 0x80A2, 0xFEFC };
        private readonly Control _owner;
        private readonly Action<string> _post;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly Dictionary<string, OpenDevice> _open = new Dictionary<string, OpenDevice>(StringComparer.OrdinalIgnoreCase);
        private readonly object _lock = new object();
        private Dictionary<string, Dictionary<string, object>> _known = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);

        public HidBridge(Control owner, Action<string> post) { _owner = owner; _post = post; }

        public void Handle(string text) {
            Dictionary<string, object> msg;
            try { msg = _json.Deserialize<Dictionary<string, object>>(text); } catch { return; }
            if (msg == null || !msg.ContainsKey("id") || !msg.ContainsKey("op")) return;
            object id = msg["id"];
            string op = msg["op"] as string;
            string path = msg.ContainsKey("path") ? msg["path"] as string : null;
            try {
                if (op == "list") { Reply(id, Enumerate().Values.ToListOfObjects()); return; }
                if (op == "open") { Open(path); Reply(id, null); return; }
                if (op == "close") { Close(path); Reply(id, null); return; }
                if (op == "send") {
                    int reportId = Convert.ToInt32(msg["reportId"]);
                    byte[] data = Convert.FromBase64String(msg["data"] as string ?? "");
                    OpenDevice dev;
                    lock (_lock) { if (!_open.TryGetValue(path ?? "", out dev)) throw new InvalidOperationException("Thiết bị chưa mở kết nối."); }
                    ThreadPool.QueueUserWorkItem(_ => {
                        try { dev.Write(reportId, data); Reply(id, null); }
                        catch (Exception ex) { Fail(id, ex); }
                    });
                    return;
                }
                throw new InvalidOperationException("Unknown native HID operation.");
            } catch (Exception ex) { Fail(id, ex); }
        }

        private void Reply(object id, object result) {
            var payload = new Dictionary<string, object> { { "kind", "reply" }, { "id", id }, { "ok", true }, { "result", result } };
            _post(_json.Serialize(payload));
        }

        private void Fail(object id, Exception ex) {
            var payload = new Dictionary<string, object> { { "kind", "reply" }, { "id", id }, { "ok", false }, { "error", ex.Message }, { "name", ex is UnauthorizedAccessException ? "NotAllowedError" : "NetworkError" } };
            _post(_json.Serialize(payload));
        }

        private void Open(string path) {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("Missing device path.");
            lock (_lock) { if (_open.ContainsKey(path)) return; }
            Dictionary<string, object> info;
            if (!Enumerate().TryGetValue(path, out info)) throw new IOException("Không tìm thấy thiết bị (đã rút hoặc tắt).");
            OpenDevice dev = OpenDevice.Open(path, Convert.ToInt32(info["inputLength"]), Convert.ToInt32(info["outputLength"]),
                (bytes) => {
                    var payload = new Dictionary<string, object> { { "kind", "input" }, { "path", path }, { "reportId", (int)bytes[0] }, { "data", Convert.ToBase64String(bytes, 1, bytes.Length - 1) } };
                    _post(_json.Serialize(payload));
                },
                () => { lock (_lock) _open.Remove(path); PostDisconnect(path); });
            lock (_lock) _open[path] = dev;
        }

        private void Close(string path) {
            OpenDevice dev = null;
            lock (_lock) { if (path != null && _open.TryGetValue(path, out dev)) _open.Remove(path); }
            if (dev != null) dev.Dispose();
        }

        public void CloseAll() {
            List<OpenDevice> all;
            lock (_lock) { all = new List<OpenDevice>(_open.Values); _open.Clear(); }
            foreach (OpenDevice d in all) d.Dispose();
        }

        private void PostDisconnect(string path) {
            _post(_json.Serialize(new Dictionary<string, object> { { "kind", "disconnect" }, { "path", path } }));
        }

        // Called (debounced) on WM_DEVICECHANGE: report plugged/unplugged interfaces.
        public void Rescan() {
            Dictionary<string, Dictionary<string, object>> now;
            try { now = Enumerate(); } catch { return; }
            foreach (var pair in now) if (!_known.ContainsKey(pair.Key)) _post(_json.Serialize(new Dictionary<string, object> { { "kind", "connect" }, { "device", pair.Value } }));
            foreach (var pair in _known) if (!now.ContainsKey(pair.Key)) { Close(pair.Key); PostDisconnect(pair.Key); }
            _known = now;
        }

        public Dictionary<string, Dictionary<string, object>> Enumerate() {
            var result = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
            foreach (string path in Native.HidPaths()) {
                using (SafeFileHandle h = Native.CreateFile(path, 0, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, IntPtr.Zero, Native.OPEN_EXISTING, 0, IntPtr.Zero)) {
                    if (h.IsInvalid) continue;
                    var attr = new Native.HIDD_ATTRIBUTES(); attr.Size = Marshal.SizeOf(typeof(Native.HIDD_ATTRIBUTES));
                    if (!Native.HidD_GetAttributes(h, ref attr)) continue;
                    if (attr.VendorID != Vendor || Array.IndexOf(Products, attr.ProductID) < 0) continue;
                    IntPtr pre;
                    if (!Native.HidD_GetPreparsedData(h, out pre)) continue;
                    Native.HIDP_CAPS caps;
                    try { if (Native.HidP_GetCaps(pre, out caps) != Native.HIDP_STATUS_SUCCESS) continue; }
                    finally { Native.HidD_FreePreparsedData(pre); }
                    // Only vendor-defined configuration collections (never the typing/mouse/media ones).
                    if (caps.UsagePage < 0xFF00 || caps.InputReportByteLength < 2 || caps.OutputReportByteLength < 2) continue;
                    byte[] nameBuf = new byte[256];
                    string product = Native.HidD_GetProductString(h, nameBuf, nameBuf.Length) ? Encoding.Unicode.GetString(nameBuf).TrimEnd('\0') : "";
                    var report = new Func<int, object[]>(len => new object[] { new Dictionary<string, object> { { "reportId", 0 }, { "items", new object[] { new Dictionary<string, object> { { "reportSize", 8 }, { "reportCount", len - 1 } } } } } });
                    var collection = new Dictionary<string, object> {
                        { "usagePage", (int)caps.UsagePage }, { "usage", (int)caps.Usage },
                        { "inputReports", report(caps.InputReportByteLength) }, { "outputReports", report(caps.OutputReportByteLength) },
                        { "featureReports", new object[0] }, { "children", new object[0] }
                    };
                    result[path] = new Dictionary<string, object> {
                        { "path", path }, { "vendorId", (int)attr.VendorID }, { "productId", (int)attr.ProductID }, { "productName", product },
                        { "collections", new object[] { collection } },
                        { "inputLength", (int)caps.InputReportByteLength }, { "outputLength", (int)caps.OutputReportByteLength }
                    };
                }
            }
            if (_known.Count == 0) _known = result;
            return result;
        }
    }

    internal static class DictionaryExtensions {
        public static List<object> ToListOfObjects(this Dictionary<string, Dictionary<string, object>>.ValueCollection values) {
            var list = new List<object>();
            foreach (var v in values) list.Add(v);
            return list;
        }
    }

    // One opened HID interface: an overlapped read loop and serialized writes.
    internal sealed class OpenDevice : IDisposable {
        private readonly SafeFileHandle _handle;
        private readonly int _inputLength, _outputLength;
        private readonly Action<byte[]> _onInput;
        private readonly Action _onLost;
        private readonly ManualResetEvent _stop = new ManualResetEvent(false);
        private readonly object _writeLock = new object();
        private volatile bool _disposed;
        // Set when a timed-out write could not be cancelled: Windows may still complete it later,
        // so nothing more is sent on this handle. Reconnecting opens a fresh handle.
        private volatile bool _writeFaulted;
        private const string WriteFaultedMessage = "Một lần ghi HID bị kẹt chưa hủy được. Ngắt kết nối rồi kết nối lại bàn phím trước khi đọc hoặc ghi tiếp.";
        // Keeps abandoned write buffers/events reachable until the kernel completes them.
        private static readonly List<ManualResetEvent> AbandonedWrites = new List<ManualResetEvent>();
        private Thread _reader;
        private int _handleClosed;

        private OpenDevice(SafeFileHandle handle, int inputLength, int outputLength, Action<byte[]> onInput, Action onLost) {
            _handle = handle; _inputLength = inputLength; _outputLength = outputLength; _onInput = onInput; _onLost = onLost;
        }

        public static OpenDevice Open(string path, int inputLength, int outputLength, Action<byte[]> onInput, Action onLost) {
            SafeFileHandle h = Native.CreateFile(path, Native.GENERIC_READ | Native.GENERIC_WRITE, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, IntPtr.Zero, Native.OPEN_EXISTING, Native.FILE_FLAG_OVERLAPPED, IntPtr.Zero);
            if (h.IsInvalid) {
                int err = Marshal.GetLastWin32Error();
                if (err == 5) throw new UnauthorizedAccessException("Windows từ chối mở thiết bị (đang bị chương trình khác giữ độc quyền?).");
                throw new IOException("Không mở được thiết bị HID (mã lỗi " + err + ").");
            }
            var dev = new OpenDevice(h, inputLength, outputLength, onInput, onLost);
            var t = new Thread(dev.ReadLoop) { IsBackground = true, Name = "A80RT HID read" };
            dev._reader = t;
            t.Start();
            return dev;
        }

        private void ReadLoop() {
            IntPtr buffer = Marshal.AllocHGlobal(_inputLength);
            IntPtr overlapped = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeOverlapped)));
            var done = new ManualResetEvent(false);
            bool lost = false;
            try {
                while (!_disposed) {
                    done.Reset();
                    var ov = new NativeOverlapped(); ov.EventHandle = done.SafeWaitHandle.DangerousGetHandle();
                    Marshal.StructureToPtr(ov, overlapped, false);
                    uint got;
                    if (!Native.ReadFile(_handle, buffer, (uint)_inputLength, IntPtr.Zero, overlapped)) {
                        int err = Marshal.GetLastWin32Error();
                        if (err != Native.ERROR_IO_PENDING) { lost = !_disposed; break; }
                        int which = WaitHandle.WaitAny(new WaitHandle[] { done, _stop });
                        if (which == 1) {
                            // The handle stays open until this loop ends (see CloseHandleOnce), so the
                            // pending read can be cancelled and drained safely.
                            Native.CancelIoEx(_handle, overlapped); Native.GetOverlappedResult(_handle, overlapped, out got, true); break;
                        }
                    }
                    if (!Native.GetOverlappedResult(_handle, overlapped, out got, true)) { lost = !_disposed; break; }
                    if (got > 1) {
                        byte[] report = new byte[got];
                        Marshal.Copy(buffer, report, 0, (int)got);
                        try { _onInput(report); } catch {}
                    }
                }
            } catch (Exception) {
                lost = !_disposed;
            } finally {
                Marshal.FreeHGlobal(buffer);
                Marshal.FreeHGlobal(overlapped);
                done.Close();
                CloseHandleOnce();
            }
            if (lost) { Dispose(); try { _onLost(); } catch {} }
        }

        // Closed exactly once, by the read loop after its I/O has completed, or by Dispose
        // when the read loop does not finish in time. Writes hold _writeLock while using it.
        private void CloseHandleOnce() {
            if (Interlocked.Exchange(ref _handleClosed, 1) != 0) return;
            lock (_writeLock) { try { _handle.Dispose(); } catch {} }
        }

        public void Write(int reportId, byte[] data) {
            try { WriteCore(reportId, data); }
            catch (ObjectDisposedException) { throw new IOException("Thiết bị đã đóng."); }
        }

        private void WriteCore(int reportId, byte[] data) {
            if (_disposed) throw new IOException("Thiết bị đã đóng.");
            if (_writeFaulted) throw new IOException(WriteFaultedMessage);
            if (data.Length > _outputLength - 1) throw new ArgumentException("Report dài hơn kích thước output của thiết bị.");
            // Windows expects [reportId][payload padded to OutputReportByteLength-1].
            byte[] frame = new byte[_outputLength];
            frame[0] = (byte)reportId;
            Buffer.BlockCopy(data, 0, frame, 1, data.Length);
            lock (_writeLock) {
                IntPtr buffer = Marshal.AllocHGlobal(frame.Length);
                IntPtr overlapped = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeOverlapped)));
                var done = new ManualResetEvent(false);
                bool stillPending = false;
                try {
                    Marshal.Copy(frame, 0, buffer, frame.Length);
                    var ov = new NativeOverlapped(); ov.EventHandle = done.SafeWaitHandle.DangerousGetHandle();
                    Marshal.StructureToPtr(ov, overlapped, false);
                    uint written;
                    if (!Native.WriteFile(_handle, buffer, (uint)frame.Length, IntPtr.Zero, overlapped)) {
                        int err = Marshal.GetLastWin32Error();
                        if (err != Native.ERROR_IO_PENDING) throw new IOException("Gửi report HID thất bại (mã lỗi " + err + ").");
                        if (!done.WaitOne(3000)) {
                            Native.CancelIoEx(_handle, overlapped);
                            // Bounded wait for the cancellation: an unbounded GetOverlappedResult here
                            // held _writeLock forever and froze Dispose()/CloseHandleOnce().
                            if (!done.WaitOne(1000)) {
                                // The kernel still owns buffer/overlapped/event and may yet complete the write.
                                // Quarantine this handle and free the memory only once the I/O has completed.
                                stillPending = true;
                                _writeFaulted = true;
                                AbandonWrite(done, buffer, overlapped);
                                throw new IOException(WriteFaultedMessage);
                            }
                            // The write may have completed just as the timeout fired: then it was sent.
                            if (Native.GetOverlappedResult(_handle, overlapped, out written, false) && written == frame.Length) return;
                            throw new IOException("Gửi report HID quá thời gian.");
                        }
                    }
                    if (!Native.GetOverlappedResult(_handle, overlapped, out written, true) || written != frame.Length) throw new IOException("Gửi report HID chưa trọn vẹn.");
                } finally {
                    if (!stillPending) {
                        Marshal.FreeHGlobal(buffer);
                        Marshal.FreeHGlobal(overlapped);
                        done.Close();
                    }
                }
            }
        }

        private static void AbandonWrite(ManualResetEvent done, IntPtr buffer, IntPtr overlapped) {
            lock (AbandonedWrites) AbandonedWrites.Add(done);
            ThreadPool.RegisterWaitForSingleObject(done, (state, timedOut) => {
                Marshal.FreeHGlobal(buffer);
                Marshal.FreeHGlobal(overlapped);
                lock (AbandonedWrites) AbandonedWrites.Remove(done);
                done.Close();
            }, null, Timeout.Infinite, true);
        }

        public void Dispose() {
            if (_disposed) return;
            _disposed = true;
            _stop.Set();
            try { Native.CancelIoEx(_handle, IntPtr.Zero); } catch {}
            // Let the read loop drain its cancelled read and close the handle itself.
            if (_reader != null && Thread.CurrentThread != _reader && _reader.Join(1500)) return;
            if (Thread.CurrentThread != _reader) CloseHandleOnce();
        }
    }

    internal static class Native {
        public const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
        public const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3, FILE_FLAG_OVERLAPPED = 0x40000000;
        public const int ERROR_IO_PENDING = 997;
        public const int HIDP_STATUS_SUCCESS = 0x00110000;
        private const int DIGCF_PRESENT = 0x2, DIGCF_DEVICEINTERFACE = 0x10;

        [StructLayout(LayoutKind.Sequential)]
        public struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID; public ushort ProductID; public ushort VersionNumber; }

        [StructLayout(LayoutKind.Sequential)]
        public struct HIDP_CAPS {
            public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices;
            public ushort NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices;
            public ushort NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }

        [DllImport("hid.dll")] private static extern void HidD_GetHidGuid(out Guid guid);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES attributes);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr data);
        [DllImport("hid.dll")] public static extern bool HidD_FreePreparsedData(IntPtr data);
        [DllImport("hid.dll")] public static extern int HidP_GetCaps(IntPtr data, out HIDP_CAPS caps);
        [DllImport("hid.dll", SetLastError = true)] public static extern bool HidD_GetProductString(SafeFileHandle h, byte[] buffer, int length);
        [DllImport("setupapi.dll", SetLastError = true)] private static extern IntPtr SetupDiGetClassDevs(ref Guid guid, IntPtr enumerator, IntPtr parent, int flags);
        [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid guid, int index, ref SP_DEVICE_INTERFACE_DATA data);
        [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, IntPtr info);
        [DllImport("setupapi.dll")] private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern bool ReadFile(SafeFileHandle h, IntPtr buffer, uint length, IntPtr read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern bool WriteFile(SafeFileHandle h, IntPtr buffer, uint length, IntPtr written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetOverlappedResult(SafeFileHandle h, IntPtr overlapped, out uint transferred, bool wait);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CancelIoEx(SafeFileHandle h, IntPtr overlapped);

        public static List<string> HidPaths() {
            var paths = new List<string>();
            Guid guid; HidD_GetHidGuid(out guid);
            IntPtr set = SetupDiGetClassDevs(ref guid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if (set == new IntPtr(-1)) return paths;
            try {
                for (int i = 0; ; i++) {
                    var data = new SP_DEVICE_INTERFACE_DATA(); data.cbSize = Marshal.SizeOf(typeof(SP_DEVICE_INTERFACE_DATA));
                    if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref guid, i, ref data)) break;
                    int required;
                    SetupDiGetDeviceInterfaceDetail(set, ref data, IntPtr.Zero, 0, out required, IntPtr.Zero);
                    if (required <= 0) continue;
                    IntPtr detail = Marshal.AllocHGlobal(required);
                    try {
                        // SP_DEVICE_INTERFACE_DETAIL_DATA_W.cbSize: 8 on 64-bit, 6 on 32-bit.
                        Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                        if (SetupDiGetDeviceInterfaceDetail(set, ref data, detail, required, out required, IntPtr.Zero))
                            paths.Add(Marshal.PtrToStringUni(new IntPtr(detail.ToInt64() + 4)));
                    } finally { Marshal.FreeHGlobal(detail); }
                }
            } finally { SetupDiDestroyDeviceInfoList(set); }
            return paths;
        }
    }

    // Read-only diagnostic: lists A80RT configuration interfaces and reads the
    // 32-byte information block (command 0x10) once. Never writes configuration.
    internal static class HidSelfTest {
        public static int Run() {
            var bridge = new HidBridge(null, s => {});
            var devices = bridge.Enumerate();
            var json = new JavaScriptSerializer();
            Console.WriteLine("devices=" + devices.Count);
            foreach (var d in devices.Values)
                Console.WriteLine(string.Format("{0:X4}:{1:X4} {2} usage={3:X4}/{4:X2} in={5} out={6}", d["vendorId"], d["productId"], d["productName"],
                    ((Dictionary<string, object>)((object[])d["collections"])[0])["usagePage"], ((Dictionary<string, object>)((object[])d["collections"])[0])["usage"], d["inputLength"], d["outputLength"]));
            foreach (var d in devices.Values) {
                int usagePage = (int)((Dictionary<string, object>)((object[])d["collections"])[0])["usagePage"];
                int product = (int)d["productId"];
                if (!((product == 0x80A1 && usagePage == 0xFF68) || (product == 0xFEFC && usagePage == 0xFF80))) continue;
                int inLen = (int)d["inputLength"], outLen = (int)d["outputLength"];
                var got = new ManualResetEvent(false); byte[] reply = null;
                OpenDevice dev = OpenDevice.Open((string)d["path"], inLen, outLen, bytes => { if (bytes.Length > 9 && bytes[1] == 0x55 && bytes[2] == 0x10) { reply = bytes; got.Set(); } }, () => {});
                try {
                    int capacity = outLen - 1 - 8, count = Math.Min(32, capacity);
                    byte[] packet = new byte[outLen - 1];
                    packet[0] = 0xAA; packet[1] = 0x10; packet[2] = (byte)count; packet[6] = (byte)(count == 32 ? 1 : 0);
                    dev.Write(0, packet);
                    if (!got.WaitOne(3000)) { Console.WriteLine("read 0x10: timeout"); continue; }
                    // reply[0] is the report ID; info payload byte k is reply[9 + k].
                    Console.WriteLine(string.Format("read 0x10 via {0:X4}: reportLength={1} header={2} firmwareBytes={3},{4} innerVidPid={5:X2}{6:X2}:{7:X2}{8:X2}",
                        product, reply.Length - 1, BitConverter.ToString(reply, 1, 8), reply[9 + 8], reply[9 + 9], reply[9 + 5], reply[9 + 4], reply[9 + 7], reply[9 + 6]));
                } finally { dev.Dispose(); }
            }
            return 0;
        }
    }
}
