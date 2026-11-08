import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const FactoryError = {
  1: {message:"NotInitialized"},
  2: {message:"InvalidPublicKey"}
}

export type FactoryDataKey = {tag: "AccountWasmHash", values: void} | {tag: "DeployedBySalt", values: readonly [Buffer]};

export interface Client {
  /**
   * Construct and simulate a deploy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deterministically deploys a PasskeyAccountContract instance for `salt` or returns
   * the existing address if already deployed by this factory.
   */
  deploy: ({salt, credential_id, public_key, recovery}: {salt: Buffer, credential_id: Buffer, public_key: Buffer, recovery: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Computes the deterministic contract address for `salt` without deploying.
   */
  get_address: ({salt}: {salt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a is_deployed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns whether a wallet has already been deployed for `salt`.
   */
  is_deployed: ({salt}: {salt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_wasm_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {account_wasm_hash}: {account_wasm_hash: Buffer},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({account_wasm_hash}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAADEZhY3RvcnlFcnJvcgAAAAIAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAABAAAAAAAAABBJbnZhbGlkUHVibGljS2V5AAAAAg==",
        "AAAAAgAAAAAAAAAAAAAADkZhY3RvcnlEYXRhS2V5AAAAAAACAAAAAAAAAAAAAAAPQWNjb3VudFdhc21IYXNoAAAAAAEAAAAAAAAADkRlcGxveWVkQnlTYWx0AAAAAAABAAAD7gAAACA=",
        "AAAAAAAAAItEZXRlcm1pbmlzdGljYWxseSBkZXBsb3lzIGEgUGFzc2tleUFjY291bnRDb250cmFjdCBpbnN0YW5jZSBmb3IgYHNhbHRgIG9yIHJldHVybnMKdGhlIGV4aXN0aW5nIGFkZHJlc3MgaWYgYWxyZWFkeSBkZXBsb3llZCBieSB0aGlzIGZhY3RvcnkuAAAAAAZkZXBsb3kAAAAAAAQAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAAAAAANY3JlZGVudGlhbF9pZAAAAAAAAA4AAAAAAAAACnB1YmxpY19rZXkAAAAAA+4AAABBAAAAAAAAAAhyZWNvdmVyeQAAA+gAAAATAAAAAQAAA+kAAAATAAAH0AAAAAxGYWN0b3J5RXJyb3I=",
        "AAAAAAAAAElDb21wdXRlcyB0aGUgZGV0ZXJtaW5pc3RpYyBjb250cmFjdCBhZGRyZXNzIGZvciBgc2FsdGAgd2l0aG91dCBkZXBsb3lpbmcuAAAAAAAAC2dldF9hZGRyZXNzAAAAAAEAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAEAAAAT",
        "AAAAAAAAAD5SZXR1cm5zIHdoZXRoZXIgYSB3YWxsZXQgaGFzIGFscmVhZHkgYmVlbiBkZXBsb3llZCBmb3IgYHNhbHRgLgAAAAAAC2lzX2RlcGxveWVkAAAAAAEAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAAEWFjY291bnRfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAANZ2V0X3dhc21faGFzaAAAAAAAAAAAAAABAAAD6AAAA+4AAAAg" ]),
      options
    )
  }
  public readonly fromJSON = {
    deploy: this.txFromJSON<Result<string>>,
        get_address: this.txFromJSON<string>,
        is_deployed: this.txFromJSON<boolean>,
        get_wasm_hash: this.txFromJSON<Option<Buffer>>
  }
}