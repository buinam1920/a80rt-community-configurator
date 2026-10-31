# Binding replacement encoding and unconfirmed write sessions — 0.3.1

Historical evidence note; current release: **0.4.0-beta.1**.

Compared against manufacturer bundle `static/js/app.3086f769.js`, SHA-256 `924907c838ff49c6d5a8699b903ed7bb473c086e468076904516fbd0ca3e9419`, on 2026-10-24. Positions are zero-based Unicode code points with half-open ranges [start, end). Official source: [LEOBOG driver](https://leobog.driveall.cn/).

- 3225655–3225917: `getUpdateKeyData` initializes [2,0,0,0] and sets the type/payload for keyboard, modifier, mouse, media, or the full 24-bit function code.
- 3227116–3227234 and 3227870–3227961: the ordinary Fn path calls `getBuildFn`, which copies all four bytes into `allFnPack[4*slot+t]`.
- 21100–21168: W is slot 34, WIN, without `fnDisabled`. 1988463–1988647: selection locks depend on `fnDisabled`; there is no evidence that W is locked.

Replacing WIN [13,0,0,8] with keyboard W must therefore produce [2,0,26,0]. The trailing 8 belongs to the old binding type; the previous policy incorrectly preserved it as opaque data in an explicitly replaced record. Empty, keyboard/modifier, mouse, and media bindings write all four bytes with a final byte of 0; function bindings already write all four bytes. Only replaced records are normalized. Unchanged records, reserved regions, and other field masks remain intact.

Fn W/U attempts in versions 0.3.0/0.3.1 still produced no change in fresh USB reads, including a native USB attempt without control 0. The manufacturer UI changed Fn+U from Print to U, but USB still read Prt, and the user's Fn+U press still activated PrintScreen. The manufacturer UI was restored to Print, its tab closed, and all nine blocks confirmed equal to the original. The encoding discrepancy does not establish whether firmware or driver caused the failure.

Since 0.3.2, Fn command 38 is blocked before any transmission on the qualified wired A80RT U with firmware 1.37, including writes within transactions. An entire mixed draft containing Fn changes is rejected atomically. The codec, Fn reading/editing, and local profiles remain available. Production-gate tests verify zero transmissions and an unchanged write epoch; synthetic data is not physical Fn evidence.

After an unconfirmed Apply, the old baseline cannot reliably represent device state. The session is invalidated while preserving the draft and original error. The host locks editing, Apply, and Revert, requests a fresh read of all nine blocks, and still permits draft export. There is no automatic retry or restoration. A successful fresh read creates a new session; write epochs and provenance continue to reject the old baseline. A preflight failure that sent no bytes does not necessarily require invalidation.
