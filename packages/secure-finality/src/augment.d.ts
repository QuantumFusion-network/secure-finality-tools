import type { ApiPromise } from "@polkadot/api";
import type { AddressOrPair } from "@polkadot/api/types";
import type { SignerOptions } from "@polkadot/api/submittable/types";
import type { ISecureResult } from "./index";

// Loosely typed to avoid version pinning on polkadot.js generics
declare module "@polkadot/api/submittable/types" {
  interface SubmittableExtrinsic<T = any, R = any> {
    signAndSendSecure(
      api: ApiPromise,
      account: AddressOrPair,
      cb?: (result: ISecureResult) => void | Promise<void>,
      options?: Partial<SignerOptions>,
    ): Promise<() => void>;
  }
}
