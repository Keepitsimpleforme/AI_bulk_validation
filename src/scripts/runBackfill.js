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
 * - All validated GTINs from backfill appear in today's reports/dashboards.
 *
 * To chunk backfill or bypass GS1 12,000 item limit, provide dates:
 *   node src/scripts/runBackfill.js --from 2024-01-01 --to 2024-06-30
 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { createRun, updateRunStatus } from "../repositories/runRepository.js";
import { ingestBackfillRun } from "../services/ingestionService.js";

async function main() {
  const args = process.argv.slice(2);
  let fromDate = null;
  let toDate = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i+1]) {
      fromDate = args[i+1];
      i++;
    } else if (args[i] === '--to' && args[i+1]) {
      toDate = args[i+1];
      i++;
    }
  }

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
  console.log("Date (from/to):", fromDate ? `${fromDate} to ${toDate || 'Now'}` : "All Time (subject to API limits)");
  console.log("Log Date:      ", today);
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
      startCursor: null,
      from: fromDate,
      to: toDate
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

