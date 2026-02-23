import { logger } from "../lib/logger.js";
import { getRun, getCheckpoint, updateRunStatus } from "../repositories/runRepository.js";
import { ingestRun } from "../services/ingestionService.js";

const runId = process.env.RUN_ID;

if (!runId) {
  logger.error("RUN_ID is required for ingestion worker");
  process.exit(1);
}

const start = async () => {
  const run = await getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  const checkpoint = await getCheckpoint(runId);

  try {
    await ingestRun({
      runId,
      statusFilter: run.status_filter,
      from: run.from_date,
      to: run.to_date,
      resultPerPage: run.result_per_page,
      startCursor: checkpoint?.cursor_out ?? null
    });
    logger.info({ runId }, "ingestion completed");
  } catch (error) {
    await updateRunStatus(runId, "PARTIAL_FAILED");
    logger.error({ err: error, runId }, "ingestion failed");
    process.exit(1);
  }
};

start();
