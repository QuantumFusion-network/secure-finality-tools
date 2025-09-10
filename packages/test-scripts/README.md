# secure-finality-tools

Tiny polkadot.js helpers to prototype a **“Secure finalized”** stage using a
`SecureUpTo` watermark and a sudo call to advance it.

```

scripts/
advance-secure-up-to.mjs   # sudo.sudo(anchor.noteAnchorVerified(latest\_finalized))
secure-tx-test.mjs         # submits a tx and waits until secureUpTo >= tx's finalized block

````

## Requirements
- Node.js **18+**
- A Substrate/Polkadot node exposing:
  - storage `anchor.secureUpTo`
  - call `anchor.noteAnchorVerified(up_to)` (sudo-only)
- A sudo key (defaults to `//Alice`) on your local dev chain.

Install deps:
```bash
npm install
````

## Usage

### 1) Send a tx and wait for “Secure finalized”

```bash
WS=ws://127.0.0.1:9944 \
SEED="//Alice" \
TO="<recipient-ss58>" \
AMOUNT=1000000000000 \
PALLET="anchor" \
npm run tx:test
```

Env vars:

* `WS` — WS endpoint (default `ws://127.0.0.1:9944`)
* `SEED` — sender URI (default `//Alice`)
* `TO` — recipient SS58 (required to send)
* `AMOUNT` — base units (default `1000000000000`)
* `PALLET` — pallet exposing `secureUpTo` (default `anchor`)
* `WATCH_ONLY_TARGET_BLOCK` — if set, **no tx** is sent; waits until `secureUpTo >= value`.

### 2) Periodically advance `SecureUpTo` via sudo

```bash
WS=ws://127.0.0.1:9944 \
SEED="//Alice" \
PALLET="anchor" \
INTERVAL_SEC=6 \
npm run secure:advance
```

Env vars:

* `WS` — WS endpoint (default `ws://127.0.0.1:9944`)
* `SEED` — sudo key URI (default `//Alice`)
* `PALLET` — pallet name (default `anchor`)
* `INTERVAL_SEC` — poll interval seconds (default `6`)
* `DRY_RUN=1` — log actions without sending extrinsics

> ⚠️ **Sudo caution:** `advance-secure-up-to.mjs` uses `sudo.sudo(...)`. Only run on dev/test networks.
