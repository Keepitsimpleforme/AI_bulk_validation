/**
 * System diagnostic: DB, runs, validation results, queues.
 * Run: node src/scripts/diagnose.js
 * Or in Docker: docker compose run --rm app node src/scripts/diagnose.js
 */

import { db } from "../lib/db.js";
import { config } from "../config.js";
import { rawBatchesQueue, validatedBatchesQueue } from "../lib/queues.js";
import { redisConnection } from "../lib/redis.js";

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  BULK VALIDATION PIPELINE – SYSTEM DIAGNOSTIC");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Time:", now.toISOString());
  console.log("Today (date key):", today);
  console.log("");

  try {
    // ─── Runs ─────────────────────────────────────────────────────────────
    const runsRes = await db.query(`
      SELECT run_id, status, from_date, to_date,
             items_fetched, validated_count, accepted_count, rejected_count,
             delivered_count, delivery_failed_count, ingestion_completed,
             start_time, end_time
      FROM runs
      ORDER BY start_time DESC
      LIMIT 10
    `);
    const runs = runsRes.rows;

    console.log("─── RUNS (latest 10) ─────────────────────────────────────────");
    if (runs.length === 0) {
      console.log("  No runs found. Scheduler or POST /v1/runs will create one.");
    } else {
      runs.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.run_id}`);
        console.log(`     status=${r.status} from=${r.from_date} to=${r.to_date}`);
        console.log(`     items_fetched=${r.items_fetched} validated=${r.validated_count} accepted=${r.accepted_count} rejected=${r.rejected_count}`);
        console.log(`     ingestion_completed=${r.ingestion_completed} start=${r.start_time}`);
      });
    }
    console.log("");

    // ─── Validation results (today) ───────────────────────────────────────
    const vrRes = await db.query(
      `SELECT COUNT(*) AS cnt FROM validation_results vr
       JOIN runs r ON r.run_id = vr.run_id
       WHERE DATE(r.start_time AT TIME ZONE 'Asia/Kolkata') = $1::date`,
      [today]
    );
    const validatedToday = parseInt(vrRes.rows[0]?.cnt ?? "0", 10);

    console.log("─── VALIDATION RESULTS (today IST) ───────────────────────────");
    console.log("  Rows for today:", validatedToday);
    if (validatedToday === 0) {
      console.log("  → Hourly publish will send nothing until there is validated data for today.");
    }
    console.log("");

    // ─── Queues (Redis) ───────────────────────────────────────────────────
    let rawWaiting = 0,
      rawActive = 0,
      validatedWaiting = 0,
      validatedActive = 0;
    try {
      rawWaiting = await rawBatchesQueue.getWaitingCount();
      rawActive = await rawBatchesQueue.getActiveCount();
      validatedWaiting = await validatedBatchesQueue.getWaitingCount();
      validatedActive = await validatedBatchesQueue.getActiveCount();
    } catch (e) {
      console.log("  (Redis queue counts skipped:", e.message, ")");
    }

    console.log("─── QUEUES (BullMQ) ─────────────────────────────────────────");
    console.log("  raw_batches:      waiting=" + rawWaiting + " active=" + rawActive);
    console.log("  validated_batches: waiting=" + validatedWaiting + " active=" + validatedActive);
    if (rawWaiting > 0 || rawActive > 0) {
      console.log("  → Ingestion is adding batches; validation worker should be processing.");
    }
    if (validatedWaiting > 0 || validatedActive > 0) {
      console.log("  → Validation is producing batches; delivery worker should be sending.");
    }
    console.log("");

    // ─── Config (safe summary) ─────────────────────────────────────────────
    console.log("─── CONFIG (summary) ───────────────────────────────────────");
    console.log("  GS1_TOKEN:        ", config.gs1.token ? "***set***" : "NOT SET (ingestion will fail)");
    console.log("  DATABASE_URL:     ", config.databaseUrl ? "set" : "NOT SET");
    console.log("  REDIS_URL:        ", config.redisUrl || "default");
    console.log("  DOWNSTREAM_URL:   ", config.downstream.url ? "set" : "not set (delivery no-op)");
    console.log("  HOURLY_PUBLISH_URL:", config.hourlyPublishUrl ? "set" : "not set");
    console.log("  API_BASE_URL:     ", config.apiBaseUrl || "default (scheduler)");
    console.log("");

    // ─── Recommendations ──────────────────────────────────────────────────
    console.log("─── RECOMMENDATIONS ─────────────────────────────────────────");
    const latest = runs[0];
    if (!latest) {
      console.log("  1. Start a run: curl -X POST http://localhost:3000/v1/runs -H 'Content-Type: application/json' -d '{\"status\":\"pending\",\"from\":\"" + today + "\",\"to\":\"" + today + "\",\"resultPerPage\":100}'");
      console.log("  2. Or wait for scheduler (every 15 min) to start a run for today.");
    } else if (
      (latest.status === "RUNNING" || latest.status === "PARTIAL_FAILED") &&
      latest.items_fetched === 0
    ) {
      console.log("  1. Ingestion failed (0 items fetched). Check app logs for GS1 errors:");
      console.log("     docker compose logs app --tail 80");
      console.log("  2. On VM, ensure GS1_TOKEN in .env is valid and same as local (401 = bad/expired token).");
    } else if (latest.status === "RUNNING" && latest.validated_count === 0 && latest.items_fetched > 0) {
      console.log("  1. Data is being fetched; validation worker should be processing. Check worker-validation logs.");
    } else if (validatedToday > 0) {
      console.log("  1. Validated data for today exists. Hourly publish will send on the next hour (:00).");
    }
    console.log("");
  } catch (err) {
    console.error("Diagnostic error:", err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
    redisConnection.disconnect();
    process.exit(process.exitCode ?? 0);
  }
}

main();
