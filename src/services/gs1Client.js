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

// fix dates to yyyy-mm-dd for gs1, adjusting timestamps to local time
function normalizeDateForGs1(dateInput) {
  if (!dateInput) return dateInput;
  const str = String(dateInput);
  // return straight away if format is correct
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // parse iso stamps correctly to local timezone
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      // pull local date pieces
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // skip bad dates
  }
  // fallback extraction
  const dateMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1];
  }
  return str; // bail out
}

export const fetchGs1Page = async ({ status, from, to, resultPerPage, cursor }) => {
  const params = {
    paginate: "cursor",
    status,
    resultperPage: resultPerPage,
    sortBy: "modified_date",
    sortDir: "asc"
  };
  
  // date filters turned off per dq team, keeping args just in case
  /*
  const fromDate = normalizeDateForGs1(from);
  let toDate = normalizeDateForGs1(to);
  if (fromDate === toDate && !toDate.includes("T")) {
    toDate = `${toDate}T23:59:59`;
  }
  params.from = fromDate;
  params.to = toDate;
  */
  
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

// fetch pending items for backfilling by oldest first
export const fetchGs1BackfillPage = async ({ status, resultPerPage, cursor, from, to }) => {
  const params = {
    paginate: "cursor",
    status,
    resultperPage: resultPerPage,
    sortBy: "created_date",
    sortDir: "asc"
  };

  const fromDate = normalizeDateForGs1(from);
  let toDate = normalizeDateForGs1(to);
  if (fromDate && toDate && fromDate === toDate && !toDate.includes("T")) {
    toDate = `${toDate}T23:59:59`;
  }

  if (fromDate) params.from = fromDate;
  if (toDate) params.to = toDate;

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
        "retrying GS1 backfill fetch"
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
