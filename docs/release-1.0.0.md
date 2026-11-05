# A80RT Configurator 1.0.0

1.0.0 is the first stable release. It builds on [0.4.0-beta.14](release-0.4.0-beta.14.md) and fixes everything a final multi-model review (2026-11-05) marked as a blocker or should-fix. The full history is in the [changelog](../CHANGELOG.md).

## What 1.0 means

- **Supported:** A80RT U on firmware 1.37, over the USB cable (all groups except Fn writes) and over the A80RT U Dongle (Rapid Trigger and general settings).
- **Verified on the owner's keyboard:** reading all nine groups over both connections, applying the full Apex preset over the cable with a matching readback, profile hotkeys over 2.4 GHz, and a byte-for-byte match of receiver and cable reads (except the Fn block, which the receiver does not relay).
- **Still blocked on purpose:** Fn layer writes, maintenance commands (calibration, factory reset, firmware), and any model/firmware that has not been measured.
- **Not established:** persistence after power loss, visible lighting behaviour and gameplay feel. A successful Apply means the changed bytes matched a fresh readback.

## Fixed since 0.4.0-beta.14

### Writes and connections

- **A stuck write can no longer land after a fresh read.** If Windows cannot cancel a timed-out write within a second, the exe marks the connection as faulted and refuses to send anything more on it; the message asks you to disconnect and reconnect. The write buffer, `OVERLAPPED` and event stay allocated and referenced until the kernel completes the request, then they are freed.
- **A failed connection keeps your draft.** The current draft, its baseline and the device view are kept until the new device has opened; if opening fails they are restored.
- **One running app per Windows session.** A second copy of the exe, even with a different `--port`, now brings the first window forward instead of opening the keyboard a second time. (Test runs with `--test-trigger` keep per-port instances.)
- **Port already in use.** If port 8787 is taken, the exe only hands over to it when it is an A80RT bridge; otherwise it explains the conflict and how to use `--port`.
- **WebView2 failing after the window opened** (for example an unwritable data folder) now closes that window and falls back to Edge/Chrome, instead of leaving an empty window.

### Data safety

- **A damaged saved profile no longer hides the others.** Bad records are skipped and counted ("Skipped 1 damaged profile in local storage"), and a damaged recovery record no longer blocks the profile list.
- **Recovery is saved right before Apply,** so a partial write that invalidates the session cannot lose the last draft.

### Interface

- **English mode:** the profile preview, the skipped-fields list and the empty packet log are translated; the default profile name follows the language.
- **Buttons say what they export:** *Import profile* / *Export profile* (all 9 groups) and *Export reading* (raw reading and packet log for bug reports).
- **Messages:** the read-only message says you can still edit, save profiles and export.
- **Toasts** sit just above the pinned draft bar, so they cover neither Apply nor the language switch.
- **Settings & maintenance tabs** use one Tab stop and Arrow/Home/End, like the other tab bars.
- **Empty Fn-slot labels** have higher contrast (#9aa4ad).
- The connection message keeps the transport name's capitalisation ("USB cable").

### Python bridge

- `Content-Length` is validated: negative or malformed values return 400 and bodies over 8 KB return 413, instead of reading without a bound.

## Documentation

- MIT [license](../LICENSE) and [third-party notices](../THIRD-PARTY-NOTICES.txt) for the bundled WebView2 SDK. Attach `THIRD-PARTY-NOTICES.txt` to every release next to the exe.
- README: requirements, troubleshooting, how to report bugs, receiver limits (including the Fn read limit), tray balloons, the 2026-11-05 hardware evidence.
- [Profile file format](rt-profile-format.md): import never replaces a profile, the 24-profile limit, `actuation` may be `0`, `deadZone` needs both values.
- [Feature comparison](feature-parity.md): current release and receiver write scope.
- `start.cmd` opens the browser two seconds after starting the Python server, so the first page load no longer fails.

## Tests

- `npm test`: 285 tests, all passing.
- New tests: a failed connection keeps the draft; damaged stored profiles are skipped and counted; the Python bridge rejects negative and oversized `Content-Length`; the exe reports its tray in `/hotkeys/config`.
- Not testable without hardware faults: the stuck-write quarantine and the WebView2 failure fallback. Both compile and follow the documented Windows/WebView2 behaviour.

## Known limitations

- The executable is unsigned; Windows SmartScreen may warn on first launch.
- Two windows saving a profile in the same millisecond can still lose one save (`localStorage` has no lock).
- Upgrading from a beta that is still running: close the beta first. Betas used a per-port instance lock, so a beta and 1.0 could otherwise run side by side.
