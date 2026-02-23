/**
 * Enhanced monitoring script with periodic reports for long-running validation runs.
 * Tracks GS1 API total vs fetched count, validates catch-up with new data, and generates reports.
 *
 * Usage:
 *   node src/scripts/monitorWithReports.js <runId> [durationMinutes]
 *   node src/scripts/monitorWithReports.js a764ef21-33f2-4bdb-b70b-2d645c784115 60
 */

import axios from "axios";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";

dotenv.config();

const API_BASE = `http://127.0.0.1:${config.port}`;
const GS1_BASE = config.gs1.baseUrl;
const GS1_TOKEN = config.gs1.token;

// Report storage
const reportsDir = path.join(process.cwd(), "outputs", "monitoring");
let reportData = [];
let startTime = Date.now();
let lastGs1Total = null;
let lastItemsFetched = 0;
let lastReportTime = Date.now();
let dataArrivalLog = []; // Track when new data arrives in GS1
let fetchLog = []; // Track when we fetch data

async function ensureReportsDir() {
  try {
    await fs.mkdir(reportsDir, { recursive: true });
  } catch (error) {
    // Ignore if exists
  }
}

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

function normalizeDateForGs1(dateInput) {
  if (!dateInput) return dateInput;
  const str = String(dateInput);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // Ignore
  }
  const dateMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : str;
}

