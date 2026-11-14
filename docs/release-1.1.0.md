# A80RT Configurator 1.1.0

1.1.0 is an interface release on top of [1.0.0](release-1.0.0.md). Keyboard reading, writing and the protocol rules are unchanged. The full history is in the [changelog](../CHANGELOG.md).

## Navigation and layout

- **Section links in the sidebar:** Keyboard, Edit configuration, Macros & advanced keys, Settings & maintenance, Configuration profiles, Data & diagnostics. The section in view is highlighted. On phones the links become a scrollable row under the logo.
- **One tab style** for every tab group (Settings & maintenance used button-style tabs before).
- **Inputs:** custom select arrows, hover and focus borders, checkboxes on the same line as their label, press feedback on buttons.
- **Rapid Trigger gauge** uses the accent colour instead of orange.
- Tighter page header so the key map sits higher; the summary numbers sit in a card; the profiles heading lines up with its panel.

## Appearance (new)

Open it with the palette button in the top bar. It only changes how the app looks on this computer; nothing is sent to the keyboard.

- **Background:** JPG, PNG, WebP or GIF up to 15 MB, or MP4/WebM video up to 40 MB. Large still images are scaled down to 2560 px. Controls for darkening, blur, panel opacity and image position.
- **Pause animation** shows a GIF's first frame or pauses the video. This also happens when Windows "reduce motion" is on; a video also pauses while the window is hidden.
- **Accent colour:** eight presets, a colour picker, or *Pick color from image*, which takes the most vivid colour from the background. Text on the accent switches between dark and white for contrast.
- **Share:** *Export theme* saves the settings and background as one JSON file; *Import theme* loads it; *Reset to default* returns to the stock look.
- **Storage:** settings in local storage, the background in IndexedDB (`a80rt-theme`). The exe and the browser version share it when they use the same address (`localhost:8787`); `--port` gives a separate store.

Every accent-derived colour in the stylesheet is now computed from `--accent`, so the whole interface follows the chosen colour.

## Logo

A new original mark, a solid A with a Rapid Trigger up-arrow cut out of it, is used in the sidebar, the browser tab, the PWA icons and the exe icon. It follows the accent colour in the app.

## Tests

289 automated tests, including new theme tests (settings validation, contrast of text on every preset accent, colour picking, accent tokens in the stylesheet).
