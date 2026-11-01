# A80RT Configurator 0.4.0-beta.6

This release makes the app easier to read and to use. It builds on [0.4.0-beta.5](release-0.4.0-beta.5.md) and does not change how the app reads from or writes to the keyboard.

The changes come from an audit of the native window against the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) checklist and WCAG 2.2 AA. The tables below show the before and after measurements at 1424×881.

## Readability

| Measured | beta.5 | beta.6 |
|---|---|---|
| Text that fails contrast (4.5:1, or 3:1 for large text) | 35 | **0** |
| Smallest text size | 7–9 px | 10 px (labels printed on the keys only) |
| Text at 10 px or smaller | 134 | 82 (labels printed on the keys only) |

- The secondary text colour is now `#8b96a0` instead of `#66717b`. Its contrast is at least 5.1:1 on every background in the app, up from 3.1–3.7:1.
- Minimum sizes are now 12 px for body text, 11 px for labels and units, and 10–12 px for the labels printed on the keys. The key labels keep the smaller size so the keyboard layout does not overflow.

## Click targets and motion

- These controls are now about 28–32 px tall:
  - VI/EN, Base/Fn, Multi-select, Select all and Clear selection;
  - the sliders' hit area;
  - text links.
- Every target meets the WCAG 2.2 AA minimum of 24×24 px. The only exceptions are checkboxes inside a clickable label, which WCAG allows.
- When Windows has "reduce motion" turned on, the app turns off transitions and the hover lift.

## Workflow

- **Sticky Apply bar.** While the draft has changes, or while a write is running, the draft bar stays at the bottom of the window with the change count, Revert and Apply.
  - The write progress, the readback, and the final result or error appear on this bar. The result stays visible for 8 seconds.
  - The page keeps space above the bar, so the bar never covers the field that has focus.
  - The bar uses the same Apply checks as before.
- **Shorter header.** The release-scope paragraph is now a one-line summary that is always visible: "Write scope: USB cable — every measured group; 2.4 GHz receiver — Rapid Trigger and general settings; Fn layer — blocked." The full text opens on click.
  - The shortcut status line is more compact.
  - Once the keyboard is connected and read, the connection strip shrinks to a single line.
- **Keyboard navigation on the key map.** The 82-key map is now a single Tab stop.
  - Arrow keys move between keys; Up and Down jump to the nearest key in the next row.
  - Home and End go to the start or end of a row.
  - Space or Enter selects a key, and Shift+arrow adds keys to the selection.
  - Keys show a clear focus ring.
- **Delete with confirmation and Undo.**
  - **Saved configuration profiles** used to be deleted on a single click. Now the first click shows "Click again to delete", and **Undo delete** is available for 10 seconds afterwards.
  - **Rapid Trigger profiles** already needed a second click. They now also offer **Undo** for 10 seconds, which restores the profile in its old position with its shortcut.

## Tests

- `npm test`: 256 tests, all passing.
- New tests:
  - `tests/ux-layer.test.mjs`: one Tab stop with arrow and Shift+arrow on the key map, and the draft bar turning sticky on changes and clearing on revert.
  - Two tests in `tests/preset-library.test.mjs` for undoing a delete, in the library and in the panel.
- Checked by hand in the native window:
  - the sticky bar with sample data;
  - delete → confirm → undo for configuration profiles stored in IndexedDB;
  - a re-run of the contrast, size and target audit.
