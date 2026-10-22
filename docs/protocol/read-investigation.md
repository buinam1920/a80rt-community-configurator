# A80RT receiver read qualification — 22 October 2026

## Measured evidence

The supplied export `C:/Users/Administrator/Downloads/a80rt-read-2026-10-22T04-14-25-963Z.json`
(SHA-256 `db65ebdf2832bf4ea81c9ad03ba17e189f5bd930bd70d122989437af4a1d8bc2`)
records a failed real read at `2026-10-22T04:11:19.231Z`. Device: **A80RT U Dongle**,
VID/PID `0x0C45:0xFEFC`, collection usage page `0xFF80`, usage `1`, input/output
report ID `0`, both **32 bytes**, no feature reports. The exact exported summary
and first request are preserved in `tests/fixtures/a80rt-dongle-descriptor.json`.
The summary does not include original HID report items; tests explicitly reconstruct
8-bit items from the measured byte totals.

The entire captured trace is one TX, at local `11:11:19`:

```text
aa 10 18 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```

This asks for command `0x10`, offset `0`, count `24`, nonfinal chunk. There is no
RX, no returned block, and `complete` is false. Opening the handle is therefore
proven; communication with the keyboard is not. The old reader fails after one
2500 ms wait. This task reproduces that no-RX failure with a synthetic silent
receiver, not a new real-device capture.

## Manufacturer comparison

Source: the supplied `work/a80rt-inspect/app.js`, originally
`https://leobog.driveall.cn/static/js/app.3086f769.js`, SHA-256
`924907c838ff49c6d5a8699b903ed7bb473c086e468076904516fbd0ca3e9419`.
This is source inspection, not a claim to have run the manufacturer UI on the
same physical device.

* `buildPkt_final(command,count,offset,payload,packLen,extra,last)` emits
  `aa`, command, count, little-endian offset, zero at byte 5, final flag at byte 6,
  and payload from byte 8. For 32-byte reports and a 32-byte device-information
  block, `sendReportSuper` has 24-byte chunk capacity: the first request matches
  the measured TX byte for byte. The store starts `deviceArray` at length 32.
* `sendReport` watches 100 ms ticks. At 30 ticks it resends the identical report
  once; after the next 30 ticks it closes the connection. Successful OS sending
  clears counters, and `getInput` cancels that timer on input. `sendReportSuper`
  additionally rejects its overall promise at 5000 ms. The old reader's 2500 ms
  single attempt expires before the manufacturer's first retry opportunity.
* `inputreport` registers a persistent listener; `getInput` forwards reports to a
  global response handler. No evidence here establishes a required wake or
  initialization opcode for this first read. This implementation adds none.
* The manufacturer handler advances on broad input criteria. That is not copied:
  our reads must still match prefix `55`, command, offset, and the entire requested
  count. Unrelated input cannot extend the read indefinitely or invent a block.

The implemented policy takes the source-grounded **3000 ms interval and one
identical retry**, with a bounded maximum of two intervals per chunk. It does
not duplicate the manufacturer's conflicting 5000 ms outer timeout/global
callback behavior. `timeoutMs` overrides the per-attempt interval for diagnostics
and tests. This is a justified software policy change, not evidence that timing
was the real receiver's sole failure cause.

## Transport and caller contract

`A80Transport(device,{onTrace,timeoutMs})` uses `open()`,
`readBlock(command,length,{signal})`, `close()`, and `getState()`.
It returns a `Uint8Array` only after every chunk of that block has arrived.
Whole-block reads queue in order; cancellation can reject a queued request
immediately, and that request will never send. Send failures propagate without
retries. Silence gets exactly one read retry. Short responses reject the block;
wrong commands, offsets, and report IDs do not complete it. Only existing allowed
read commands can be sent. Raw bytes are preserved.

`getState()` has three distinct facts:

* `opened`: this session owns an open HID handle.
* `hasResponse`: this session accepted at least one complete matching read chunk;
  false after open, false for TX-only/irrelevant/malformed input, reset by close.
  This does **not** assert that the full configuration has been read.
* `sessionId`: an opaque generation local to that transport instance. It changes
  on close and new open; callers must bind both transport/reader identity and
  generation, not compare this number across instances.

`onTrace` receives `{type,sessionId,at,...details}`. `tx`/`rx` carry copied bytes;
`tx` carries command, offset, requested length, and attempt; `retry`/`timeout`
carry command, offset, and attempt; `opened`/`closed` identify lifecycle changes.
Tracing is diagnostic only and must not throw. RX traces include unsolicited
frames; `hasResponse` only qualifies validated responses.

The `A80Reader` facade preserves old exports and callbacks, translates packet
traces to `onPacket(direction,bytes)`, and publishes only complete blocks.
Progress now advances per completed block. The app binds read progress, block
publication, completion, and errors to the captured reader, generation, and
snapshot. A disconnected old reader cannot populate a new device snapshot.
Opening a handle displays “chờ phản hồi”, not keyboard readiness. No write path
has been enabled by this change. Future editors must require all relevant real
blocks in the current ConfigSession, not merely `opened` or `hasResponse`.

## Stale-frame boundary

Close removes the old listener and invalidates pending/queued operations.
Callbacks already captured in the old session cannot settle a new session's
request; the regression test delivers such an old callback after reopening.
The controller's 22 October 2026 review ruling narrows Task 1 acceptance to this
callback/result isolation, including the app's prior-reader/snapshot guards.
The authoritative plan and generated Task 1 brief now state that precise guarantee.
The packet header has **no proven transaction ID**. A byte-identical delayed
response emitted onto a newly opened handle and matching its current command,
offset, and length is indistinguishable from a fresh response. Software
generation checks cannot solve that stronger on-wire case. No arbitrary delay,
guessed flush command, or claim of hardware freshness is introduced.

The separate `format limitation: a byte-identical old frame through the current
listener is accepted after reopen` test caches a first-session response and
dispatches those exact bytes through the current EventTarget listener after
reopening. It explicitly expects acceptance and a current-session RX trace.
This is characterization of the format limitation, not proof of response freshness
or hardware success. The detached-callback rejection test uses a fresh synthetic
reply only after asserting that an invoked old callback did not complete the read.

## Hardware acceptance still pending

Both worker and controller CUA inventories had **zero IAB tabs** during this
implementation. The previously authorized device tab is unavailable. Consequently
there is no new hardware RX, no measured ACK arrival time, and no same-device
manufacturer UI comparison. Physical sleep state, radio mode, and whether another
tab/application holds the interface are unobserved; none is asserted as the cause.

For the next controlled hardware check, the user must make the keyboard awake in
2.4 GHz mode and close/release other configurator tabs/apps, then reopen/authorize
the receiver tab if needed. Capture the descriptor, both TX attempts and any RX
with elapsed timestamps. Verify `0x10` then all six Reader blocks (2128 bytes).
Compare the same collection and first command in the manufacturer driver with
other owners closed. If still silent, retain the failed trace and investigate
radio/interface ownership before proposing another opcode. Do not change RT,
remap, lighting, reset, or firmware simply to obtain read evidence.

Automated tests use a real transport over a synthetic EventTarget HID boundary;
they qualify software behavior only. Hardware acceptance must remain pending in
later reports until actual RX and complete-block evidence exist.
