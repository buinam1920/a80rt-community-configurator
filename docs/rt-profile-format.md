# Rapid Trigger profile file format (`a80rt-rt-profile/v1`)

A Rapid Trigger profile is a small JSON file that a person, or an AI assistant, can read and write. Import it in the app under **Rapid Trigger → Manage profiles & shortcuts**, either with **Import JSON file** or by pasting it with **Paste JSON**. The profile then appears as a button next to Office, Beginner, Gaming, LoL and Apex.

Importing only adds the profile to the app's local library. Nothing is sent to the keyboard until you click the profile and press **Apply**. Apply runs the usual write checks and reads the keyboard back to verify. Profiles change only Rapid Trigger and the two dead zones, so they can be applied over the USB cable or over the 2.4 GHz receiver.

## Format

```json
{
  "schema": "a80rt-rt-profile/v1",
  "name": "Valorant",
  "shortcut": "Ctrl+Alt+3",
  "default": { "actuation": 1.5, "rtPress": 0, "rtRelease": 0, "wholeTravel": false },
  "keys": {
    "W": { "actuation": 0.5, "rtPress": 0.15, "rtRelease": 0.15, "wholeTravel": true },
    "LCtrl": { "actuation": 0.8 },
    "Space": { "actuation": 1.0 }
  },
  "deadZone": { "top": 0.05, "bottom": 0.1 }
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Always `"a80rt-rt-profile/v1"`. |
| `name` | yes | Profile name, up to 32 characters. Importing a profile with the name of one of your own profiles replaces that profile. A name that matches a built-in profile is rejected. |
| `default` | no | Settings for every key. Defaults to `{"actuation": 1.5}`. |
| `keys` | no | Only the keys that differ from `default`. A field left out of a key takes its value from `default`. |
| `deadZone` | no | Dead zones for the whole keyboard, `top` and `bottom`, from 0 to 0.5 mm. If omitted, the dead zones are left as they are. |
| `shortcut` | no | Global shortcut that switches to this profile. It must use Ctrl, Alt or Win plus A–Z, 0–9 or F1–F24, for example `"Ctrl+Alt+3"`. If another profile already uses the combination, it is not assigned. |

### Per-key settings (millimetres, at most 2 decimals)

| Setting | Range | Meaning |
|---|---|---|
| `actuation` | 0.01 – 3.3 | How far the key travels before it registers. Lower is more sensitive. `0` keeps the manufacturer default, which the vendor app shows as 1.2 mm. |
| `rtPress` | 0 – 3.3 | Rapid Trigger press distance. `0` turns Rapid Trigger off for the key. |
| `rtRelease` | 0 – 3.3 | Rapid Trigger release distance. |
| `wholeTravel` | `true` / `false` | `true` keeps Rapid Trigger active over the whole key travel. `false` activates it only after the actuation point. |

Profiles never change key bindings, lighting, macros, the Fn layer or switch types.

## Key names

Names are not case-sensitive. These are the 82 standard names:

```
Esc F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 Ins Prt
` 1 2 3 4 5 6 7 8 9 0 Minus = Backspace Del
Tab Q W E R T Y U I O P [ ] \ PgUp
Caps A S D F G H J K L ; ' Enter PgDn
LShift Z X C V B N M , . / RShift Up End
LCtrl Win Alt Space Fn RCtrl Left Down Right
```

Common alternatives are also accepted: `Escape`, `Insert`, `PrintScreen`, `Delete`, `PageUp`, `PageDown`, `CapsLock`, `Shift` or `Left Shift` (left), `Right Shift`, `Ctrl` or `Left Ctrl` (left), `Right Ctrl`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `-`, `Grave`, `Backslash`, `Semicolon`, `Quote`, `Comma`, `Period`, `Slash`, `Spacebar`, `KeyW`, `Digit1`, and `slot:34` (the raw slot number).

## Using an AI assistant

1. Click **Copy AI instructions** in the app. This copies the format, the limits, every key name, an example and your current profile.
2. Paste the instructions into ChatGPT, Claude, Gemini or another assistant. Replace the last line with a description of your game, the keys you use and your play style.
3. Copy the JSON the assistant returns and paste it into **Paste JSON** in the app. Code fences such as ```` ```json ```` are removed automatically.

If something is wrong, the app shows exactly what to fix, for example `keys.W.actuation = 5: must be between 0 and 3.3 mm.` You can edit the JSON in the box and import it again.

## Examples

The [`examples/rt-profiles/`](../examples/rt-profiles/) folder has ready-made profiles: Valorant, CS2 and Typing. In the app, each profile row in **Manage profiles & shortcuts** has an **Export** button that downloads a profile, built-in or your own, in this format.
