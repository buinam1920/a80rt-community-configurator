# A80RT Configurator 1.1.2

1.1.2 builds on [1.1.1](release-1.1.1.md). Keyboard reading, writing and the protocol rules are unchanged. The full history is in the [changelog](../CHANGELOG.md).

## Start with Windows

- **Off by default.** Turn it on with the **Start with Windows** checkbox at the bottom of the sidebar, or from the tray menu (*Khởi động cùng Windows (chạy nền)*). Untick either to turn it off; both always show the same setting. The checkbox appears only in the exe, since the browser version cannot start with Windows.
- **What happens at sign-in:** the exe starts hidden in the tray. The app page still loads in the background, so the keyboard connects automatically, the battery shows in the tray and profile hotkeys work. Double-click the tray icon to open the window.
- **How it works:** the option writes the current user's startup entry (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value *A80RT Configurator*) pointing at this exe with `--start-in-tray`. Nothing is installed for other users.
- **Where the exe lives matters:** startup runs the exe from the folder it was in when you ticked the option. Keep it somewhere stable (not Downloads, which you may clean). After moving or updating the exe, untick and tick the option again from the new copy.
- If the app is already running, a second `--start-in-tray` launch exits quietly; opening the exe normally still brings the running window forward. If port 8787 is taken at sign-in, the startup launch gives up silently instead of showing a dialog.

## Battery (receiver)

- Battery is read every **5 seconds** while idle, the manufacturer driver's interval (was 30 seconds).
- A failed read now **clears** the percentage instead of leaving the previous value on screen. Before, a keyboard that was asleep or out of range could keep showing an old number such as 80%.
- Every successful read refreshes the tray, so the tray's two-minute expiry no longer hides a reading that is still current.
- The percentage itself still comes straight from the keyboard (device-info byte 17, the same byte the manufacturer driver shows). How accurate it is near empty depends on the keyboard firmware.

## Tests

295 automated tests, including an 80% → 3% update, failed reads and recovery.
