# A80RT Configurator 0.4.0-beta.12

This release builds on [0.4.0-beta.11](release-0.4.0-beta.11.md). It shortens the interface text and adds icons to buttons where a common convention exists.

## Shorter text

- The page now shows only what you need, in short phrases. Long explanations were cut to the essential fact or removed.
  - Write scope: *Writable: USB — all groups · 2.4 GHz — RT and general settings · Fn — locked*.
  - Whole-travel RT: *On: RT works over the whole travel. Off: only after the actuation point.*
  - Profile notes: *Saved profile Valorant.*, *Exported Valorant.a80rt-rt.json.*
  - Messages: *✓ Applied · read-back matches*, *Battery 9% · charge soon*.
- These blocks were removed from the page, and their content stays in the README and the release notes:
  - the hardware-evidence log (about 1,700 characters, now a **Hardware evidence ↗** link in the footer);
  - the protocol and source notes in the key inspector and editors;
  - the long notes about local storage and cloud features.
- Button labels are shorter, for example *Save macro*, *Record keys*, *Assign*, *Unassign*, *Save & finish*, *Restore session*.
- The Vietnamese and English text was rewritten together. In English mode the whole page, including tooltips and placeholders, is translated; the only Vietnamese left is the bilingual "Ngôn ngữ / Language" label of the language switch.

## Icons

There is a new set of single-stroke icons (`dist/ui/icons.js`). They are drawn for the app, so no third-party licence applies. Icons follow common conventions:

| Action | Icon |
|---|---|
| Connect, Disconnect | plug, crossed-out plug |
| Read configuration, Export | download arrow |
| Import, Open saved copy | upload arrow |
| Apply, Bring into draft, Assign | check mark |
| Undo, Revert | undo arrow |
| Delete | trash can |
| Close, Exit sample data, Unassign | × |
| Save | floppy disk |
| Rename, Duplicate, Preview | pencil, copy, eye |
| Restore session, Restore built-ins | history clock |
| Record, Stop | red dot, square |
| Notifications | bell |
| Copy AI instructions | copy |
| External links (vendor driver, hardware evidence) | ↗ box |

- A few buttons show **only the icon** because the icon alone is unambiguous: exit sample data, and Export and Delete on each Rapid Trigger profile row. They keep an accessible name and a tooltip in both languages.
- A Delete button that is waiting for its confirming second click shows the text *Click again to delete*.
- `setText` keeps a button's icon when its label changes.

## Fixes

- English mode: placeholders and tooltips on text boxes, such as **Paste JSON**, are now translated.
- English mode: the **Connect keyboard** button was shown as "Connection". It now has its own label, separate from the *Connection* row in the device panel.

## Tests

- `npm test`: 271 tests, all passing; the suite was run twice in a row. Two assertions were updated for the shorter messages.
- In the native window with sample data, a scan of all visible text, tooltips, labels and placeholders in English mode found no untranslated Vietnamese other than the bilingual language-switch label.
