import axios from "axios";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { withRetries } from "../lib/backoff.js";
import { metrics } from "../lib/metrics.js";
import { logger } from "../lib/logger.js";
import {
  createOutboxRecord,
  getDueOutboxRecords,
  markOutboxDelivered,
  saveIdempotencyKeys,
  updateOutboxRetry
} from "../repositories/deliveryRepository.js";
import { incrementRunCounters, tryFinalizeRun } from "../repositories/runRepository.js";

const deliveryClient = axios.create({
  timeout: config.downstream.timeoutMs
});

const isRetriableDeliveryError = (error) => {
  const status = error?.response?.status;
  return !status || status === 429 || (status >= 500 && status <= 599);
};

const calculateIdempotencyKey = (record) => {
  const raw = `${record.gtin ?? ""}|${record.validationStatus ?? ""}`;
  return createHash("sha256").update(raw).digest("hex");
};

export const deliverValidatedBatch = async ({ runId, batchId, validatedRecords }) => {
  if (!config.downstream.url) {
    logger.debug("DOWNSTREAM_URL not set; skipping delivery");
    return;
  }
  const payload = { data: validatedRecords };

  try {
    await withRetries({
      maxRetries: config.downstream.maxRetries,
      baseMs: 2000,
      shouldRetry: isRetriableDeliveryError,
      onRetry: (error, attempt, waitMs) => {
        metrics.retryTotal.inc({ component: "delivery" }, 1);
        logger.warn(
          { attempt, waitMs, status: error?.response?.status, runId, batchId },
          "retrying downstream delivery"
        );
      },
      fn: async () => {
        await deliveryClient.put(config.downstream.url, payload);
      }
    });

    const keys = validatedRecords.map((record) => ({
      idempotencyKey: calculateIdempotencyKey(record),
      runId,
      batchId,
      status: "DELIVERED"
    }));
    await saveIdempotencyKeys(keys);
    await incrementRunCounters(runId, {
      delivered_count: validatedRecords.length
    });
    await tryFinalizeRun(runId);
    metrics.deliverySuccessTotal.inc(validatedRecords.length);
  } catch (error) {
    metrics.deliveryFailedTotal.inc(validatedRecords.length);
    await incrementRunCounters(runId, {
      delivery_failed_count: validatedRecords.length
    });

    const nextRetryAt = new Date(Date.now() + 2 * 60 * 1000);
    await createOutboxRecord({
      runId,
      batchId,
      payload,
      errorText: error.message,
      nextRetryAt
    });
    throw error;
  }
};

export const replayOutbox = async () => {
  const records = await getDueOutboxRecords(50);
  for (const record of records) {
    try {
      await deliveryClient.put(config.downstream.url, record.payload);
      await markOutboxDelivered(record.outbox_id);
      await tryFinalizeRun(record.run_id);
    } catch (error) {
      const attempts = Number(record.attempts) + 1;
      const delayMs = Math.min(2 ** attempts * 1000, 10 * 60 * 1000);
      await updateOutboxRetry(
        record.outbox_id,
        attempts,
        new Date(Date.now() + delayMs),
        error.message
      );
    }
  }
};
