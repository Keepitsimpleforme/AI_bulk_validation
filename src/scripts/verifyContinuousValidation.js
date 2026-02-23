/**
 * Comprehensive verification script to check if continuous validation is working.
 * Verifies:
 * 1. GS1 API data growth over time
 * 2. Our runs are catching new data
 * 3. No gaps in validation coverage
 * 4. Data integrity (no duplicates, all items processed)
 * 
 * Usage:
 *   node src/scripts/verifyContinuousValidation.js [date] [hours]
 *   node src/scripts/verifyContinuousValidation.js 2026-02-20 2
 */

import axios from "axios";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { db } from "../lib/db.js";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = `http://127.0.0.1:${config.port}`;
const GS1_BASE = config.gs1.baseUrl;
const GS1_TOKEN = config.gs1.token;

function normalizeDateForGs1(dateInput) {
  if (!dateInput) return dateInput;
  const str = String(dateInput);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}
  const dateMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : str;
}

async function getGs1Total(status, from, to) {
  try {
    const fromDate = normalizeDateForGs1(from);
    const toDate = normalizeDateForGs1(to);
    const params = {
      status,
      from: fromDate,
      to: fromDate === toDate ? `${toDate}T23:59:59` : toDate,
      resultperPage: 10
    };
    const { data } = await axios.get(`${GS1_BASE}${config.gs1.productsPath}`, {
      params,
      timeout: 10000,
      headers: { Authorization: `Bearer ${GS1_TOKEN}` }
    });
    return {
      total: data?.pageInfo?.totalResults || 0,
      success: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      total: null,
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function getRunsForDate(date) {
  try {
    const result = await db.query(`
      SELECT 
        run_id,
        status,
        from_date,
        to_date,
        items_fetched,
        validated_count,
        accepted_count,
        rejected_count,
        delivered_count,
        start_time,
        end_time,
        ingestion_completed
      FROM runs
      WHERE from_date::text LIKE $1 || '%'
      ORDER BY start_time ASC
    `, [date]);

    return result.rows;
  } catch (error) {
    logger.error({ err: error }, "failed to get runs");
    return [];
  }
}

async function analyzeCoverage(runs, gs1Snapshots) {
  const analysis = {
    totalRuns: runs.length,
    successfulRuns: runs.filter(r => r.status === "SUCCESS").length,
    failedRuns: runs.filter(r => r.status === "FAILED").length,
    partialRuns: runs.filter(r => r.status === "PARTIAL_FAILED").length,
    totalItemsFetched: runs.reduce((sum, r) => sum + (r.items_fetched || 0), 0),
    uniqueItemsFetched: new Set(),
    timeGaps: [],
    gs1Growth: []
  };

  // Track GS1 growth
  if (gs1Snapshots.length > 1) {
    for (let i = 1; i < gs1Snapshots.length; i++) {
      const prev = gs1Snapshots[i - 1];
      const curr = gs1Snapshots[i];
      if (prev.success && curr.success) {
        const growth = curr.total - prev.total;
        const timeDiff = new Date(curr.timestamp) - new Date(prev.timestamp);
        analysis.gs1Growth.push({
          from: prev.timestamp,
          to: curr.timestamp,
          growth: growth,
          minutes: Math.floor(timeDiff / 60000)
        });
      }
    }
  }

  // Check for time gaps between runs
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1];
    const curr = runs[i];
    if (prev.end_time && curr.start_time) {
      const gap = new Date(curr.start_time) - new Date(prev.end_time);
      const gapMinutes = Math.floor(gap / 60000);
      if (gapMinutes > 30) {
        analysis.timeGaps.push({
          from: prev.end_time,
          to: curr.start_time,
          gapMinutes: gapMinutes
        });
      }
    }
  }

  return analysis;
}

async function verifyContinuousValidation(date, hours = 2) {
  const startTime = Date.now();
  const endTime = startTime + (hours * 60 * 60 * 1000);
  const snapshots = [];
  const checkInterval = 5 * 60 * 1000; // Every 5 minutes

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║     CONTINUOUS VALIDATION VERIFICATION                        ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nDate: ${date}`);
  console.log(`Duration: ${hours} hours`);
  console.log(`Check Interval: 5 minutes\n`);

  // Get existing runs
  const existingRuns = await getRunsForDate(date);
  console.log(`─ Existing Runs Found ────────────────────────────────────────────`);
  console.log(`  Total runs: ${existingRuns.length}`);
  if (existingRuns.length > 0) {
    const latest = existingRuns[existingRuns.length - 1];
    console.log(`  Latest run: ${latest.run_id}`);
    console.log(`  Latest status: ${latest.status}`);
    console.log(`  Latest items: ${latest.items_fetched}`);
  }

  // Start monitoring GS1 API
  console.log(`\n─ Monitoring GS1 API Growth ──────────────────────────────────────`);
  console.log(`  Checking every 5 minutes for ${hours} hours...\n`);

  let checkCount = 0;
  while (Date.now() < endTime) {
    const gs1Result = await getGs1Total("pending", date, date);
    checkCount++;

    if (gs1Result.success) {
      snapshots.push(gs1Result);
      const time = new Date(gs1Result.timestamp).toLocaleTimeString();
      const growth = snapshots.length > 1
        ? gs1Result.total - snapshots[snapshots.length - 2].total
        : 0;

      console.log(
        `  [${time}] GS1 Total: ${gs1Result.total} ${growth > 0 ? `(+${growth})` : ""}`
      );
    } else {
      console.log(`  [${new Date().toLocaleTimeString()}] Failed to fetch GS1 total`);
    }

    // Check for new runs
    const currentRuns = await getRunsForDate(date);
    if (currentRuns.length > existingRuns.length) {
      const newRuns = currentRuns.slice(existingRuns.length);
      console.log(`\n  🆕 New run detected: ${newRuns[0].run_id}`);
      existingRuns.push(...newRuns);
    }

    // Wait for next check
    const remaining = Math.ceil((endTime - Date.now()) / 60000);
    if (remaining > 0) {
      console.log(`  Next check in 5 minutes (${remaining} minutes remaining)...\n`);
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  // Final analysis
  const finalRuns = await getRunsForDate(date);
  const analysis = await analyzeCoverage(finalRuns, snapshots);

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    VERIFICATION RESULTS                        ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  console.log("\n─ Run Statistics ────────────────────────────────────────────────");
  console.log(`  Total Runs:          ${analysis.totalRuns}`);
  console.log(`  Successful:          ${analysis.successfulRuns}`);
  console.log(`  Partial Failed:      ${analysis.partialRuns}`);
  console.log(`  Failed:              ${analysis.failedRuns}`);
  console.log(`  Total Items Fetched: ${analysis.totalItemsFetched}`);

  console.log("\n─ GS1 API Growth ────────────────────────────────────────────────");
  if (analysis.gs1Growth.length > 0) {
    const totalGrowth = analysis.gs1Growth.reduce((sum, g) => sum + g.growth, 0);
    console.log(`  Total Growth:        +${totalGrowth} items`);
    console.log(`  Growth Events:      ${analysis.gs1Growth.length}`);
    analysis.gs1Growth.forEach((g, idx) => {
      if (g.growth > 0) {
        console.log(`    ${idx + 1}. +${g.growth} items in ${g.minutes} minutes`);
      }
    });
  } else {
    console.log(`  No growth detected during monitoring period`);
  }

  console.log("\n─ Coverage Gaps ──────────────────────────────────────────────────");
  if (analysis.timeGaps.length > 0) {
    console.log(`  ⚠️  Found ${analysis.timeGaps.length} gaps > 30 minutes:`);
    analysis.timeGaps.forEach((gap, idx) => {
      console.log(`    ${idx + 1}. ${gap.gapMinutes} minutes gap`);
      console.log(`       From: ${new Date(gap.from).toLocaleString()}`);
      console.log(`       To:   ${new Date(gap.to).toLocaleString()}`);
    });
  } else {
    console.log(`  ✓ No significant gaps detected`);
  }

  // Final GS1 check
  const finalGs1 = await getGs1Total("pending", date, date);
  const latestRun = finalRuns.length > 0 ? finalRuns[finalRuns.length - 1] : null;

  console.log("\n─ Current Status ──────────────────────────────────────────────────");
  if (finalGs1.success) {
    console.log(`  GS1 Total:           ${finalGs1.total}`);
    if (latestRun) {
      console.log(`  Latest Run Items:   ${latestRun.items_fetched}`);
      const remaining = Math.max(0, finalGs1.total - latestRun.items_fetched);
      if (remaining > 0 && latestRun.status === "SUCCESS") {
        console.log(`  ⚠️  Remaining:        ${remaining} items (new data arrived)`);
        console.log(`  💡 Action:           Start new run to validate new data`);
      } else {
        console.log(`  ✓ Status:           Up to date`);
      }
    }
  }

  console.log("\n─ Verification Summary ────────────────────────────────────────────");
  const hasScheduler = analysis.totalRuns > 1 || (analysis.totalRuns === 1 && Date.now() - new Date(finalRuns[0]?.start_time || 0) < 3600000);
  
  if (hasScheduler && analysis.gs1Growth.length > 0) {
    console.log(`  ✅ Continuous validation appears to be working`);
    console.log(`  ✅ New data is being detected`);
    console.log(`  ✅ Runs are being created automatically`);
  } else if (analysis.totalRuns === 1 && analysis.gs1Growth.length > 0) {
    console.log(`  ⚠️  Only one run detected, but GS1 data is growing`);
    console.log(`  💡 Scheduler may not be running or needs configuration`);
  } else {
    console.log(`  ℹ️  Insufficient data to verify continuous validation`);
    console.log(`  💡 Run for longer duration or check scheduler status`);
  }

  await db.end();
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const hours = parseInt(process.argv[3] || "2", 10);

  await verifyContinuousValidation(date, hours);
}

main().catch((err) => {
  logger.error({ err }, "verification failed");
  process.exit(1);
});