async function getGs1TotalCount(status, from, to) {
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
    const pageInfo = data?.pageInfo || {};
    return {
      totalResults: pageInfo.totalResults || 0,
      currentPageResults: pageInfo.currentPageResults || 0,
      success: true
    };
  } catch (error) {
    return {
      totalResults: null,
      currentPageResults: null,
      success: false,
      error: error.message
    };
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const secs = seconds % 60;
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function printStatus(run, gs1Count, startTime, reportInterval) {
  clearScreen();
  const elapsed = Date.now() - startTime;
  const elapsedMinutes = Math.floor(elapsed / 60000);
  const runDate = normalizeDateForGs1(run.from_date) || "N/A";
  const toDate = normalizeDateForGs1(run.to_date) || runDate;

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║     ENHANCED VALIDATION MONITORING WITH REPORTS                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nRun ID: ${run.run_id}`);
  console.log(`Date Range: ${runDate} ${toDate !== runDate ? `to ${toDate}` : ""}`);
  console.log(`Status: ${run.status || "UNKNOWN"}`);
  console.log(`Elapsed: ${formatDuration(elapsed)} (${elapsedMinutes} minutes)`);
  console.log(`Next Report: ${reportInterval - elapsedMinutes} minutes`);
  
  console.log("\n─ Progress ────────────────────────────────────────────────────");
  console.log(`  Pages Fetched:     ${run.pages_fetched || 0}`);
  console.log(`  Items Fetched:      ${run.items_fetched || 0}`);
  console.log(`  Validated:          ${run.validated_count || 0}`);
  console.log(`  Accepted:           ${run.accepted_count || 0}`);
  console.log(`  Rejected:           ${run.rejected_count || 0}`);
  console.log(`  Delivered:          ${run.delivered_count || 0}`);
  console.log(`  Delivery Failed:    ${run.delivery_failed_count || 0}`);
  console.log(`  Ingestion Complete: ${run.ingestion_completed ? "✓" : "✗"}`);
  
  console.log("\n─ GS1 API Status ──────────────────────────────────────────────");
  if (gs1Count.success && gs1Count.totalResults !== null) {
    const fetched = run.items_fetched || 0;
    const total = gs1Count.totalResults;
    const remaining = Math.max(0, total - fetched);
    const percent = total > 0 ? ((fetched / total) * 100).toFixed(1) : 0;
    const newItems = lastGs1Total !== null && total > lastGs1Total ? total - lastGs1Total : 0;
    const itemsSinceLastCheck = fetched - lastItemsFetched;
    const now = new Date();
    
    // Track new data arrival
    if (newItems > 0) {
      dataArrivalLog.push({
        timestamp: now.toISOString(),
        gs1_total: total,
        new_items: newItems,
        previous_total: lastGs1Total
      });
    }
    
    // Track fetching activity
    if (itemsSinceLastCheck > 0) {
      fetchLog.push({
        timestamp: now.toISOString(),
        items_fetched: itemsSinceLastCheck,
        total_fetched: fetched,
        remaining: remaining
      });
    }
    
    console.log(`  Total in GS1:       ${total} ${newItems > 0 ? `(+${newItems} new)` : ""}`);
    console.log(`  Fetched:            ${fetched}`);
    console.log(`  Remaining:          ${remaining}`);
    console.log(`  Progress:           ${percent}%`);
    
    if (newItems > 0) {
      console.log(`  🆕 NEW DATA:        +${newItems} items detected at ${now.toLocaleTimeString()}`);
      // Check if we're catching up
      const timeSinceArrival = dataArrivalLog.length > 0 
        ? Math.floor((now - new Date(dataArrivalLog[dataArrivalLog.length - 1].timestamp)) / 1000)
        : 0;
      if (itemsSinceLastCheck > 0) {
        console.log(`  ✅ Catching up:     Fetched ${itemsSinceLastCheck} items since last check`);
      } else {
        console.log(`  ⏳ Waiting:         ${timeSinceArrival}s since new data arrived`);
      }
    }
    
    if (remaining > 0 && run.status === "RUNNING") {
      if (itemsSinceLastCheck > 0) {
        console.log(`  ⚡ Active:          ${remaining} items pending (${itemsSinceLastCheck} fetched since last check)`);
      } else {
        console.log(`  ⏸️  Paused/Waiting   ${remaining} items pending`);
      }
    } else if (remaining === 0 && run.status === "RUNNING") {
      console.log(`  ✓ All items fetched, validating/delivering...`);
    } else if (run.status === "SUCCESS") {
      console.log(`  ✓ Run completed     ${fetched}/${total} items processed`);
    }
  } else {
    console.log(`  GS1 API:            ${gs1Count.error || "Unable to fetch"}`);
  }
  
  // Show recent data arrival and fetch activity
  if (dataArrivalLog.length > 0 || fetchLog.length > 0) {
    console.log("\n─ Data Activity Timeline ─────────────────────────────────────");
    const recentArrivals = dataArrivalLog.slice(-5).reverse();
    const recentFetches = fetchLog.slice(-5).reverse();
    
    if (recentArrivals.length > 0) {
      console.log("  Recent Data Arrivals in GS1:");
      recentArrivals.forEach((entry, idx) => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        console.log(`    ${idx + 1}. ${time} - +${entry.new_items} items (Total: ${entry.gs1_total})`);
      });
    }
    
    if (recentFetches.length > 0) {
      console.log("  Recent Fetch Activity:");
      recentFetches.forEach((entry, idx) => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        console.log(`    ${idx + 1}. ${time} - Fetched ${entry.items_fetched} items (Total: ${entry.total_fetched}, Remaining: ${entry.remaining})`);
      });
    }
  }
  
  console.log("\n─ Timestamps ──────────────────────────────────────────────────");
  if (run.start_time) {
    console.log(`  Started:            ${new Date(run.start_time).toLocaleString()}`);
  }
  if (run.end_time) {
    console.log(`  Completed:          ${new Date(run.end_time).toLocaleString()}`);
  }
  if (run.last_checkpoint_at) {
    console.log(`  Last Checkpoint:     ${new Date(run.last_checkpoint_at).toLocaleString()}`);
  }
  
  console.log(`\n  [Monitoring for ${reportInterval} minutes. Press Ctrl+C to stop]\n`);
}

async function saveReport(run, gs1Count, elapsedMs) {
  const reportEntry = {
    timestamp: new Date().toISOString(),
    elapsed_seconds: Math.floor(elapsedMs / 1000),
    run: {
      status: run.status,
      items_fetched: run.items_fetched || 0,
      validated_count: run.validated_count || 0,
      accepted_count: run.accepted_count || 0,
      rejected_count: run.rejected_count || 0,
      delivered_count: run.delivered_count || 0,
      ingestion_completed: run.ingestion_completed || false
    },
    gs1: {
      total_results: gs1Count.totalResults,
      fetched_vs_total: gs1Count.totalResults !== null ? {
        fetched: run.items_fetched || 0,
        total: gs1Count.totalResults,
        remaining: Math.max(0, (gs1Count.totalResults || 0) - (run.items_fetched || 0)),
        percent: gs1Count.totalResults > 0 
          ? (((run.items_fetched || 0) / gs1Count.totalResults) * 100).toFixed(1)
          : 0
      } : null
    },
    data_activity: {
      new_arrivals_since_last_report: dataArrivalLog.filter(e => 
        new Date(e.timestamp) > new Date(lastReportTime)
      ).length,
      fetch_events_since_last_report: fetchLog.filter(e => 
        new Date(e.timestamp) > new Date(lastReportTime)
      ).length
    }
  };
  
  reportData.push(reportEntry);
  
  // Save periodic report
  const reportFile = path.join(reportsDir, `monitoring_${run.run_id}_${Date.now()}.json`);
  try {
    await fs.writeFile(reportFile, JSON.stringify(reportEntry, null, 2));
  } catch (error) {
    logger.warn({ error: error.message }, "failed to save report");
  }
}

async function saveFinalReport(runId) {
  const finalReport = {
    run_id: runId,
    monitoring_start: new Date(startTime).toISOString(),
    monitoring_end: new Date().toISOString(),
    duration_seconds: Math.floor((Date.now() - startTime) / 1000),
    reports: reportData,
    data_arrival_log: dataArrivalLog,
    fetch_log: fetchLog,
    summary: {
      total_reports: reportData.length,
      initial_items_fetched: reportData[0]?.run?.items_fetched || 0,
      final_items_fetched: reportData[reportData.length - 1]?.run?.items_fetched || 0,
      items_processed_during_monitoring: (reportData[reportData.length - 1]?.run?.items_fetched || 0) - (reportData[0]?.run?.items_fetched || 0),
      initial_gs1_total: reportData[0]?.gs1?.total_results || null,
      final_gs1_total: reportData[reportData.length - 1]?.gs1?.total_results || null,
      new_items_detected: reportData[reportData.length - 1]?.gs1?.total_results && reportData[0]?.gs1?.total_results
        ? (reportData[reportData.length - 1]?.gs1?.total_results - reportData[0]?.gs1?.total_results)
        : null,
      data_arrival_events: dataArrivalLog.length,
      fetch_events: fetchLog.length,
      total_new_items_arrived: dataArrivalLog.reduce((sum, e) => sum + e.new_items, 0),
      total_items_fetched_during_monitoring: fetchLog.reduce((sum, e) => sum + e.items_fetched, 0)
    }
  };
  
  const finalReportFile = path.join(reportsDir, `final_report_${runId}.json`);
  await fs.writeFile(finalReportFile, JSON.stringify(finalReport, null, 2));
  
  // Also save CSV summary
  const csvLines = ["timestamp,elapsed_seconds,items_fetched,validated,accepted,rejected,delivered,gs1_total,remaining,percent,new_arrivals,fetch_events"];
  for (const entry of reportData) {
    const gs1 = entry.gs1?.fetched_vs_total;
    csvLines.push([
      entry.timestamp,
      entry.elapsed_seconds,
      entry.run.items_fetched,
      entry.run.validated_count,
      entry.run.accepted_count,
      entry.run.rejected_count,
      entry.run.delivered_count,
      gs1?.total || "",
      gs1?.remaining || "",
      gs1?.percent || "",
      entry.data_activity?.new_arrivals_since_last_report || 0,
      entry.data_activity?.fetch_events_since_last_report || 0
    ].join(","));
  }
  
  // Save detailed data arrival log CSV
  const arrivalCsvLines = ["timestamp,gs1_total,new_items,previous_total"];
  for (const entry of dataArrivalLog) {
    arrivalCsvLines.push([
      entry.timestamp,
      entry.gs1_total,
      entry.new_items,
      entry.previous_total
    ].join(","));
  }
  const arrivalCsvFile = path.join(reportsDir, `data_arrivals_${runId}.csv`);
  await fs.writeFile(arrivalCsvFile, arrivalCsvLines.join("\n"));
  
  // Save detailed fetch log CSV
  const fetchCsvLines = ["timestamp,items_fetched,total_fetched,remaining"];
  for (const entry of fetchLog) {
    fetchCsvLines.push([
      entry.timestamp,
      entry.items_fetched,
      entry.total_fetched,
      entry.remaining
    ].join(","));
  }
  const fetchCsvFile = path.join(reportsDir, `fetch_activity_${runId}.csv`);
  await fs.writeFile(fetchCsvFile, fetchCsvLines.join("\n"));
  
  const csvFile = path.join(reportsDir, `monitoring_${runId}.csv`);
  await fs.writeFile(csvFile, csvLines.join("\n"));
  
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    FINAL REPORT SAVED                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nReports saved to:`);
  console.log(`  JSON: ${finalReportFile}`);
  console.log(`  CSV:  ${csvFile}`);
  console.log(`  Data Arrivals CSV: ${arrivalCsvFile}`);
  console.log(`  Fetch Activity CSV: ${fetchCsvFile}`);
  console.log(`\nSummary:`);
  console.log(`  Duration: ${formatDuration(finalReport.duration_seconds * 1000)}`);
  console.log(`  Reports: ${finalReport.summary.total_reports}`);
  console.log(`  Items processed: ${finalReport.summary.items_processed_during_monitoring}`);
  console.log(`  Data arrival events: ${finalReport.summary.data_arrival_events}`);
  console.log(`  Fetch events: ${finalReport.summary.fetch_events}`);
  console.log(`  Total new items arrived: +${finalReport.summary.total_new_items_arrived}`);
  console.log(`  Total items fetched: ${finalReport.summary.total_items_fetched_during_monitoring}`);
  if (finalReport.summary.new_items_detected !== null) {
    console.log(`  Net change in GS1 total: +${finalReport.summary.new_items_detected}`);
  }
}

