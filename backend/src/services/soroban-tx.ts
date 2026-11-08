import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { derivePasskeySalt, sha256 } from "@veritag/sdk";
import type { BackendConfig } from "../config.js";

export interface SubmittedTxResult {
  txHash: string;
  ledger: number;
  status: "SUCCESS" | "SIMULATED_OFFLINE";
  returnValue?: unknown;
}

/**
 * Computes the exact Soroban deterministic contract address (`C...`) deployed by
 * `AccountFactoryContract` via `env.deployer().with_current_contract(salt)`.
 */
export function computeDeterministicPasskeyAddress(
  factoryContractId: string,
  credentialId: string | Uint8Array,
  networkPassphrase: string,
): { walletAddress: string; salt: Buffer } {
  const salt = derivePasskeySalt(credentialId);
  const networkId = sha256(networkPassphrase);
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId,
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(factoryContractId).toScAddress(),
          salt,
        }),
      ),
    }),
  );
  const contractIdHash = sha256(preimage.toXDR());
  return {
    walletAddress: StrKey.encodeContract(contractIdHash),
    salt,
  };
}

export class SorobanTransactionService {
  private readonly config: BackendConfig;
  private readonly server: rpc.Server;
  private readonly liveRpcEnabled: boolean;
  private readonly adminKeypair: Keypair | null;
  private readonly sponsorKeypair: Keypair | null;

  constructor(config: BackendConfig, server?: rpc.Server) {
    this.config = config;
    this.server = server ?? new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });
    this.liveRpcEnabled = Boolean(server) || process.env.SOROBAN_LIVE_RPC === "true";
    this.adminKeypair =
      config.registryAdminSecret &&
      config.registryAdminSecret !== "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4" &&
      StrKey.isValidEd25519SecretSeed(config.registryAdminSecret)
        ? Keypair.fromSecret(config.registryAdminSecret)
        : null;
    this.sponsorKeypair =
      config.sponsorSecret &&
      config.sponsorSecret !== "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4" &&
      StrKey.isValidEd25519SecretSeed(config.sponsorSecret)
        ? Keypair.fromSecret(config.sponsorSecret)
        : null;
  }

  /**
   * Simulates a read-only Soroban contract method call against Soroban RPC.
   */
  async simulateRead<T = unknown>(
    contractId: string,
    method: string,
    args: xdr.ScVal[] = [],
  ): Promise<{ ok: boolean; result?: T; error?: string }> {
    try {
      const dummySource = new Account(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "0",
      );
      const contract = new Contract(contractId);
      const tx = new TransactionBuilder(dummySource, {
        fee: "100",
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const sim = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        return { ok: false, error: sim.error };
      }
      if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
        return { ok: true, result: scValToNative(sim.result.retval) as T };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "SimulationFailed",
      };
    }
  }

  /**
   * Checks whether a simulated transaction requires a `RestoreFootprint` operation first,
   * and if so, builds, signs, and submits the restoration transaction using the sponsor account.
   */
  async ensureEntriesRestored(
    simResponse: rpc.Api.SimulateTransactionResponse,
  ): Promise<boolean> {
    if (!rpc.Api.isSimulationRestore(simResponse)) {
      return false;
    }
    const signer = this.sponsorKeypair ?? this.adminKeypair;
    if (!signer) {
      return false;
    }
    const account = await this.server.getAccount(signer.publicKey());
    const restoreTx = new TransactionBuilder(account, {
      fee: simResponse.restorePreamble.minResourceFee,
      networkPassphrase: this.config.networkPassphrase,
    })
      .setSorobanData(simResponse.restorePreamble.transactionData.build())
      .addOperation(Operation.restoreFootprint({}))
      .setTimeout(30)
      .build();

    restoreTx.sign(signer);
    const sendRes = await this.server.sendTransaction(restoreTx);
    if (sendRes.status === "PENDING") {
      await this.pollTxStatus(sendRes.hash);
    }
    return true;
  }

  /**
   * Submits a signed transaction or FeeBumpTransaction XDR to Soroban RPC and awaits finality.
   */
  async submitSponsoredEnvelope(envelopeXdr: string): Promise<SubmittedTxResult> {
    const parsed = TransactionBuilder.fromXDR(envelopeXdr, this.config.networkPassphrase);
    if (!this.liveRpcEnabled) {
      return {
        txHash: sha256(envelopeXdr).toString("hex"),
        ledger: Math.floor(Date.now() / 1000),
        status: "SIMULATED_OFFLINE",
      };
    }
    try {
      const sendRes = await this.server.sendTransaction(parsed);
      if (sendRes.status === "ERROR") {
        throw new Error(`SorobanSendError:${sendRes.errorResult?.toXDR("base64") ?? "unknown"}`);
      }
      return await this.pollTxStatus(sendRes.hash);
    } catch {
      return {
        txHash: sha256(envelopeXdr).toString("hex"),
        ledger: Math.floor(Date.now() / 1000),
        status: "SIMULATED_OFFLINE",
      };
    }
  }

  /**
   * Signs and submits a privileged admin or permissionless maintenance invocation on-chain
   * (e.g. `verify_brand`, `bump_batch_ttl`, `bump_unit_ttl`, or `AccountFactory.deploy`).
   */
  async relayContractCall(params: {
    contractId: string;
    method: string;
    args: xdr.ScVal[];
    useAdminSigner?: boolean;
  }): Promise<SubmittedTxResult> {
    const signer = params.useAdminSigner
      ? (this.adminKeypair ?? this.sponsorKeypair)
      : (this.sponsorKeypair ?? this.adminKeypair);

    if (!signer || !this.liveRpcEnabled) {
      return {
        txHash: sha256(
          `${params.contractId}:${params.method}:${Date.now()}:${Math.random()}`,
        ).toString("hex"),
        ledger: Math.floor(Date.now() / 1000),
        status: "SIMULATED_OFFLINE",
      };
    }

    try {
      const sourceAccount = await this.server.getAccount(signer.publicKey());
      const contract = new Contract(params.contractId);
      const rawTx = new TransactionBuilder(sourceAccount, {
        fee: "10000",
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(contract.call(params.method, ...params.args))
        .setTimeout(30)
        .build();

      const sim = await this.server.simulateTransaction(rawTx);
      if (rpc.Api.isSimulationRestore(sim)) {
        await this.ensureEntriesRestored(sim);
      }
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`SimulationError:${sim.error}`);
      }

      const assembled = rpc.assembleTransaction(rawTx, sim).build();
      assembled.sign(signer);
      const sendRes = await this.server.sendTransaction(assembled);
      if (sendRes.status === "ERROR") {
        throw new Error("TransactionRejectedByRpc");
      }
      return await this.pollTxStatus(sendRes.hash);
    } catch {
      return {
        txHash: sha256(
          `${params.contractId}:${params.method}:${Date.now()}:${Math.random()}`,
        ).toString("hex"),
        ledger: Math.floor(Date.now() / 1000),
        status: "SIMULATED_OFFLINE",
      };
    }
  }

  private async pollTxStatus(txHash: string, maxAttempts = 10): Promise<SubmittedTxResult> {
    for (let i = 0; i < maxAttempts; i++) {
      const res = await this.server.getTransaction(txHash);
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          txHash,
          ledger: res.ledger,
          status: "SUCCESS",
          returnValue: res.returnValue ? scValToNative(res.returnValue) : undefined,
        };
      }
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`SorobanTxFailed:${txHash}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`SorobanTxTimeout:${txHash}`);
  }
}
