/**
 * Production scheduler worker for continuous validation runs.
 * Automatically starts validation runs on a schedule to catch new data.
 * 
 * Features:
 * - Prevents duplicate runs (checks for active runs)
 * - Handles failures gracefully
 * - Logs all scheduled runs
 * - Can be run as PM2 cron job or standalone
 * 
 * Usage:
 *   PM2 cron: every 15 minutes
 *   Standalone: node src/workers/schedulerWorker.js
 */

import axios from "axios";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { db } from "../lib/db.js";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = config.apiBaseUrl;
const SCHEDULE_INTERVAL_MINUTES = parseInt(process.env.SCHEDULE_INTERVAL_MINUTES || "15", 10);
const MAX_CONCURRENT_RUNS = parseInt(process.env.MAX_CONCURRENT_RUNS || "1", 10);

/**
 * Get today's date in YYYY-MM-DD format (IST timezone)
 */
function getTodayIST() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 10);
}

/**
 * Check if there's already an active run for today
 */
async function hasActiveRunForToday(date) {
  try {
    const result = await db.query(`
      SELECT run_id, status, start_time
      FROM runs
      WHERE from_date::text LIKE $1 || '%'
        AND status IN ('RUNNING', 'PARTIAL_FAILED')
        AND start_time > NOW() - INTERVAL '2 hours'
      ORDER BY start_time DESC
      LIMIT 1
    `, [date]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    logger.error({ err: error, date }, "failed to check active runs");
    return null;
  }
}

/**
 * Get the latest completed run for today
 */
async function getLatestRunForToday(date) {
  try {
    const result = await db.query(`
      SELECT run_id, status, items_fetched, start_time, end_time
      FROM runs
      WHERE from_date::text LIKE $1 || '%'
        AND status IN ('SUCCESS', 'PARTIAL_FAILED', 'FAILED')
      ORDER BY start_time DESC
      LIMIT 1
    `, [date]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    logger.error({ err: error, date }, "failed to get latest run");
    return null;
  }
}

/**
 * Start a new validation run for today
 */
async function startValidationRun(date) {
  try {
    logger.info({ date }, "starting scheduled validation run");

    const response = await axios.post(
      `${API_BASE}/v1/runs`,
      {
        status: "pending",
        from: date,
        to: date,
        resultPerPage: 100
      },
      {
        timeout: 10000,
        headers: { "Content-Type": "application/json" }
      }
    );

    const runId = response.data.runId;
    logger.info({ runId, date }, "scheduled run started");

    return { success: true, runId };
  } catch (error) {
    logger.error(
      {
        err: error,
        status: error.response?.status,
        date
      },
      "failed to start scheduled run"
    );
    return { success: false, error: error.message };
  }
}

/**
 * Main scheduler logic
 */
async function runScheduler() {
  const today = getTodayIST();
  const now = new Date();

  logger.info({ today, timestamp: now.toISOString() }, "scheduler tick");

  try {
    // Check for active runs
    const activeRun = await hasActiveRunForToday(today);
    if (activeRun) {
      logger.info(
        {
          activeRunId: activeRun.run_id,
          status: activeRun.status,
          startTime: activeRun.start_time
        },
        "skipping - active run exists"
      );
      return;
    }

    // Check latest completed run
    const latestRun = await getLatestRunForToday(today);
    if (latestRun) {
      const runAge = now - new Date(latestRun.start_time);
      const runAgeMinutes = Math.floor(runAge / 60000);

      // If run completed very recently (< 5 minutes), skip to avoid too frequent runs
      if (runAgeMinutes < 5 && latestRun.status === "SUCCESS") {
        logger.info(
          {
            latestRunId: latestRun.run_id,
            ageMinutes: runAgeMinutes,
            itemsFetched: latestRun.items_fetched
          },
          "skipping - recent successful run exists"
        );
        return;
      }
    }

    // Start new run
    const result = await startValidationRun(today);
    if (result.success) {
      logger.info(
        { runId: result.runId, date: today },
        "scheduled validation run started successfully"
      );
    } else {
      logger.error(
        { error: result.error, date: today },
        "failed to start scheduled run"
      );
    }
  } catch (error) {
    logger.error({ err: error }, "scheduler error");
  }
}

/**
 * Run scheduler once (for cron/PM2)
 */
async function main() {
  try {
    await runScheduler();
    await db.end();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "scheduler failed");
    await db.end();
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runScheduler, getTodayIST };
