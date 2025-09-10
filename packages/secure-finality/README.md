# Secure finality adaptor

Usage example:
```ts
import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { installSignAndSendSecure } from "secure-finality"; // adjust path

(async () => {
  const api = await ApiPromise.create({ provider: new WsProvider("ws://127.0.0.1:9944") });

  // Patch once
  const probeTx = api.tx.system.remark("0x");
  installSignAndSendSecure(probeTx);

  // Build any tx
  const keyring = new Keyring({ type: "sr25519" });
  const alice = keyring.addFromUri("//Alice");
  const tx = api.tx.balances.transferKeepAlive("<dest>", 1_000_000_000_000n);

  // Call the new method
  await tx.signAndSendSecure(api, alice, (res) => {
    if (res.status?.isReady)          console.log("Ready");
    else if (res.status?.isInBlock)   console.log("InBlock");
    else if (res.status?.isFinalized) console.log("Finalized");
    else if (res.isSecureFinalized)   console.log(`Secure finalized at block #${res.secureFinalizedAt}`);
  });
})();
```
