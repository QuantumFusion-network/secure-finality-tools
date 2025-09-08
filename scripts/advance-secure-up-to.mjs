#!/usr/bin/env node
// Node 18+; ESM module.
//
// Periodically advances anchor.SecureUpTo by sudo-calling:
//    sudo.sudo(anchor.noteAnchorVerified(<latest finalized block>))
//
// Usage:
//   npm i @polkadot/api @polkadot/util-crypto
//   WS=ws://127.0.0.1:9944 SEED=//Alice PALLET=anchor INTERVAL_SEC=6 node advance-secure-up-to.mjs
//
// Env vars:
//   WS            - WebSocket endpoint (default ws://127.0.0.1:9944)
//   SEED          - Sudo key seed/URI (default //Alice)
//   PALLET        - Pallet name (default "anchor")
//   INTERVAL_SEC  - Poll interval seconds (default 6)
//   DRY_RUN       - If set to "1", do not send extrinsics (log only)

import process from "node:process";
import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";

const WS = process.env.WS || "ws://127.0.0.1:9944";
const SEED = process.env.SEED || "//Alice";
const PALLET = process.env.PALLET || "anchor";
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC || 6);
const DRY_RUN = process.env.DRY_RUN === "1";

let inFlight = false;
let stop = false;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function getFinalizedNumber(api) {
  const hash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(hash);
  return header.number.toNumber();
}

async function getSecureUpTo(api, palletQuery) {
  const up = await palletQuery.secureUpTo();
  return up?.toNumber ? up.toNumber() : Number(up);
}

async function sendSudoAdvance(api, sender, targetBlock) {
  const call = api.tx[PALLET].noteAnchorVerified(targetBlock);
  const sudoCall = api.tx.sudo.sudo(call);

  return new Promise(async (resolve, reject) => {
    try {
      const unsub = await sudoCall.signAndSend(sender, async (result) => {
        const { status, dispatchError, events } = result;

        if (status.isReady) {
          console.log(`[sudo] Ready`);
        } else if (status.isBroadcast) {
          console.log(`[sudo] Broadcast`);
        } else if (status.isInBlock) {
          console.log(`[sudo] InBlock ${status.asInBlock.toHex()}`);
        } else if (status.isFinalized) {
          console.log(`[sudo] Finalized ${status.asFinalized.toHex()}`);

          const failed = events?.some(
            ({ event }) =>
              event.section === "system" && event.method === "ExtrinsicFailed",
          );

          if (failed) {
            if (dispatchError?.isModule) {
              const mod = dispatchError.asModule;
              const meta = api.registry.findMetaError(mod);
              console.error(
                `❌ DispatchError: ${meta.section}.${meta.name} - ${meta.docs.join(" ")}`,
              );
            } else {
              console.error(`❌ DispatchError: ${dispatchError?.toString()}`);
            }
            unsub();
            reject(new Error("sudo extrinsic failed"));
            return;
          }

          unsub();
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function main() {
  console.log(`Connecting to ${WS} ...`);
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  await cryptoWaitReady();

  // Validate pallets/methods exist
  if (!api.query[PALLET]?.secureUpTo) {
    console.error(
      `❌ Missing storage '${PALLET}.secureUpTo'. Adjust PALLET or storage name.`,
    );
    process.exit(1);
  }
  if (!api.tx[PALLET]?.noteAnchorVerified) {
    console.error(
      `❌ Missing call '${PALLET}.noteAnchorVerified'. Check pallet name / call name.`,
    );
    process.exit(1);
  }
  if (!api.tx.sudo?.sudo) {
    console.error(`❌ Missing pallet 'sudo' or method 'sudo'.`);
    process.exit(1);
  }

  const keyring = new Keyring({ type: "sr25519" });
  const sudoer = keyring.addFromUri(SEED);

  console.log(
    `Started. Polling every ${INTERVAL_SEC}s as ${sudoer.address}. DRY_RUN=${DRY_RUN ? "1" : "0"}`,
  );

  // Clean shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    stop = true;
    // small delay to let in-flight finalize log
    await sleep(200);
    await api.disconnect();
    process.exit(0);
  });

  // Main loop
  while (!stop) {
    try {
      if (inFlight) {
        await sleep(200);
        continue;
      }
      inFlight = true;

      const [finalized, currentUp] = await Promise.all([
        getFinalizedNumber(api),
        getSecureUpTo(api, api.query[PALLET]),
      ]);

      const need = finalized > currentUp;
      process.stdout.write(
        `Tick: finalized=#${finalized}, secureUpTo=#${currentUp} ${need ? "→ needs advance" : "✓ up-to-date"}     \r`,
      );

      if (need) {
        console.log(
          `\nAdvancing ${PALLET}.secureUpTo from #${currentUp} → #${finalized}`,
        );
        if (DRY_RUN) {
          console.log(
            `[DRY] Would call sudo.sudo(${PALLET}.noteAnchorVerified(${finalized}))`,
          );
        } else {
          await sendSudoAdvance(api, sudoer, finalized);
          // optional: verify new value
          const after = await getSecureUpTo(api, api.query[PALLET]);
          console.log(`secureUpTo is now #${after}`);
        }
      }
    } catch (e) {
      console.error("\nLoop error:", e?.message || e);
      // brief backoff to avoid tight error loop
      await sleep(1000);
    } finally {
      inFlight = false;
      await sleep(INTERVAL_SEC * 1000);
    }
  }
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
