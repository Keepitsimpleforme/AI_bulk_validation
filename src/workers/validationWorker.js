import { Worker } from "bullmq";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { QUEUE_NAMES, rawBatchesQueue, validatedBatchesQueue } from "../lib/queues.js";
import { redisConnection } from "../lib/redis.js";
import { metrics } from "../lib/metrics.js";
import { processRawBatch } from "../services/validationService.js";

const worker = new Worker(
  QUEUE_NAMES.RAW_BATCHES,
  async (job) => {
    await processRawBatch(job.data);
    const [rawWaiting, validatedWaiting] = await Promise.all([
      rawBatchesQueue.getWaitingCount(),
      validatedBatchesQueue.getWaitingCount()
    ]);
    metrics.queueDepthRawBatches.set(rawWaiting);
    metrics.queueDepthValidatedBatches.set(validatedWaiting);
  },
  {
    connection: redisConnection,
    concurrency: config.queue.rawConcurrency
  }
);

worker.on("completed", (job) => logger.info({ jobId: job.id }, "validation job completed"));
worker.on("failed", (job, err) =>
  logger.error({ jobId: job?.id, err }, "validation job failed")
);

async function shutdown(signal) {
  logger.info({ signal }, "validation worker shutting down");
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
