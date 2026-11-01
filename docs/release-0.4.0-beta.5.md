# A80RT Configurator 0.4.0-beta.5

This release adds your own Rapid Trigger profiles and lets you set the shortcut for each profile. It builds on [0.4.0-beta.4](release-0.4.0-beta.4.md).

## Your own profiles

All of this lives in the **Rapid Trigger** tab.

- **Save the current draft as a profile.** Type a name and press **Save as profile**; Enter also works. The profile then shows up as a button next to Office, Beginner, Gaming, LoL and Apex.
  - Saving under an existing name updates that profile.
  - Names can be up to 32 characters, and you can keep up to 24 profiles.
  - A profile stores Rapid Trigger for every key (actuation, RT press/release, whole-travel) and both global dead zones.
  - Switch IDs and the bottom/rtMode bits are left untouched.
- **Click a profile to load it.** Clicking a profile puts it in the draft, the same way presets work. Nothing is sent until you press Apply.
  - Profiles only touch Rapid Trigger and general settings, so they can also be applied over the 2.4 GHz receiver.
  - The button of the profile that matches the draft is highlighted. **Custom** is highlighted when nothing matches.
- **Manage profiles & shortcuts.** This panel lists every profile with its kind (Vendor, App suggestion, Yours), its shortcut and a Delete button.
  - Delete asks for a second click.
  - Your own profiles are removed permanently.
  - Built-in profiles are only hidden, and **Restore deleted built-in profiles** brings them back.
- Profiles and shortcuts are kept in local storage on this computer.
  - The native window and a browser keep separate storage.
  - Corrupt or out-of-range stored data is ignored and never reaches the keyboard.

## Shortcut for any profile

- To set a shortcut, click **Set shortcut** next to a profile, then press the new combination.
  - Esc cancels.
  - Backspace or Delete removes the shortcut.
- A shortcut needs **Ctrl, Alt or Win** plus a letter A–Z, a digit 0–9 or F1–F24. Plain keys are refused so a game key can never trigger a profile switch.
- Keys are read by physical position, so the keyboard layout does not matter.
- If you give one profile a combination another profile already has, the other profile loses it.
- The defaults are still Ctrl+Alt+1 → LoL and Ctrl+Alt+2 → Apex.
- **Global registration.**
  - The app window sends its shortcut list to the background program through `POST /hotkeys/bindings`. Only requests from the app's own origin are accepted.
  - The program replaces its `RegisterHotKey` registrations and reports which combinations failed because another program already uses them. The app then shows a warning.
  - The tray menu lists the active shortcuts.
  - This works in both the exe and `scripts/a80rt_local.py`.
- When you press a shortcut, the same rules as before apply. The profile is applied automatically only if the draft has no other changes, and it always goes through preflight, the Fn block and readback.

## Other changes

- The tray tooltip no longer hard-codes the LoL/Apex shortcuts.
- The POST body limit for the background program is now 8 KB, up from 4 KB, to fit up to 20 bindings.
- English translations cover all the new text.

## Tests

- `npm test`: 252 tests, all passing.
- New tests:
  - `tests/preset-library.test.mjs` (5) covers shortcut parsing, the draft → profile → draft round trip on every key, delete/hide/restore, moving a shortcut, rejecting hostile stored data, and the panel's save → shortcut → delete flow.
  - `tests/local-bridge.test.mjs` gained 2 tests for `/hotkeys/bindings` on the Python bridge and on the exe: origin check, invalid keys dropped, new preset ids dispatched.
- Manual checks:
  - The exe registered a real global hotkey (`Ctrl+Alt+Shift+F24`) and swapped its registrations when it received a new list.
  - In the native window with sample data, saving, setting a shortcut and the layout were checked in English.

## Not yet verified on hardware

- A global shortcut for a custom profile, pressed in game, writing to the keyboard.
