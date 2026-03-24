import { Queue } from "bullmq";
import { redisConnection } from "./redis.js";

export const QUEUE_NAMES = {
  RAW_BATCHES: "raw_batches",
  VALIDATED_BATCHES: "validated_batches",
  DEAD_LETTER: "dead_letter"
};

export const rawBatchesQueue = new Queue(QUEUE_NAMES.RAW_BATCHES, {
  connection: redisConnection,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: 1000 }
});
export const validatedBatchesQueue = new Queue(QUEUE_NAMES.VALIDATED_BATCHES, {
  connection: redisConnection,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: 1000 }
});
export const deadLetterQueue = new Queue(QUEUE_NAMES.DEAD_LETTER, {
  connection: redisConnection,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: 1000 }
});
