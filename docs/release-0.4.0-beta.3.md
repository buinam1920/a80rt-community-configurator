# A80RT Configurator 0.4.0-beta.3

Release notes for the changes since 0.4.0-beta.2 (commit `b588385`).

## Highlights

- **Standalone window.** `A80RT-Configurator-0.4.0-beta.3.exe` opens its own WebView2 window. You no longer need a browser.
- **Wireless writes.** Rapid Trigger and general settings can be written through the 2.4 GHz receiver. Hotkey profile switching now works wirelessly.
- **Battery.** When you connect through the receiver, the top bar, window title, taskbar badge and tray icon show the keyboard battery.
- **Auto-connect.** A keyboard you have already allowed is detected at startup and when you plug it in.
- **English interface.** A VI/EN switch is in the top bar.

## Standalone window (WebView2 + native HID)

- The exe hosts the app in WebView2. `scripts/native/NativeShell.cs` reads and writes the keyboard through the Windows HID API (SetupDi/HidD/HidP, overlapped I/O).
- `scripts/native/hid-shim.js` gives the app the same `navigator.hid` surface as the browser version: `getDevices`/`requestDevice`, `connect`/`disconnect` events, and `open`/`close`/`sendReport`/`inputreport` on each device.
- Report bytes are passed through unchanged as base64. The host never builds, alters, retries or originates a report, so the same JavaScript still enforces every measured protocol rule: framing, ACK parsing, qualification and readback.
- Enumeration only includes vendor collections (usage page ≥ 0xFF00) for VID `0C45` with PID `80A1`, `80A2` or `FEFC`. Plug and unplug events are debounced from `WM_DEVICECHANGE`.
- There is no device chooser, so the keyboard is detected automatically.
- Closing the window keeps the app in the tray, where hotkeys and the battery icon keep working. Starting the exe again brings back the window that is already running.
- If WebView2 is unavailable, the exe opens an Edge/Chrome app window instead. `--browser` forces that window.
- WebView2 data is stored in `%LOCALAPPDATA%\A80RT-Configurator\WebView2`. Profiles saved by the browser version stay in that browser: export them as JSON there, then import them in the window.
- WebView2 SDK 1.0.4314.35 is embedded under its license (`vendor/webview2/`, with `LICENSE.txt`, `NOTICE.txt` and `SOURCE.txt`).
- Developer flags: `--user-data <dir>`, `--remote-debugging <port>`, `--hid-selftest <file>`. The self-test only lists devices and sends one info read.

## Receiver writes (A80RT U Dongle)

- These writes are qualified for **Rapid Trigger (0x27)** and **general settings (0x21, including dead zones)** only. They are allowed after a fresh read that confirms an inner A80RT U at firmware 1.37.
- The receiver uses PID `FEFC`, interface FF80/1, report ID 0 and 32-byte reports.
- Evidence comes from a native measurement on 2026-10-31:
  - W actuation raw 120→121→120;
  - top dead zone 30→31→30;
  - each step was verified by readback and followed by a byte-for-byte match of all nine blocks;
  - ACKs have the wired header shape inside 32-byte reports.
- The sanitized fixture is `tests/fixtures/a80rt-dongle-write-qualification.json`.
- Every other group still needs the USB cable: key bindings, colors, lighting, macros and DKS. A draft that mixes these with receiver-writable changes is blocked before any byte is sent.
- Fn writes (0x26) are still blocked on every connection.
- A receiver read that continues past offset 0 no longer revokes the firmware attestation from the same session.

## Battery

- Battery is read from device-info byte 17 over the receiver. While connected it is polled every 30 s, and polling pauses whenever a read or write is running.
- The level shows in a top-bar chip, the window title (`🔋NN% · …`), the taskbar badge and a tray icon drawn with the percentage.
- One warning is shown at ≤20% and another at ≤10%.

## Auto-connect

- At startup, and again shortly after a keyboard is plugged in, the app connects to a device you have already allowed and reads it. A wired connection is preferred over the receiver.
- If the draft has unsaved changes, the app does not reconnect automatically. Disconnecting by hand turns auto-connect off until the next plug-in.
- A Web Lock (`a80rt-keyboard`) keeps two app windows from using the keyboard at the same time.

## English interface

- `dist/i18n.js` translates the rendered interface. Vietnamese stays the source text, and `dist/i18n-en.js` maps it to English with exact strings and anchored patterns.
- The language follows the system by default and is saved in `localStorage` as `a80rt-lang`. Switching does not reload the page, so the draft is kept.
- Windows notifications use the selected language.
- Two parts are still only in Vietnamese: the raw profile preview text and the tray menu labels.

## Tests

- `npm test`: 243 tests, all passing.
- New test files:
  - `tests/dongle-qualification.test.mjs`
  - `tests/auto-connect-battery.test.mjs`
  - `tests/native-hid-shim.test.mjs`
- `tests/release-graph.test.mjs` now checks for 16 modules at version `0.4.0-beta.3`.

## Not yet verified on hardware

- A full read and an Apply through the standalone window with the keyboard awake. The send and receive paths were checked through the receiver, which replied with a link-loss report while the keyboard was asleep.
- Physical in-game hotkey switching over the receiver.
- How the tray battery icon looks on different taskbar scales.

## Build

```powershell
npm test
npm run build   # writes A80RT-Configurator.exe; set A80RT_BUILD_OUTPUT to change the path
```

The build needs the .NET Framework 4 `csc.exe` that ships with Windows. The exe is unsigned and is not committed to the repository.
