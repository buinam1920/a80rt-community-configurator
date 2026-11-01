# A80RT Configurator 0.4.0-beta.11

This release builds on [0.4.0-beta.10](release-0.4.0-beta.10.md).

## Key binding picker

**Key bindings / Fn** used to be a single drop-down with more than 150 entries: keys, modifiers, media, mouse buttons and functions all in one list. It is now a picker laid out like the manufacturer driver:

- **Tabs:** Keys, Modifier, Media, Mouse, Functions. Each tab is a grid of buttons with short names.
- **"Assigned: …"** shows the current binding of the selected keys. The matching button is highlighted, and the picker opens on its tab.
- **Search** covers every tab and works in Vietnamese and English. For example, `mute` finds *Tắt tiếng*, and `bluetooth` finds Bluetooth 1–3.
- **Unassign (empty)** clears the binding.
- Fn F1–F12 are still locked. The whole picker is disabled when they are selected.
- On the Fn layer, an empty slot shows the firmware default that is in effect, for example *Assigned: empty · the firmware uses its default, WIN*.

Every choice goes through the same draft edit as before, and nothing is sent until Apply. Fn writes remain blocked. The native list is still in the page, hidden, as a fallback.

## Fixed

- In English mode, entries such as `Phím · A` and `Modifier · Ctrl trái` were left untranslated. They now read `Key · A` and `Modifier · Left Ctrl`.

## Correction to the 0.4.0-beta.10 notes

Those notes said the Fn block reads back as zeros because a factory reset cleared it. That was wrong.

Reads over the **USB cable** on 2026-10-22, 10-24, 10-25 and 11-01 all return the same 169-byte Fn block. That data is still stored on the keyboard.

Reads through the **2.4 GHz receiver** returned different data:

- **2026-10-31:** a Rapid Trigger block that differs from the one read over the cable.
- **Today:** zeros, after the receiver was paired again.

So the receiver returns its own copy of the configuration, or the keyboard keeps a separate configuration for 2.4 GHz mode. Which of the two is still being investigated.

Until then:

- The Fn view through the receiver shows firmware defaults for empty slots, marked with a dashed border.
- Rapid Trigger writes through the receiver are verified only against the receiver's own readback.

To change a profile reliably, use the USB cable.

## Tests

- `npm test`: 271 tests, all passing. The suite was run twice in a row.
- `tests/binding-picker.test.mjs` adds 4 tests:
  - tabs and the current-binding display, with assigning and unassigning;
  - search in Vietnamese and English;
  - the Fn F1–F12 lock disables the picker;
  - the message for an empty Fn slot.
