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
  recoveryChunkSize?: number;
  onWarning?: (message: string) => void;
}

export class IndexerPoller {
  private readonly contractId: string;
  private readonly provider: SorobanEventsProvider;
  private readonly writer: IndexerWriter;
  private readonly confirmationLedgers: number;
  private readonly batchLimit: number;
  private readonly recoveryChunkSize: number;
  private readonly warn: (message: string) => void;

  constructor(options: IndexerPollerOptions) {
    this.contractId = options.contractId;
    this.provider = options.provider;
    this.writer = options.writer;
    this.confirmationLedgers = options.confirmationLedgers ?? 2;
    this.batchLimit = options.batchLimit ?? 100;
    this.recoveryChunkSize =
      options.recoveryChunkSize ?? Math.max(1, Math.floor(this.batchLimit / 4));
    this.warn = options.onWarning ?? ((msg: string) => console.warn(msg));
  }

  /**
   * Detects sequence gaps in an incoming event stream relative to `baselineLedger`.
   * Returns the first gap `{ lastContiguousLedger, skippedToLedger }` if found, or `null`.
   */
  private findFirstLedgerGap(
    baselineLedger: number,
    events: RawSorobanEvent[],
  ): { lastContiguousLedger: number; skippedToLedger: number } | null {
    if (events.length === 0) {
      return null;
    }

    let expectedPrev = baselineLedger > 0 ? baselineLedger : events[0]!.ledger;

    for (const ev of events) {
      if (ev.ledger > expectedPrev + 1) {
        return {
          lastContiguousLedger: expectedPrev,
          skippedToLedger: ev.ledger,
        };
      }
      if (ev.ledger > expectedPrev) {
        expectedPrev = ev.ledger;
      }
    }

    return null;
  }

