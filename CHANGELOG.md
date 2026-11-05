# Changelog

Detailed notes for each release are in [docs/](docs/).

## 1.0.0 — 2026-11-05

First stable release. Fixes from the final review: a stuck native write quarantines the connection, a failed connection keeps the draft, one app instance per Windows session, clear port-conflict and WebView2-failure handling, damaged saved profiles are skipped, recovery is saved before Apply, English-mode and accessibility fixes, MIT license and third-party notices. [Notes](docs/release-1.0.0.md)

## 0.4.0-beta.14

The receiver relays the keyboard's real configuration except the Fn block (byte comparison 2026-11-05). Auto-connect never wipes a draft; Restore draft after Revert; the profile library no longer loses profiles across windows, on full Undo or on import; bounded native write cancellation; profile-hotkey results as tray balloons. [Notes](docs/release-0.4.0-beta.14.md)

## 0.4.0-beta.13

Reads retry once after a timed-out HID send; a write that completed as the timeout fired counts as sent. [Notes](docs/release-0.4.0-beta.13.md)

## 0.4.0-beta.12

Shorter interface text and a conventional icon set; input attributes are translated. [Notes](docs/release-0.4.0-beta.12.md)

## 0.4.0-beta.11

Tabbed key-binding picker with search; corrected Fn/receiver explanation. [Notes](docs/release-0.4.0-beta.11.md)

## 0.4.0-beta.10

Empty Fn slots show the firmware default function. [Notes](docs/release-0.4.0-beta.10.md)

## 0.4.0-beta.9

Shareable Rapid Trigger profile files (`a80rt-rt-profile/v1`), import from file or pasted JSON, and copyable AI instructions. [Notes](docs/release-0.4.0-beta.9.md)

## 0.4.0-beta.8

Accessibility pass: `aria-invalid`/`aria-busy`, tabular numbers, z-index scale. [Notes](docs/release-0.4.0-beta.8.md)

## 0.4.0-beta.7

Fn-layer view with function names; fixed a crash on Disconnect. [Notes](docs/release-0.4.0-beta.7.md)

## 0.4.0-beta.6

Readability, larger click targets, sticky Apply bar, arrow-key navigation, delete confirmation with Undo. [Notes](docs/release-0.4.0-beta.6.md)

## 0.4.0-beta.5

Your own Rapid Trigger profiles with global shortcuts. [Notes](docs/release-0.4.0-beta.5.md)

## 0.4.0-beta.4

Recovery after a 2.4 GHz link loss. [Notes](docs/release-0.4.0-beta.4.md)

## 0.4.0-beta.3

Standalone WebView2 window with native HID, receiver writes for Rapid Trigger and settings, battery, auto-connect, English interface. [Notes](docs/release-0.4.0-beta.3.md)

## 0.3.x

Per-key actuation/RT display and vendor presets (0.3.7), installable PWA (0.3.6), draft and import correctness (0.3.5, [notes](docs/0.3.5-correctness.md)).
