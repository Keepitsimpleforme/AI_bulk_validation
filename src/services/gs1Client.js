import axios from "axios";
import { config } from "../config.js";
import { withRetries } from "../lib/backoff.js";
import { metrics } from "../lib/metrics.js";
import { logger } from "../lib/logger.js";

const client = axios.create({
  baseURL: config.gs1.baseUrl,
  timeout: config.gs1.timeoutMs,
  headers: {
    Authorization: `Bearer ${config.gs1.token}`
  }
});

const isRetriableGs1Error = (error) => {
  const status = error?.response?.status;
  return !status || status === 429 || (status >= 500 && status <= 599);
};

/**
 * Normalizes date input to YYYY-MM-DD format for GS1 API.
 * Handles both date strings (YYYY-MM-DD) and ISO timestamps (YYYY-MM-DDTHH:mm:ss.sssZ).
 * For timestamps, uses the local date (not UTC) to match user's timezone intent.
 */
function normalizeDateForGs1(dateInput) {
  if (!dateInput) return dateInput;
  const str = String(dateInput);
  // If it's already YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // If it's an ISO timestamp, parse it and use local date
  // This handles cases where PostgreSQL DATE is read as UTC timestamp
  // e.g., "2026-02-19T18:30:00.000Z" (2026-02-20 00:00 IST) -> "2026-02-20"
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      // Use local date components to preserve user's intended date
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // Ignore parse errors
  }
  // Fallback: try to extract date part from string
  const dateMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1];
  }
  return str; // Return original if we can't normalize
}

export const fetchGs1Page = async ({ status, from, to, resultPerPage, cursor }) => {
  const params = {
    paginate: "cursor",
    status,
    resultperPage: resultPerPage
  };
  
  // Always normalize dates to YYYY-MM-DD format for GS1 API
  const fromDate = normalizeDateForGs1(from);
  let toDate = normalizeDateForGs1(to);
  // If from and to are the same date, append T23:59:59 to include full day
  if (fromDate === toDate && !toDate.includes("T")) {
    toDate = `${toDate}T23:59:59`;
  }
  
  // Always include date filters to ensure cursor pagination respects date range
  params.from = fromDate;
  params.to = toDate;
  
  // Include cursor if provided (for pagination)
  if (cursor) {
    params.cursor = cursor;
  }

  return withRetries({
    maxRetries: config.gs1.maxRetries,
    baseMs: config.gs1.backoffBaseMs,
    shouldRetry: isRetriableGs1Error,
    onRetry: (error, attempt, waitMs) => {
      metrics.retryTotal.inc({ component: "ingestion" }, 1);
      logger.warn(
        { attempt, waitMs, status: error?.response?.status },
        "retrying GS1 fetch"
      );
    },
    fn: async () => {
      const response = await client.get(config.gs1.productsPath, { params });
      const payload = response.data ?? {};
      const pageInfo = payload.pageInfo ?? {};
      const items = Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload.data)
          ? payload.data
          : Array.isArray(payload.products)
            ? payload.products
            : [];
      const nextCursor = payload.nextCursor ?? pageInfo.nextCursor ?? null;
      const hasNextPage =
        typeof payload.hasNextPage === "boolean"
          ? payload.hasNextPage
          : typeof pageInfo.hasNextPage === "boolean"
            ? pageInfo.hasNextPage
            : Boolean(nextCursor);
      metrics.gs1PagesFetchedTotal.inc(1);
      metrics.gs1ItemsFetchedTotal.inc(items.length);
      return {
        items,
        nextCursor,
        hasNextPage
      };
    }
  });
};
