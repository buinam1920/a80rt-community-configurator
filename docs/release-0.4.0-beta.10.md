# A80RT Configurator 0.4.0-beta.10

This release builds on [0.4.0-beta.9](release-0.4.0-beta.9.md).

## Fixed: the Fn layer looked empty after a factory reset

A factory reset clears the keyboard's stored configuration to zeros. The Fn block (0x16) then reads back as 512 zero bytes, and the Fn view showed nothing but plain key labels.

The keyboard still uses its built-in Fn functions when the Fn block is zero. The base key map behaves the same way: it has always read back as zeros, yet the keyboard types normally.

The Fn view now shows the **firmware defaults** for empty Fn slots:

- Keys showing a default have a **dashed border**, and a note under the key map explains why.
- The tooltip, Key details and screen-reader label add **"(firmware default)"**, for example *Fn + W: WIN (firmware default)*.
- A binding stored on the keyboard always takes precedence over the default.

The defaults come from the Fn block of an A80RT U on firmware 1.37, read before any reset:

- over the USB cable on 2026-10-25;
- through the receiver on 2026-10-31.

Both reads were byte-for-byte identical.

The defaults are used only for display. They are never written to the keyboard, and Fn writes stay blocked.

## Note for anyone who has reset their keyboard

The reset also sets every key's switch type (ID) back to 0. If you had selected your switch type before, select it again and calibrate with the manufacturer's tool.

## Tests

- `npm test`: 267 tests, all passing.
- New test: an all-zero Fn block shows the firmware defaults, marked as defaults, with their highlight. A binding stored on the keyboard still wins over the default.
- Checked in the native window with sample data, whose Fn block is all zeros: 82 keys show a default with a dashed border, the explanatory note appears, and Key details reads `00 00 00 00 · WIN (firmware default)`.
