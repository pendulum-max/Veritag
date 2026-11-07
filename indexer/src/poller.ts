import { rpc } from "@stellar/stellar-sdk";
import { decodeRegistryEvent, type RawSorobanEvent } from "./decoder.js";
import type { IndexerWriter } from "./writer.js";

export interface EventPageResponse {
  latestLedger: number;
  cursor: string;
  events: RawSorobanEvent[];
}

export interface SorobanEventsProvider {
  fetchEvents(params: {
    contractId: string;
    cursor?: string;
    startLedger?: number;
    limit?: number;
  }): Promise<EventPageResponse>;
}

export class RpcEventsProvider implements SorobanEventsProvider {
  private readonly server: rpc.Server;

  constructor(rpcUrl: string) {
    this.server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  }

  async fetchEvents(params: {
    contractId: string;
    cursor?: string;
    startLedger?: number;
    limit?: number;
  }): Promise<EventPageResponse> {
    const latest = await this.server.getLatestLedger();
    const requestParams: rpc.Server.GetEventsRequest = params.cursor
      ? {
          cursor: params.cursor,
          filters: [{ type: "contract", contractIds: [params.contractId] }],
          limit: params.limit ?? 100,
        }
      : {
          startLedger: params.startLedger ?? Math.max(1, latest.sequence - 1000),
          filters: [{ type: "contract", contractIds: [params.contractId] }],
          limit: params.limit ?? 100,
        };

    const res = await this.server.getEvents(requestParams);
    const events: RawSorobanEvent[] = res.events.map((ev) => ({
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      ledgerClosedAt: ev.ledgerClosedAt,
      topic: ev.topic,
      value: ev.value,
    }));

    return {
      latestLedger: res.latestLedger,
      cursor: res.cursor ?? events[events.length - 1]?.id ?? params.cursor ?? "",
      events,
    };
  }
}

export interface IndexerPollerOptions {
  contractId: string;
  provider: SorobanEventsProvider;
  writer: IndexerWriter;
  confirmationLedgers?: number;
  batchLimit?: number;
}

export class IndexerPoller {
  private readonly contractId: string;
  private readonly provider: SorobanEventsProvider;
  private readonly writer: IndexerWriter;
  private readonly confirmationLedgers: number;
  private readonly batchLimit: number;

  constructor(options: IndexerPollerOptions) {
    this.contractId = options.contractId;
    this.provider = options.provider;
    this.writer = options.writer;
    this.confirmationLedgers = options.confirmationLedgers ?? 2;
    this.batchLimit = options.batchLimit ?? 100;
  }

  /**
   * Executes one idempotent poll cycle, decoding events, updating database projections,
   * advancing the saved cursor, and promoting confirmed events to finalized.
   */
  async pollOnce(): Promise<{ fetched: number; applied: number; finalized: number }> {
    const cursorState = await this.writer.getCursor();

    let page: EventPageResponse;
    try {
      page = await this.provider.fetchEvents({
        contractId: this.contractId,
        cursor: cursorState.lastCursor || undefined,
        startLedger: cursorState.lastCursor ? undefined : Math.max(1, cursorState.lastLedger),
        limit: this.batchLimit,
      });
    } catch {
      // Handle RPC retention window cursor expiration by falling back to startLedger
      page = await this.provider.fetchEvents({
        contractId: this.contractId,
        startLedger: Math.max(1, cursorState.lastLedger),
        limit: this.batchLimit,
      });
    }

    const confirmedCutoff = page.latestLedger - this.confirmationLedgers;
    let appliedCount = 0;
    let highestLedger = cursorState.lastLedger;

    for (const rawEv of page.events) {
      highestLedger = Math.max(highestLedger, rawEv.ledger);
      const decoded = decodeRegistryEvent(rawEv);
      if (!decoded) continue;

      const isFinalized = decoded.ledger <= confirmedCutoff;
      const { applied } = await this.writer.applyEvent(decoded, isFinalized);
      if (applied) {
        appliedCount++;
      }
    }

    const newlyFinalized = await this.writer.finalizeEventsUpTo(confirmedCutoff);

    if (page.events.length > 0 || page.cursor) {
      await this.writer.saveCursor({
        lastLedger: Math.max(highestLedger, page.latestLedger),
        lastCursor: page.cursor || cursorState.lastCursor,
      });
    }

    return {
      fetched: page.events.length,
      applied: appliedCount,
      finalized: newlyFinalized,
    };
  }
}
