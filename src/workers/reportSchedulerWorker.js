import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { generateDailySummary, generateRunReport } from "../services/reportingService.js";

function getTodayISTDateString() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function getLatestCompletedRunIdForDate(date) {
  const { rows } = await db.query(
    `SELECT run_id
     FROM runs
     WHERE DATE(start_time AT TIME ZONE 'Asia/Kolkata') = $1::date
       AND status IN ('SUCCESS', 'PARTIAL_FAILED')
     ORDER BY end_time DESC NULLS LAST, start_time DESC
     LIMIT 1`,
    [date]
  );
  return rows[0]?.run_id ?? null;
}

async function runReportScheduler() {
  const reportDate = process.env.REPORT_DATE ?? getTodayISTDateString();
  logger.info({ reportDate }, "report scheduler tick");

  const latestRunId = await getLatestCompletedRunIdForDate(reportDate);
  if (!latestRunId) {
    logger.warn({ reportDate }, "no completed run found for report generation");
    return;
  }

  const runReport = await generateRunReport(latestRunId);
  const daily = await generateDailySummary(reportDate);

  logger.info(
    {
      reportDate,
      runId: latestRunId,
      runReportJson: runReport.jsonPath,
      runReportCsv: runReport.csvPath,
      validationResultsCsv: runReport.resultsCsvPath,
      dailyJson: daily.jsonPath,
      dailyCsv: daily.csvPath
    },
    "2-hour reports generated"
  );
}

async function main() {
  try {
    await runReportScheduler();
    await db.end();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "report scheduler failed");
    await db.end();
    process.exit(1);
  }
}

main();
