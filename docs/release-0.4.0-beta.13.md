# A80RT Configurator 0.4.0-beta.13

This release builds on [0.4.0-beta.12](release-0.4.0-beta.12.md).

## Fixed: "Reading incomplete: Gửi report HID quá thời gian."

In the native window, the exe sends each report with a Windows HID write. If that write does not finish within 3 seconds, for example because the receiver or the keyboard is busy, waking up or waiting for the radio link, the exe gives up on it. Three problems made this end a read with a raw error:

- **A read stopped on the first stuck write.** A read already retried once when the keyboard did not answer, but a failed write ended it immediately. Now a timed-out write during a **read** is also retried once. Reads have no side effects, so retrying is safe.
- **Configuration writes still never retry.** A write that times out stops the Apply, as before.
- **A finished write could be reported as failed.** If the write completed just as the 3-second timeout fired, the exe treated it as failed. It now checks the result after cancelling, and a write that went through counts as sent.
- **The error was not translated.** If both attempts time out, the message is now the usual guidance: *The keyboard did not answer command … — wake the keyboard in 2.4 GHz mode / reconnect the cable*. In English mode, the inner text of "Reading incomplete / Connection failed / Not applied: …" messages is now translated as well.

## Tests

- `npm test`: 274 tests, all passing; the suite was run twice in a row.
- New `tests/send-timeout-retry.test.mjs`:
  - one timed-out send is retried and the read succeeds;
  - two timed-out sends end with the usual guidance;
  - other send errors are not retried.
- Not yet verified on the keyboard: the cause of the slow writes itself.
