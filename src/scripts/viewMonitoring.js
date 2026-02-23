/**
 * View monitoring reports and current run status.
 * 
 * Usage:
 *   node src/scripts/viewMonitoring.js [runId]
 *   node src/scripts/viewMonitoring.js                    # Shows latest run
 */

import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { config } from "../config.js";

const API_BASE = `http://127.0.0.1:${config.port}`;
const reportsDir = path.join(process.cwd(), "outputs", "monitoring");

async function getLatestRunId() {
  try {
    // Try to find latest report file
    const files = await fs.readdir(reportsDir);
    const reportFiles = files.filter(f => f.startsWith("final_report_") && f.endsWith(".json"));
    if (reportFiles.length === 0) return null;
    
    // Get most recent
    const stats = await Promise.all(
      reportFiles.map(async (f) => {
        const stat = await fs.stat(path.join(reportsDir, f));
        return { file: f, mtime: stat.mtime };
      })
    );
    stats.sort((a, b) => b.mtime - a.mtime);
    const latest = stats[0].file;
    const runId = latest.replace("final_report_", "").replace(".json", "");
    return runId;
  } catch (error) {
    return null;
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

async function loadReport(runId) {
  try {
    const reportPath = path.join(reportsDir, `final_report_${runId}.json`);
    const content = await fs.readFile(reportPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function printDashboard(run, report) {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║              VALIDATION MONITORING DASHBOARD                   ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  
  console.log(`\n📊 Run ID: ${run.run_id}`);
  console.log(`   Status: ${run.status}`);
  
  if (run.start_time) {
    console.log(`   Started: ${new Date(run.start_time).toLocaleString()}`);
  }
  if (run.end_time) {
    console.log(`   Completed: ${new Date(run.end_time).toLocaleString()}`);
  }
  
  console.log("\n─ Processing Stats ─────────────────────────────────────────────");
  console.log(`  Items Fetched:      ${run.items_fetched || 0}`);
  console.log(`  Validated:          ${run.validated_count || 0}`);
  console.log(`  Accepted:           ${run.accepted_count || 0} (${run.items_fetched > 0 ? ((run.accepted_count / run.items_fetched) * 100).toFixed(1) : 0}%)`);
  console.log(`  Rejected:           ${run.rejected_count || 0} (${run.items_fetched > 0 ? ((run.rejected_count / run.items_fetched) * 100).toFixed(1) : 0}%)`);
  console.log(`  Delivered:          ${run.delivered_count || 0}`);
  console.log(`  Delivery Failed:    ${run.delivery_failed_count || 0}`);
  console.log(`  Ingestion Complete: ${run.ingestion_completed ? "✓ Yes" : "✗ No"}`);
  
  if (report) {
    const summary = report.summary || {};
    const duration = report.duration_seconds || summary.duration_seconds || 0;
    console.log("\n─ Monitoring Summary ──────────────────────────────────────────");
    console.log(`  Monitoring Duration: ${formatDuration(duration)}`);
    console.log(`  Reports Generated:  ${summary.total_reports || report.reports?.length || 0}`);
    console.log(`  Items Processed:    ${summary.items_processed_during_monitoring || 0}`);
    
    if (summary.new_items_detected !== null && summary.new_items_detected > 0) {
      console.log(`  🆕 New Items Detected: +${summary.new_items_detected}`);
    }
    
    if (report.reports.length > 0) {
      const firstReport = report.reports[0];
      const lastReport = report.reports[report.reports.length - 1];
      
      if (firstReport.gs1?.total_results && lastReport.gs1?.total_results) {
        console.log("\n─ GS1 API Comparison ──────────────────────────────────────────");
        console.log(`  Initial GS1 Total:  ${firstReport.gs1.total_results}`);
        console.log(`  Final GS1 Total:    ${lastReport.gs1.total_results}`);
        const change = lastReport.gs1.total_results - firstReport.gs1.total_results;
        if (change > 0) {
          console.log(`  Change:             +${change} items (new data added)`);
        } else if (change < 0) {
          console.log(`  Change:             ${change} items`);
        } else {
          console.log(`  Change:             No change`);
        }
      }
    }
  }
  
  console.log("\n─ Report Files ──────────────────────────────────────────────────");
  const csvPath = path.join(reportsDir, `monitoring_${run.run_id}.csv`);
  const jsonPath = path.join(reportsDir, `final_report_${run.run_id}.json`);
  console.log(`  CSV:  ${csvPath}`);
  console.log(`  JSON: ${jsonPath}`);
  
  console.log("\n");
}

async function main() {
  let runId = process.argv[2];
  
  if (!runId) {
    runId = await getLatestRunId();
    if (!runId) {
      console.error("No run ID provided and no reports found.");
      console.error("Usage: node src/scripts/viewMonitoring.js [runId]");
      process.exit(1);
    }
    console.log(`Using latest run: ${runId}`);
  }
  
  const run = await getRunStatus(runId);
  if (!run) {
    console.error(`Run ${runId} not found!`);
    process.exit(1);
  }
  
  const report = await loadReport(runId);
  
  printDashboard(run, report);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
