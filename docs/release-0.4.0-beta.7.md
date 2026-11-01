# A80RT Configurator 0.4.0-beta.7

This release builds on [0.4.0-beta.6](release-0.4.0-beta.6.md).

## The Fn layer shows what each key does

Switching the keyboard map to **Fn** now labels every key with what Fn + that key does, like the manufacturer driver. Before, it only showed the key's own name and actuation.

| What Fn + key does | What the key shows |
|---|---|
| A function: factory reset, Bluetooth 1–3, wireless re-link, Win/Mac/Android mode, light effect/color/brightness/speed, battery, Win lock, Alt+Tab, Win+E… | The function name, highlighted in green |
| A media function: Home, Email, previous/next track, play/pause, mute, volume… | The media name, highlighted in green |
| A different key (for example Fn+U → Print, Fn+Del → Home) | That key's name in amber |
| The key itself, an unknown function code, or nothing | The normal key label (dimmed when empty) |

- Labels are short so they fit on a key. Hover a key to see the full name, for example *Fn + Esc: Factory reset*; screen readers announce it too. The **Key details** panel shows the full name next to the binding bytes.
- The names come from the app's own function and media tables, the same ones the Fn editor already uses. They were checked against a default Fn layer read from an A80RT U on firmware 1.37.
- Works in Vietnamese and English.
- Fn **writes** stay blocked as before; this release only changes how the Fn layer is displayed.

## Fixed: the app could close itself on Disconnect

Since 0.4.0-beta.3, the native window could crash with `ObjectDisposedException` when you pressed **Disconnect** or the receiver went away.

The cause was in the HID read thread. `Dispose()` closed the device handle while the thread was still cancelling its pending read, and the exception escaped the background thread, which ended the whole app.

Now:

- the read loop drains its cancelled read and closes the handle itself, exactly once;
- writes hold a lock while they use the handle, so it cannot close in the middle of a write;
- no exception can leave the read thread.

Before the fix, the window crashed on the first Disconnect. After the fix, three connect → disconnect cycles over the 2.4 GHz receiver left the window running.

## Tests

- `npm test`: 258 tests, all passing. The suite was run three times in a row.
- New: `tests/fn-layer-view.test.mjs` decodes the manufacturer's default Fn bytes and checks the key labels: functions, media, keys that send another key, modifiers, unknown codes, empty slots, mouse and macro.