  /**
   * Executes one idempotent poll cycle, detecting ledger sequence gaps or RPC rollbacks,
   * rewinding and re-fetching with smaller block chunks if needed, decoding events,
   * updating database projections, advancing the saved cursor, and promoting confirmed events.
   */
  async pollOnce(): Promise<{
    fetched: number;
    applied: number;
    finalized: number;
    gapsRecovered?: number;
    rolledBack?: number;
  }> {
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

    let rolledBack = 0;
    let gapsRecovered = 0;

    // 1. Detect RPC node divergence / reorganization where latestLedger regressed behind lastLedger
    if (cursorState.lastLedger > 0 && page.latestLedger < cursorState.lastLedger) {
      const rewindLedger = Math.max(0, page.latestLedger);
      this.warn(
        `[IndexerPoller] RPC ledger regression detected: latestLedger=${page.latestLedger} < cursor.lastLedger=${cursorState.lastLedger}. Rolling back unfinalized events above ledger ${rewindLedger} and rewinding cursor.`,
      );
      if (this.writer.rollbackEventsAfterLedger) {
        rolledBack = await this.writer.rollbackEventsAfterLedger(rewindLedger);
      }
      await this.writer.saveCursor({
        lastLedger: rewindLedger,
        lastCursor: "",
      });
      page = await this.provider.fetchEvents({
        contractId: this.contractId,
        startLedger: Math.max(1, rewindLedger),
        limit: this.recoveryChunkSize,
      });
    }

    // 2. Detect ledger sequence gaps (`current_ledger > last_contiguous_ledger + 1`)
    const gap = this.findFirstLedgerGap(cursorState.lastLedger, page.events);
    let eventsToProcess = page.events;
    let finalCursor = page.cursor;
    let latestLedger = page.latestLedger;

    if (gap) {
      gapsRecovered++;
      this.warn(
        `[IndexerPoller] Ledger sequence gap detected between ledger ${gap.lastContiguousLedger} and ${gap.skippedToLedger}. Quarantining gap [${gap.lastContiguousLedger + 1}..${gap.skippedToLedger - 1}] and rewinding cursor to ${gap.lastContiguousLedger}.`,
      );

      if (this.writer.recordGapQuarantine) {
        await this.writer.recordGapQuarantine({
          fromLedger: gap.lastContiguousLedger + 1,
          toLedger: gap.skippedToLedger - 1,
          detectedAt: new Date().toISOString(),
        });
      }

      // Rewind saved cursor to lastContiguousLedger and re-fetch in smaller chunks
      await this.writer.saveCursor({
        lastLedger: gap.lastContiguousLedger,
        lastCursor: "",
      });

      const recoveredEvents: RawSorobanEvent[] = [];
      for (const ev of page.events) {
        if (ev.ledger <= gap.lastContiguousLedger) {
          recoveredEvents.push(ev);
        }
      }

      const recoveryPage = await this.provider.fetchEvents({
        contractId: this.contractId,
        startLedger: gap.lastContiguousLedger + 1,
        limit: this.recoveryChunkSize,
      });

      latestLedger = Math.max(latestLedger, recoveryPage.latestLedger);
      if (recoveryPage.cursor) {
        finalCursor = recoveryPage.cursor;
      }

      // Merge contiguous prefix, recovered gap events, and remaining original events in ledger order
      const mergedById = new Map<string, RawSorobanEvent>();
      for (const ev of [...recoveredEvents, ...recoveryPage.events, ...page.events]) {
        mergedById.set(ev.id, ev);
      }
      eventsToProcess = Array.from(mergedById.values()).sort((a, b) =>
        a.ledger !== b.ledger ? a.ledger - b.ledger : a.id.localeCompare(b.id),
      );
    }

    const confirmedCutoff = latestLedger - this.confirmationLedgers;
    let appliedCount = 0;
    let highestLedger = cursorState.lastLedger;

    for (const rawEv of eventsToProcess) {
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

    if (eventsToProcess.length > 0 || finalCursor) {
      await this.writer.saveCursor({
        lastLedger: Math.max(highestLedger, latestLedger),
        lastCursor: finalCursor || cursorState.lastCursor,
      });
    }

    return {
      fetched: eventsToProcess.length,
      applied: appliedCount,
      finalized: newlyFinalized,
      ...(gapsRecovered > 0 ? { gapsRecovered } : {}),
      ...(rolledBack > 0 ? { rolledBack } : {}),
    };
  }

  /**
   * Backfills contract events across a historical ledger range `[fromLedger, toLedger]`,
   * paginating by cursor until `toLedger` is reached.
   */
  async backfillRange(
    fromLedger: number,
    toLedger: number,
  ): Promise<{ pages: number; fetched: number; applied: number }> {
    if (fromLedger <= 0 || toLedger < fromLedger) {
      throw new Error("Invalid backfill ledger range");
    }

    let cursor: string | undefined;
    let currentStart = fromLedger;
    let pages = 0;
    let totalFetched = 0;
    let totalApplied = 0;

    while (currentStart <= toLedger) {
      const page = await this.provider.fetchEvents({
        contractId: this.contractId,
        cursor,
        startLedger: cursor ? undefined : currentStart,
        limit: this.batchLimit,
      });
      pages++;

      if (page.events.length === 0) {
        break;
      }

      const confirmedCutoff = page.latestLedger - this.confirmationLedgers;
      let maxEventLedger = currentStart;

      for (const rawEv of page.events) {
        maxEventLedger = Math.max(maxEventLedger, rawEv.ledger);
        if (rawEv.ledger > toLedger) continue;
        totalFetched++;

        const decoded = decodeRegistryEvent(rawEv);
        if (!decoded) continue;

        const isFinalized = decoded.ledger <= confirmedCutoff;
        const { applied } = await this.writer.applyEvent(decoded, isFinalized);
        if (applied) {
          totalApplied++;
        }
      }

      await this.writer.saveCursor({
        lastLedger: Math.min(maxEventLedger, toLedger),
        lastCursor: page.cursor || cursor || "",
      });

      if (maxEventLedger >= toLedger || !page.cursor || page.cursor === cursor) {
        break;
      }
      cursor = page.cursor;
      currentStart = maxEventLedger;
    }

    return { pages, fetched: totalFetched, applied: totalApplied };
  }
}
