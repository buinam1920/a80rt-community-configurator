# A80RT Configurator 0.4.0-beta.8

This release applies the [ui-skills](https://github.com/ibelick/ui-skills) rules (MIT, by ibelick) that fit a plain JavaScript/CSS app: the accessibility, motion and typography rules. It builds on [0.4.0-beta.7](release-0.4.0-beta.7.md).

## Changes

- **Error fields for screen readers.** An editor field that rejects its value is marked `aria-invalid` and points to the error text with `aria-describedby`. Both are cleared once the value is accepted.
- **Busy state for screen readers.** The editors, the draft bar and the key map are marked `aria-busy` while the app is reading, writing, connecting or running maintenance.
- **Numbers that do not jump.** Actuation values, stats, battery percentage, change count, key legends and device details use tabular figures, so numbers keep the same width when they change.
- **No more layout-property animation.** The read progress bar and the travel bar no longer animate `width` or `left`; they move straight to the new value. The remaining transitions use transform, opacity or colour, and all of them are 200 ms or shorter.
- **Fixed z-index scale.** All stacking uses three CSS variables: `--z-raised` (focused key), `--z-sticky` (Apply bar) and `--z-toast` (notification).
- **Cleaner line breaks.** Headings use `text-wrap: balance` and body text uses `text-wrap: pretty`, so lines no longer end with a single orphaned word.

## Already compliant (no change needed)

- No blur or backdrop filters, and no animations that loop.
- `prefers-reduced-motion` is respected (since 0.4.0-beta.6).
- Focus is always visible: no outline is removed without a replacement, and the key map shows its own focus ring.
- Destructive actions need confirmation:
  - a factory reset of the device requires ticking an "I understand" checkbox;
  - deleting a profile takes two clicks and offers Undo.
- Disabled buttons explain why: the Apply bar shows the reason.
- Every button and field has an accessible name.

## Rules deliberately not applied

- **React and Tailwind rules.** These include `cn`, `motion/react`, Radix/Base UI and `h-dvh`. They assume a stack this app does not use.
- **"No gradients."** The subtle key-cap and panel gradients are part of the existing visual design and do not affect readability.
- **"Use an AlertDialog for destructive actions."** The app uses two-click confirmation with Undo, or an explicit checkbox, which protects just as well without a modal.

## Tests

- `npm test`: 259 tests, all passing; the suite was run twice in a row.
- New test: an invalid value marks its field `aria-invalid` and points it at the error; an accepted value clears both.
