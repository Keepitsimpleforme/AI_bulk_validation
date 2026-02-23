/**
 * Live monitoring script for a validation run.
 * Polls run status and GS1 API to track progress and verify catch-up with new data.
 *
 * Usage:
 *   node src/scripts/monitorRun.js [runId]
 *   node src/scripts/monitorRun.js --date 2026-02-20  (monitors latest run for date)
 */

import axios from "axios";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = `http://127.0.0.1:${config.port}`;
const GS1_BASE = config.gs1.baseUrl;
const GS1_TOKEN = config.gs1.token;

async function getRunStatus(runId) {
  try {
    const { data } = await axios.get(`${API_BASE}/v1/runs/${runId}`);
    return data;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

async function getGs1TotalCount(status, from, to) {
  try {
    // Extract date part (YYYY-MM-DD) from ISO string or date
    const fromDate = typeof from === "string" ? from.split("T")[0] : from;
    const toDate = typeof to === "string" ? to.split("T")[0] : to;
    
    const params = {
      status,
      from: fromDate,
      to: fromDate === toDate ? `${toDate}T23:59:59` : toDate, // Full day if same date
      resultperPage: 10
    };
    const { data } = await axios.get(`${GS1_BASE}${config.gs1.productsPath}`, {
      params,
      timeout: 10000,
      headers: { Authorization: `Bearer ${GS1_TOKEN}` }
    });
    const pageInfo = data?.pageInfo || {};
    return {
      totalResults: pageInfo.totalResults || 0,
      currentPageResults: pageInfo.currentPageResults || 0
    };
  } catch (error) {
    logger.warn({ error: error.message, status: error.response?.status }, "failed to fetch GS1 total count");
    return { totalResults: null, currentPageResults: null };
  }
}

async function findLatestRunForDate(date) {
  try {
    // Query all runs and find the latest one for the given date
    // Since we don't have a date filter endpoint, we'll need to check recent runs
    // For now, we'll require runId to be passed
    return null;
  } catch (error) {
    return null;
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function printStatus(run, gs1Count, startTime) {
  clearScreen();
  const elapsed = Date.now() - startTime;
  const runDate = run.from_date || "N/A";
  const toDate = run.to_date || runDate;

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          LIVE VALIDATION MONITORING                            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nRun ID: ${run.run_id}`);
  console.log(`Date Range: ${runDate} ${toDate !== runDate ? `to ${toDate}` : ""}`);
  console.log(`Status: ${run.status || "UNKNOWN"}`);
  console.log(`Elapsed: ${formatDuration(elapsed)}`);
  console.log("\n─ Progress ────────────────────────────────────────────────────");
  console.log(`  Pages Fetched:     ${run.pages_fetched || 0}`);
  console.log(`  Items Fetched:     ${run.items_fetched || 0}`);
  console.log(`  Validated:         ${run.validated_count || 0}`);
  console.log(`  Accepted:          ${run.accepted_count || 0}`);
  console.log(`  Rejected:          ${run.rejected_count || 0}`);
  console.log(`  Delivered:          ${run.delivered_count || 0}`);
  console.log(`  Delivery Failed:   ${run.delivery_failed_count || 0}`);
  console.log("\n─ GS1 API Status ──────────────────────────────────────────────");
  if (gs1Count.totalResults !== null) {
    const fetched = run.items_fetched || 0;
    const total = gs1Count.totalResults;
    const remaining = Math.max(0, total - fetched);
    const percent = total > 0 ? ((fetched / total) * 100).toFixed(1) : 0;
    console.log(`  Total in GS1:      ${total}`);
    console.log(`  Fetched:           ${fetched}`);
    console.log(`  Remaining:         ${remaining}`);
    console.log(`  Progress:          ${percent}%`);
    if (remaining > 0 && run.status === "RUNNING") {
      console.log(`  ⚡ Catching up...  ${remaining} items pending`);
    } else if (remaining === 0 && run.status === "RUNNING") {
      console.log(`  ✓ All items fetched, validating...`);
    }
  } else {
    console.log(`  GS1 API:           Unable to fetch`);
  }
  console.log("\n─ Timestamps ──────────────────────────────────────────────────");
  if (run.start_time) {
    console.log(`  Started:           ${new Date(run.start_time).toLocaleString()}`);
  }
  if (run.end_time) {
    console.log(`  Completed:         ${new Date(run.end_time).toLocaleString()}`);
  }
  if (run.last_checkpoint_at) {
    console.log(`  Last Checkpoint:   ${new Date(run.last_checkpoint_at).toLocaleString()}`);
  }
  console.log(`\n  [Press Ctrl+C to stop monitoring]\n`);
}

async function monitorRun(runId, pollIntervalMs = 3000) {
  const startTime = Date.now();
  let lastItemsFetched = 0;
  let lastGs1Total = null;
  let consecutiveNoProgress = 0;

  console.log(`Starting monitoring for run: ${runId}`);
  console.log(`Polling every ${pollIntervalMs / 1000}s...\n`);

  while (true) {
    try {
      const run = await getRunStatus(runId);
      if (!run) {
        console.error(`\n❌ Run ${runId} not found!`);
        process.exit(1);
      }

      // Get GS1 total count for comparison
      const gs1Count = await getGs1TotalCount(
        run.status_filter || "pending",
        run.from_date,
        run.to_date
      );

      printStatus(run, gs1Count, startTime);

      // Check if run completed
      if (run.status === "SUCCESS" || run.status === "PARTIAL_FAILED" || run.status === "FAILED") {
        console.log("\n╔════════════════════════════════════════════════════════════════╗");
        console.log(`║  Run ${run.status === "SUCCESS" ? "COMPLETED" : "FINISHED"} - ${run.status}  ║`);
        console.log("╚════════════════════════════════════════════════════════════════╝");
        if (gs1Count.totalResults !== null) {
          const fetched = run.items_fetched || 0;
          const total = gs1Count.totalResults;
          if (fetched < total) {
            console.log(`\n⚠️  Note: GS1 now has ${total} items, but we fetched ${fetched}.`);
            console.log(`   This is normal - new items were added after the run started.`);
            console.log(`   To catch up, start a new run or resume this one.`);
          } else {
            console.log(`\n✓ All available items processed (${fetched}/${total})`);
          }
        }
        break;
      }

      // Detect if we're making progress
      const currentItems = run.items_fetched || 0;
      if (currentItems === lastItemsFetched && run.status === "RUNNING") {
        consecutiveNoProgress++;
        if (consecutiveNoProgress > 10) {
          console.log("\n⚠️  Warning: No progress detected for 30+ seconds.");
          console.log("   The run may be stuck or waiting for data.");
        }
      } else {
        consecutiveNoProgress = 0;
      }
      lastItemsFetched = currentItems;

      // Check if GS1 total increased (new data arrived)
      if (gs1Count.totalResults !== null) {
        if (lastGs1Total !== null && gs1Count.totalResults > lastGs1Total) {
          const newItems = gs1Count.totalResults - lastGs1Total;
          console.log(`\n🆕 New data detected: +${newItems} items in GS1 (total: ${gs1Count.totalResults})`);
          console.log(`   Our system should catch up via cursor pagination...`);
        }
        lastGs1Total = gs1Count.totalResults;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      console.error("\n❌ Error monitoring run:", error.message);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

async function main() {
  let runId = process.argv[2];
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const date = dateArg ? dateArg.split("=")[1] : null;

  if (!runId && date) {
    // Try to find latest run for date (simplified - would need DB query)
    console.error("Please provide runId. Finding runs by date not yet implemented.");
    process.exit(1);
  }

  if (!runId) {
    console.error("Usage: node src/scripts/monitorRun.js <runId>");
    console.error("   or: node src/scripts/monitorRun.js --date=YYYY-MM-DD");
    process.exit(1);
  }

  // Remove --date= prefix if present
  if (runId.startsWith("--date=")) {
    console.error("Please provide runId. Finding runs by date not yet implemented.");
    process.exit(1);
  }

  await monitorRun(runId);
}

main().catch((err) => {
  logger.error({ err }, "monitor failed");
  process.exit(1);
});
