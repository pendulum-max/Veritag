import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { sha256 } from "@veritag/sdk";
import { describe, expect, it } from "vitest";
import { decodeRegistryEvent, type RawSorobanEvent } from "../src/decoder.js";
import { IndexerPoller, type SorobanEventsProvider } from "../src/poller.js";
import { InMemoryIndexerWriter } from "../src/writer.js";

function scSym(s: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(s);
}

function scAddr(pub: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(pub), { type: "address" });
}

function scBytes32(buf: Buffer): xdr.ScVal {
  return xdr.ScVal.scvBytes(buf);
}

function scMap(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return xdr.ScVal.scvMap(
    sorted.map(([k, val]) => new xdr.ScMapEntry({ key: scSym(k), val })),
  );
}

describe("@veritag/indexer XDR decoder, poller, and idempotent writer", () => {
  it("decodes base64 XDR Soroban contract events and projects full unit lifecycle idempotently", async () => {
    const brand = Keypair.random().publicKey();
    const serviceCenter = Keypair.random().publicKey();
    const alice = Keypair.random().publicKey();
    const bob = Keypair.random().publicKey();

    const batchId = sha256("BATCH-INDEXER-01");
    const root = sha256("MERKLE-ROOT-01");
    const unitId = sha256("UNIT-01");
    const reportHash = sha256("REPORT-01");
    const recallReason = sha256("RECALL-01");

    const rawEvents: RawSorobanEvent[] = [
      {
        id: "000100-1",
        ledger: 100,
        txHash: "tx1",
        topic: [scSym("brand_registered").toXDR("base64"), scAddr(brand).toXDR("base64")],
        value: scMap([["domain", xdr.ScVal.scvString("nordic-med.eu")]]).toXDR("base64"),
      },
      {
        id: "000101-1",
        ledger: 101,
        txHash: "tx2",
        topic: [scSym("brand_verified"), scAddr(brand)],
        value: scMap([]),
      },
      {
        id: "000102-1",
        ledger: 102,
        txHash: "tx3",
        topic: [scSym("batch_committed"), scAddr(brand), scBytes32(batchId)],
        value: scMap([
          ["root", scBytes32(root)],
          ["warranty_months", nativeToScVal(12, { type: "u32" })],
          ["unit_count", nativeToScVal(500n, { type: "u64" })],
        ]),
      },
      {
        id: "000103-1",
        ledger: 103,
        txHash: "tx4",
        topic: [scSym("unit_activated"), scBytes32(unitId)],
        value: scMap([
          ["brand", scAddr(brand)],
          ["batch_id", scBytes32(batchId)],
          ["owner", scAddr(alice)],
          ["warranty_expiry", nativeToScVal(1_800_000_000n, { type: "u64" })],
        ]),
      },
      {
        id: "000104-1",
        ledger: 104,
        txHash: "tx5",
        topic: [scSym("duplicate_attempt"), scBytes32(unitId)],
        value: scMap([["caller", scAddr(bob)]]),
      },
      {
        id: "000105-1",
        ledger: 105,
        txHash: "tx6",
        topic: [scSym("unit_transferred"), scBytes32(unitId)],
        value: scMap([
          ["from", scAddr(alice)],
          ["to", scAddr(bob)],
        ]),
      },
      {
        id: "000106-1",
        ledger: 106,
        txHash: "tx7",
        topic: [scSym("claim_filed"), scBytes32(unitId)],
        value: scMap([
          ["claim_id", nativeToScVal(1, { type: "u32" })],
          ["service_center", scAddr(serviceCenter)],
        ]),
      },
      {
        id: "000107-1",
        ledger: 107,
        txHash: "tx8",
        topic: [scSym("claim_resolved"), scBytes32(unitId)],
        value: scMap([
          ["claim_id", nativeToScVal(1, { type: "u32" })],
          ["outcome", nativeToScVal(3, { type: "u32" })], // Repaired = 3
          ["report_hash", scBytes32(reportHash)],
        ]),
      },
      {
        id: "000108-1",
        ledger: 108,
        txHash: "tx9",
        topic: [scSym("batch_recalled"), scAddr(brand), scBytes32(batchId)],
        value: scMap([["reason_hash", scBytes32(recallReason)]]),
      },
    ];

    // Quick sanity check on decoder directly
    const firstDecoded = decodeRegistryEvent(rawEvents[0]!);
    expect(firstDecoded?.type).toBe("brand_registered");

    const writer = new InMemoryIndexerWriter();
    let latestChainLedger = 108;
    let pollCalls = 0;

    const mockProvider: SorobanEventsProvider = {
      async fetchEvents(params) {
        pollCalls++;
        if (pollCalls === 1) {
          expect(params.cursor).toBeUndefined();
          return {
            latestLedger: latestChainLedger,
            cursor: "000108-1",
            events: rawEvents,
          };
        }
        // Second call replays last event + advances latestLedger to 112 so unconfirmed events finalize
        expect(params.cursor).toBe("000108-1");
        return {
          latestLedger: latestChainLedger,
          cursor: "000108-1",
          events: rawEvents.slice(-1),
        };
      },
    };

    const poller = new IndexerPoller({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      provider: mockProvider,
      writer,
      confirmationLedgers: 2,
    });

    const cycle1 = await poller.pollOnce();
    expect(cycle1.fetched).toBe(9);
    expect(cycle1.applied).toBe(9);

    // Events at ledgers 107 and 108 are within 2 ledgers of 108, so not yet finalized
    expect(writer.events.get("000106-1")?.finalized).toBe(true);
    expect(writer.events.get("000107-1")?.finalized).toBe(false);
    expect(writer.events.get("000108-1")?.finalized).toBe(false);

    // Advance chain head & replay -> zero duplicate state mutations, all pending events finalized!
    latestChainLedger = 112;
    const cycle2 = await poller.pollOnce();
    expect(cycle2.fetched).toBe(1);
    expect(cycle2.applied).toBe(0);
    expect(cycle2.finalized).toBe(1);
    expect(writer.events.get("000107-1")?.finalized).toBe(true);
    expect(writer.events.get("000108-1")?.finalized).toBe(true);

    const unitHex = unitId.toString("hex");
    const projectedUnit = writer.units.get(unitHex)!;
    expect(projectedUnit.owner).toBe(bob);
    expect(projectedUnit.duplicateAttempts).toBe(1);
    expect(projectedUnit.claimsUsed).toBe(1);
    expect(projectedUnit.status).toBe("Recalled");

    const projectedClaim = writer.claims.get(`${unitHex}:1`)!;
    expect(projectedClaim.outcome).toBe("Repaired");
    expect(projectedClaim.reportHash).toBe(reportHash.toString("hex"));
  });
});
