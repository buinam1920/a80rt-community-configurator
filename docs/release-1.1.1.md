# A80RT Configurator 1.1.1

1.1.1 fixes the logo on top of [1.1.0](release-1.1.0.md). Keyboard reading, writing and the protocol rules are unchanged. The full history is in the [changelog](../CHANGELOG.md).

## The logo follows your accent colour

- **In the app:** the sidebar logo and the browser-tab icon use the accent chosen in Appearance.
- **In the exe:** the page sends the colour to the exe (`POST /hotkeys/accent`). The exe draws the logo in that colour, saves it once per colour under `%LocalAppData%\A80RT-Configurator\accent`, and applies it to the window, the tray and the taskbar button. The saved colour is used again at the next start.
- **Taskbar button:** Windows 11 draws it from the exe file's icon, so the window gets its own app ID and relaunch icon for each colour (the mechanism Chrome uses for profile icons). If you pin the app, the open window shows as a separate button next to the pin.
- **Unchanged:** the exe file in Explorer, the Desktop shortcut and a pinned shortcut keep the lime icon, because Windows reads those from the file. The tray still shows the battery number instead of the logo while it is displayed.
- The browser version (`npm start`) accepts the colour request and does nothing with it.

## Sharper small icons

The exe icon now contains 16, 20, 24, 32, 40, 48 and 64 px images drawn for their size (larger letter, thicker arrow). Before, Windows shrank the 192 px image and the arrow disappeared in the taskbar and tray.

If Windows still shows the 1.0 icon for an exe at the same path, that is its icon cache; it clears after signing out and back in.

## Tests

291 automated tests, including checks that the sidebar, browser-tab icon and exe draw the same shape and that the exe and the Python bridge accept the colour request.
