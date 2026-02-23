import IORedis from "ioredis";
import { config } from "../config.js";

export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null
});
