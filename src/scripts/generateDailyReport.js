import { generateDailySummary } from "../services/reportingService.js";
import { logger } from "../lib/logger.js";

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);

generateDailySummary(date)
  .then((result) => {
    logger.info({ date, paths: [result.jsonPath, result.csvPath] }, "daily report generated");
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ err: error }, "daily report generation failed");
    process.exit(1);
  });
