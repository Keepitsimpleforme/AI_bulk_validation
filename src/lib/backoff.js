import { setTimeout as delay } from "node:timers/promises";

export const jitteredBackoff = (attempt, baseMs) => {
  const exp = Math.max(0, attempt - 1);
  const raw = baseMs * (2 ** exp);
  const jitter = Math.floor(Math.random() * Math.max(50, raw * 0.2));
  return raw + jitter;
};

export const withRetries = async ({
  fn,
  maxRetries,
  baseMs,
  shouldRetry,
  onRetry
}) => {
  let attempt = 1;
  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }
      const waitMs = jitteredBackoff(attempt, baseMs);
      if (onRetry) {
        onRetry(error, attempt, waitMs);
      }
      await delay(waitMs);
      attempt += 1;
    }
  }
};
