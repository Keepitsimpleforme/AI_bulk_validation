import dotenv from "dotenv";

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: toNumber(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL ?? "info",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  gs1: {
    baseUrl: process.env.GS1_BASE_URL ?? "https://api.gs1datakart.org",
    productsPath: process.env.GS1_PRODUCTS_PATH ?? "/console/retailer/products",
    token: process.env.GS1_TOKEN ?? "",
    timeoutMs: toNumber(process.env.GS1_TIMEOUT_MS, 15000),
    maxRetries: toNumber(process.env.GS1_MAX_RETRIES, 5),
    backoffBaseMs: toNumber(process.env.GS1_BACKOFF_BASE_MS, 1000)
  },
  downstream: {
    url: process.env.DOWNSTREAM_URL ?? "",
    timeoutMs: toNumber(process.env.DOWNSTREAM_TIMEOUT_MS, 10000),
    maxRetries: toNumber(process.env.DELIVERY_MAX_RETRIES, 5),
    batchSize: toNumber(process.env.DELIVERY_BATCH_SIZE, 100),
    /** Delay in ms before delivery worker can process a batch (e.g. 2h = 7200000). Set via DELIVERY_DELAY_HOURS or DELIVERY_DELAY_MS. */
    delayMs: process.env.DELIVERY_DELAY_MS
      ? toNumber(process.env.DELIVERY_DELAY_MS, 0)
      : toNumber(process.env.DELIVERY_DELAY_HOURS, 0) * 60 * 60 * 1000
  },
  /** Hourly publish URL: cumulative validated results for the day (JSON) sent every hour. */
  hourlyPublishUrl: process.env.HOURLY_PUBLISH_URL ?? "",
  hourlyPublishTimeoutMs: toNumber(process.env.HOURLY_PUBLISH_TIMEOUT_MS, 30000),
  /** Main app: same as dashboard — PUT with { data: [ { GTIN_number, Status, Reason, Date } ] }. Sent every hour if set. */
  mainAppPublishUrl: process.env.MAIN_APP_PUBLISH_URL ?? "",
  /** Main use-case app: CSV with full column set sent every hour. POST body = CSV. Optional; use MAIN_APP_PUBLISH_URL for same format as dashboard. */
  mainAppCsvUrl: process.env.MAIN_APP_CSV_URL ?? "",
  mainAppCsvTimeoutMs: toNumber(process.env.MAIN_APP_CSV_TIMEOUT_MS, 60000),
  /** Base URL for the bulk API (used by scheduler to start runs). In Docker set to http://app:3000 */
  apiBaseUrl: process.env.API_BASE_URL ?? `http://127.0.0.1:${toNumber(process.env.PORT, 3000)}`,
  queue: {
    rawHighWatermark: toNumber(process.env.RAW_QUEUE_HIGH_WATERMARK, 200),
    rawConcurrency: toNumber(process.env.RAW_QUEUE_CONCURRENCY, 5),
    validatedConcurrency: toNumber(process.env.VALIDATED_QUEUE_CONCURRENCY, 5)
  }
};
