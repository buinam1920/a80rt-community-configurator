# A80RT Community Configurator — 0.4.0-beta.5

An unofficial community configurator compatible with LEOBOG A80RT keyboards. This project is not affiliated with or endorsed by LEOBOG. Product names identify compatible hardware only.

**[Download the Windows beta](https://github.com/buinam1920/a80rt-community-configurator/releases/tag/v0.4.0-beta.5)** — choose `A80RT-Configurator-0.4.0-beta.5.exe` under Assets.

## Getting started

1. Run the executable. It opens its own window using Microsoft WebView2, which is built into Windows 10/11; Edge or Chrome is only needed for the `--browser` fallback. Python is not required.
2. Close the manufacturer's configuration page. In the app, connect the keyboard and read its configuration. All nine configuration blocks must be read before editing.
3. Edit the draft, review the changes, then click Apply. Sliders and preset buttons only change the local draft.
4. Keep the app running (closing the window keeps it in the tray) while using global shortcuts. Defaults are **Ctrl+Alt+1 → LoL** and **Ctrl+Alt+2 → Apex**; assign your own under **Manage profiles & shortcuts** in the Rapid Trigger tab. A shortcut applies its profile automatically only when the existing draft has no changes. Otherwise, review the staged profile and click Apply.
5. Use the system tray menu to reopen the window, toggle sound, create a desktop shortcut, or exit completely.

Profiles are stored in the browser on this machine, not inside the executable. Export profile JSON files to keep separate backups. Changing the browser, origin, or clearing site data can make existing profiles unavailable.

## Beta status and compatibility

Live writes are qualified for the **wired A80RT U, firmware 1.37**, using interface FF68/61, report ID 0, 64-byte reports.

Through the **A80RT U Dongle** (2.4 GHz receiver, FEFC, interface FF80/1, 32-byte reports) only **Rapid Trigger (0x27)** and **general settings (0x21, including dead zones)** are writable, after a fresh read that attests an inner A80RT U at firmware 1.37. This covers every RT preset and the LoL/Apex profiles, so hotkey profile switching works wirelessly. It is based on a native measurement on 2026-10-31: W actuation raw 120→121→120 and top dead zone 30→31→30, each verified by readback and followed by a byte-for-byte match of all nine blocks; ACKs have the wired header shape in 32-byte reports. Other groups (key bindings, colors, lighting, macros, DKS) still require the USB cable, and a mixed draft is blocked before any byte is sent. Plain A80RT and other firmware/interface variants are not enabled for live writes.

**Fn writes are blocked.** Fn mappings can be edited and saved locally, but any draft with Fn changes blocks the entire Apply operation before transmission. Revert those changes to apply supported blocks.

A successful Apply means the changed fields matched a fresh readback. It does not establish persistence after power loss, visible lighting behavior, key output, or gameplay behavior. Unconfirmed writes preserve the draft and lock editing, Apply, and Revert until a fresh complete read. Export the draft first if needed.

The executable is unsigned. Physical in-game hotkeys and a complete preset write have not been validated on hardware for this beta. Automated tests do not replace hardware measurements.

## Features

- Read all nine configuration blocks, with raw data inspection.
- Per-key actuation, Rapid Trigger press/release thresholds, and whole-travel RT.
- Base/Fn mappings, lighting, per-key colors, macros, DKS, MT, TGL, RS/SOCD, and general settings, subject to model capabilities and write restrictions.
- Vendor-derived Office, Beginner, and Gaming presets; community LoL and Apex presets.
- Your own Rapid Trigger profiles: name the current draft and save it as a button next to the presets, delete or hide any profile (built-ins can be restored), and assign a global shortcut to any profile (Ctrl, Alt or Win plus A–Z, 0–9 or F1–F24).
- Local profiles, JSON import/export, draft previews, and session recovery.
- A standalone Windows executable with embedded interface assets and system tray controls. Since 0.4.0-beta.3 it opens its **own window (WebView2)** instead of a browser: the exe talks to the keyboard through the Windows HID API and exposes the same `navigator.hid` surface to the app (`scripts/native/hid-shim.js`, `scripts/native/NativeShell.cs`). Report bytes pass through unchanged, so every measured protocol rule is still enforced by the same JavaScript; the host never builds, alters, retries or originates a report. No device chooser is needed and the keyboard is detected automatically. Closing the window keeps the app in the tray (hotkeys, battery); use the tray menu to exit. `--browser` forces the previous Edge/Chrome app window, which is also the automatic fallback when WebView2 is unavailable. Profiles saved in the browser version live in that browser's storage: export them as JSON there and import them in the window. WebView2 SDK 1.0.4314.35 is redistributed under its license (`vendor/webview2/`).
- English or Vietnamese interface (VI/EN switch in the top bar; follows the system language by default).
- Global profile shortcuts with sound feedback and optional Windows notifications. The app window sends its shortcut list to the exe (or `scripts/a80rt_local.py`), which registers them with `RegisterHotKey`.
- Single-window event dispatch: the bridge selects one app window, prioritizes a connected/read session, and accepts only the first matching result for each event. Events time out after 45 seconds.
- Installable browser app (PWA) with an offline interface cache.

See the [feature comparison](docs/feature-parity.md) for implementation coverage, simulation tests, hardware evidence, and manufacturer-dependent features. Linked technical documents may be in Vietnamese.

## Rapid Trigger and presets

Actuation raw value 0 is preserved. The interface displays the manufacturer's 1.2 mm fallback for it, but its physical meaning has not been measured. Manual actuation input starts at 0.01 mm. Positive raw distances use units of 0.01 mm.

Whole-travel RT uses bit 0. According to the manufacturer's source, enabling it keeps RT active throughout travel; otherwise RT becomes active after actuation. This is source-derived behavior, not a separate physical measurement. Bottom Optimization and Rampage Mode remain readable and preserved but have no qualified editor for all supported variants.

Global top/bottom dead zones are settings bytes 8/9, with a range of 0.00–0.50 mm in 0.01 mm steps. They are independent of the current key selection. Zero and unknown stored values remain unchanged until the corresponding field is edited; no separate firmware enable flag is inferred.

Per-key switch selection is available for wired A80RT/A80RT U under source-derived capability gates and hidden for the dongle. Unknown switch IDs are preserved. Distance edits are rejected if switch travel is unknown. Changing a switch does not calibrate it; use the manufacturer's calibration tool.

Vendor-derived presets preserve switch IDs and the bottom/rtMode bits. Only Office resets both global dead zones to zero. Preset values and source notes are in [presets.js](dist/config/presets.js).

Saved profiles store Rapid Trigger for every key (actuation, RT press/release, whole-travel) and both global dead zones; switch IDs and the bottom/rtMode bits are left untouched. They are kept in this window's local storage, apply through the same draft, preflight and readback as any other edit, and are therefore writable over the receiver as well as the cable.

Community presets are starting points, not manufacturer data:

- **LoL:** default 1.5 mm; Q/W/E/R/D/F at 1.0 mm; 1–6/B/Tab at 1.4 mm; Space at 1.8 mm; RT off.
- **Apex:** W/A/S/D at 0.4 mm with 0.15 mm whole-travel RT; Space/Shift at 0.8 mm; left Ctrl/C at 0.6 mm with 0.2 mm RT; Q/Z/E/R/G/Tab at 1.2 mm; remaining keys at 1.5 mm.

## Profiles and recovery

Profiles are stored in IndexedDB and separated by model identity, connection type, VID/PID, and product name. Saving a draft creates a new profile. Profiles can be renamed, duplicated, deleted, previewed, and exported as JSON v2.

Import, selected-profile preview, and recovery always open a preview first. Confirm before moving changes into the draft. Supported fields are transferred in one atomic transaction; unsupported fields are listed as skipped. Reserved bits, color markers, device information, and locked Fn F1–F12 fields retain their current draft values. Changed binding records own all four bytes according to the manufacturer's encoding. Unchanged records remain intact.

Macro, DKS, RS, and SOCD references are validated. A different model, missing block, invalid byte, or malformed macro pointer rejects the transfer without changing the draft. Unsupported bottom/rtMode fields and dongle switch fields keep their current values.

Opening a profile without an active session creates an offline baseline that preserves its stored bytes, including unknown values. It grants no device-write permission. Connecting discards the offline session and requires a fresh nine-block read. Moving a profile into a live session validates semantic edits and preserves current opaque/locked fields. For example, a stored brightness value of 255 can be preserved offline but cannot be applied as a brightness edit; editable brightness is 1–5.

Stored raw-zero actuation can be restored from a profile after a positive edit. Only the corresponding actuation bytes are changed, with normal validation and readback.

Valid draft changes are saved for recovery after roughly 350 ms. Wait for the recovery confirmation before reloading. Recovery opens offline; connect/read again before transferring it into a device session. Unsaved macro input is not included. Storage failures do not erase the open draft or previous saved recovery.

Macro input survives Revert and profile replacement of its source macro. Recording stops, and the macro must be saved again or reselected before assignment. DKS selectors support an unused usage 0; new patterns default to A (usage 4). MT/TGL do not offer usage 0.

Legacy JSON v1 is view-only, even when it contains all nine blocks. Source/firmware labels in JSON cannot grant write authority. Export stays local. There is no manufacturer cloud sync, account backend, or hardware profile-bank switching.

## Hardware evidence

Measurements below apply only to the stated device and procedure:

- **2026-10-22:** native USB tooling read nine blocks (4,688 bytes) from A80RT U 0C45:80A1, FF68/61, report 0/64, firmware bytes [55,1] = 1.37. An authorized W color edit was read back and restored; all nine final blocks matched the original. Twenty-two color-write/control ACKs were measured. Test fixtures contain sanitized headers and synthetic padding, not private USB captures.
- **2026-10-23:** the deployed browser app read nine blocks, changed W's stored RGB from #000000 to #1b80ff, verified Apply, then restored #000000 with verified Apply. Lighting mode stayed at 11. This establishes that browser workflow for stored W color only.
- **2026-10-24:** browser Apply/readback verified W RT press threshold 0→0.01→0 mm, global top dead zone 0.30→0.31→0.30 mm, and base W mapping [0,0,0,0]→[2,0,26,0]→[0,0,0,0], including restoration.
- **2026-10-25:** native USB tooling using production codec commit `9697747` passed ten write/readback/restoration cases: unassigned macro, assigned macro, TGL, MT, RS, SOCD, DKS, polling, brightness, and actuation. The run used 6,036 frames; all nine blocks matched the original after each case. Assignments used Print slot 99 and Insert slot 103; DKS used empty pattern 1 with [16,30,30,16]. Polling codes were 6→3→6, brightness 5→4→5, and Print actuation raw 0→120→0. See the [sanitized fixture](tests/fixtures/a80rt-wired-feature-qualification.json).

Those ten native USB cases have **not** all been exercised through browser Apply. Key output, timing, visible lighting, power-cycle persistence, full-profile Apply, maintenance operations, receivers, and other model/firmware combinations remain unverified.

Fn W/U changes failed in app versions 0.3.0/0.3.1 and in a native USB attempt without control 0. The manufacturer UI changed Fn+U visually, but a fresh USB read still showed Print and the user's Fn+U press still produced PrintScreen. The original state was restored and all nine blocks matched. Fn writes have therefore been blocked since 0.3.2 for this qualified device/firmware. The cause is not established; do not generalize to other models. See [binding evidence](docs/binding-source-evidence.md).

## Build and test

The Windows executable embeds the interface assets and is built with the Windows .NET Framework C# compiler. Node.js is required for the build script:

```text
npm run build
npm test
```

The beta passed **229 automated tests**, including an executable bridge test. To build without overwriting an executable that is already running, set `A80RT_BUILD_OUTPUT`. Set `A80RT_TEST_EXE` to test that specific output.

For source-based serving, Python's standard library is sufficient:

```text
npm start
```

Alternatively, run `start.cmd`. It prefers the executable when available and otherwise uses Python. Open `http://localhost:8787/` in Edge/Chrome, not a file URL.

To install the PWA, start the local server, open the page, and use the browser's install-app option. Its profiles share storage with the same browser/origin. The service worker uses network-first loading and a versioned offline cache of static interface files. It does not cache the hotkey bridge or manage WebHID/profile data. Open the app with the server running after source updates to receive the new interface.

All 16 JavaScript modules, the entry script, and CSS use the same release token through an import map. Update package version, import map, entry/CSS tokens, snapshot metadata, and service worker VERSION together. Release-graph tests check module coverage and cycles.

## Protocol and limits

Protocol observations came from the [manufacturer's browser tool](https://leobog.driveall.cn/), bundle `static/js/app.3086f769.js`, observed on 2026-10-22. This is a separate implementation based on those observations. [Protocol facts](dist/device/protocol-facts.json) distinguish source evidence from measurements.

- VID 0C45; PID 80A1 for wired A80RT U, 80A2 for A80RT, FEFC for A80RT U Dongle. Product identity must also match; shared PIDs alone are insufficient.
- Read blocks: device 0x10/32, settings 0x11/32, keymap 0x12/512, lighting 0x13/16, colors 0x14/512, macro 0x15/1024, Fn 0x16/512, RT 0x17/1024, DKS 0x18/1024. Physical macro capacity has not been measured; 1,024 bytes is the source-derived read region.
- Request header: AA/command/count/offsetLE/00/final/00, payload at byte 8. Reads may retry once; writes and controls never retry. Unrelated command/offset replies are ignored. Matching write replies with invalid count, flags, or length fail closed. ACK payload echo is not assumed.
- Only one transaction owns a transport at a time. Genuine device snapshots carry provenance that JSON cannot recreate. Session/write epochs prevent stale snapshots after writes or reconnects. Firmware attestation requires a complete current-session device response.
- Mapped configuration commands 0x21–0x28, except Fn 0x26, use strict header validation and changed-field readback on the qualified wired interface. Arbitrary opcodes and compact maintenance commands remain blocked.
- Codecs preserve unknown bytes and reject invalid fields/references. Physical slots are non-contiguous: W 34, Backspace 92, PgDn 108.
- Post-write control 0 follows the observed manufacturer sequence; it is not proof of permanent storage.

Manufacturer cloud libraries, music sync, calibration, reset, and firmware updates remain external. Use the [manufacturer's tool](https://leobog.driveall.cn/) for the correct model. Opening that link does not mean this app performed those operations.

## Earlier versions

- **0.3.7:** per-key actuation/RT display, vendor-derived presets, and an actuation drag control.
- **0.3.6:** installable PWA and offline interface caching.
- **0.3.5:** draft context, macro ownership, DKS/profile validation, and import-race fixes. See the [historical correctness notes](docs/0.3.5-correctness.md).

These older version numbers describe project history. The current release is **0.4.0-beta.5** ([release notes](docs/release-0.4.0-beta.5.md)); see also the notes for [0.4.0-beta.4](docs/release-0.4.0-beta.4.md) and [0.4.0-beta.3](docs/release-0.4.0-beta.3.md).
