# A80RT Configurator 0.4.0-beta.9

This release builds on [0.4.0-beta.8](release-0.4.0-beta.8.md). It adds Rapid Trigger profile files that you can share, and a way to have an AI assistant write a profile for you.

## Profile files

Rapid Trigger profiles can now be saved to and loaded from a small JSON file in the [`a80rt-rt-profile/v1`](rt-profile-format.md) format. A file holds a default for every key, the keys that differ from it (in mm), and optionally the dead zones and a shortcut. Keys use plain names such as `W`, `Space`, `LShift` or `F1`.

These controls are in **Rapid Trigger → Manage profiles & shortcuts**:

- **Export** (on each profile row): downloads `<name>.a80rt-rt.json`. This works for built-in profiles and for your own.
- **Import JSON file**: loads a `.json` file of up to 256 KB.
- **Paste JSON**: paste a profile, for example one written by an AI. Code fences such as ```` ```json ```` are removed automatically.
- **Copy AI instructions**: copies a ready-made prompt for ChatGPT, Claude, Gemini or another assistant. It contains the file format, the limits, all 82 key names, an example and your current profile. Describe your game and play style, then paste the JSON the assistant returns into **Paste JSON**.

When you import a file:

- The profile becomes a button next to the others. A profile with the name of one of your own profiles replaces it; a name that matches a built-in profile is rejected.
- The shortcut in the file is assigned only if no other profile already uses it.
- Unknown fields and unusable shortcuts produce a warning and are skipped.
- Any other problem rejects the whole file with a message that says what to fix, for example `keys.W.actuation = 5: must be between 0 and 3.3 mm.`

Importing never writes to the keyboard. A profile goes into the draft when you click it and reaches the keyboard only when you press Apply. Apply runs the usual checks and reads the keyboard back to verify.

The format is documented in [docs/rt-profile-format.md](rt-profile-format.md), and [`examples/rt-profiles/`](../examples/rt-profiles/) has ready-made profiles for Valorant, CS2 and Typing.

## Tests

- `npm test`: 266 tests, all passing; the suite was run twice in a row.
- `tests/rt-profile-file.test.mjs` (7 new tests) covers:
  - every key name is unique;
  - files written by an AI, including name variants, code fences and settings inherited from `default`;
  - clear errors for ten kinds of mistake;
  - export and re-import give the same settings on every key, for built-in and saved profiles;
  - the AI instructions, whose own example imports correctly;
  - the bundled example profiles are valid;
  - in the panel: pasted JSON imports, a shortcut that another profile already uses is not taken, export downloads a file, and the AI instructions are copied.
- In the native window with sample data, a profile pasted as JSON appeared as **Valorant · Ctrl+Alt+3**.
- Known issue: `tests/session.test.mjs` ("apply overlap across sessions…") is timing-sensitive and has occasionally failed under heavy CPU load. It passed on every rerun, and the files it covers have not changed since 0.3.5.
