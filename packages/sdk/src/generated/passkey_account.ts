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




export type DataKey = {tag: "Passkey", values: readonly [Buffer]} | {tag: "PasskeyCount", values: void} | {tag: "RecoverySigner", values: void};

export const AccountError = {
  1: {message:"UnknownCredential"},
  2: {message:"InvalidAuthenticatorData"},
  3: {message:"UserNotPresent"},
  4: {message:"ChallengeMismatch"},
  5: {message:"RecoveryNotConfigured"},
  6: {message:"CannotRemoveLastAuthMethod"},
  7: {message:"InvalidPublicKey"}
}

export type AccountSignature = {tag: "WebAuthn", values: readonly [WebAuthnCredential]} | {tag: "Recovery", values: void};


export interface WebAuthnCredential {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  credential_id: Buffer;
  signature: Buffer;
}

export interface Client {
  /**
   * Construct and simulate a add_passkey transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_passkey: ({credential_id, public_key}: {credential_id: Buffer, public_key: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_passkey transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_passkey: ({credential_id}: {credential_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a remove_passkey transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_passkey: ({credential_id}: {credential_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_passkey_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_passkey_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_recovery_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_recovery_signer: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_recovery_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_recovery_signer: ({recovery}: {recovery: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {credential_id, public_key, recovery}: {credential_id: Buffer, public_key: Buffer, recovery: Option<string>},
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
    return ContractClient.deploy({credential_id, public_key, recovery}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAAB1Bhc3NrZXkAAAAAAQAAAA4AAAAAAAAAAAAAAAxQYXNza2V5Q291bnQAAAAAAAAAAAAAAA5SZWNvdmVyeVNpZ25lcgAA",
        "AAAABAAAAAAAAAAAAAAADEFjY291bnRFcnJvcgAAAAcAAAAAAAAAEVVua25vd25DcmVkZW50aWFsAAAAAAAAAQAAAAAAAAAYSW52YWxpZEF1dGhlbnRpY2F0b3JEYXRhAAAAAgAAAAAAAAAOVXNlck5vdFByZXNlbnQAAAAAAAMAAAAAAAAAEUNoYWxsZW5nZU1pc21hdGNoAAAAAAAABAAAAAAAAAAVUmVjb3ZlcnlOb3RDb25maWd1cmVkAAAAAAAABQAAAAAAAAAaQ2Fubm90UmVtb3ZlTGFzdEF1dGhNZXRob2QAAAAAAAYAAAAAAAAAEEludmFsaWRQdWJsaWNLZXkAAAAH",
        "AAAAAgAAAAAAAAAAAAAAEEFjY291bnRTaWduYXR1cmUAAAACAAAAAQAAAAAAAAAIV2ViQXV0aG4AAAABAAAH0AAAABJXZWJBdXRobkNyZWRlbnRpYWwAAAAAAAAAAAAAAAAACFJlY292ZXJ5",
        "AAAAAQAAAAAAAAAAAAAAEldlYkF1dGhuQ3JlZGVudGlhbAAAAAAABAAAAAAAAAASYXV0aGVudGljYXRvcl9kYXRhAAAAAAAOAAAAAAAAABBjbGllbnRfZGF0YV9qc29uAAAADgAAAAAAAAANY3JlZGVudGlhbF9pZAAAAAAAAA4AAAAAAAAACXNpZ25hdHVyZQAAAAAAA+4AAABA",
        "AAAAAAAAAAAAAAALYWRkX3Bhc3NrZXkAAAAAAgAAAAAAAAANY3JlZGVudGlhbF9pZAAAAAAAAA4AAAAAAAAACnB1YmxpY19rZXkAAAAAA+4AAABBAAAAAQAAA+kAAAACAAAH0AAAAAxBY2NvdW50RXJyb3I=",
        "AAAAAAAAAAAAAAALZ2V0X3Bhc3NrZXkAAAAAAQAAAAAAAAANY3JlZGVudGlhbF9pZAAAAAAAAA4AAAABAAAD6AAAA+4AAABB",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAJc2lnbmF0dXJlAAAAAAAH0AAAABBBY2NvdW50U2lnbmF0dXJlAAAAAAAAAA1hdXRoX2NvbnRleHRzAAAAAAAD6gAAB9AAAAAHQ29udGV4dAAAAAABAAAD6QAAAAIAAAfQAAAADEFjY291bnRFcnJvcg==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAMAAAAAAAAADWNyZWRlbnRpYWxfaWQAAAAAAAAOAAAAAAAAAApwdWJsaWNfa2V5AAAAAAPuAAAAQQAAAAAAAAAIcmVjb3ZlcnkAAAPoAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAOcmVtb3ZlX3Bhc3NrZXkAAAAAAAEAAAAAAAAADWNyZWRlbnRpYWxfaWQAAAAAAAAOAAAAAQAAA+kAAAACAAAH0AAAAAxBY2NvdW50RXJyb3I=",
        "AAAAAAAAAAAAAAARZ2V0X3Bhc3NrZXlfY291bnQAAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAATZ2V0X3JlY292ZXJ5X3NpZ25lcgAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAATc2V0X3JlY292ZXJ5X3NpZ25lcgAAAAABAAAAAAAAAAhyZWNvdmVyeQAAA+gAAAATAAAAAQAAA+kAAAACAAAH0AAAAAxBY2NvdW50RXJyb3I=" ]),
      options
    )
  }
  public readonly fromJSON = {
    add_passkey: this.txFromJSON<Result<void>>,
        get_passkey: this.txFromJSON<Option<Buffer>>,
        remove_passkey: this.txFromJSON<Result<void>>,
        get_passkey_count: this.txFromJSON<u32>,
        get_recovery_signer: this.txFromJSON<Option<string>>,
        set_recovery_signer: this.txFromJSON<Result<void>>
  }
}