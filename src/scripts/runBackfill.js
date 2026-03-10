/**
 * Manual backfill script: walk GS1 modified_date cursor stream and enqueue
 * only GTINs that have NOT been validated before.
 *
 * Usage:
 *   node src/scripts/runBackfill.js
 *
 * - Uses GS1 cursor endpoint:
 *     ?paginate=cursor&status=pending&resultperPage=BACKFILL_RESULT_PER_PAGE
 *     &sortBy=modified_date&sortDir=asc
 * - Does NOT use from/to date filters.
 * - Every run is a fresh backfill run with a new run_id.
 * - All validated GTINs from backfill appear in today's reports/dashboards.
 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { createRun, updateRunStatus } from "../repositories/runRepository.js";
import { ingestBackfillRun } from "../services/ingestionService.js";

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const runId = randomUUID();
  const statusFilter = "pending";
  const resultPerPage =
    Number(process.env.BACKFILL_RESULT_PER_PAGE) && Number(process.env.BACKFILL_RESULT_PER_PAGE) > 0
      ? Number(process.env.BACKFILL_RESULT_PER_PAGE)
      : 10;

  console.log("\n─── GS1 Backfill Run ───");
  console.log("Run ID:        ", runId);
  console.log("Status filter: ", statusFilter);
  console.log("Result/page:   ", resultPerPage);
  console.log("Date (from/to):", today);
  console.log("");

  if (!config.gs1.token) {
    console.error("GS1_TOKEN is not set in .env – cannot run backfill.");
    process.exit(1);
  }

  // Create a run row so results integrate with existing reporting/delivery.
  await createRun({
    runId,
    statusFilter,
    from: today,
    to: today,
    resultPerPage
  });

  try {
    const { totalPages, totalItems, totalEnqueued, totalSkipped } = await ingestBackfillRun({
      runId,
      statusFilter,
      resultPerPage,
      startCursor: null
    });

    await updateRunStatus(runId, "SUCCESS");

    console.log("Backfill completed.");
    console.log(`  Pages fetched from GS1:      ${totalPages}`);
    console.log(`  Items seen from GS1:        ${totalItems}`);
    console.log(`  New items enqueued/validated: ${totalEnqueued}`);
    console.log(`  Skipped (already validated): ${totalSkipped}`);
    console.log("");
  } catch (error) {
    await updateRunStatus(runId, "PARTIAL_FAILED");
    logger.error({ err: error, runId }, "backfill run failed");
    console.error("Backfill run failed:", error.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

