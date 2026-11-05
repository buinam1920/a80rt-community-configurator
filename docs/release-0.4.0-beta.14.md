# A80RT Configurator 0.4.0-beta.14

This release builds on [0.4.0-beta.13](release-0.4.0-beta.13.md). It fixes the findings of an independent review: one safety issue with writes, data-loss risks in the profile library, and a possible freeze on disconnect.

## Safety: blank receiver copy blocks Apply

After the receiver is re-paired or reset, it can answer reads with its **own blank configuration**: the Fn layer is all zeros, while the same keyboard over the USB cable always has 169 non-zero Fn bytes. Applying from that reading would send zeros, including switch ID 0, to the keyboard.

- When the reading came through the receiver and its Fn block is all zeros, Apply is blocked with: *The receiver returned a blank configuration… Connect the USB cable and read again to write.*
- Profile hotkeys go through the same check.
- Verified on the owner's keyboard on 2026-11-05: the receiver returned the blank copy and Apply was blocked; the same Apex profile applied over the USB cable and the read-back matched.
- Receiver writes from a normal (non-blank) reading are unchanged.

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

- The "Windows notifications are blocked…" notice next to the shortcuts stayed in Vietnamese because it was appended to the same text as the shortcut list. It is now a separate text node and is translated. A scan of every tab in English mode found no other Vietnamese text.

## Tests

- `npm test`: 283 tests, all passing in three consecutive runs.
- Fixed a flaky test: "apply overlap across sessions…" used a 10 ms ACK timeout, which could expire under CPU load before its checks ran. It now uses 5 s; the Apply is still ended by the abort it tests.
- New tests cover the two-window library, Undo when full, duplicate import names, Restore draft, and the blank-receiver block.
- Checked in a browser with sample data: Revert/Restore, toast position, picker tabs, labels, duplicate import and two windows.
- Not yet verified on hardware: the disconnect freeze fix (it cannot be triggered on demand).
- Known and accepted: two windows saving a profile in the same millisecond can still lose one save, because `localStorage` has no lock.
