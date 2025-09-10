#!/usr/bin/env node
// Node 18+; ESM module.
//
// Usage (example):
//   npm i @polkadot/api
//   WS=ws://127.0.0.1:9944 SEED=//Alice TO=<dest SS58> AMOUNT=1000000000000 node secure-tx-test.mjs
//
// Env vars:
//   WS       - WebSocket endpoint (default ws://127.0.0.1:9944)
//   SEED     - Sender seed or URI (default //Alice)
//   TO       - Destination address (required to send)
//   AMOUNT   - Amount in the chain's base units (default "1000000000000")
//   PALLET   - Pallet name that exposes `secureUpTo` storage (default "anchor")
//   WATCH_ONLY_TARGET_BLOCK - If set (e.g. 12345), the script WILL NOT send a tx;
//                              it will only wait until secureUpTo >= this block.
//
// Notes:
// - If your pallet or storage item name differs, tweak PALLET or the property access below.

import process from "node:process";
import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";

const WS = process.env.WS || "ws://127.0.0.1:9944";
const SEED = process.env.SEED || "//Alice";
const TO = process.env.TO || "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"; // Bob
const AMOUNT = process.env.AMOUNT || "1000000000000";
const PALLET = process.env.PALLET || "anchor";
const WATCH_ONLY_TARGET_BLOCK = process.env.WATCH_ONLY_TARGET_BLOCK
  ? Number(process.env.WATCH_ONLY_TARGET_BLOCK)
  : null;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  console.log(`Connecting to ${WS} ...`);
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  await cryptoWaitReady();

  // Resolve the 'secureUpTo' storage entry dynamically: api.query[PALLET].secureUpTo
  const palletQuery = api.query[PALLET];
  if (!palletQuery || !palletQuery.secureUpTo) {
    console.error(
      `❌ Could not find storage '${PALLET}.secureUpTo'. ` +
        `Adjust PALLET (current="${PALLET}") or storage name in the script.`,
    );
    process.exit(1);
  }

  // Helper to subscribe to secureUpTo until it reaches targetBlock.
  async function waitForSecureUpTo(targetBlock) {
    console.log(
      `→ Watching ${PALLET}.secureUpTo until it ≥ #${targetBlock} ...`,
    );
    return new Promise(async (resolve, reject) => {
      try {
        const unsub = await palletQuery.secureUpTo(async (upTo) => {
          const n = upTo?.toNumber ? upTo.toNumber() : Number(upTo);
          process.stdout.write(`secureUpTo = #${n}\r`);
          if (Number.isFinite(n) && n >= targetBlock) {
            console.log("\nStatus of transfer: Secure finalized");
            unsub();
            resolve();
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // WATCH-ONLY MODE: don't send a tx; just wait for watermark to pass a given block
  if (WATCH_ONLY_TARGET_BLOCK !== null) {
    await waitForSecureUpTo(WATCH_ONLY_TARGET_BLOCK);
    await api.disconnect();
    return;
  }

  // Otherwise, we send a simple transfer and track its finalized block number.
  if (!TO) {
    console.error("❌ TO is required (destination address). Set env TO=...");
    process.exit(1);
  }

  const keyring = new Keyring({ type: "sr25519" });
  const sender = keyring.addFromUri(SEED);

  // Pick transfer call
  const balances = api.tx.balances;
  let makeTransfer;
  if (balances?.transferKeepAlive) {
    makeTransfer = (to, value) => balances.transferKeepAlive(to, value);
  } else if (balances?.transfer) {
    makeTransfer = (to, value) => balances.transfer(to, value);
  } else {
    console.error(
      "❌ Could not find balances.transferKeepAlive/transfer on this chain.",
    );
    process.exit(1);
  }

  console.log(
    `Submitting transfer from ${sender.address} → ${TO}, amount=${AMOUNT} ...`,
  );
  const tx = makeTransfer(TO, AMOUNT);

  let includedAtFinalizedBlock = null;

  const unsub = await tx.signAndSend(sender, async (result) => {
    const { status, dispatchError, events } = result;

    if (status.isReady) {
      console.log("Status of transfer: Ready");
    } else if (status.isBroadcast) {
      console.log("Status of transfer: Broadcast");
    } else if (status.isInBlock) {
      console.log(
        `Successful transfer ... InBlock ${status.asInBlock.toHex()}`,
      );
    } else if (status.isFinalized) {
      console.log(
        `Status of transfer: Finalized at ${status.asFinalized.toHex()}`,
      );

      // Report extrinsic success/failure
      const failed = events?.some(
        ({ event }) =>
          event.section === "system" && event.method === "ExtrinsicFailed",
      );
      if (failed) {
        // Decode error if possible
        if (dispatchError?.isModule) {
          const mod = dispatchError.asModule;
          const error = api.registry.findMetaError(mod);
          console.error(
            `❌ DispatchError: ${error.section}.${error.name} - ${error.docs.join(" ")}`,
          );
        } else {
          console.error(`❌ DispatchError: ${dispatchError?.toString()}`);
        }
        unsub();
        await api.disconnect();
        process.exit(1);
      }

      // Determine the block number of the finalized block that included this extrinsic
      const header = await api.rpc.chain.getHeader(status.asFinalized);
      includedAtFinalizedBlock = header.number.toNumber();
      console.log(`→ Tx finalized in block #${includedAtFinalizedBlock}`);

      // Stop listening to the tx stream
      unsub();

      // Now wait for secure watermark to pass this block
      await waitForSecureUpTo(includedAtFinalizedBlock);

      await sleep(50);
      await api.disconnect();
      process.exit(0);
    }
  });
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
