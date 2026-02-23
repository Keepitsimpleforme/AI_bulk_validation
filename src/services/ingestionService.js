import { randomUUID } from "node:crypto";
import { rawBatchesQueue } from "../lib/queues.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import { fetchGs1Page } from "./gs1Client.js";
import {
  incrementRunCounters,
  insertBatchEvent,
  markIngestionCompleted,
  tryFinalizeRun,
  upsertCheckpoint
} from "../repositories/runRepository.js";

export const ingestRun = async ({ runId, statusFilter, from, to, resultPerPage, startCursor }) => {
  let cursor = startCursor ?? null;
  let hasNext = true;
  let sourcePageSeq = 0;

  while (hasNext) {
    const waiting = await rawBatchesQueue.getWaitingCount();
    metrics.queueDepthRawBatches.set(waiting);
    if (waiting > config.queue.rawHighWatermark) {
      logger.warn({ runId, waiting }, "raw queue watermark exceeded; stopping ingestion loop");
      break;
    }

    const page = await fetchGs1Page({
      status: statusFilter,
      from,
      to,
      resultPerPage,
      cursor
    });
    sourcePageSeq += 1;
    const batchId = randomUUID();

    await rawBatchesQueue.add("validate-batch", {
      runId,
      batchId,
      fromDate: from,
      sourcePageSeq,
      cursorIn: cursor,
      cursorOut: page.nextCursor,
      items: page.items
    });

    await insertBatchEvent({
      batchId,
      runId,
      sourcePageSeq,
      itemsCount: page.items.length,
      cursorIn: cursor,
      cursorOut: page.nextCursor,
      eventType: "RAW_BATCH_ENQUEUED"
    });

    await upsertCheckpoint(runId, sourcePageSeq, cursor, page.nextCursor);
    await incrementRunCounters(runId, {
      pages_fetched: 1,
      items_fetched: page.items.length
    });

    cursor = page.nextCursor;
    hasNext = page.hasNextPage;
  }

  await markIngestionCompleted(runId);
  await tryFinalizeRun(runId);
};
