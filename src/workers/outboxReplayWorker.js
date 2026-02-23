import { logger } from "../lib/logger.js";
import { replayOutbox } from "../services/deliveryService.js";

const start = async () => {
  try {
    await replayOutbox();
    logger.info("outbox replay completed");
  } catch (error) {
    logger.error({ err: error }, "outbox replay failed");
    process.exit(1);
  }
};

start();