async function monitorRun(runId, durationMinutes = 60, pollIntervalMs = 5000, reportIntervalMinutes = 5) {
  const deadline = Date.now() + (durationMinutes * 60 * 1000);
  let reportCount = 0;
  
  await ensureReportsDir();
  
  console.log(`Starting enhanced monitoring for run: ${runId}`);
  console.log(`Duration: ${durationMinutes} minutes`);
  console.log(`Polling every ${pollIntervalMs / 1000}s`);
  console.log(`Reports every ${reportIntervalMinutes} minutes\n`);

  while (Date.now() < deadline) {
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

      const elapsed = Date.now() - startTime;
      const elapsedMinutes = Math.floor(elapsed / 60000);
      const reportInterval = reportIntervalMinutes;
      
      printStatus(run, gs1Count, startTime, reportInterval);

      // Save report periodically
      if (Date.now() - lastReportTime >= (reportIntervalMinutes * 60 * 1000)) {
        await saveReport(run, gs1Count, elapsed);
        lastReportTime = Date.now();
        reportCount++;
      }

      // Track changes
      if (gs1Count.totalResults !== null) {
        if (lastGs1Total !== null && gs1Count.totalResults > lastGs1Total) {
          const newItems = gs1Count.totalResults - lastGs1Total;
          logger.info(
            { runId, newItems, gs1Total: gs1Count.totalResults, fetched: run.items_fetched },
            "new data detected in GS1"
          );
        }
        lastGs1Total = gs1Count.totalResults;
      }
      lastItemsFetched = run.items_fetched || 0;

      // Check if run completed
      if (run.status === "SUCCESS" || run.status === "PARTIAL_FAILED" || run.status === "FAILED") {
        console.log("\n╔════════════════════════════════════════════════════════════════╗");
        console.log(`║  Run ${run.status === "SUCCESS" ? "COMPLETED" : "FINISHED"} - ${run.status}  ║`);
        console.log("╚════════════════════════════════════════════════════════════════╝");
        await saveReport(run, gs1Count, elapsed);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      console.error("\n❌ Error monitoring run:", error.message);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  
  // Save final report
  const finalRun = await getRunStatus(runId);
  const finalGs1Count = finalRun 
    ? await getGs1TotalCount(finalRun.status_filter || "pending", finalRun.from_date, finalRun.to_date)
    : { totalResults: null, success: false };
  
  if (finalRun) {
    await saveReport(finalRun, finalGs1Count, Date.now() - startTime);
  }
  await saveFinalReport(runId);
}

async function main() {
  const runId = process.argv[2];
  const durationMinutes = parseInt(process.argv[3] || "60", 10);

  if (!runId) {
    console.error("Usage: node src/scripts/monitorWithReports.js <runId> [durationMinutes]");
    console.error("   Example: node src/scripts/monitorWithReports.js a764ef21-33f2-4bdb-b70b-2d645c784115 60");
    process.exit(1);
  }

  // Handle Ctrl+C gracefully
  process.on("SIGINT", async () => {
    console.log("\n\nStopping monitoring...");
    await saveFinalReport(runId);
    process.exit(0);
  });

  await monitorRun(runId, durationMinutes);
}

main().catch((err) => {
  logger.error({ err }, "monitor failed");
  process.exit(1);
});
