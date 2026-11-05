# A80RT Configurator 0.4.0-beta.14

This release builds on [0.4.0-beta.13](release-0.4.0-beta.13.md). It fixes the findings of an independent review: one safety issue with writes, data-loss risks in the profile library, and a possible freeze on disconnect.

## Finding: the receiver relays the keyboard's real configuration (except Fn)

On 2026-11-05 the owner read the same keyboard twice, once through the 2.4 GHz receiver and once over the USB cable, right after applying the Apex profile over the cable:

| Block | Receiver vs. cable |
|---|---|
| settings, keymap, lighting, colors, macro, RT, DKS | identical, byte for byte (RT: 98 non-zero bytes, the Apex values) |
| device info | 3 bytes differ (16, 17, 20: battery and link status) |
| Fn layer | receiver returns all zeros; cable returns 169 non-zero bytes |

So reads through the receiver come from the keyboard, and the 2026-10-31 receiver write qualification (RT 0x27 and settings 0x21, read back through the receiver) stands. The receiver simply does not relay the Fn block; Fn writes over the receiver were already blocked. An all-zero Fn block is therefore **not** a sign of a blank receiver copy, and no write guard is based on it. This replaces the open question in REVIEW-SOL-6.1.md §4.

## Draft safety

- **Auto-connect no longer wipes a draft.** It checks for a draft again after waiting for the device list, so edits made during that wait are kept. A draft left after a failed or unconfirmed write also stops automatic reconnection; press Connect when ready.
- **Restore draft.** Revert still takes one click, and a **Restore draft** button now appears for 10 seconds afterwards. A new edit, a new session or a busy state withdraws it.
- **Toasts no longer cover Apply.** While the draft bar is pinned at the bottom, toasts appear at the top.

## Profile library

- **Two windows no longer delete each other's profiles.** The library reads storage again before every change and reloads when another window saves.
- **Storage errors are reported.** If storage is blocked or full, the change is rolled back and an error is shown, instead of a false "saved".
- **Undo after delete respects the 24-profile limit.** It used to allow 25, and one profile was lost on the next start.
- **Import never replaces a profile.** A file whose name is already taken is saved as "Name (2)", and the message says so.

## Native window

- **No freeze on disconnect after a stuck write.** After cancelling a write that timed out, the exe waits at most 1 second instead of indefinitely while holding the write lock. If Windows still owns the buffer, it is left allocated instead of being freed while in use.

## Accessibility

- Each profile's export and delete buttons name the profile for screen readers, including in the "click again" state.
- The key-binding picker tabs follow the standard tab pattern: `aria-controls`, a `tabpanel`, one Tab stop, and Arrow/Home/End to switch groups.

## English mode

- The default profile name ("Cấu hình của tôi") now follows the language ("My configuration"), unless you typed your own name.
- The "Windows notifications are blocked…" notice next to the shortcuts stayed in Vietnamese because it was appended to the same text as the shortcut list. It is now a separate text node and is translated. A scan of every tab in English mode found no other Vietnamese text.

## Tests

- `npm test`: 282 tests, all passing.
- Fixed a flaky test: "apply overlap across sessions…" used a 10 ms ACK timeout, which could expire under CPU load before its checks ran. It now uses 5 s; the Apply is still ended by the abort it tests.
- New tests cover the two-window library, Undo when full, duplicate import names and Restore draft. The receiver Apply test keeps an all-zero Fn block, as the real receiver returns.
- Checked in a browser with sample data: Revert/Restore, toast position, picker tabs, labels, duplicate import and two windows.
- Not yet verified on hardware: the disconnect freeze fix (it cannot be triggered on demand).
- Known and accepted: two windows saving a profile in the same millisecond can still lose one save, because `localStorage` has no lock.
