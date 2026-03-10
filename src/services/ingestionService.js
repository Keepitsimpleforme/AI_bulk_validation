import { randomUUID } from "node:crypto";
import { rawBatchesQueue } from "../lib/queues.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import { fetchGs1BackfillPage, fetchGs1Page } from "./gs1Client.js";
import {
  incrementRunCounters,
  insertBatchEvent,
  markIngestionCompleted,
  tryFinalizeRun,
  upsertCheckpoint
} from "../repositories/runRepository.js";
import { findExistingGtins } from "../repositories/validationRepository.js";

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

/**
 * Backfill ingestion: walk GS1 pending products in cursor mode sorted by modified_date asc.
 * Skips GTINs that already exist in validation_results to avoid duplicate validation.
 * Intended to be called from a manual script (no scheduler).
 */
export const ingestBackfillRun = async ({ runId, statusFilter, resultPerPage, startCursor }) => {
  let cursor = startCursor ?? null;
  let hasNext = true;
  let sourcePageSeq = 0;
  let totalPages = 0;
  let totalItems = 0;
  let totalEnqueued = 0;
  let totalSkipped = 0;

  const fromDateForPayload = new Date().toISOString().slice(0, 10);

  while (hasNext) {
    const waiting = await rawBatchesQueue.getWaitingCount();
    metrics.queueDepthRawBatches.set(waiting);
    if (waiting > config.queue.rawHighWatermark) {
      logger.warn({ runId, waiting }, "raw queue watermark exceeded; stopping backfill ingestion loop");
      break;
    }

    const page = await fetchGs1BackfillPage({
      status: statusFilter,
      resultPerPage,
      cursor
    });

    totalPages += 1;
    const items = page.items ?? [];
    totalItems += items.length;

    // Split items by GTIN presence
    const withGtins = [];
    const withoutGtins = [];
    for (const item of items) {
      const rawGtin = item?.gtin ?? item?.GTIN ?? item?.GTIN_number;
      const gtin = rawGtin != null ? String(rawGtin).trim() : "";
      if (gtin) {
        withGtins.push({ gtin, item });
      } else {
        withoutGtins.push(item);
      }
    }

    const gtinList = withGtins.map((x) => x.gtin);
    const existingSet = await findExistingGtins(gtinList);

    const itemsToEnqueue = [];
    for (const entry of withGtins) {
      if (!existingSet.has(entry.gtin)) {
        itemsToEnqueue.push(entry.item);
      } else {
        totalSkipped += 1;
      }
    }
    // Always enqueue items without GTIN for validation (cannot dedupe them)
    itemsToEnqueue.push(...withoutGtins);

    sourcePageSeq += 1;
    const batchId = randomUUID();

    if (itemsToEnqueue.length > 0) {
      totalEnqueued += itemsToEnqueue.length;

      await rawBatchesQueue.add("validate-batch", {
        runId,
        batchId,
        fromDate: fromDateForPayload,
        sourcePageSeq,
        cursorIn: cursor,
        cursorOut: page.nextCursor,
        items: itemsToEnqueue
      });

      await insertBatchEvent({
        batchId,
        runId,
        sourcePageSeq,
        itemsCount: itemsToEnqueue.length,
        cursorIn: cursor,
        cursorOut: page.nextCursor,
        eventType: "RAW_BATCH_ENQUEUED"
      });
    }

    await upsertCheckpoint(runId, sourcePageSeq, cursor, page.nextCursor);
    await incrementRunCounters(runId, {
      pages_fetched: 1,
      items_fetched: itemsToEnqueue.length
    });

    cursor = page.nextCursor;
    hasNext = page.hasNextPage;
  }

  await markIngestionCompleted(runId);
  await tryFinalizeRun(runId);

  logger.info(
    { runId, totalPages, totalItems, totalEnqueued, totalSkipped },
    "backfill ingestion completed"
  );

  return { totalPages, totalItems, totalEnqueued, totalSkipped };
};
