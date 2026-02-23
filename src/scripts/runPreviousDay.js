/**
 * Start a validation run for a date or date range (GS1 from/to) and produce outputs.
 * Uses cursor pagination (paginate=cursor); GS1 does not return totalResults in cursor mode.
 *
 * Usage:
 *   Single day (default: yesterday):
 *     node src/scripts/runPreviousDay.js [YYYY-MM-DD]
 *     npm run validate:day -- 2026-02-19
 *   Date range (same as API from/to, e.g. 2025-08-01 to 2026-01-12):
 *     node src/scripts/runPreviousDay.js YYYY-MM-DD YYYY-MM-DD
 *     npm run validate:day -- 2025-08-01 2026-01-12
 *   Env: DATE=YYYY-MM-DD or FROM=... and TO=...
 */
import axios from "axios";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { generateRunReport, generateDailySummary } from "../services/reportingService.js";

const API_BASE = `http://127.0.0.1:${config.port}`;

function getPreviousDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseDate(input) {
  if (!input || typeof input !== "string") return getPreviousDay();
  const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return getPreviousDay();
  const [, y, m, day] = match;
  const d = new Date(Number(y), Number(m) - 1, Number(day));
  if (Number.isNaN(d.getTime())) return getPreviousDay();
  return `${y}-${m}-${day}`;
}

/** Returns { from, to } (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss). Supports single day or range via args or env.
 * For single-day queries, appends T23:59:59 to 'to' to include the full day. */
function parseFromTo() {
  const fromEnv = process.env.FROM || process.env.DATE;
  const toEnv = process.env.TO;
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];
  let from, to;
  if (fromEnv && toEnv) {
    from = parseDate(fromEnv);
    to = parseDate(toEnv);
  } else if (arg1 && arg2) {
    from = parseDate(arg1);
    to = parseDate(arg2);
  } else {
    const single = parseDate(arg1 || fromEnv);
    from = single;
    to = single;
  }
  // If single day (from === to) and 'to' is date-only (no time), append T23:59:59 to include full day
  if (from === to && !to.includes("T")) {
    to = `${to}T23:59:59`;
  }
  return { from, to };
}

async function waitForRun(runId, maxWaitMs = 600_000, pollMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const { data } = await axios.get(`${API_BASE}/v1/runs/${runId}`);
    const status = data.status;
    if (status === "SUCCESS" || status === "PARTIAL_FAILED" || status === "FAILED") {
      return data;
    }
    logger.info({ runId, status, items_fetched: data.items_fetched, validated_count: data.validated_count }, "waiting for run");
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Run ${runId} did not complete within ${maxWaitMs / 1000}s`);
}

async function main() {
  const { from, to } = parseFromTo();
  const isRange = from !== to;
  logger.info({ from, to, isRange }, "starting validation run");

  const { data: createRes } = await axios.post(`${API_BASE}/v1/runs`, {
    status: "pending",
    from,
    to,
    resultPerPage: 100
  });
  const runId = createRes.runId;
  logger.info({ runId, from, to }, "run started");

  const run = await waitForRun(runId);
  logger.info({ runId, status: run.status, items_fetched: run.items_fetched, validated_count: run.validated_count }, "run finished");

  const { report, jsonPath, csvPath, resultsCsvPath } = await generateRunReport(runId);
  logger.info({ runId, jsonPath, csvPath, resultsCsvPath }, "run report written");

  const runStartDate = run.start_time ? String(run.start_time).slice(0, 10) : from;
  const { jsonPath: dailyJson, csvPath: dailyCsv } = await generateDailySummary(runStartDate);
  logger.info({ date: runStartDate, jsonPath: dailyJson, csvPath: dailyCsv }, "daily summary written");

  const dateLabel = isRange ? `${from} to ${to}` : from;
  console.log("\n--- Outputs ---");
  console.log("Run summary report (data " + dateLabel + "):", jsonPath, csvPath);
  console.log("Detailed validation results CSV (all products):", resultsCsvPath);
  console.log("Daily summary (run date " + runStartDate + "):", dailyJson, dailyCsv);
  console.log("\n--- Summary ---");
  console.log("Run status:", report.status);
  console.log("Items fetched:", report.pages_fetched, "pages,", report.items_fetched, "items");
  console.log("Validated:", report.validated, "| Accepted:", report.accepted, "| Rejected:", report.rejected);
  console.log("Delivered:", report.delivered, "| Delivery failed:", report.delivery_failed);
  console.log("\nDownload detailed CSV via API:");
  console.log(`  curl http://localhost:${config.port}/v1/runs/${runId}/results.csv -o validation_results.csv`);
}

main().catch((err) => {
  logger.error({ err }, "run previous day failed");
  process.exit(1);
});
