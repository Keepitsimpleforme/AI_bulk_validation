import { Worker } from "bullmq";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { QUEUE_NAMES } from "../lib/queues.js";
import { redisConnection } from "../lib/redis.js";
import { deliverValidatedBatch } from "../services/deliveryService.js";

const worker = new Worker(
  QUEUE_NAMES.VALIDATED_BATCHES,
  async (job) => {
    await deliverValidatedBatch(job.data);
  },
  {
    connection: redisConnection,
    concurrency: config.queue.validatedConcurrency
  }
);

worker.on("completed", (job) => logger.info({ jobId: job.id }, "delivery job completed"));
worker.on("failed", (job, err) =>
  logger.error({ jobId: job?.id, err }, "delivery job failed")
);

async function shutdown(signal) {
  logger.info({ signal }, "delivery worker shutting down");
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
