import type { ApiPromise } from "@polkadot/api";
import type { AddressOrPair } from "@polkadot/api/types";
import type { ISubmittableResult } from "@polkadot/types/types";
import type { SignerOptions } from "@polkadot/api/submittable/types";
import { waitForSecureUpTo } from "./waitForSecureUpTo";

// Minimal augmentation type the callback will see on the last call
export interface ISecureResult extends ISubmittableResult {
  /** True only on the synthetic, final "secure finalized" callback */
  isSecureFinalized?: boolean;
  /** Block number that satisfied SecureUpTo >= included block */
  secureFinalizedAt?: number;
}

type StatusCb = (result: ISecureResult) => void | Promise<void>;

/**
 * Install a method `signAndSendSecure` on the prototype of Submittable extrinsics.
 * Call this ONCE after you have an `api` instance (any tx instance will do for patching).
 *
 * Example:
 *   const tx = api.tx.balances.transferKeepAlive(dest, amount);
 *   installSignAndSendSecure(tx);
 */
export function installSignAndSendSecure(anyTxInstance: any) {
  const proto = Object.getPrototypeOf(anyTxInstance);
  if (proto.signAndSendSecure) return; // already installed

  /**
   * Usage:
   *   await tx.signAndSendSecure(palletAnchor, account, (result) => { ... }, options?)
   *
   * @param palletAnchor  e.g. api.query.anchor  (must have .secureUpTo storage)
   * @param account       AddressOrPair
   * @param cb            Status callback (called multiple times; last call has isSecureFinalized=true)
   * @param options       Optional signer options
   * @returns             Promise resolving to an unsubscribe function for the underlying tx subscription
   */
  proto.signAndSendSecure = async function (
    api: ApiPromise,
    account: AddressOrPair,
    cb?: StatusCb,
    options?: Partial<SignerOptions>,
  ): Promise<() => void> {
    // Start normal signAndSend
    const unsub: () => void = await this.signAndSend(
      account,
      async (result: ISubmittableResult) => {
        // Fan-out the original statuses to the user callback
        if (cb) await cb(result as ISecureResult);

        // On Finalized, optionally wait for SecureUpTo and callback once more
        if (result.status?.isFinalized) {
          // If the extrinsic failed, don't wait for secure watermark
          const failed = (result.events || []).some(
            ({ event }) =>
              event.section === "system" && event.method === "ExtrinsicFailed",
          );
          if (failed) return;

          // Find the block number of the finalized block that included this tx
          const finalizedHash = result.status.asFinalized;
          const header = await api.rpc.chain.getHeader(finalizedHash);
          const includedAt = header.number.toNumber();

          // Wait for SecureUpTo >= includedAt
          await waitForSecureUpTo(api.query.anchor, includedAt);

          // One synthetic callback to signal "Secure finalized"
          if (cb) {
            await cb({
              ...(result as any),
              isSecureFinalized: true,
              secureFinalizedAt: includedAt,
            });
          }
        }
      },
      options as any,
    );

    // Return the user's ability to stop receiving normal tx status updates.
    // NOTE: This does NOT cancel the secureUpTo wait (helper auto-unsubs when satisfied).
    return unsub;
  };
}
