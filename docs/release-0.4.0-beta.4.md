# A80RT Configurator 0.4.0-beta.4

Bug-fix release on top of [0.4.0-beta.3](release-0.4.0-beta.3.md).

## Fixed: the app got stuck after a 2.4 GHz link loss

When the keyboard sleeps, is switched off or loses its pairing, the A80RT U Dongle stays plugged in and enumerated, but it answers with the link-loss header `55 FC 04`. The transport already ended its session on that header. The app, however, kept the old reader as "connected":

- auto-connect skipped it, because a reader was still present;
- every later read failed with "device not opened";
- battery polling swallowed the error, so the app showed no hint.

The only way out was to press Disconnect and then Connect by hand.

Now, when the receiver reports a link loss:

- the app releases the stale reader, closes the HID handle and clears the battery display;
- it explains what happened, and keeps the unapplied draft;
- it retries automatically with back-off (3 s, 6 s, 12 s, 24 s, then every 30 s). Each retry is a normal connect followed by a fresh nine-block read, which also renews the firmware attestation before any write is allowed;
- if the draft has unapplied changes, it does not reconnect automatically, because a new read would replace the draft;
- an interrupted Apply is never replayed;
- retries stop on a manual Disconnect or when the receiver is unplugged. Plugging it back in triggers the usual auto-connect.

The recovery path only sends read commands (0x10–0x18).

## Scope

The app does not cause the link loss. It only reads from the receiver, and the keyboard's own typing over 2.4 GHz does not depend on the app.

This fix does not cover a sleeping keyboard that produces timeouts instead of `55 FC 04`. In that case the session stays open, so pressing **Read** again works once the keyboard is awake.

## Tests

- `npm test`: 245 tests, all passing.
- New tests in `tests/auto-connect-battery.test.mjs`:
  - link loss followed by wake-up reconnects with reads only;
  - a manual Disconnect stops the retries.
- `tests/transport.test.mjs` was updated for the new recovery behaviour.
